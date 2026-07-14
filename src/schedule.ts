const TIME_ZONE = "America/New_York";
const WINDOW_START_MINUTES = 6 * 60; // 06:00 ET
const WINDOW_END_MINUTES = 15 * 60; // 15:00 ET (exclusive)
const IDLE_CHECK_MS = 60_000;

type EtClock = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const value = parts.find((part) => part.type === type)?.value;
  if (!value) {
    throw new Error(`Missing date part: ${type}`);
  }
  return Number(value);
}

export function getEtClock(date = new Date()): EtClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return {
    year: partValue(parts, "year"),
    month: partValue(parts, "month"),
    day: partValue(parts, "day"),
    hour: partValue(parts, "hour"),
    minute: partValue(parts, "minute"),
    second: partValue(parts, "second"),
  };
}

function minutesOfDay(clock: EtClock): number {
  return clock.hour * 60 + clock.minute + clock.second / 60;
}

/** True from 06:00 ET inclusive through 15:00 ET exclusive. */
export function isWithinPollWindow(date = new Date()): boolean {
  const minutes = minutesOfDay(getEtClock(date));
  return minutes >= WINDOW_START_MINUTES && minutes < WINDOW_END_MINUTES;
}

function formatEtTime(clock: EtClock): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(clock.hour)}:${pad(clock.minute)}:${pad(clock.second)} ET`;
}

export async function waitForPollWindow(
  sleepFn: (ms: number) => Promise<void>,
): Promise<void> {
  while (!isWithinPollWindow()) {
    const clock = getEtClock();
    console.log(
      `[schedule] outside 06:00-15:00 ET (now ${formatEtTime(clock)}), sleeping ${IDLE_CHECK_MS / 1000}s`,
    );
    await sleepFn(IDLE_CHECK_MS);
  }
}
