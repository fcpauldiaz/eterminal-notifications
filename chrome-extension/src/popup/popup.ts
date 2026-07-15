import { hasTerminalSessionCookie } from "../shared/api";
import type { ExtensionMessage } from "../shared/messages";
import { isWithinPollWindow } from "../shared/schedule";
import { loadSettings, saveSettings } from "../shared/storage";

const enabledEl = document.getElementById("enabled") as HTMLInputElement;
const ntfyTopicEl = document.getElementById("ntfyTopic") as HTMLInputElement;
const ntfyBaseUrlEl = document.getElementById("ntfyBaseUrl") as HTMLInputElement;
const ntfyTokenEl = document.getElementById("ntfyToken") as HTMLInputElement;
const thresholdEl = document.getElementById(
  "nearCrossThreshold",
) as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const feedbackEl = document.getElementById("feedback") as HTMLParagraphElement;
const saveBtn = document.getElementById("save") as HTMLButtonElement;
const pollBtn = document.getElementById("pollNow") as HTMLButtonElement;
const testBtn = document.getElementById("testNotify") as HTMLButtonElement;

function showFeedback(message: string, isError = false): void {
  feedbackEl.hidden = false;
  feedbackEl.textContent = message;
  feedbackEl.classList.toggle("error", isError);
}

async function persistForm(): Promise<void> {
  const threshold = Number(thresholdEl.value);
  await saveSettings({
    enabled: enabledEl.checked,
    ntfyTopic: ntfyTopicEl.value.trim(),
    ntfyBaseUrl: ntfyBaseUrlEl.value.trim() || "https://ntfy.sh",
    ntfyToken: ntfyTokenEl.value.trim(),
    nearCrossThreshold: Number.isFinite(threshold) ? threshold : 5,
  });
}

async function refreshStatus(): Promise<void> {
  const authOk = await hasTerminalSessionCookie();
  const settings = await loadSettings();
  const bits = [
    settings.enabled ? "Monitoring on" : "Monitoring off",
    authOk ? "Terminal session found" : "Log into Terminal in this browser",
    settings.ntfyTopic.trim()
      ? `ntfy: ${settings.ntfyTopic.trim()}`
      : "ntfy topic empty (Chrome-only alerts)",
    isWithinPollWindow() ? "inside ET window" : "outside 06:00-15:00 ET",
    "playbook: ETH/RTH · CBOE mute · directed setups",
  ];
  statusEl.textContent = bits.join(" · ");
}

async function hydrate(): Promise<void> {
  const settings = await loadSettings();
  enabledEl.checked = settings.enabled;
  ntfyTopicEl.value = settings.ntfyTopic;
  ntfyBaseUrlEl.value = settings.ntfyBaseUrl;
  ntfyTokenEl.value = settings.ntfyToken;
  thresholdEl.value = String(settings.nearCrossThreshold);
  await refreshStatus();
}

saveBtn.addEventListener("click", () => {
  void (async () => {
    await persistForm();
    await refreshStatus();
    showFeedback("Settings saved");
    chrome.runtime.sendMessage({ type: "POLL_NOW" } satisfies ExtensionMessage);
  })();
});

pollBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "POLL_NOW" } satisfies ExtensionMessage, () => {
    if (chrome.runtime.lastError) {
      showFeedback(chrome.runtime.lastError.message ?? "Poll failed", true);
      return;
    }
    showFeedback("Poll requested");
    void refreshStatus();
  });
});

testBtn.addEventListener("click", () => {
  void (async () => {
    await persistForm();
    await refreshStatus();
    showFeedback("Sending test…");
    chrome.runtime.sendMessage(
      { type: "TEST_NOTIFY" } satisfies ExtensionMessage,
      (response: ExtensionMessage | undefined) => {
        if (chrome.runtime.lastError) {
          showFeedback(chrome.runtime.lastError.message ?? "Test failed", true);
          return;
        }
        if (!response || response.type !== "TEST_NOTIFY_RESULT") {
          showFeedback("No test response from service worker", true);
          return;
        }
        if (response.ntfySkipped) {
          showFeedback(
            `Chrome ok · ntfy skipped (empty topic). Set topic then retry.`,
            true,
          );
          return;
        }
        if (!response.ok) {
          showFeedback(
            `Failed: ${response.error ?? "unknown"} · ntfy ${response.ntfyStatus ?? "-"} ${response.ntfyBody ?? ""}`,
            true,
          );
          return;
        }
        showFeedback(
          `Sent · ntfy ${response.ntfyStatus ?? "ok"} ${response.ntfyBody ?? ""}`.trim(),
        );
      },
    );
  })();
});

void hydrate();
