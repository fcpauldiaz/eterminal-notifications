import type {
  ChartMarker,
  ChartZone,
  ColorRole,
  DirectedSetup,
  ExtremeBand,
  ExtremeLevelLabel,
  ExtensionSettings,
  FlowExtremeHit,
  FlowPoint,
  NearCrossSnapshot,
  OpexAlignedLevel,
  PricePoint,
  ProfileBar,
  RetailFlowPoint,
  SetupKind,
  Spx3ViewResponse,
} from "./types";

export function lastPoint<T>(series: T[] | undefined): T | null {
  if (!series?.length) {
    return null;
  }
  return series[series.length - 1] ?? null;
}

export function biasLabel(role: ColorRole | null): string {
  if (!role) {
    return "Unknown";
  }
  const lower = role.toLowerCase();
  if (lower === "bullish") {
    return "Bullish";
  }
  if (lower === "bearish") {
    return "Bearish";
  }
  if (lower === "neutral") {
    return "Neutral";
  }
  return role;
}

export function normalizeBias(role: ColorRole | null): ColorRole | null {
  if (!role) {
    return null;
  }
  const lower = role.toLowerCase();
  if (lower === "bullish" || lower === "bearish" || lower === "neutral") {
    return lower;
  }
  return role;
}

export function isNeutralBias(role: ColorRole | null): boolean {
  return normalizeBias(role) === "neutral";
}

export function computeNearCross(
  retailSeries: RetailFlowPoint[] | undefined,
  instSeries: FlowPoint[] | undefined,
  threshold: number,
): NearCrossSnapshot {
  const retail = lastPoint(retailSeries);
  const inst = lastPoint(instSeries);

  if (!retail || !inst) {
    return {
      nearCross: false,
      gap: Number.POSITIVE_INFINITY,
      retailValue: 0,
      instValue: 0,
    };
  }

  const gap = Math.abs(retail.value - inst.value);
  return {
    nearCross: gap < threshold,
    gap,
    retailValue: retail.value,
    instValue: inst.value,
  };
}

export function pointAtOffset<T>(
  series: T[] | undefined,
  offsetFromEnd: number,
): T | null {
  if (!series?.length) {
    return null;
  }
  const index = series.length - 1 - offsetFromEnd;
  if (index < 0) {
    return null;
  }
  return series[index] ?? null;
}

/** Last `count` values oldest → newest. */
export function recentValues(
  series: FlowPoint[] | undefined,
  count: number,
): number[] {
  if (!series?.length || count <= 0) {
    return [];
  }
  return series.slice(Math.max(0, series.length - count)).map((p) => p.value);
}

export function seriesSlope(
  series: FlowPoint[] | undefined,
  lookbackBars: number,
): number {
  const values = recentValues(series, Math.max(2, lookbackBars + 1));
  if (values.length < 2) {
    return 0;
  }
  return values[values.length - 1]! - values[0]!;
}

function stepDirectionStats(values: number[]): {
  up: number;
  down: number;
  flat: number;
  steps: number;
} {
  let up = 0;
  let down = 0;
  let flat = 0;
  for (let i = 1; i < values.length; i += 1) {
    const delta = values[i]! - values[i - 1]!;
    if (delta > 0) {
      up += 1;
    } else if (delta < 0) {
      down += 1;
    } else {
      flat += 1;
    }
  }
  return { up, down, flat, steps: Math.max(0, values.length - 1) };
}

/** Drop consecutive duplicate values (series holds flat 1m copies between ~5m updates). */
function compressConsecutive(values: number[]): number[] {
  if (!values.length) {
    return [];
  }
  const out: number[] = [values[0]!];
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] !== out[out.length - 1]) {
      out.push(values[i]!);
    }
  }
  return out;
}

/**
 * Flow prints often stair-step for ~5 bars. Pull a longer raw window, compress
 * flats, then keep the last lookback+1 distinct points for direction checks.
 */
function recentTrajectoryValues(
  series: FlowPoint[] | undefined,
  lookbackBars: number,
): number[] {
  const need = Math.max(2, lookbackBars + 1);
  // ~5m cadence on 1m series → up to need*6 raw points; keep a cushion.
  const raw = recentValues(series, need * 6);
  return compressConsecutive(raw).slice(-need);
}

/** Direction ratios ignore flat holds so stair-steps don't dilute up/down %. */
function activeStepRatios(values: number[]): {
  upRatio: number;
  downRatio: number;
} {
  const steps = stepDirectionStats(values);
  const active = steps.up + steps.down;
  return {
    upRatio: active ? steps.up / active : 0,
    downRatio: active ? steps.down / active : 0,
  };
}

export type ApproachTrajectory = {
  validFromBelow: boolean;
  validFromAbove: boolean;
  gapShrinking: boolean;
  startedBelowRetail: boolean;
  startedAboveRetail: boolean;
  netMove: number;
  upRatio: number;
  downRatio: number;
  pathSummary: string;
};

export function analyzeApproachTrajectory(
  instSeries: FlowPoint[] | undefined,
  retailSeries: RetailFlowPoint[] | undefined,
  settings: ExtensionSettings,
): ApproachTrajectory {
  const lookback = Math.max(2, settings.slopeLookbackBars);
  const inst = recentTrajectoryValues(instSeries, lookback);
  const retail = recentTrajectoryValues(retailSeries, lookback);
  const empty: ApproachTrajectory = {
    validFromBelow: false,
    validFromAbove: false,
    gapShrinking: false,
    startedBelowRetail: false,
    startedAboveRetail: false,
    netMove: 0,
    upRatio: 0,
    downRatio: 0,
    pathSummary: "insufficient history",
  };

  if (inst.length < 3 || retail.length < 3) {
    return empty;
  }

  const startInst = inst[0]!;
  const endInst = inst[inst.length - 1]!;
  const startRetail = retail[0]!;
  const endRetail = retail[retail.length - 1]!;
  const netMove = endInst - startInst;
  const { upRatio, downRatio } = activeStepRatios(inst);
  const startGap = Math.abs(startInst - startRetail);
  const endGap = Math.abs(endInst - endRetail);
  const gapShrinking = endGap < startGap - 0.15;
  const startedBelowRetail = startInst < startRetail - 0.25;
  const startedAboveRetail = startInst > startRetail + 0.25;
  const minRatio = settings.trajectoryMinStepRatio;
  const minMove = settings.trajectoryMinMove;

  const validFromBelow =
    startedBelowRetail &&
    netMove >= minMove &&
    upRatio >= minRatio &&
    gapShrinking &&
    endInst <= endRetail + 1;

  const validFromAbove =
    startedAboveRetail &&
    netMove <= -minMove &&
    downRatio >= minRatio &&
    gapShrinking &&
    endInst >= endRetail - 1;

  const pathSummary = [
    `inst ${startInst.toFixed(1)}→${endInst.toFixed(1)}`,
    `retail ${startRetail.toFixed(1)}→${endRetail.toFixed(1)}`,
    `gap ${startGap.toFixed(1)}→${endGap.toFixed(1)}`,
    `up ${(upRatio * 100).toFixed(0)}% down ${(downRatio * 100).toFixed(0)}%`,
  ].join(" · ");

  return {
    validFromBelow,
    validFromAbove,
    gapShrinking,
    startedBelowRetail,
    startedAboveRetail,
    netMove,
    upRatio,
    downRatio,
    pathSummary,
  };
}

export type ZoneTrajectory = {
  inZone: boolean;
  openedInZone: boolean;
  enteredFromBelow: boolean;
  enteredFromAbove: boolean;
  pathSummary: string;
};

export function analyzeZoneTrajectory(
  instSeries: FlowPoint[] | undefined,
  settings: ExtensionSettings,
): ZoneTrajectory {
  const lookback = Math.max(2, settings.slopeLookbackBars);
  const values = recentTrajectoryValues(instSeries, lookback);
  const center = settings.preferredZoneCenter;
  const width = settings.preferredZoneWidth;
  const zoneLow = center - width;
  const zoneHigh = center + width;

  const inZoneValue = (value: number) =>
    value >= zoneLow && value <= zoneHigh;

  if (values.length < 3) {
    return {
      inZone: false,
      openedInZone: false,
      enteredFromBelow: false,
      enteredFromAbove: false,
      pathSummary: "insufficient history",
    };
  }

  const start = values[0]!;
  const end = values[values.length - 1]!;
  const inZone = inZoneValue(end);
  const openedInZone = inZoneValue(start);
  const { upRatio, downRatio } = activeStepRatios(values);
  const netMove = end - start;
  const minRatio = settings.trajectoryMinStepRatio;
  const minMove = settings.trajectoryMinMove;

  // Short-context preferred zone: rise from more negative into ~-10.
  const enteredFromBelow =
    inZone &&
    !openedInZone &&
    start < zoneLow &&
    netMove >= minMove &&
    upRatio >= minRatio;

  const enteredFromAbove =
    inZone &&
    !openedInZone &&
    start > zoneHigh &&
    netMove <= -minMove &&
    downRatio >= minRatio;

  return {
    inZone,
    openedInZone,
    enteredFromBelow,
    enteredFromAbove,
    pathSummary: `zone ${zoneLow.toFixed(0)}..${zoneHigh.toFixed(0)} · ${start.toFixed(1)}→${end.toFixed(1)}${
      openedInZone ? " · opened in zone" : ""
    }`,
  };
}

export function inPreferredZone(
  instValue: number,
  center: number,
  width: number,
): boolean {
  return Math.abs(instValue - center) <= width;
}

export function detectDirectedSetup(
  bias: ColorRole | null,
  retailValue: number,
  instValue: number,
  gap: number,
  nearCross: boolean,
  instSlope: number,
  approach: ApproachTrajectory,
  zone: ZoneTrajectory,
  settings: ExtensionSettings,
): DirectedSetup | null {
  const normalized = normalizeBias(bias);
  if (!nearCross || !normalized || normalized === "neutral") {
    return null;
  }

  // Preferred zone only counts with a real entry trajectory (not already open inside).
  const preferredZone =
    zone.enteredFromBelow ||
    (normalized === "bearish" && zone.enteredFromAbove);

  const pathSummary = `${approach.pathSummary} | ${zone.pathSummary}`;

  if (normalized === "bearish" && approach.validFromBelow) {
    return {
      kind: "short_cross",
      gap,
      retailValue,
      instValue,
      instSlope,
      bias: normalized,
      preferredZone: preferredZone && zone.enteredFromBelow,
      alertKey:
        preferredZone && zone.enteredFromBelow
          ? "short_cross_zone"
          : "short_cross",
      pathSummary,
      gapShrinking: approach.gapShrinking,
    };
  }

  if (normalized === "bullish" && approach.validFromBelow) {
    return {
      kind: "long_cross",
      gap,
      retailValue,
      instValue,
      instSlope,
      bias: normalized,
      preferredZone: false,
      alertKey: "long_cross",
      pathSummary,
      gapShrinking: approach.gapShrinking,
    };
  }

  if (normalized === "bullish" && approach.validFromAbove) {
    return {
      kind: "long_cross",
      gap,
      retailValue,
      instValue,
      instSlope,
      bias: normalized,
      preferredZone: false,
      alertKey: "long_cross_from_above",
      pathSummary,
      gapShrinking: approach.gapShrinking,
    };
  }

  if (normalized === "bearish" && approach.validFromAbove) {
    return {
      kind: "short_cross",
      gap,
      retailValue,
      instValue,
      instSlope,
      bias: normalized,
      preferredZone: Boolean(preferredZone && zone.enteredFromAbove),
      alertKey:
        preferredZone && zone.enteredFromAbove
          ? "short_cross_zone"
          : "short_cross_from_above",
      pathSummary,
      gapShrinking: approach.gapShrinking,
    };
  }

  void settings;
  return null;
}

function extremeLabel(band: ExtremeBand, positive: boolean): ExtremeLevelLabel {
  return (positive ? `+${band}` : `-${band}`) as ExtremeLevelLabel;
}

function lastIndexWhere(
  values: number[],
  predicate: (value: number) => boolean,
): number {
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (predicate(values[i]!)) {
      return i;
    }
  }
  return -1;
}

export function detectExtremes(
  seriesName: "retail" | "inst",
  series: FlowPoint[] | undefined,
  bands: ExtremeBand[],
  settings: ExtensionSettings,
  previousPollValue: number | null,
): FlowExtremeHit[] {
  const lookback = Math.max(
    settings.slopeLookbackBars,
    settings.extremeLookbackBars,
  );
  const values = recentValues(series, lookback + 1);
  if (values.length < 2 && previousPollValue == null) {
    return [];
  }

  const end = values.length
    ? values[values.length - 1]!
    : (previousPollValue as number);
  const minMove = settings.trajectoryMinMove;
  const hits: FlowExtremeHit[] = [];
  const sorted = [...bands].sort((a, b) => a - b);

  for (const band of sorted) {
    if (end >= band) {
      const lastInsideIdx = lastIndexWhere(values, (value) => value < band);
      const seriesEntry =
        lastInsideIdx >= 0 && lastInsideIdx < values.length - 1;
      const pollEntry =
        previousPollValue != null && previousPollValue < band;
      const enteredFromInside = seriesEntry || pollEntry;
      const fromValue = seriesEntry
        ? values[lastInsideIdx]!
        : pollEntry
          ? previousPollValue!
          : values[0] ?? previousPollValue ?? end;
      const moveInto = end - fromValue;
      const directedApproach = moveInto >= minMove;
      const openedBeyond =
        !pollEntry &&
        !seriesEntry &&
        values.length > 0 &&
        values.every((value) => value >= band);
      const trajectoryValid =
        enteredFromInside && directedApproach && !openedBeyond;

      hits.push({
        key: `${seriesName}:+${band}`,
        series: seriesName,
        band,
        label: extremeLabel(band, true),
        value: end,
        enteredFromInside,
        directedApproach,
        trajectoryValid,
        pathSummary: trajectoryValid
          ? `rose into +${band} (${fromValue.toFixed(1)}→${end.toFixed(1)}${
              pollEntry && !seriesEntry ? ", poll" : ""
            })`
          : openedBeyond
            ? `already beyond +${band} over lookback`
            : `at +${band} without valid upward path`,
      });
    }

    if (end <= -band) {
      const lastInsideIdx = lastIndexWhere(values, (value) => value > -band);
      const seriesEntry =
        lastInsideIdx >= 0 && lastInsideIdx < values.length - 1;
      const pollEntry =
        previousPollValue != null && previousPollValue > -band;
      const enteredFromInside = seriesEntry || pollEntry;
      const fromValue = seriesEntry
        ? values[lastInsideIdx]!
        : pollEntry
          ? previousPollValue!
          : values[0] ?? previousPollValue ?? end;
      const moveInto = end - fromValue;
      const directedApproach = moveInto <= -minMove;
      const openedBeyond =
        !pollEntry &&
        !seriesEntry &&
        values.length > 0 &&
        values.every((value) => value <= -band);
      const trajectoryValid =
        enteredFromInside && directedApproach && !openedBeyond;

      hits.push({
        key: `${seriesName}:-${band}`,
        series: seriesName,
        band,
        label: extremeLabel(band, false),
        value: end,
        enteredFromInside,
        directedApproach,
        trajectoryValid,
        pathSummary: trajectoryValid
          ? `fell into -${band} (${fromValue.toFixed(1)}→${end.toFixed(1)}${
              pollEntry && !seriesEntry ? ", poll" : ""
            })`
          : openedBeyond
            ? `already beyond -${band} over lookback`
            : `at -${band} without valid downward path`,
      });
    }
  }

  return hits;
}

export function bothExtremeSameSide(
  retailValue: number,
  instValue: number,
  band: ExtremeBand = 30,
): { bearish: boolean; bullish: boolean } {
  // Terminal convention: +flow extremes are bearish, −flow extremes are bullish.
  return {
    bearish: retailValue >= band && instValue >= band,
    bullish: retailValue <= -band && instValue <= -band,
  };
}

export function computeOpexAligned(
  general: ProfileBar[] | undefined,
  opex: ProfileBar[] | undefined,
  widthThreshold: number,
): OpexAlignedLevel[] {
  if (!general?.length || !opex?.length) {
    return [];
  }

  const generalByPrice = new Map<number, number>();
  for (const bar of general) {
    generalByPrice.set(bar.centerPrice, bar.widthRatio);
  }

  const aligned: OpexAlignedLevel[] = [];
  for (const bar of opex) {
    const generalWidth = generalByPrice.get(bar.centerPrice);
    if (generalWidth == null) {
      continue;
    }
    if (generalWidth < widthThreshold || bar.widthRatio < widthThreshold) {
      continue;
    }
    aligned.push({
      centerPrice: bar.centerPrice,
      generalWidth,
      opexWidth: bar.widthRatio,
      strength: Math.min(generalWidth, bar.widthRatio),
    });
  }

  return aligned.sort((a, b) => b.strength - a.strength);
}

export function nearestAlignedLevel(
  price: number | null,
  aligned: OpexAlignedLevel[],
  proximity: number,
): OpexAlignedLevel | null {
  if (price == null || !aligned.length) {
    return null;
  }
  let best: OpexAlignedLevel | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const level of aligned) {
    const dist = Math.abs(price - level.centerPrice);
    if (dist <= proximity && dist < bestDist) {
      best = level;
      bestDist = dist;
    }
  }
  return best;
}

export function currentPriceValue(view: Spx3ViewResponse): number | null {
  if (view.currentPrice && typeof view.currentPrice.value === "number") {
    return view.currentPrice.value;
  }
  const last = lastPoint(view.priceSeries as PricePoint[] | undefined);
  return last?.value ?? null;
}

export type PlaybookEvaluation = {
  bias: ColorRole | null;
  retailValue: number;
  instValue: number;
  gap: number;
  nearCross: boolean;
  instSlope: number;
  setup: DirectedSetup | null;
  retailExtremes: FlowExtremeHit[];
  instExtremes: FlowExtremeHit[];
  bothExtremeBearish: boolean;
  bothExtremeBullish: boolean;
  opexAligned: OpexAlignedLevel[];
  nearOpex: OpexAlignedLevel | null;
  price: number | null;
  approach: ApproachTrajectory;
  zone: ZoneTrajectory;
};

export function evaluatePlaybook(
  view: Spx3ViewResponse,
  settings: ExtensionSettings,
  previous: { retailValue: number | null; instValue: number | null } = {
    retailValue: null,
    instValue: null,
  },
): PlaybookEvaluation {
  const retailLast = lastPoint(view.retailFlowSeries);
  const instLast = lastPoint(view.instFlowSeries);
  const near = computeNearCross(
    view.retailFlowSeries,
    view.instFlowSeries,
    settings.nearCrossThreshold,
  );
  const retailValue = retailLast?.value ?? near.retailValue;
  const instValue = instLast?.value ?? near.instValue;
  const bias = normalizeBias(retailLast?.colorRole ?? null);
  const instSlope = seriesSlope(
    view.instFlowSeries,
    settings.slopeLookbackBars,
  );
  const approach = analyzeApproachTrajectory(
    view.instFlowSeries,
    view.retailFlowSeries,
    settings,
  );
  const zone = analyzeZoneTrajectory(view.instFlowSeries, settings);
  const setup = detectDirectedSetup(
    bias,
    retailValue,
    instValue,
    near.gap,
    near.nearCross,
    instSlope,
    approach,
    zone,
    settings,
  );
  const retailExtremes = detectExtremes(
    "retail",
    view.retailFlowSeries,
    settings.flowExtremeBands,
    settings,
    previous.retailValue,
  );
  const instExtremes = detectExtremes(
    "inst",
    view.instFlowSeries,
    settings.flowExtremeBands,
    settings,
    previous.instValue,
  );
  const sameSide = bothExtremeSameSide(retailValue, instValue, 30);
  const opexAligned = computeOpexAligned(
    view.profileBars,
    view.opexProfileBars,
    settings.opexWidthThreshold,
  );
  const price = currentPriceValue(view);
  const nearOpex = nearestAlignedLevel(
    price,
    opexAligned,
    settings.opexPriceProximity,
  );

  return {
    bias,
    retailValue,
    instValue,
    gap: near.gap,
    nearCross: near.nearCross,
    instSlope,
    setup,
    retailExtremes,
    instExtremes,
    bothExtremeBearish: sameSide.bearish,
    bothExtremeBullish: sameSide.bullish,
    opexAligned,
    nearOpex,
    price,
    approach,
    zone,
  };
}

export function setupKindLabel(kind: SetupKind): string {
  return kind === "short_cross" ? "Short setup" : "Long setup";
}

function priceAtOrNear(
  prices: PricePoint[],
  time: number,
): PricePoint | null {
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

function resolveZoneKind(
  kindRaw: string,
  styleRaw: string,
): "R" | "S" | null {
  const kind = kindRaw.toUpperCase();
  const style = styleRaw.toLowerCase();
  if (kind === "R" || style.includes("resistance")) {
    return "R";
  }
  if (kind === "S" || style.includes("support")) {
    return "S";
  }
  // Pivots / SR intentionally ignored.
  return null;
}

/**
 * R and S area bands only (pivots/SR skipped).
 * Price must sit inside [bottomPrice, topPrice].
 */
export function parseChartZones(areas: unknown): ChartZone[] {
  if (!Array.isArray(areas)) {
    return [];
  }
  const out: ChartZone[] = [];
  for (const raw of areas) {
    if (!raw || typeof raw !== "object") {
      continue;
    }
    const entry = raw as {
      centerPrice?: unknown;
      topPrice?: unknown;
      bottomPrice?: unknown;
      label?: unknown;
      kind?: unknown;
      style?: unknown;
    };
    const kind = resolveZoneKind(
      String(entry.kind ?? ""),
      String(entry.style ?? ""),
    );
    if (!kind) {
      continue;
    }
    if (
      typeof entry.centerPrice !== "number" ||
      typeof entry.topPrice !== "number" ||
      typeof entry.bottomPrice !== "number"
    ) {
      continue;
    }
    if (
      !Number.isFinite(entry.centerPrice) ||
      !Number.isFinite(entry.topPrice) ||
      !Number.isFinite(entry.bottomPrice)
    ) {
      continue;
    }
    const top = Math.max(entry.topPrice, entry.bottomPrice);
    const bottom = Math.min(entry.topPrice, entry.bottomPrice);
    out.push({
      label: typeof entry.label === "string" ? entry.label : kind,
      kind,
      centerPrice: entry.centerPrice,
      topPrice: top,
      bottomPrice: bottom,
    });
  }
  return out;
}

function priceInsideZone(price: number, zone: ChartZone): boolean {
  return price >= zone.bottomPrice && price <= zone.topPrice;
}

function zoneContaining(
  price: number,
  zones: ChartZone[],
): ChartZone | null {
  let best: ChartZone | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const zone of zones) {
    if (!priceInsideZone(price, zone)) {
      continue;
    }
    const dist = Math.abs(price - zone.centerPrice);
    if (dist < bestDist) {
      best = zone;
      bestDist = dist;
    }
  }
  return best;
}

type PairedFlowPoint = {
  time: number;
  retail: number;
  inst: number;
};

/** Forward-fill r/i and keep only bars where either flow value changed. */
function pairedFlowChanges(
  retail: RetailFlowPoint[],
  inst: FlowPoint[],
): PairedFlowPoint[] {
  const retailByTime = new Map(retail.map((point) => [point.time, point.value]));
  const instByTime = new Map(inst.map((point) => [point.time, point.value]));
  const times = [
    ...new Set([...retailByTime.keys(), ...instByTime.keys()]),
  ].sort((a, b) => a - b);

  const paired: PairedFlowPoint[] = [];
  let lastRetail: number | null = null;
  let lastInst: number | null = null;

  for (const time of times) {
    if (retailByTime.has(time)) {
      lastRetail = retailByTime.get(time)!;
    }
    if (instByTime.has(time)) {
      lastInst = instByTime.get(time)!;
    }
    if (lastRetail == null || lastInst == null) {
      continue;
    }
    const prev = paired[paired.length - 1];
    if (prev && prev.retail === lastRetail && prev.inst === lastInst) {
      continue;
    }
    paired.push({ time, retail: lastRetail, inst: lastInst });
  }

  return paired;
}

/**
 * Retail vs inst crosses while SPX is inside an R or S area band.
 * Pivots/SR ignored. Backfills the full series window each poll.
 * R → red (above), S → green (below).
 */
export function findFlowRsCrossMarkers(
  view: Spx3ViewResponse,
  dayKey: string,
): ChartMarker[] {
  const retail = view.retailFlowSeries ?? [];
  const inst = view.instFlowSeries ?? [];
  const prices = view.priceSeries ?? [];
  const zones = parseChartZones(view.areas);
  if (retail.length < 2 || inst.length < 2 || !prices.length || !zones.length) {
    return [];
  }

  const paired = pairedFlowChanges(retail, inst);
  if (paired.length < 2) {
    return [];
  }

  const markers: ChartMarker[] = [];

  for (let i = 1; i < paired.length; i += 1) {
    const prev = paired[i - 1]!;
    const curr = paired[i]!;
    const priorDiff = prev.retail - prev.inst;
    const currDiff = curr.retail - curr.inst;
    const crossed = priorDiff !== 0 && priorDiff * currDiff <= 0;
    if (!crossed) {
      continue;
    }

    const at = priceAtOrNear(prices, curr.time);
    if (at == null) {
      continue;
    }

    const zone = zoneContaining(at.value, zones);
    if (!zone) {
      continue;
    }

    markers.push({
      id: `flow-rs:${dayKey}:${at.time}:${zone.kind}:${zone.centerPrice}`,
      time: at.time,
      price: at.value,
      side: zone.kind === "R" ? "above" : "below",
      color: zone.kind === "R" ? "red" : "green",
      kind: "flow_rs",
      label: `×${zone.label}`,
      levelLabel: zone.label,
      levelKind: zone.kind,
    });
  }

  return markers;
}
