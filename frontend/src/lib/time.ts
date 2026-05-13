const DEFAULT_TIMEZONE = "Asia/Shanghai";

export function startOfLocalDayEpoch(value: Date, timezone = DEFAULT_TIMEZONE): number {
  const parts = dateParts(value, timezone);
  const localMidnightUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  const offset = timezoneOffsetMs(new Date(localMidnightUtc), timezone);
  return Math.floor((localMidnightUtc - offset) / 1000);
}

export function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

export function formatDay(value: Date, timezone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    month: "numeric",
    day: "numeric"
  }).format(value);
}

export function formatWeekday(value: Date, timezone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    weekday: "short"
  }).format(value);
}

export function formatTime(epoch: number, timezone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(epoch * 1000);
}

function dateParts(value: Date, timezone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);

  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day)
  };
}

function timezoneOffsetMs(value: Date, timezone: string): number {
  const asUtc = new Date(value.toLocaleString("en-US", { timeZone: "UTC" }));
  const asLocal = new Date(value.toLocaleString("en-US", { timeZone: timezone }));
  return asLocal.getTime() - asUtc.getTime();
}
