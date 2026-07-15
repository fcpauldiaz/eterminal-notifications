import { biasLabel } from "../shared/flow";
import type { ExtensionMessage } from "../shared/messages";
import {
  getTradingSession,
  isCboeResetWindow,
} from "../shared/schedule";
import type { ColorRole, FlowUiState } from "../shared/types";
import {
  clearExtremeChartMarkers,
  updateExtremeChartMarkers,
} from "./chart-markers";

const ROOT_ID = "spx3-alerts-pills";
/** Matches Terminal: SPX/ES at top-2, Opex at top-10 (~40px). Pills sit under Opex. */
const FALLBACK_TOP_PX = 76;
const FALLBACK_LEFT_PX = 8;
const GAP_BELOW_OPEX_PX = 8;

let latestState: FlowUiState | null = null;
let positionObserver: MutationObserver | null = null;

function isSpx3Path(pathname = location.pathname): boolean {
  return pathname === "/user/spx3" || pathname.startsWith("/user/spx3/");
}

function findOpexBadge(): HTMLElement | null {
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>("div.pointer-events-none.absolute"),
  );
  for (const node of nodes) {
    const text = node.textContent?.trim() ?? "";
    if (!text || text === "SPX/ES 1m") {
      continue;
    }
    if (/opex/i.test(text) || node.className.includes("tracking-[0.16em]")) {
      return node;
    }
  }
  return null;
}

function ensureRoot(): HTMLElement {
  const existing = document.getElementById(ROOT_ID);
  if (existing) {
    return existing;
  }

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.setAttribute("data-spx3-alerts", "true");
  document.documentElement.appendChild(root);
  return root;
}

function removeRoot(): void {
  document.getElementById(ROOT_ID)?.remove();
  positionObserver?.disconnect();
  positionObserver = null;
  clearExtremeChartMarkers();
}

function placeRoot(root: HTMLElement): void {
  const opex = findOpexBadge();
  if (opex) {
    const parent = opex.offsetParent instanceof HTMLElement ? opex.offsetParent : null;
    if (parent) {
      const parentStyle = getComputedStyle(parent);
      if (parentStyle.position === "static") {
        parent.style.position = "relative";
      }
      if (root.parentElement !== parent) {
        parent.appendChild(root);
      }
      root.style.position = "absolute";
      root.style.left = `${opex.offsetLeft}px`;
      root.style.top = `${opex.offsetTop + opex.offsetHeight + GAP_BELOW_OPEX_PX}px`;
      root.style.right = "auto";
      root.dataset.anchored = "opex";
      return;
    }

    const rect = opex.getBoundingClientRect();
    if (root.parentElement !== document.documentElement) {
      document.documentElement.appendChild(root);
    }
    root.style.position = "fixed";
    root.style.left = `${Math.round(rect.left)}px`;
    root.style.top = `${Math.round(rect.bottom + GAP_BELOW_OPEX_PX)}px`;
    root.style.right = "auto";
    root.dataset.anchored = "opex-fixed";
    return;
  }

  if (root.parentElement !== document.documentElement) {
    document.documentElement.appendChild(root);
  }
  root.style.position = "fixed";
  root.style.left = `${FALLBACK_LEFT_PX}px`;
  root.style.top = `${FALLBACK_TOP_PX}px`;
  root.style.right = "auto";
  root.dataset.anchored = "fallback";
}

function watchPosition(root: HTMLElement): void {
  positionObserver?.disconnect();
  positionObserver = new MutationObserver(() => {
    placeRoot(root);
  });
  positionObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  window.addEventListener("resize", () => placeRoot(root), { passive: true });
}

function biasClass(role: ColorRole | null): string {
  const lower = role?.toLowerCase();
  if (lower === "bullish") {
    return "spx3-pill--bullish";
  }
  if (lower === "bearish") {
    return "spx3-pill--bearish";
  }
  if (lower === "neutral") {
    return "spx3-pill--neutral";
  }
  return "spx3-pill--unknown";
}

function render(state: FlowUiState | null): void {
  latestState = state;

  if (!isSpx3Path()) {
    removeRoot();
    return;
  }

  const root = ensureRoot();
  placeRoot(root);
  watchPosition(root);

  if (!state) {
    root.innerHTML = `
      <div class="spx3-pill spx3-pill--unknown" title="Waiting for first poll">Flow …</div>
    `;
    updateExtremeChartMarkers(null);
    return;
  }

  const extremesList = state.extremes ?? [];
  const liveSession = getTradingSession();
  const sessionLabel = liveSession.toUpperCase();
  const mutedCboe = isCboeResetWindow();

  const bias = `
    <div class="spx3-pill ${biasClass(state.bias)}" title="retailFlowSeries last colorRole">
      ${biasLabel(state.bias)}
    </div>
  `;

  const session = `
    <div class="spx3-pill spx3-pill--session" title="Live ETH / RTH / OFF (ET)">
      ${sessionLabel}
    </div>
  `;

  const mutes = [
    mutedCboe
      ? `<div class="spx3-pill spx3-pill--mute" title="9:44–9:50 ET CBOE reset">CBOE mute</div>`
      : "",
    state.mutedYellow
      ? `<div class="spx3-pill spx3-pill--mute" title="Yellow/neutral retail — avoid heavy flow reliance">Yellow mute</div>`
      : "",
  ].join("");

  const mixed = state.mixedFlow
    ? `<div class="spx3-pill spx3-pill--mixed" title="Day saw both red and green retail">Mixed</div>`
    : "";

  const pathTitle = (state.pathSummary ?? "").replaceAll('"', "'");

  const setup = state.setupKind
    ? `
      <div class="spx3-pill spx3-pill--cross" title="${pathTitle || state.setupKind}">
        ${state.setupKind === "short_cross" ? "Short setup" : "Long setup"}
        ${state.preferredZone ? " · zone" : ""}
        · Δ ${Number.isFinite(state.gap) ? state.gap.toFixed(2) : "—"}
      </div>
    `
    : state.nearCross
      ? `
      <div class="spx3-pill spx3-pill--cross" title="${pathTitle || "Near but trajectory invalid"}">
        Near · no path · Δ ${Number.isFinite(state.gap) ? state.gap.toFixed(2) : "—"}
      </div>
    `
      : "";

  const extremes =
    extremesList.length > 0
      ? `<div class="spx3-pill spx3-pill--extreme" title="Outer flow levels">${extremesList.join(" ")}</div>`
      : "";

  const onesided = state.bothExtremeBearish
    ? `<div class="spx3-pill spx3-pill--mute" title="Both deeply bearish (+extremes) — avoid blind longs">1-sided bearish</div>`
    : "";

  const opex =
    (state.opexAlignedCount ?? 0) > 0
      ? `<div class="spx3-pill spx3-pill--opex" title="General + OPEX strong levels">
          OPEX×${state.opexAlignedCount}${
            state.nearOpexLevel != null ? ` · ~${state.nearOpexLevel}` : ""
          }
        </div>`
      : "";

  root.innerHTML = `${bias}${session}${mutes}${mixed}${setup}${extremes}${onesided}${opex}`;
  placeRoot(root);
  updateExtremeChartMarkers(state);
}

function applyMessage(message: ExtensionMessage): void {
  if (message.type === "FLOW_UPDATE") {
    render(message.state);
  }
  if (message.type === "FLOW_UI") {
    render(message.state);
  }
}

function requestFlowUi(): void {
  chrome.runtime.sendMessage(
    { type: "GET_FLOW_UI" } satisfies ExtensionMessage,
    (response) => {
      if (chrome.runtime.lastError) {
        render(latestState);
        return;
      }
      applyMessage(response as ExtensionMessage);
    },
  );
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  applyMessage(message);
});

let lastPath = location.pathname;
const syncPath = (): void => {
  if (location.pathname === lastPath) {
    return;
  }
  lastPath = location.pathname;
  if (isSpx3Path()) {
    requestFlowUi();
  } else {
    removeRoot();
  }
};

window.addEventListener("popstate", syncPath);
setInterval(() => {
  syncPath();
  // Refresh live session / CBOE mute without waiting for a poll.
  if (latestState && isSpx3Path()) {
    render(latestState);
  }
}, 1000);

const pushState = history.pushState.bind(history);
history.pushState = function (...args) {
  const result = pushState(...args);
  syncPath();
  return result;
};

const replaceState = history.replaceState.bind(history);
history.replaceState = function (...args) {
  const result = replaceState(...args);
  syncPath();
  return result;
};

requestFlowUi();
