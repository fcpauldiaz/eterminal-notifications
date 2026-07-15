import type { Spx3Signal } from "./types";

export type NtfyConfig = {
  baseUrl: string;
  topic: string;
  token?: string;
};

type AlertPayload = {
  title: string;
  body: string;
  priority?: string;
  tags?: string;
};

type SignalMeta = {
  tags: string;
  priority: string;
  label: string;
};

function signalMeta(signal: Spx3Signal): SignalMeta {
  const side = signal.side.toLowerCase();
  const color = signal.color.toLowerCase();

  if (side === "long" || color === "blue" || color === "green" || color === "purple") {
    const tag =
      color === "blue"
        ? "blue_square"
        : color === "green"
          ? "green_square"
          : color === "purple"
            ? "purple_square"
            : "large_blue_circle";
    return {
      tags: `${tag},chart_with_upwards_trend`,
      priority: side === "long" ? "high" : "default",
      label: side === "long" ? "LONG" : side.toUpperCase(),
    };
  }

  if (side === "short" || color === "red") {
    return {
      tags: "red_square,chart_with_downwards_trend",
      priority: "high",
      label: side === "short" ? "SHORT" : side.toUpperCase(),
    };
  }

  return {
    tags: "bell",
    priority: "default",
    label: `${side.toUpperCase()} / ${color}`,
  };
}

export function signalAlertPayload(signal: Spx3Signal): AlertPayload {
  const meta = signalMeta(signal);
  return {
    title: `Terminal new signal - ${meta.label}`,
    body: [
      `id: ${signal.id}`,
      `side: ${signal.side}`,
      `color: ${signal.color}`,
      `shape: ${signal.shape} (${signal.variant})`,
      `price: ${signal.price}`,
      `time: ${signal.time}`,
      `source: ${signal.source}`,
    ].join("\n"),
    priority: meta.priority,
    tags: meta.tags,
  };
}

function toLatin1Header(value: string): string {
  return value
    .replace(/\u2014|\u2013/g, "-")
    .replace(/\u2192/g, "->")
    .replace(/\u2248/g, "~=")
    .replace(/[^\x00-\xFF]/g, "?");
}

export async function publishNtfy(
  config: NtfyConfig,
  alert: AlertPayload,
): Promise<{ status: number; body: string }> {
  const topic = config.topic.trim();
  if (!topic) {
    console.warn("[ntfy] skipped: topic is empty");
    return { status: 0, body: "skipped: empty topic" };
  }

  const url = `${config.baseUrl.replace(/\/$/, "")}/${encodeURIComponent(topic)}`;
  const headers: Record<string, string> = {
    Title: toLatin1Header(alert.title),
    Priority: alert.priority ?? "default",
    Tags: toLatin1Header(alert.tags ?? "bell"),
    "Content-Type": "text/plain; charset=utf-8",
  };

  if (config.token?.trim()) {
    headers.Authorization = `Bearer ${config.token.trim()}`;
  }

  console.log("[ntfy] POST", {
    url,
    title: headers.Title,
    priority: headers.Priority,
    tags: headers.Tags,
    hasToken: Boolean(config.token?.trim()),
    bodyPreview: alert.body.slice(0, 120),
  });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: alert.body,
    });
  } catch (err) {
    console.error("[ntfy] fetch threw", err);
    throw err;
  }

  const text = await res.text().catch(() => "");
  console.log("[ntfy] response", {
    status: res.status,
    statusText: res.statusText,
    ok: res.ok,
    body: text.slice(0, 500),
  });

  if (!res.ok) {
    throw new Error(`ntfy publish failed (${res.status}): ${text.slice(0, 200)}`);
  }

  return { status: res.status, body: text.slice(0, 500) };
}
