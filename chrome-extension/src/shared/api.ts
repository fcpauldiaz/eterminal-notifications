import {
  SPX3_VIEW_PATH,
  TERMINAL_ORIGIN,
  type Spx3ViewResponse,
} from "./types";

export class AuthRequiredError extends Error {
  readonly status = 401;

  constructor(message = "Unauthorized") {
    super(message);
    this.name = "AuthRequiredError";
  }
}

export async function fetchSpx3View(): Promise<Spx3ViewResponse> {
  const res = await fetch(`${TERMINAL_ORIGIN}${SPX3_VIEW_PATH}`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      Origin: TERMINAL_ORIGIN,
    },
  });

  if (res.status === 401) {
    throw new AuthRequiredError();
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

export async function hasTerminalSessionCookie(): Promise<boolean> {
  const cookies = await chrome.cookies.getAll({ url: TERMINAL_ORIGIN });
  return cookies.some(
    (cookie) =>
      /session|token|auth/i.test(cookie.name) && cookie.value.length > 0,
  );
}

export async function getSessionCookieHeader(): Promise<string> {
  const cookies = await chrome.cookies.getAll({ url: TERMINAL_ORIGIN });
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}
