import { publishNtfy, type NtfyConfig } from "./ntfy";

export type DualAlert = {
  title: string;
  body: string;
  priority?: string;
  tags?: string;
};

export type NotifyDualResult = {
  chromeOk: boolean;
  chromeError?: string;
  ntfySkipped: boolean;
  ntfyOk: boolean;
  ntfyStatus?: number;
  ntfyBody?: string;
  ntfyError?: string;
};

export async function notifyChrome(alert: DualAlert): Promise<void> {
  await chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: alert.title,
    message: alert.body.slice(0, 250),
    priority: alert.priority === "high" ? 2 : 0,
  });
}

export async function notifyDual(
  ntfy: NtfyConfig,
  alert: DualAlert,
): Promise<NotifyDualResult> {
  const result: NotifyDualResult = {
    chromeOk: false,
    ntfySkipped: !ntfy.topic.trim(),
    ntfyOk: false,
  };

  try {
    await notifyChrome(alert);
    result.chromeOk = true;
    console.log("[notify] chrome ok");
  } catch (err) {
    result.chromeError = err instanceof Error ? err.message : String(err);
    console.error("[notify] chrome failed", err);
  }

  if (result.ntfySkipped) {
    console.warn("[notify] ntfy topic empty - Chrome notification only");
    return result;
  }

  try {
    const published = await publishNtfy(ntfy, alert);
    result.ntfyOk = true;
    result.ntfyStatus = published.status;
    result.ntfyBody = published.body;
    console.log("[notify] ntfy ok");
  } catch (err) {
    result.ntfyError = err instanceof Error ? err.message : String(err);
    console.error("[notify] ntfy failed", err);
  }

  return result;
}
