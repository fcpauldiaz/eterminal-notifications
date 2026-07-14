import type { Spx3Signal } from "./types.js";

export type NtfyConfig = {
  baseUrl: string;
  topic: string;
  token?: string;
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

export async function publishSignalAlert(
  config: NtfyConfig,
  signal: Spx3Signal,
): Promise<void> {
  const meta = signalMeta(signal);
  const url = `${config.baseUrl.replace(/\/$/, "")}/${encodeURIComponent(config.topic)}`;
  const title = `SPX3 new signal - ${meta.label}`;
  const body = [
    `id: ${signal.id}`,
    `side: ${signal.side}`,
    `color: ${signal.color}`,
    `shape: ${signal.shape} (${signal.variant})`,
    `price: ${signal.price}`,
    `time: ${signal.time}`,
    `source: ${signal.source}`,
  ].join("\n");

  const headers: Record<string, string> = {
    Title: title,
    Priority: meta.priority,
    Tags: meta.tags,
    "Content-Type": "text/plain; charset=utf-8",
  };

  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`ntfy publish failed (${res.status}): ${text.slice(0, 200)}`);
  }
}
