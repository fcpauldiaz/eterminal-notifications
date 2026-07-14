export function parseSetCookieHeaders(headers: Headers): string[] {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

export function cookieHeaderFromSetCookie(setCookieHeaders: string[]): string {
  return setCookieHeaders
    .map((header) => header.split(";")[0]?.trim())
    .filter((pair): pair is string => Boolean(pair))
    .join("; ");
}

export class CookieJar {
  private cookieHeader = "";

  applySetCookie(headers: Headers): void {
    const setCookies = parseSetCookieHeaders(headers);
    if (setCookies.length === 0) {
      return;
    }

    const next = cookieHeaderFromSetCookie(setCookies);
    if (next) {
      this.cookieHeader = next;
    }
  }

  get header(): string {
    return this.cookieHeader;
  }

  get hasSession(): boolean {
    return this.cookieHeader.length > 0;
  }
}
