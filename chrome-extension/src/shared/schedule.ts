const TIME_ZONE = "America/New_York";
const WINDOW_START_MINUTES = 6 * 60;
const WINDOW_END_MINUTES = 15 * 60;
/** CBOE delayed-data reset: ignore flow alerts in this ET window. */
const CBOE_RESET_START_MINUTES = 9 * 60 + 44;
const CBOE_RESET_END_MINUTES = 9 * 60 + 50;
/** RTH open 09:30 ET — before that (in poll window) is treated as ETH/EU. */
export const RTH_START_MINUTES = 9 * 60 + 30;

export type EtClock = {
  hour: number;
  minute: number;
  second: number;
};

export type TradingSession = "eth" | "rth" | "off";

function partValue(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  const value = parts.find((part) => part.type === type)?.value;
  if (!value) {
    throw new Error(`Missing date part: ${type}`);
  }
  return Number(value);
}

export function getEtClock(date = new Date()): EtClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return {
    hour: partValue(parts, "hour"),
    minute: partValue(parts, "minute"),
    second: partValue(parts, "second"),
  };
}

export function getEtDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = partValue(parts, "year");
  const month = String(partValue(parts, "month")).padStart(2, "0");
  const day = String(partValue(parts, "day")).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function minutesOfDay(clock: EtClock): number {
  return clock.hour * 60 + clock.minute + clock.second / 60;
}

/** True from 06:00 ET inclusive through 15:00 ET exclusive. */
export function isWithinPollWindow(date = new Date()): boolean {
  const minutes = minutesOfDay(getEtClock(date));
  return minutes >= WINDOW_START_MINUTES && minutes < WINDOW_END_MINUTES;
}

/** True during ~9:44–9:50 ET CBOE delayed data reset. */
export function isCboeResetWindow(date = new Date()): boolean {
  const minutes = minutesOfDay(getEtClock(date));
  return (
    minutes >= CBOE_RESET_START_MINUTES && minutes < CBOE_RESET_END_MINUTES
  );
}

export function getTradingSession(date = new Date()): TradingSession {
  if (!isWithinPollWindow(date)) {
    return "off";
  }
  const minutes = minutesOfDay(getEtClock(date));
  return minutes < RTH_START_MINUTES ? "eth" : "rth";
}

/** True at/after 09:30 ET (unix seconds). */
export function isAtOrAfterRthOpen(unixSeconds: number): boolean {
  return minutesOfDay(getEtClock(new Date(unixSeconds * 1000))) >= RTH_START_MINUTES;
}

export function getSessionKey(date = new Date()): string {
  const session = getTradingSession(date);
  if (session === "off") {
    return `${getEtDateKey(date)}-off`;
  }
  return `${getEtDateKey(date)}-${session}`;
}
