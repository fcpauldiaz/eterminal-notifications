import {
  DEFAULT_POLL_STATE,
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  type FlowUiState,
  type PollState,
} from "./types";

const SETTINGS_KEY = "settings";
const POLL_STATE_KEY = "pollState";
const FLOW_UI_KEY = "flowUi";

export async function loadSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(stored[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined) };
}

export async function saveSettings(
  patch: Partial<ExtensionSettings>,
): Promise<ExtensionSettings> {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function loadPollState(): Promise<PollState> {
  const stored = await chrome.storage.local.get(POLL_STATE_KEY);
  return {
    ...DEFAULT_POLL_STATE,
    ...(stored[POLL_STATE_KEY] as Partial<PollState> | undefined),
  };
}

export async function savePollState(state: PollState): Promise<void> {
  await chrome.storage.local.set({ [POLL_STATE_KEY]: state });
}

export async function loadFlowUi(): Promise<FlowUiState | null> {
  const stored = await chrome.storage.local.get(FLOW_UI_KEY);
  return (stored[FLOW_UI_KEY] as FlowUiState | undefined) ?? null;
}

export async function saveFlowUi(state: FlowUiState): Promise<void> {
  await chrome.storage.local.set({ [FLOW_UI_KEY]: state });
}
