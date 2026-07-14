import { config as loadEnv } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CookieJar } from "./cookies.js";
import { publishSignalAlert, type NtfyConfig } from "./ntfy.js";
import { waitForPollWindow } from "./schedule.js";
import type { KnownState, Spx3Signal, Spx3ViewResponse } from "./types.js";

loadEnv();

type AppConfig = {
  baseUrl: string;
  email: string;
  password: string;
  pollIntervalMs: number;
  statePath: string;
  ntfy: NtfyConfig;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function loadConfig(): AppConfig {
  return {
    baseUrl: (process.env.BASE_URL ?? "https://terminal.emini.today").replace(/\/$/, ""),
    email: requireEnv("TERMINAL_EMAIL"),
    password: requireEnv("TERMINAL_PASSWORD"),
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? "30000"),
    statePath: process.env.STATE_PATH ?? "./state.json",
    ntfy: {
      baseUrl: process.env.NTFY_BASE_URL ?? "https://ntfy.sh",
      topic: requireEnv("NTFY_TOPIC"),
      token: process.env.NTFY_TOKEN?.trim() || undefined,
    },
  };
}

async function signIn(cfg: AppConfig, jar: CookieJar): Promise<void> {
  const res = await fetch(`${cfg.baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: cfg.baseUrl,
    },
    body: JSON.stringify({
      email: cfg.email,
      password: cfg.password,
    }),
  });

  jar.applySetCookie(res.headers);

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Sign-in failed (${res.status}): ${text.slice(0, 300)}`);
  }

  if (!jar.hasSession) {
    throw new Error("Sign-in succeeded but no session cookie was returned");
  }

  console.log(`[auth] signed in as ${cfg.email}`);
}

async function fetchSpx3View(cfg: AppConfig, jar: CookieJar): Promise<Spx3ViewResponse> {
  const res = await fetch(`${cfg.baseUrl}/api/user/spx3-view`, {
    headers: {
      Cookie: jar.header,
      Origin: cfg.baseUrl,
      Accept: "application/json",
    },
  });

  if (res.status === 401) {
    const err = new Error("Unauthorized") as Error & { status: number };
    err.status = 401;
    throw err;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`spx3-view failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as Spx3ViewResponse;
  if (!Array.isArray(data.signals)) {
    throw new Error("spx3-view response missing signals[]");
  }
  return data;
}

async function loadState(statePath: string): Promise<KnownState | null> {
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as KnownState;
    if (!Array.isArray(parsed.signalIds)) {
      return null;
    }
    return parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

async function saveState(statePath: string, signalIds: string[]): Promise<void> {
  const dir = path.dirname(path.resolve(statePath));
  await mkdir(dir, { recursive: true });
  const state: KnownState = {
    signalIds: [...signalIds].sort(),
    updatedAt: new Date().toISOString(),
  };
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureSession(cfg: AppConfig, jar: CookieJar): Promise<void> {
  if (!jar.hasSession) {
    await signIn(cfg, jar);
  }
}

async function fetchViewWithReauth(cfg: AppConfig, jar: CookieJar): Promise<Spx3ViewResponse> {
  await ensureSession(cfg, jar);
  try {
    return await fetchSpx3View(cfg, jar);
  } catch (err) {
    if ((err as { status?: number }).status === 401) {
      console.warn("[auth] session expired, re-signing in");
      await signIn(cfg, jar);
      return fetchSpx3View(cfg, jar);
    }
    throw err;
  }
}

async function processSignals(
  cfg: AppConfig,
  signals: Spx3Signal[],
): Promise<{ newCount: number; total: number }> {
  const currentIds = signals.map((s) => s.id);
  const previous = await loadState(cfg.statePath);

  if (!previous) {
    await saveState(cfg.statePath, currentIds);
    console.log(`[state] baseline saved (${currentIds.length} signals), no alerts`);
    return { newCount: 0, total: currentIds.length };
  }

  const known = new Set(previous.signalIds);
  const newcomers = signals.filter((signal) => !known.has(signal.id));
  const publishedIds: string[] = [];

  for (const signal of newcomers) {
    try {
      await publishSignalAlert(cfg.ntfy, signal);
      publishedIds.push(signal.id);
      console.log(`[ntfy] published ${signal.id} (${signal.side}/${signal.color})`);
    } catch (err) {
      console.error(`[ntfy] failed for ${signal.id}:`, err);
    }
  }

  const nextIds = currentIds.filter(
    (id) => known.has(id) || publishedIds.includes(id),
  );
  await saveState(cfg.statePath, nextIds);

  if (newcomers.length === 0) {
    console.log(`[poll] no new signals (${currentIds.length} total)`);
  } else {
    console.log(
      `[poll] ${publishedIds.length}/${newcomers.length} new signal(s) notified (${currentIds.length} total)`,
    );
  }

  return { newCount: publishedIds.length, total: currentIds.length };
}

async function tick(cfg: AppConfig, jar: CookieJar): Promise<void> {
  const view = await fetchViewWithReauth(cfg, jar);
  await processSignals(cfg, view.signals);
}

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  const cfg = loadConfig();
  const jar = new CookieJar();

  console.log(
    `[boot] base=${cfg.baseUrl} ntfy=${cfg.ntfy.baseUrl}/${cfg.ntfy.topic} interval=${cfg.pollIntervalMs}ms window=06:00-15:00 ET`,
  );

  if (once) {
    await tick(cfg, jar);
    return;
  }

  for (;;) {
    await waitForPollWindow(sleep);
    try {
      await tick(cfg, jar);
    } catch (err) {
      console.error("[poll] error:", err);
    }
    await sleep(cfg.pollIntervalMs);
  }
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
