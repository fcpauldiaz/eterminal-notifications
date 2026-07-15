import {
  AuthRequiredError,
  fetchSpx3View,
  hasTerminalSessionCookie,
} from "../shared/api";
import type { ExtensionMessage } from "../shared/messages";
import { signalAlertPayload } from "../shared/ntfy";
import { notifyDual } from "../shared/notify";
import {
  biasLabel,
  evaluatePlaybook,
  findFlowRsCrossMarkers,
  isNeutralBias,
  setupKindLabel,
  type PlaybookEvaluation,
} from "../shared/playbook";
import {
  getEtDateKey,
  getSessionKey,
  getTradingSession,
  isAtOrAfterRthOpen,
  isCboeResetWindow,
  isWithinPollWindow,
} from "../shared/schedule";
import {
  loadFlowUi,
  loadPollState,
  loadSettings,
  saveFlowUi,
  savePollState,
} from "../shared/storage";
import {
  IDLE_PERIOD_MINUTES,
  POLL_ALARM_NAME,
  POLL_PERIOD_MINUTES,
  type ChartMarker,
  type ExtremeBand,
  type ExtremeLevelLabel,
  type ExtensionSettings,
  type FlowExtremeHit,
  type FlowUiState,
  type PollState,
  type Spx3Signal,
  type Spx3ViewResponse,
} from "../shared/types";

async function setBadge(text: string, color = "#c0392b"): Promise<void> {
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

async function clearBadge(): Promise<void> {
  await chrome.action.setBadgeText({ text: "" });
}

async function broadcastFlow(state: FlowUiState): Promise<void> {
  await saveFlowUi(state);
  const tabs = await chrome.tabs.query({
    url: ["https://terminal.emini.today/*"],
  });
  const message: ExtensionMessage = { type: "FLOW_UPDATE", state };
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id == null) {
        return;
      }
      try {
        await chrome.tabs.sendMessage(tab.id, message);
      } catch {
        // Content script may not be injected yet.
      }
    }),
  );
}

function ntfyFromSettings(settings: ExtensionSettings) {
  return {
    baseUrl: settings.ntfyBaseUrl,
    topic: settings.ntfyTopic,
    token: settings.ntfyToken || undefined,
  };
}

function emptyUi(
  settings: ExtensionSettings,
  patch: Partial<FlowUiState> = {},
): FlowUiState {
  return {
    bias: null,
    nearCross: false,
    gap: Number.POSITIVE_INFINITY,
    retailValue: 0,
    instValue: 0,
    threshold: settings.nearCrossThreshold,
    updatedAt: new Date().toISOString(),
    authOk: true,
    session: getTradingSession(),
    mixedFlow: false,
    mutedYellow: false,
    mutedCboe: isCboeResetWindow(),
    setupKind: null,
    preferredZone: false,
    instSlope: 0,
    pathSummary: null,
    extremes: [],
    bothExtremeBearish: false,
    opexAlignedCount: 0,
    nearOpexLevel: null,
    extremeMarkers: [],
    chartTimeStart: null,
    chartTimeEnd: null,
    chartPrice: null,
    chartPriceMin: null,
    chartPriceMax: null,
    chartLevels: [],
    ...patch,
  };
}

function extractLevelPrices(levels: unknown): number[] {
  if (!Array.isArray(levels)) {
    return [];
  }
  const prices: number[] = [];
  for (const level of levels) {
    if (
      level &&
      typeof level === "object" &&
      "price" in level &&
      typeof (level as { price: unknown }).price === "number"
    ) {
      prices.push((level as { price: number }).price);
    }
  }
  return [...new Set(prices)];
}

function chartMetaFromView(view: Spx3ViewResponse | null | undefined): {
  chartTimeStart: number | null;
  chartTimeEnd: number | null;
  chartPrice: number | null;
  chartPriceMin: number | null;
  chartPriceMax: number | null;
  chartLevels: number[];
} {
  const series = view?.priceSeries ?? [];
  const last = series.length ? series[series.length - 1] : null;
  // SPX3 price pane is framed around RTH; using the overnight series start
  // for linear X mapping shifts morning markers hours to the right.
  const rthStart = series.find((point) => isAtOrAfterRthOpen(point.time));
  return {
    chartTimeStart: rthStart?.time ?? series[0]?.time ?? null,
    chartTimeEnd: view?.currentPrice?.time ?? last?.time ?? null,
    chartPrice: view?.currentPrice?.value ?? last?.value ?? null,
    chartPriceMin: series.length
      ? Math.min(...series.map((point) => point.value))
      : null,
    chartPriceMax: series.length
      ? Math.max(...series.map((point) => point.value))
      : null,
    chartLevels: extractLevelPrices(view?.levels),
  };
}

function toFlowUi(
  settings: ExtensionSettings,
  evaled: PlaybookEvaluation,
  poll: PollState,
  authOk: boolean,
  view?: Spx3ViewResponse | null,
): FlowUiState {
  const extremeLabels = [...evaled.retailExtremes, ...evaled.instExtremes].map(
    (hit) => hit.label,
  );
  return {
    bias: evaled.bias,
    nearCross: evaled.nearCross,
    gap: evaled.gap,
    retailValue: evaled.retailValue,
    instValue: evaled.instValue,
    threshold: settings.nearCrossThreshold,
    updatedAt: new Date().toISOString(),
    authOk,
    session: getTradingSession(),
    mixedFlow: poll.seenBullishInDay && poll.seenBearishInDay,
    mutedYellow: isNeutralBias(evaled.bias),
    mutedCboe: isCboeResetWindow(),
    setupKind: evaled.setup?.kind ?? null,
    preferredZone: evaled.setup?.preferredZone ?? false,
    instSlope: evaled.instSlope,
    pathSummary: evaled.setup?.pathSummary ?? evaled.approach.pathSummary,
    extremes: [...new Set(extremeLabels)],
    bothExtremeBearish: evaled.bothExtremeBearish,
    opexAlignedCount: evaled.opexAligned.length,
    nearOpexLevel: evaled.nearOpex?.centerPrice ?? null,
    extremeMarkers: poll.extremeChartMarkers ?? [],
    ...chartMetaFromView(view),
  };
}

function hasAlerted(poll: PollState, key: string): boolean {
  return poll.sessionAlertedTypes.includes(key);
}

function markAlerted(poll: PollState, key: string): PollState {
  if (hasAlerted(poll, key)) {
    return poll;
  }
  return {
    ...poll,
    sessionAlertedTypes: [...poll.sessionAlertedTypes, key],
  };
}

function resetForSession(poll: PollState, sessionKey: string, dayKey: string): PollState {
  const dayChanged = poll.dayKey !== dayKey;
  return {
    ...poll,
    sessionKey,
    dayKey,
    sessionAlertedTypes: [],
    seenBullishInDay: dayChanged ? false : poll.seenBullishInDay,
    seenBearishInDay: dayChanged ? false : poll.seenBearishInDay,
    nearCrossActive: false,
    activeExtremeKeys: [],
    extremeChartMarkers: dayChanged ? [] : poll.extremeChartMarkers ?? [],
  };
}

function priceAtTime(
  prices: { time: number; value: number }[],
  time: number,
): { time: number; value: number } | null {
  if (!prices.length) {
    return null;
  }
  let best = prices[0]!;
  let bestDist = Math.abs(best.time - time);
  for (const point of prices) {
    const dist = Math.abs(point.time - time);
    if (dist < bestDist) {
      best = point;
      bestDist = dist;
    }
  }
  return best;
}

function compressFlowPoints(
  series: { time: number; value: number }[] | undefined,
): { time: number; value: number }[] {
  if (!series?.length) {
    return [];
  }
  const out: { time: number; value: number }[] = [series[0]!];
  for (let i = 1; i < series.length; i += 1) {
    const point = series[i]!;
    if (point.value !== out[out.length - 1]!.value) {
      out.push(point);
    }
  }
  return out;
}

function backfillExtremeMarkersFromSeries(
  view: Spx3ViewResponse,
  bands: ExtremeBand[],
  dayKey: string,
): ChartMarker[] {
  const prices = view.priceSeries ?? [];
  const sortedBands = [...bands].sort((a, b) => a - b);
  const markers: ChartMarker[] = [];

  const pushMarker = (
    seriesName: "retail" | "inst",
    band: ExtremeBand,
    positive: boolean,
    point: { time: number; value: number },
  ) => {
    // Snap to a price-bar time so chart timeToCoordinate can resolve the bar.
    const at = priceAtTime(prices, point.time);
    if (at == null) {
      return;
    }
    const label = (positive ? `+${band}` : `-${band}`) as ExtremeLevelLabel;
    markers.push({
      id: `extreme-marker:${seriesName}:${label}:${dayKey}`,
      time: at.time,
      price: at.value,
      side: positive ? "above" : "below",
      // +bands = bearish (red), −bands = bullish (green)
      color: positive ? "red" : "green",
      label,
      kind: "extreme",
      series: seriesName,
    });
  };

  const scan = (
    seriesName: "retail" | "inst",
    flow: { time: number; value: number }[] | undefined,
  ) => {
    const points = compressFlowPoints(flow);
    if (!points.length) {
      return;
    }

    for (const band of sortedBands) {
      let foundUp = false;
      let foundDown = false;

      // Series already open beyond the band (crossing happened before the window).
      if (points[0]!.value >= band) {
        pushMarker(seriesName, band, true, points[0]!);
        foundUp = true;
      }
      if (points[0]!.value <= -band) {
        pushMarker(seriesName, band, false, points[0]!);
        foundDown = true;
      }

      for (let i = 1; i < points.length; i += 1) {
        const prev = points[i - 1]!.value;
        const curr = points[i]!.value;
        if (!foundUp && prev < band && curr >= band) {
          pushMarker(seriesName, band, true, points[i]!);
          foundUp = true;
        }
        if (!foundDown && prev > -band && curr <= -band) {
          pushMarker(seriesName, band, false, points[i]!);
          foundDown = true;
        }
        if (foundUp && foundDown) {
          break;
        }
      }
    }
  };

  scan("retail", view.retailFlowSeries);
  scan("inst", view.instFlowSeries);
  return markers;
}

function stampExtremeMarkers(
  poll: PollState,
  hits: FlowExtremeHit[],
  view: Spx3ViewResponse,
  dayKey: string,
  bands: ExtremeBand[],
): PollState {
  // Rebuild from the series each poll so history before install / before
  // reload is always represented on the chart.
  const byId = new Map<string, ChartMarker>();
  for (const marker of backfillExtremeMarkersFromSeries(view, bands, dayKey)) {
    byId.set(marker.id, marker);
  }
  for (const marker of findFlowRsCrossMarkers(view, dayKey)) {
    byId.set(marker.id, marker);
  }

  const series = view.priceSeries ?? [];
  const last = series.length ? series[series.length - 1] : null;
  const price = view.currentPrice?.value ?? last?.value;
  const time = view.currentPrice?.time ?? last?.time;

  if (price != null && time != null) {
    for (const hit of hits) {
      if (!hit.trajectoryValid) {
        continue;
      }
      const id = `extreme-marker:${hit.key}:${dayKey}`;
      if (byId.has(id)) {
        continue;
      }
      const positive = hit.label.startsWith("+");
      byId.set(id, {
        id,
        time,
        price,
        side: positive ? "above" : "below",
        // +bands = bearish (red), −bands = bullish (green)
        color: positive ? "red" : "green",
        label: hit.label,
        kind: "extreme",
        series: hit.series,
      });
    }
  }

  const nextMarkers = [...byId.values()].sort((a, b) => a.time - b.time);
  const extremes = nextMarkers.filter((marker) => marker.kind === "extreme");
  const flowRs = nextMarkers.filter((marker) => marker.kind === "flow_rs");
  console.log(
    `[chart-markers] extremes=${extremes.length} flow×R/S=${flowRs.length} · ${nextMarkers
      .map((marker) => marker.label)
      .join(" ")}`,
  );

  return {
    ...poll,
    extremeChartMarkers: nextMarkers,
  };
}

async function alertNewSignals(
  settings: ExtensionSettings,
  signals: Spx3Signal[],
  caution: string | null,
): Promise<string[]> {
  const published: string[] = [];
  for (const signal of signals) {
    const payload = signalAlertPayload(signal);
    const body = caution ? `${payload.body}\n\ncaution: ${caution}` : payload.body;
    await notifyDual(ntfyFromSettings(settings), {
      ...payload,
      body,
      title: caution ? `${payload.title} (caution)` : payload.title,
    });
    published.push(signal.id);
  }
  return published;
}

async function notifySetup(
  settings: ExtensionSettings,
  evaled: PlaybookEvaluation,
  mixedFlow: boolean,
): Promise<void> {
  const setup = evaled.setup;
  if (!setup) {
    return;
  }
  await notifyDual(ntfyFromSettings(settings), {
    title: `Terminal ${setupKindLabel(setup.kind)}`,
    body: [
      `session: ${getTradingSession().toUpperCase()}`,
      `bias: ${biasLabel(setup.bias)}`,
      `gap: ${setup.gap.toFixed(3)}`,
      `retail: ${setup.retailValue.toFixed(2)}`,
      `inst: ${setup.instValue.toFixed(2)}`,
      `inst slope (${settings.slopeLookbackBars} bars): ${setup.instSlope.toFixed(2)}`,
      `trajectory: ${setup.pathSummary}`,
      setup.preferredZone
        ? `preferred zone: entered near ${settings.preferredZoneCenter}`
        : "preferred zone: no valid entry path",
      `gap shrinking: ${setup.gapShrinking ? "yes" : "no"}`,
      `mixed day: ${mixedFlow ? "yes" : "no"}`,
      "path: first-of-type this session",
    ].join("\n"),
    priority: "high",
    tags:
      setup.kind === "short_cross"
        ? "chart_with_downwards_trend,blue_circle"
        : "chart_with_upwards_trend,blue_circle",
  });
}

async function notifyExtreme(
  settings: ExtensionSettings,
  hit: FlowExtremeHit,
  caution: string | null,
): Promise<void> {
  await notifyDual(ntfyFromSettings(settings), {
    title: caution
      ? `Terminal ${hit.series} extreme ${hit.label} (caution)`
      : `Terminal ${hit.series} extreme ${hit.label}`,
    body: [
      `series: ${hit.series}`,
      `level: ${hit.label}`,
      `value: ${hit.value.toFixed(2)}`,
      `trajectory: ${hit.pathSummary}`,
      caution ? `caution: ${caution}` : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join("\n"),
    priority: "high",
    tags: hit.label.startsWith("+")
      ? "arrow_up,warning"
      : "arrow_down,warning",
  });
}

async function notifySameSideCaution(
  settings: ExtensionSettings,
  side: "bearish" | "bullish",
  evaled: PlaybookEvaluation,
): Promise<void> {
  const avoid = side === "bearish" ? "longs" : "shorts";
  await notifyDual(ntfyFromSettings(settings), {
    title: `Terminal both flows extreme ${side}`,
    body: [
      `avoid blind ${avoid}`,
      `retail: ${evaled.retailValue.toFixed(2)}`,
      `inst: ${evaled.instValue.toFixed(2)}`,
      "one-sided pressure may be too strong for countertrend",
    ].join("\n"),
    priority: "high",
    tags: "no_entry,warning",
  });
}

async function processView(
  settings: ExtensionSettings,
  view: Spx3ViewResponse,
  poll: PollState,
): Promise<PollState> {
  const now = new Date();
  const dayKey = getEtDateKey(now);
  const sessionKey = getSessionKey(now);
  const mutedCboe = isCboeResetWindow(now);

  let next: PollState =
    poll.sessionKey && poll.sessionKey !== sessionKey
      ? resetForSession(poll, sessionKey, dayKey)
      : {
          ...poll,
          sessionKey: poll.sessionKey || sessionKey,
          dayKey: poll.dayKey || dayKey,
        };

  const evaled = evaluatePlaybook(view, settings, {
    retailValue: next.prevRetailValue,
    instValue: next.prevInstValue,
  });

  const bias = evaled.bias;
  if (bias?.toLowerCase() === "bullish") {
    next = { ...next, seenBullishInDay: true };
  }
  if (bias?.toLowerCase() === "bearish") {
    next = { ...next, seenBearishInDay: true };
  }

  const mixedFlow = next.seenBullishInDay && next.seenBearishInDay;
  const mutedYellow = isNeutralBias(bias);
  const extremeHits = [...evaled.retailExtremes, ...evaled.instExtremes];
  next = stampExtremeMarkers(
    next,
    extremeHits,
    view,
    dayKey,
    settings.flowExtremeBands,
  );

  const flowUi = toFlowUi(settings, evaled, next, true, view);
  await broadcastFlow(flowUi);

  const currentIds = view.signals.map((signal) => signal.id);
  const activeExtremeKeys = extremeHits.map((hit) => hit.key);

  next = {
    ...next,
    updatedAt: flowUi.updatedAt,
    lastColorRole: bias,
    nearCrossActive: evaled.nearCross,
    activeExtremeKeys,
    prevInstValue: evaled.instValue,
    prevRetailValue: evaled.retailValue,
  };

  if (!next.baselineDone) {
    next = {
      ...next,
      signalIds: [...currentIds].sort(),
      baselineDone: true,
      sessionAlertedTypes: [],
      nearCrossActive: false,
      activeExtremeKeys,
    };
    console.log(
      `[poll] baseline saved (${currentIds.length} signals); playbook alerts armed`,
    );
    return next;
  }

  const alertsAllowed = !mutedCboe;
  const tradeAlertsAllowed = alertsAllowed && !mutedYellow;

  const known = new Set(next.signalIds);
  const newcomers = view.signals.filter((signal) => !known.has(signal.id));

  if (alertsAllowed && newcomers.length > 0) {
    const caution = mutedYellow
      ? "retail neutral/yellow - options flow less reliable"
      : mutedCboe
        ? "CBOE reset window"
        : null;
    // During yellow we still surface marked signals with caution; CBOE blocks above.
    const publishedIds = await alertNewSignals(
      settings,
      newcomers,
      mutedYellow ? caution : null,
    );
    next = {
      ...next,
      signalIds: currentIds
        .filter((id) => known.has(id) || publishedIds.includes(id))
        .sort(),
    };
  } else if (newcomers.length === 0) {
    next = {
      ...next,
      signalIds: currentIds.filter((id) => known.has(id)).sort(),
    };
  } else {
    // Muted window: absorb new IDs silently so they don't fire later as "new".
    next = {
      ...next,
      signalIds: [...currentIds].sort(),
    };
    console.log(`[poll] muted CBOE window - absorbed ${newcomers.length} signal(s)`);
  }

  // Color-role flip (informational — allowed even into yellow).
  if (
    alertsAllowed &&
    bias &&
    poll.lastColorRole &&
    bias.toLowerCase() !== poll.lastColorRole.toLowerCase()
  ) {
    await notifyDual(ntfyFromSettings(settings), {
      title: `Terminal retail flow -> ${biasLabel(bias)}`,
      body: [
        `was: ${biasLabel(poll.lastColorRole)}`,
        `now: ${biasLabel(bias)}`,
        `retail: ${evaled.retailValue.toFixed(2)}`,
        `inst: ${evaled.instValue.toFixed(2)}`,
        `session: ${getTradingSession().toUpperCase()}`,
        isNeutralBias(bias)
          ? "caution: yellow/neutral - avoid relying heavily on flow signals"
          : `mixed day: ${mixedFlow ? "yes" : "no"}`,
      ].join("\n"),
      priority: "high",
      tags:
        bias.toLowerCase() === "bullish"
          ? "chart_with_upwards_trend,green_circle"
          : bias.toLowerCase() === "bearish"
            ? "chart_with_downwards_trend,red_circle"
            : "white_circle,warning",
    });
  }

  const setupBlockedByOnesided =
    (evaled.setup?.kind === "long_cross" && evaled.bothExtremeBearish) ||
    (evaled.setup?.kind === "short_cross" && evaled.bothExtremeBullish);

  if (tradeAlertsAllowed && evaled.setup && !setupBlockedByOnesided) {
    const key = evaled.setup.alertKey;
    if (!hasAlerted(next, key)) {
      await notifySetup(settings, evaled, mixedFlow);
      next = markAlerted(next, key);
    }
  }

  // Suppress long setups / frame countertrend when both extreme bearish.
  if (tradeAlertsAllowed && evaled.bothExtremeBearish) {
    const key = "caution_both_extreme_bearish";
    if (!hasAlerted(next, key)) {
      await notifySameSideCaution(settings, "bearish", evaled);
      next = markAlerted(next, key);
    }
  }
  if (tradeAlertsAllowed && evaled.bothExtremeBullish) {
    const key = "caution_both_extreme_bullish";
    if (!hasAlerted(next, key)) {
      await notifySameSideCaution(settings, "bullish", evaled);
      next = markAlerted(next, key);
    }
  }

  if (tradeAlertsAllowed) {
    for (const hit of extremeHits) {
      if (!hit.trajectoryValid) {
        if (Math.abs(hit.value) >= hit.band) {
          console.log(
            `[extreme] skip ${hit.key} value=${hit.value.toFixed(2)} · ${hit.pathSummary}`,
          );
        }
        continue;
      }
      if (hasAlerted(next, `extreme:${hit.key}`)) {
        continue;
      }
      let caution: string | null = null;
      if (
        hit.series === "inst" &&
        hit.label.startsWith("+") &&
        evaled.bothExtremeBearish
      ) {
        caution = "both flows deeply bearish (+extremes) - do not blindly long";
      }
      if (
        hit.series === "inst" &&
        hit.label.startsWith("-") &&
        evaled.bothExtremeBullish
      ) {
        caution = "both flows deeply bullish (−extremes) - do not blindly short";
      }
      await notifyExtreme(settings, hit, caution);
      next = markAlerted(next, `extreme:${hit.key}`);
    }
  }

  if (newcomers.length === 0) {
    console.log(
      `[poll] session=${getTradingSession()} yellow=${mutedYellow} cboe=${mutedCboe} signals=${currentIds.length}`,
    );
  }

  await broadcastFlow(toFlowUi(settings, evaled, next, true, view));
  return next;
}

async function ensureAlarm(): Promise<void> {
  const periodInMinutes = isWithinPollWindow()
    ? POLL_PERIOD_MINUTES
    : IDLE_PERIOD_MINUTES;
  await chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes });
}

async function runPoll(force = false): Promise<void> {
  const settings = await loadSettings();
  if (!settings.enabled && !force) {
    await setBadge("off", "#7f8c8d");
    return;
  }

  if (!force && !isWithinPollWindow()) {
    console.log("[poll] outside 06:00-15:00 ET");
    const previous = await loadFlowUi();
    await broadcastFlow(
      emptyUi(settings, {
        ...(previous ?? {}),
        session: "off",
        mutedCboe: false,
        authOk: previous?.authOk ?? true,
        updatedAt: new Date().toISOString(),
      }),
    );
    await ensureAlarm();
    return;
  }

  try {
    const view = await fetchSpx3View();
    const poll = await loadPollState();
    const next = await processView(settings, view, poll);
    await savePollState(next);
    await clearBadge();
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      await setBadge("!");
      const previous = await loadFlowUi();
      await broadcastFlow(
        emptyUi(settings, {
          bias: previous?.bias ?? null,
          nearCross: previous?.nearCross ?? false,
          gap: previous?.gap ?? Number.POSITIVE_INFINITY,
          retailValue: previous?.retailValue ?? 0,
          instValue: previous?.instValue ?? 0,
          authOk: false,
          mixedFlow: previous?.mixedFlow ?? false,
          mutedYellow: previous?.mutedYellow ?? false,
          setupKind: previous?.setupKind ?? null,
          preferredZone: previous?.preferredZone ?? false,
          instSlope: previous?.instSlope ?? 0,
          pathSummary: previous?.pathSummary ?? null,
          extremes: previous?.extremes ?? [],
          bothExtremeBearish: previous?.bothExtremeBearish ?? false,
          opexAlignedCount: previous?.opexAlignedCount ?? 0,
          nearOpexLevel: previous?.nearOpexLevel ?? null,
          extremeMarkers: previous?.extremeMarkers ?? [],
          chartTimeStart: previous?.chartTimeStart ?? null,
          chartTimeEnd: previous?.chartTimeEnd ?? null,
          chartPrice: previous?.chartPrice ?? null,
          chartPriceMin: previous?.chartPriceMin ?? null,
          chartPriceMax: previous?.chartPriceMax ?? null,
          chartLevels: previous?.chartLevels ?? [],
        }),
      );
      console.warn("[poll] not logged into Terminal in this browser");
      return;
    }
    console.error("[poll] error:", err);
    await setBadge("err", "#e67e22");
  } finally {
    await ensureAlarm();
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureAlarm().then(() => runPoll(true));
});

chrome.runtime.onStartup.addListener(() => {
  void ensureAlarm().then(() => runPoll(true));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM_NAME) {
    void runPoll(false);
  }
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === "GET_FLOW_UI") {
    void loadFlowUi().then((state) => {
      if (!state) {
        sendResponse({ type: "FLOW_UI", state } satisfies ExtensionMessage);
        return;
      }
      sendResponse({
        type: "FLOW_UI",
        state: {
          ...state,
          session: getTradingSession(),
          mutedCboe: isCboeResetWindow(),
        },
      } satisfies ExtensionMessage);
    });
    return true;
  }

  if (message.type === "POLL_NOW") {
    void runPoll(true).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "TEST_NOTIFY") {
    void (async () => {
      console.log("[test-notify] requested");
      try {
        const settings = await loadSettings();
        const result = await notifyDual(ntfyFromSettings(settings), {
          title: "Terminal Notifications test",
          body: [
            "Manual test from the extension popup.",
            `topic: ${settings.ntfyTopic.trim() || "(empty)"}`,
            `base: ${settings.ntfyBaseUrl}`,
            `at: ${new Date().toISOString()}`,
          ].join("\n"),
          priority: "high",
          tags: "white_check_mark,bell",
        });
        console.log("[test-notify] result", result);
        sendResponse({
          type: "TEST_NOTIFY_RESULT",
          ok: result.chromeOk && (result.ntfySkipped || result.ntfyOk),
          ntfySkipped: result.ntfySkipped,
          ntfyStatus: result.ntfyStatus,
          ntfyBody: result.ntfyBody ?? result.ntfyError,
          error: result.chromeError ?? result.ntfyError,
        } satisfies ExtensionMessage);
      } catch (err) {
        console.error("[test-notify] failed", err);
        sendResponse({
          type: "TEST_NOTIFY_RESULT",
          ok: false,
          ntfySkipped: false,
          error: err instanceof Error ? err.message : String(err),
        } satisfies ExtensionMessage);
      }
    })();
    return true;
  }

  if (message.type === "GET_STATUS") {
    void (async () => {
      const settings = await loadSettings();
      const authOk = await hasTerminalSessionCookie();
      sendResponse({
        type: "STATUS",
        enabled: settings.enabled,
        authOk,
        hasNtfyTopic: Boolean(settings.ntfyTopic.trim()),
        withinWindow: isWithinPollWindow(),
      } satisfies ExtensionMessage);
    })();
    return true;
  }

  return false;
});

void ensureAlarm().then(() => runPoll(true));
