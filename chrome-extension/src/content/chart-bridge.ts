/**
 * Runs in the page MAIN world so we can reach Lightweight Charts instances
 * and convert time/price → canvas coordinates.
 */

type CoordPoint = { time: number; price: number };
type CoordResult = {
  time: number;
  price: number;
  x: number | null;
  y: number | null;
};

type VisibleRange = { from: number; to: number };

type BridgeResponse = {
  results: CoordResult[] | null;
  visible: VisibleRange | null;
  chartFound: boolean;
};

type TimeScaleLike = {
  timeToCoordinate: (time: number | string) => number | null;
  coordinateToTime?: (x: number) => unknown;
  getVisibleRange?: () => { from: unknown; to: unknown } | null;
  width?: () => number;
  subscribeVisibleTimeRangeChange?: (cb: () => void) => void;
  unsubscribeVisibleTimeRangeChange?: (cb: () => void) => void;
};

type ChartLike = {
  timeScale: () => TimeScaleLike;
  panes?: () => Array<{
    getSeries?: () => SeriesLike[];
  }>;
  series?: () => SeriesLike[];
};

type SeriesLike = {
  priceToCoordinate: (price: number) => number | null;
  setMarkers?: (markers: SeriesMarker[]) => void;
  markers?: () => SeriesMarker[];
  attachPrimitive?: (primitive: unknown) => void;
  detachPrimitive?: (primitive: unknown) => void;
};

type SeriesMarker = {
  time: number;
  position: "aboveBar" | "belowBar" | "inBar";
  shape: "circle" | "square" | "arrowUp" | "arrowDown";
  color: string;
  id?: string;
  text?: string;
  size?: number;
};

type NativeMarkerInput = {
  id: string;
  time: number;
  price: number;
  side: "above" | "below";
  color: "green" | "red";
  label: string;
};

type DrawMarker = {
  time: number;
  price: number;
  side: "above" | "below";
  color: string;
};

type CanvasTarget = {
  useMediaCoordinateSpace?: (
    cb: (scope: { context: CanvasRenderingContext2D }) => void,
  ) => void;
  useBitmapCoordinateSpace?: (
    cb: (scope: {
      context: CanvasRenderingContext2D;
      horizontalPixelRatio: number;
      verticalPixelRatio: number;
    }) => void,
  ) => void;
};

/**
 * Terminal ships LW Charts v5: series markers live in createSeriesMarkers,
 * which is not on window. We draw via attachPrimitive so dots scroll/zoom.
 */
function createMarkersPrimitive() {
  const state: {
    markers: DrawMarker[];
    chart: ChartLike | null;
    series: SeriesLike | null;
    requestUpdate: (() => void) | null;
  } = {
    markers: [],
    chart: null,
    series: null,
    requestUpdate: null,
  };

  const renderer = {
    draw(target: CanvasTarget) {
      const chart = state.chart;
      const series = state.series;
      if (!chart || !series || !state.markers.length) {
        return;
      }

      const paint = (
        ctx: CanvasRenderingContext2D,
        scaleX = 1,
        scaleY = 1,
      ) => {
        let timeScale: TimeScaleLike;
        try {
          timeScale = chart.timeScale();
        } catch {
          return;
        }

        for (const marker of state.markers) {
          let x: number | null = null;
          for (const delta of [0, -30, 30, -60, 60, -90, 90, -120, 120]) {
            try {
              const mapped = timeScale.timeToCoordinate(marker.time + delta);
              if (mapped != null && Number.isFinite(mapped)) {
                x = mapped;
                break;
              }
            } catch {
              // try next
            }
          }
          let y: number | null = null;
          try {
            const mapped = series.priceToCoordinate(marker.price);
            y = mapped != null && Number.isFinite(mapped) ? mapped : null;
          } catch {
            y = null;
          }
          if (x == null || y == null) {
            continue;
          }

          const cy =
            (marker.side === "above" ? y - 12 : y + 12) * scaleY;
          const cx = x * scaleX;
          const radius = 5.5 * Math.min(scaleX, scaleY);

          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fillStyle = marker.color;
          ctx.fill();
          ctx.lineWidth = 1.5 * Math.min(scaleX, scaleY);
          ctx.strokeStyle = "rgba(255,255,255,0.92)";
          ctx.stroke();
        }
      };

      if (typeof target.useMediaCoordinateSpace === "function") {
        target.useMediaCoordinateSpace(({ context }) => {
          paint(context, 1, 1);
        });
        return;
      }
      if (typeof target.useBitmapCoordinateSpace === "function") {
        target.useBitmapCoordinateSpace(
          ({ context, horizontalPixelRatio, verticalPixelRatio }) => {
            paint(context, horizontalPixelRatio, verticalPixelRatio);
          },
        );
      }
    },
  };

  const paneView = {
    zOrder: () => "top" as const,
    renderer: () => renderer,
  };

  const primitive = {
    attached(param: {
      chart: ChartLike;
      series: SeriesLike;
      requestUpdate: () => void;
    }) {
      state.chart = param.chart;
      state.series = param.series;
      state.requestUpdate = param.requestUpdate;
    },
    detached() {
      state.chart = null;
      state.series = null;
      state.requestUpdate = null;
    },
    paneViews: () => [paneView],
    updateAllViews: () => {
      // renderer reads live state; nothing to cache
    },
    setMarkers(markers: DrawMarker[]) {
      state.markers = markers;
      state.requestUpdate?.();
    },
    /** Ensure chart/series are bound even if attach payload shape differs. */
    bind(chart: ChartLike, series: SeriesLike) {
      state.chart = chart;
      state.series = series;
    },
  };

  return primitive;
}

type MarkersHost = {
  setMarkers: (markers: DrawMarker[]) => void;
  detach?: () => void;
};

declare global {
  interface Window {
    __eterminalFindChartCoords?: (points: CoordPoint[]) => BridgeResponse;
    LightweightCharts?: {
      createSeriesMarkers?: (
        series: SeriesLike,
        markers?: SeriesMarker[],
      ) => MarkersHost;
    };
  }
}

export {};

function isChartLike(value: unknown): value is ChartLike {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as ChartLike).timeScale === "function"
  );
}

function isSeriesLike(value: unknown): value is SeriesLike {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as SeriesLike).priceToCoordinate === "function"
  );
}

function scorePriceSeries(series: SeriesLike, samplePrice: number): number {
  try {
    const y = series.priceToCoordinate(samplePrice);
    if (y == null || !Number.isFinite(y)) {
      return -1;
    }
    let score = 1;
    // Flow panes map ~±50; SPX maps thousands into the visible pane.
    if (samplePrice > 500 && y > 0 && y < 5000) {
      score = 100;
    }
    if (typeof series.attachPrimitive === "function") {
      score += 25;
    }
    if (typeof series.setMarkers === "function") {
      score += 5;
    }
    return score;
  } catch {
    return -1;
  }
}

function findBestPriceCandidate(
  samplePrice: number,
  requireAttach = false,
): ChartCandidate | null {
  const candidates = findChartCandidates();
  let best: ChartCandidate | null = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    if (
      requireAttach &&
      typeof candidate.series.attachPrimitive !== "function" &&
      typeof candidate.series.setMarkers !== "function"
    ) {
      continue;
    }
    const score = scorePriceSeries(candidate.series, samplePrice);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore > 0 ? best : null;
}

function toDrawMarkers(inputs: NativeMarkerInput[]): DrawMarker[] {
  return inputs.map((marker) => ({
    time: marker.time > 1e12 ? Math.floor(marker.time / 1000) : marker.time,
    price: marker.price,
    side: marker.side,
    color: marker.color === "green" ? "#22c55e" : "#ef4444",
  }));
}

let markersPrimitive: ReturnType<typeof createMarkersPrimitive> | null = null;
let markersSeries: SeriesLike | null = null;
let markersChart: ChartLike | null = null;
let lastMarkerInputs: NativeMarkerInput[] = [];

function detachMarkersPrimitive(): void {
  if (markersPrimitive && markersSeries?.detachPrimitive) {
    try {
      markersSeries.detachPrimitive(markersPrimitive);
    } catch {
      // ignore
    }
  }
  markersPrimitive = null;
  markersSeries = null;
  markersChart = null;
}

function markerInputsFingerprint(inputs: NativeMarkerInput[]): string {
  return inputs
    .map(
      (marker) =>
        `${marker.id}|${marker.time}|${marker.price}|${marker.color}|${marker.side}`,
    )
    .sort()
    .join(";");
}

let lastAppliedFingerprint = "";

function applyNativeMarkers(inputs: NativeMarkerInput[]): {
  ok: boolean;
  mode: "primitive" | "createSeriesMarkers" | "setMarkers" | "none";
  count: number;
  reason?: string;
} {
  lastMarkerInputs = inputs;
  const fingerprint = markerInputsFingerprint(inputs);

  if (!inputs.length) {
    if (markersPrimitive) {
      markersPrimitive.setMarkers([]);
    }
    lastAppliedFingerprint = "";
    return { ok: true, mode: "none", count: 0 };
  }

  // Already attached with the same payload — skip redraw churn.
  if (
    markersPrimitive &&
    markersSeries &&
    markersChart &&
    fingerprint === lastAppliedFingerprint
  ) {
    return { ok: true, mode: "primitive", count: inputs.length };
  }

  const samplePrice =
    inputs.reduce((sum, marker) => sum + marker.price, 0) / inputs.length;
  const found =
    findBestPriceCandidate(
      Number.isFinite(samplePrice) && samplePrice > 0 ? samplePrice : 7500,
      true,
    ) ??
    findBestPriceCandidate(
      Number.isFinite(samplePrice) && samplePrice > 0 ? samplePrice : 7500,
      false,
    );
  if (!found) {
    return {
      ok: false,
      mode: "none",
      count: 0,
      reason: `no-series:${findChartCandidates().length}`,
    };
  }

  const { chart, series } = found;
  const draws = toDrawMarkers(inputs);

  // 1) Preferred: custom canvas primitive (works on Terminal's LW Charts v5).
  if (typeof series.attachPrimitive === "function") {
    try {
      if (
        !markersPrimitive ||
        markersSeries !== series ||
        markersChart !== chart
      ) {
        detachMarkersPrimitive();
        markersPrimitive = createMarkersPrimitive();
        series.attachPrimitive(markersPrimitive);
        markersSeries = series;
        markersChart = chart;
      }
      markersPrimitive.bind(chart, series);
      markersPrimitive.setMarkers(draws);
      lastAppliedFingerprint = fingerprint;
      return { ok: true, mode: "primitive", count: draws.length };
    } catch (error) {
      detachMarkersPrimitive();
      lastAppliedFingerprint = "";
      console.warn("[eterminal] attachPrimitive failed", error);
    }
  }

  // 2) Official plugin if the page exposed it globally (rare).
  const create = window.LightweightCharts?.createSeriesMarkers;
  if (typeof create === "function") {
    try {
      const markerPayload = inputs.map((marker) => ({
        time: marker.time > 1e12 ? Math.floor(marker.time / 1000) : marker.time,
        position: (marker.side === "above" ? "aboveBar" : "belowBar") as
          | "aboveBar"
          | "belowBar",
        shape: "circle" as const,
        color: marker.color === "green" ? "#22c55e" : "#ef4444",
        id: `eterminal:${marker.id}`,
        text: marker.label,
        size: 1.75,
      }));
      create(series, markerPayload);
      markersSeries = series;
      markersChart = chart;
      return {
        ok: true,
        mode: "createSeriesMarkers",
        count: markerPayload.length,
      };
    } catch {
      // fall through
    }
  }

  // 3) Legacy series.setMarkers (v3/v4).
  if (typeof series.setMarkers === "function") {
    try {
      series.setMarkers(
        inputs.map((marker) => ({
          time: marker.time > 1e12 ? Math.floor(marker.time / 1000) : marker.time,
          position: marker.side === "above" ? "aboveBar" : "belowBar",
          shape: "circle",
          color: marker.color === "green" ? "#22c55e" : "#ef4444",
          id: `eterminal:${marker.id}`,
          text: marker.label,
          size: 1.75,
        })),
      );
      markersSeries = series;
      markersChart = chart;
      return { ok: true, mode: "setMarkers", count: inputs.length };
    } catch {
      // fall through
    }
  }

  return {
    ok: false,
    mode: "none",
    count: 0,
    reason: "no-marker-api",
  };
}

function normalizeTime(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const asNum = Number(value);
    if (Number.isFinite(asNum)) {
      return asNum > 1e12 ? Math.floor(asNum / 1000) : asNum;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }
  if (value && typeof value === "object") {
    const obj = value as { timestamp?: unknown; year?: unknown };
    if (typeof obj.timestamp === "number") {
      return normalizeTime(obj.timestamp);
    }
  }
  return null;
}

function seriesFromChart(chart: ChartLike): SeriesLike[] {
  const out: SeriesLike[] = [];
  const seen = new Set<SeriesLike>();

  const push = (series: unknown) => {
    if (isSeriesLike(series) && !seen.has(series)) {
      seen.add(series);
      out.push(series);
    }
  };

  try {
    const listed = chart.series?.();
    if (Array.isArray(listed)) {
      listed.forEach(push);
    }
  } catch {
    // ignore
  }

  try {
    const panes = chart.panes?.() ?? [];
    for (const pane of panes) {
      (pane.getSeries?.() ?? []).forEach(push);
    }
  } catch {
    // ignore
  }

  const privateChart = chart as ChartLike & {
    _private__serieses?: SeriesLike[];
    _serieses?: SeriesLike[];
    _private__chartWidget?: {
      _private__model?: {
        serieses?: () => SeriesLike[];
      };
    };
    _private__model?: {
      serieses?: () => SeriesLike[];
      _serieses?: SeriesLike[];
    };
  };
  for (const list of [
    privateChart._private__serieses,
    privateChart._serieses,
    privateChart._private__model?.serieses?.(),
    privateChart._private__model?._serieses,
    privateChart._private__chartWidget?._private__model?.serieses?.(),
  ]) {
    if (Array.isArray(list)) {
      list.forEach(push);
    }
  }

  // Prefer SeriesApi (has attachPrimitive) first.
  out.sort((a, b) => {
    const score = (series: SeriesLike) =>
      typeof series.attachPrimitive === "function" ? 1 : 0;
    return score(b) - score(a);
  });

  return out;
}

function collectChartsFromObject(
  root: unknown,
  depth: number,
  found: ChartLike[],
  seen: Set<unknown>,
): void {
  if (!root || depth > 8 || found.length >= 8) {
    return;
  }
  if (typeof root !== "object") {
    return;
  }
  if (seen.has(root)) {
    return;
  }
  seen.add(root);

  if (isChartLike(root)) {
    found.push(root);
    return;
  }

  if (Array.isArray(root)) {
    for (const item of root.slice(0, 80)) {
      collectChartsFromObject(item, depth + 1, found, seen);
    }
    return;
  }

  const maybeHook = root as {
    memoizedState?: unknown;
    next?: unknown;
    current?: unknown;
  };
  if ("memoizedState" in maybeHook || "current" in maybeHook) {
    collectChartsFromObject(maybeHook.memoizedState, depth + 1, found, seen);
    collectChartsFromObject(maybeHook.current, depth + 1, found, seen);
    collectChartsFromObject(maybeHook.next, depth + 1, found, seen);
  }

  for (const value of Object.values(root as Record<string, unknown>).slice(
    0,
    80,
  )) {
    if (!value || typeof value !== "object") {
      continue;
    }
    collectChartsFromObject(value, depth + 1, found, seen);
  }
}

function chartsFromReactFiber(node: Element): ChartLike[] {
  const found: ChartLike[] = [];
  const seen = new Set<unknown>();
  const fiberKey = Object.keys(node).find(
    (key) =>
      key.startsWith("__reactFiber$") ||
      key.startsWith("__reactInternalInstance$"),
  );
  if (!fiberKey) {
    return found;
  }

  type Fiber = {
    return?: Fiber | null;
    child?: Fiber | null;
    sibling?: Fiber | null;
    stateNode?: unknown;
    memoizedProps?: unknown;
    memoizedState?: unknown;
  };

  let fiber = (node as unknown as Record<string, unknown>)[fiberKey] as
    | Fiber
    | null;

  for (let i = 0; i < 60 && fiber; i += 1) {
    collectChartsFromObject(fiber.stateNode, 0, found, seen);
    collectChartsFromObject(fiber.memoizedProps, 0, found, seen);
    collectChartsFromObject(fiber.memoizedState, 0, found, seen);

    let child = fiber.child ?? null;
    for (let c = 0; child && c < 12; c += 1) {
      collectChartsFromObject(child.stateNode, 0, found, seen);
      collectChartsFromObject(child.memoizedProps, 0, found, seen);
      collectChartsFromObject(child.memoizedState, 0, found, seen);
      child = child.sibling ?? null;
    }

    fiber = fiber.return ?? null;
  }

  return found;
}

function readVisibleRange(timeScale: TimeScaleLike): VisibleRange | null {
  try {
    const range = timeScale.getVisibleRange?.();
    if (!range) {
      return null;
    }
    const from = normalizeTime(range.from);
    const to = normalizeTime(range.to);
    if (from == null || to == null || to <= from) {
      return null;
    }
    return { from, to };
  } catch {
    return null;
  }
}

function tryDirectTimeToX(
  timeScale: TimeScaleLike,
  time: number,
): number | null {
  const candidates: Array<number | string> = [time];
  if (time > 1e12) {
    candidates.push(Math.floor(time / 1000));
  } else if (time > 1e9) {
    candidates.push(time * 1000);
  }
  // Nearest minute snaps — flow bars and price bars can be offset by a few seconds.
  for (const delta of [0, -30, 30, -60, 60, -90, 90, -120, 120, -180, 180, -300, 300]) {
    candidates.push(time + delta);
  }

  for (const candidate of candidates) {
    try {
      const x = timeScale.timeToCoordinate(candidate);
      if (x != null && Number.isFinite(x)) {
        return x;
      }
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Binary-search X using coordinateToTime — works even when timeToCoordinate
 * requires an exact bar match.
 */
function timeToXBySearch(
  timeScale: TimeScaleLike,
  time: number,
  widthHint: number,
): number | null {
  if (typeof timeScale.coordinateToTime !== "function") {
    return null;
  }

  const width =
    (typeof timeScale.width === "function" ? timeScale.width() : 0) ||
    widthHint;
  if (width < 40) {
    return null;
  }

  let lo = 0;
  let hi = width;
  let found = false;

  for (let i = 0; i < 28; i += 1) {
    const mid = (lo + hi) / 2;
    let mapped: unknown = null;
    try {
      mapped = timeScale.coordinateToTime!(mid);
    } catch {
      mapped = null;
    }
    const t = normalizeTime(mapped);
    if (t == null) {
      // Outside the series — shrink from the empty edge.
      if (i % 2 === 0) {
        hi = mid;
      } else {
        lo = mid;
      }
      continue;
    }
    found = true;
    if (t < time) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return found ? (lo + hi) / 2 : null;
}

function timeToX(
  timeScale: TimeScaleLike,
  time: number,
  widthHint: number,
): number | null {
  return (
    tryDirectTimeToX(timeScale, time) ??
    timeToXBySearch(timeScale, time, widthHint)
  );
}

type ChartCandidate = { chart: ChartLike; series: SeriesLike };

function findChartCandidates(): ChartCandidate[] {
  const candidates: ChartCandidate[] = [];
  const seenSeries = new Set<SeriesLike>();

  const pushChart = (chart: ChartLike) => {
    for (const series of seriesFromChart(chart)) {
      if (seenSeries.has(series)) {
        continue;
      }
      seenSeries.add(series);
      candidates.push({ chart, series });
    }
  };

  const canvases = Array.from(document.querySelectorAll("canvas")).filter(
    (canvas) => canvas.clientWidth >= 120 && canvas.clientHeight >= 80,
  );
  canvases.sort(
    (a, b) =>
      a.getBoundingClientRect().top - b.getBoundingClientRect().top ||
      b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight,
  );

  for (const canvas of canvases) {
    let el: Element | null = canvas;
    for (let depth = 0; el && depth < 14; depth += 1) {
      for (const chart of chartsFromReactFiber(el)) {
        pushChart(chart);
      }
      el = el.parentElement;
    }
  }

  // Broad scan: chart refs may live on wrappers that don't inherit canvas fiber path.
  if (candidates.length === 0) {
    const roots = Array.from(
      document.querySelectorAll("div, section, main, article"),
    ).filter(
      (el) =>
        el.clientWidth >= 240 &&
        el.clientHeight >= 120 &&
        Object.keys(el).some(
          (key) =>
            key.startsWith("__reactFiber$") ||
            key.startsWith("__reactContainer$"),
        ),
    );
    for (const el of roots.slice(0, 80)) {
      for (const chart of chartsFromReactFiber(el)) {
        pushChart(chart);
      }
      if (candidates.length >= 8) {
        break;
      }
    }
  }

  return candidates;
}

function scoreMapping(
  results: CoordResult[],
  series: SeriesLike,
  samplePrice: number,
): number {
  let hits = 0;
  for (const result of results) {
    if (result.x != null && result.y != null) {
      hits += 2;
    } else if (result.x != null || result.y != null) {
      hits += 1;
    }
  }
  try {
    const y = series.priceToCoordinate(samplePrice);
    if (y != null && Number.isFinite(y) && y > 0) {
      hits += 20;
    }
  } catch {
    // ignore
  }
  return hits;
}

function mapPoints(points: CoordPoint[]): BridgeResponse {
  if (!points.length) {
    return { results: [], visible: null, chartFound: false };
  }

  const candidates = findChartCandidates();
  if (!candidates.length) {
    return { results: null, visible: null, chartFound: false };
  }

  const samplePrice =
    points.reduce((sum, point) => sum + point.price, 0) / points.length;

  let best: CoordResult[] | null = null;
  let bestVisible: VisibleRange | null = null;
  let bestScore = -1;

  for (const { chart, series } of candidates) {
    let timeScale: TimeScaleLike;
    try {
      timeScale = chart.timeScale();
    } catch {
      continue;
    }

    const widthHint =
      typeof timeScale.width === "function" ? timeScale.width() : 800;
    const visible = readVisibleRange(timeScale);

    const results = points.map((point) => {
      let y: number | null = null;
      try {
        const mapped = series.priceToCoordinate(point.price);
        y = mapped != null && Number.isFinite(mapped) ? mapped : null;
      } catch {
        y = null;
      }
      return {
        time: point.time,
        price: point.price,
        x: timeToX(timeScale, point.time, widthHint),
        y,
      };
    });

    const score = scoreMapping(results, series, samplePrice);
    if (score > bestScore) {
      bestScore = score;
      best = results;
      bestVisible = visible;
    }
  }

  return {
    results: bestScore > 0 ? best : null,
    visible: bestVisible,
    chartFound: true,
  };
}

function notifyRangeChange(): void {
  window.postMessage(
    {
      source: "eterminal-page",
      type: "coords-invalidate",
    },
    "*",
  );
}

let subscribed: ChartLike | null = null;
const onVisibleRangeChange = () => {
  notifyRangeChange();
};

function ensureRangeSubscription(): void {
  const candidates = findChartCandidates();
  const next = candidates[0]?.chart ?? null;
  if (!next || next === subscribed) {
    return;
  }

  if (subscribed) {
    try {
      subscribed
        .timeScale()
        .unsubscribeVisibleTimeRangeChange?.(onVisibleRangeChange);
    } catch {
      // ignore
    }
  }

  subscribed = next;
  try {
    next.timeScale().subscribeVisibleTimeRangeChange?.(onVisibleRangeChange);
  } catch {
    // ignore
  }
}

window.__eterminalFindChartCoords = mapPoints;

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) {
    return;
  }
  const data = event.data as {
    source?: string;
    type?: string;
    requestId?: string;
    points?: CoordPoint[];
    markers?: NativeMarkerInput[];
  } | null;
  if (!data || data.source !== "eterminal-ext") {
    return;
  }

  if (
    data.type === "coords-request" &&
    data.requestId &&
    Array.isArray(data.points)
  ) {
    ensureRangeSubscription();
    const response = mapPoints(data.points);
    window.postMessage(
      {
        source: "eterminal-page",
        type: "coords-response",
        requestId: data.requestId,
        ...response,
      },
      "*",
    );
    return;
  }

  if (data.type === "markers-set" && data.requestId && Array.isArray(data.markers)) {
    const result = applyNativeMarkers(data.markers);
    window.postMessage(
      {
        source: "eterminal-page",
        type: "markers-response",
        requestId: data.requestId,
        ...result,
      },
      "*",
    );
  }
});

window.setInterval(() => {
  ensureRangeSubscription();
  // Re-bind only if the chart remounted (SPA) and we lost the primitive.
  if (lastMarkerInputs.length > 0 && !markersPrimitive) {
    applyNativeMarkers(lastMarkerInputs);
  }
}, 2500);
