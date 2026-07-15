import type { ChartMarker, FlowUiState } from "../shared/types";

const ROOT_ID = "spx3-extreme-markers";
const LEFT_PAD_PX = 8;
const RIGHT_PROFILE_RATIO = 0.26;
const RIGHT_PAD_MIN_PX = 72;
const TOP_PAD_PX = 10;
const BOTTOM_PAD_PX = 16;
const VERTICAL_OFFSET_PX = 14;
const CIRCLE_SIZE_PX = 14;

let latestState: FlowUiState | null = null;
let resizeObserver: ResizeObserver | null = null;
let paintToken = 0;
let invalidateBound = false;
let nativeApplied = false;
let lastNativeFingerprint = "";
let lastAttachWarnKey = "";

function markerFingerprint(markers: ChartMarker[]): string {
  return markers
    .map(
      (marker) =>
        `${marker.id}|${marker.time}|${marker.price}|${marker.color}|${marker.side}`,
    )
    .sort()
    .join(";");
}

function ensureInvalidateListener(): void {
  if (invalidateBound) {
    return;
  }
  invalidateBound = true;
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) {
      return;
    }
    const data = event.data as { source?: string; type?: string } | null;
    // Native canvas primitives scroll with the chart; only DOM fallback needs
    // repositioning on visible-range changes.
    if (
      data?.source === "eterminal-page" &&
      data.type === "coords-invalidate" &&
      latestState &&
      !nativeApplied
    ) {
      void renderMarkers(latestState);
    }
  });
}

function isSpx3Path(pathname = location.pathname): boolean {
  return pathname === "/user/spx3" || pathname.startsWith("/user/spx3/");
}

type ChartFrame = {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
};

type MappedPoint = {
  x: number;
  y: number;
  source: "bridge" | "fallback";
};

function findPriceChartFrame(): ChartFrame | null {
  const canvases = Array.from(document.querySelectorAll("canvas")).filter(
    (canvas) => canvas.clientWidth >= 200 && canvas.clientHeight >= 120,
  );
  if (!canvases.length) {
    return null;
  }

  canvases.sort(
    (a, b) =>
      a.getBoundingClientRect().top - b.getBoundingClientRect().top ||
      b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight,
  );
  const canvas = canvases[0]!;
  const host = canvas.parentElement;
  if (!(host instanceof HTMLElement)) {
    return null;
  }
  return { host, canvas };
}

function ensureRoot(host: HTMLElement): HTMLElement {
  const existing = document.getElementById(ROOT_ID);
  if (existing) {
    if (existing.parentElement !== host) {
      host.appendChild(existing);
    }
    return existing;
  }

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.setAttribute("data-spx3-extreme-markers", "true");
  host.appendChild(root);
  return root;
}

function removeRoot(): void {
  document.getElementById(ROOT_ID)?.remove();
  resizeObserver?.disconnect();
  resizeObserver = null;
}

function plotRightEdge(width: number): number {
  const profilePad = Math.max(
    RIGHT_PAD_MIN_PX,
    Math.round(width * RIGHT_PROFILE_RATIO),
  );
  return Math.max(LEFT_PAD_PX + 40, width - profilePad);
}

type BridgeResponse = {
  results: Array<{
    time: number;
    price: number;
    x: number | null;
    y: number | null;
  }> | null;
  visible: { from: number; to: number } | null;
  chartFound: boolean;
};

function requestNativeMarkers(markers: ChartMarker[]): Promise<{
  ok: boolean;
  mode: string;
  count: number;
  reason?: string;
} | null> {
  const attempt = (): Promise<{
    ok: boolean;
    mode: string;
    count: number;
    reason?: string;
  } | null> =>
    new Promise((resolve) => {
      const requestId = `markers-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const timeout = window.setTimeout(() => {
        window.removeEventListener("message", onMessage);
        resolve(null);
      }, 600);

      function onMessage(event: MessageEvent): void {
        if (event.source !== window) {
          return;
        }
        const data = event.data as {
          source?: string;
          type?: string;
          requestId?: string;
          ok?: boolean;
          mode?: string;
          count?: number;
          reason?: string;
        } | null;
        if (
          !data ||
          data.source !== "eterminal-page" ||
          data.type !== "markers-response" ||
          data.requestId !== requestId
        ) {
          return;
        }
        window.clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        resolve({
          ok: Boolean(data.ok),
          mode: data.mode ?? "none",
          count: data.count ?? 0,
          reason: data.reason,
        });
      }

      window.addEventListener("message", onMessage);
      window.postMessage(
        {
          source: "eterminal-ext",
          type: "markers-set",
          requestId,
          markers: markers.map((marker) => ({
            id: marker.id,
            time: marker.time,
            price: marker.price,
            side: marker.side,
            color: marker.color,
            label: marker.label,
          })),
        },
        "*",
      );
    });

  // Retry: MAIN bridge may not be ready yet right after load / SPA nav.
  return (async () => {
    let last: Awaited<ReturnType<typeof attempt>> = null;
    for (let i = 0; i < 4; i += 1) {
      last = await attempt();
      if (last?.ok) {
        return last;
      }
      // null = bridge timeout; no-series = chart not mounted yet
      const retryable =
        last == null ||
        last.reason?.startsWith("no-series") === true ||
        last.reason === "no-marker-api";
      if (!retryable) {
        return last;
      }
      await new Promise((resolve) => {
        window.setTimeout(resolve, 250 * (i + 1));
      });
    }
    return last;
  })();
}

function requestBridgeCoords(
  points: Array<{ time: number; price: number }>,
): Promise<BridgeResponse | null> {
  return new Promise((resolve) => {
    const requestId = `coords-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timeout = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      resolve(null);
    }, 350);

    function onMessage(event: MessageEvent): void {
      if (event.source !== window) {
        return;
      }
      const data = event.data as (BridgeResponse & {
        source?: string;
        type?: string;
        requestId?: string;
      }) | null;
      if (
        !data ||
        data.source !== "eterminal-page" ||
        data.type !== "coords-response" ||
        data.requestId !== requestId
      ) {
        return;
      }
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      resolve({
        results: data.results ?? null,
        visible: data.visible ?? null,
        chartFound: Boolean(data.chartFound),
      });
    }

    window.addEventListener("message", onMessage);
    window.postMessage(
      {
        source: "eterminal-ext",
        type: "coords-request",
        requestId,
        points,
      },
      "*",
    );
  });
}

function fallbackMap(
  marker: ChartMarker,
  state: FlowUiState,
  width: number,
  height: number,
  visible: { from: number; to: number } | null,
): MappedPoint | null {
  const start = visible?.from ?? state.chartTimeStart;
  const end = visible?.to ?? state.chartTimeEnd;
  if (start == null || end == null) {
    return null;
  }

  const right = plotRightEdge(width);
  const usable = Math.max(1, right - LEFT_PAD_PX);
  const ratio =
    end <= start
      ? 1
      : Math.min(1, Math.max(0, (marker.time - start) / (end - start)));
  const x = LEFT_PAD_PX + ratio * usable;

  const min = state.chartPriceMin;
  const max = state.chartPriceMax;
  const price = marker.price;
  let y: number;
  if (
    min != null &&
    max != null &&
    Number.isFinite(min) &&
    Number.isFinite(max) &&
    max > min
  ) {
    const top = TOP_PAD_PX;
    const bottom = height - BOTTOM_PAD_PX;
    const span = bottom - top;
    y = top + ((max - price) / (max - min)) * span;
  } else if (state.chartPrice != null) {
    const midY = height * 0.42;
    const pxPerPoint = Math.max(1.2, (height * 0.35) / 40);
    y = midY - (price - state.chartPrice) * pxPerPoint;
  } else {
    return null;
  }

  return { x, y, source: "fallback" };
}

function markerTitle(marker: ChartMarker): string {
  if (marker.kind === "flow_rs") {
    return `Flow cross inside ${marker.levelKind ?? "zone"} ${marker.levelLabel ?? marker.label} @ ${marker.price.toFixed(2)}`;
  }
  return `${marker.series ?? "flow"} ${marker.label} @ ${marker.price.toFixed(2)}`;
}

function syncRootToCanvas(root: HTMLElement, frame: ChartFrame): void {
  const hostStyle = getComputedStyle(frame.host);
  if (hostStyle.position === "static") {
    frame.host.style.position = "relative";
  }

  const hostRect = frame.host.getBoundingClientRect();
  const canvasRect = frame.canvas.getBoundingClientRect();
  root.style.position = "absolute";
  root.style.left = `${canvasRect.left - hostRect.left}px`;
  root.style.top = `${canvasRect.top - hostRect.top}px`;
  root.style.width = `${frame.canvas.clientWidth}px`;
  root.style.height = `${frame.canvas.clientHeight}px`;
  root.style.pointerEvents = "none";
  root.style.zIndex = "40";
  root.style.overflow = "hidden";
}

function renderDots(
  root: HTMLElement,
  markers: ChartMarker[],
  mapped: Array<MappedPoint | null>,
  height: number,
): void {
  const html = markers
    .map((marker, index) => {
      const point = mapped[index];
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        return "";
      }
      const y =
        marker.side === "above"
          ? Math.max(TOP_PAD_PX, point.y - VERTICAL_OFFSET_PX)
          : Math.min(height - BOTTOM_PAD_PX, point.y + VERTICAL_OFFSET_PX);
      const colorClass =
        marker.color === "green"
          ? "spx3-extreme-dot--green"
          : "spx3-extreme-dot--red";
      const size =
        marker.kind === "flow_rs" ? CIRCLE_SIZE_PX + 2 : CIRCLE_SIZE_PX;
      return `
        <div
          class="spx3-extreme-dot ${colorClass}"
          title="${markerTitle(marker).replaceAll('"', "'")}"
          data-source="${point.source}"
          style="left:${point.x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${size}px;height:${size}px"
        ></div>
      `;
    })
    .join("");

  root.innerHTML = html;
}

async function paintDomFallback(
  root: HTMLElement,
  frame: ChartFrame,
  state: FlowUiState,
  token: number,
): Promise<void> {
  syncRootToCanvas(root, frame);
  const width = frame.canvas.clientWidth;
  const height = frame.canvas.clientHeight;
  if (width < 40 || height < 40) {
    root.innerHTML = "";
    return;
  }

  const markers = state.extremeMarkers ?? [];
  if (!markers.length) {
    root.innerHTML = "";
    return;
  }

  const bridge = await requestBridgeCoords(
    markers.map((marker) => ({ time: marker.time, price: marker.price })),
  );

  if (token !== paintToken) {
    return;
  }

  const visible = bridge?.visible ?? null;
  const mapped: Array<MappedPoint | null> = markers.map((marker, index) => {
    const bridgePoint = bridge?.results?.[index];
    const fallback = fallbackMap(marker, state, width, height, visible);

    if (
      bridgePoint &&
      bridgePoint.x != null &&
      bridgePoint.y != null &&
      Number.isFinite(bridgePoint.x) &&
      Number.isFinite(bridgePoint.y)
    ) {
      return { x: bridgePoint.x, y: bridgePoint.y, source: "bridge" };
    }

    if (bridgePoint && fallback) {
      return {
        x:
          bridgePoint.x != null && Number.isFinite(bridgePoint.x)
            ? bridgePoint.x
            : fallback.x,
        y:
          bridgePoint.y != null && Number.isFinite(bridgePoint.y)
            ? bridgePoint.y
            : fallback.y,
        source:
          bridgePoint.x != null && bridgePoint.y != null ? "bridge" : "fallback",
      };
    }

    return fallback;
  });

  renderDots(root, markers, mapped, height);
}

async function renderMarkers(state: FlowUiState | null): Promise<void> {
  latestState = state;
  paintToken += 1;
  const token = paintToken;

  if (!isSpx3Path()) {
    lastNativeFingerprint = "";
    await requestNativeMarkers([]);
    nativeApplied = false;
    removeRoot();
    return;
  }

  const markers = state?.extremeMarkers ?? [];
  if (!state || !markers.length) {
    lastNativeFingerprint = "";
    await requestNativeMarkers([]);
    nativeApplied = false;
    removeRoot();
    return;
  }

  const fingerprint = markerFingerprint(markers);
  if (nativeApplied && fingerprint === lastNativeFingerprint) {
    return;
  }

  const native = await requestNativeMarkers(markers);
  if (token !== paintToken) {
    return;
  }

  if (native?.ok) {
    nativeApplied = true;
    lastNativeFingerprint = fingerprint;
    lastAttachWarnKey = "";
    removeRoot();
    return;
  }

  const warnKey = `${native?.reason ?? "timeout"}:${fingerprint}`;
  if (warnKey !== lastAttachWarnKey) {
    lastAttachWarnKey = warnKey;
    console.warn(
      "[chart-markers] native attach failed · falling back to DOM overlay",
      native ?? { ok: false, reason: "bridge-timeout" },
    );
  }

  nativeApplied = false;
  lastNativeFingerprint = "";
  const frame = findPriceChartFrame();
  if (!frame) {
    removeRoot();
    return;
  }

  const root = ensureRoot(frame.host);
  syncRootToCanvas(root, frame);

  resizeObserver?.disconnect();
  resizeObserver = new ResizeObserver(() => {
    if (latestState && !nativeApplied) {
      void renderMarkers(latestState);
    }
  });
  resizeObserver.observe(frame.canvas);
  resizeObserver.observe(frame.host);

  await paintDomFallback(root, frame, state, token);
}

export function updateExtremeChartMarkers(state: FlowUiState | null): void {
  ensureInvalidateListener();
  void renderMarkers(state);
}

export function clearExtremeChartMarkers(): void {
  paintToken += 1;
  nativeApplied = false;
  lastNativeFingerprint = "";
  void requestNativeMarkers([]);
  removeRoot();
}
