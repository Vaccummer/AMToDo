const DEFAULT_TIMEZONE = "Asia/Shanghai";

export function startOfLocalDayEpoch(value: Date, timezone = DEFAULT_TIMEZONE): number {
  const parts = dateParts(value, timezone);
  return startOfDateKeyEpoch(
    `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    timezone
  );
}

export function startOfDateKeyEpoch(dateKey: string, timezone = DEFAULT_TIMEZONE): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  const localMidnightUtc = Date.UTC(year, month - 1, day);
  const offset = timezoneOffsetMs(new Date(localMidnightUtc), timezone);
  return Math.floor((localMidnightUtc - offset) / 1000);
}

export function dateKeyFromDate(value: Date, timezone = DEFAULT_TIMEZONE): string {
  const parts = dateParts(value, timezone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function dateKeyFromEpoch(epoch: number, timezone = DEFAULT_TIMEZONE): string {
  return dateKeyFromDate(new Date(epoch * 1000), timezone);
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days, 12));
  return value.toISOString().slice(0, 10);
}

export function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

export function formatDateKeyDay(dateKey: string): string {
  const [_year, month, day] = dateKey.split("-").map(Number);
  return `${month}月${day}日`;
}

export function formatDateKeyWeekday(dateKey: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    weekday: "short"
  }).format(dateKeyToNoonUtc(dateKey));
}

export function monthLabelFromDateKey(dateKey: string): string {
  const [year, month] = dateKey.split("-").map(Number);
  return `${year}年${month}月`;
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

function dateKeyToNoonUtc(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}
