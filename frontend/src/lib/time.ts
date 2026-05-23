let DEFAULT_TIMEZONE = "Asia/Shanghai";

export function getDefaultTimezone(): string {
  return DEFAULT_TIMEZONE;
}

export function setDefaultTimezone(tz: string): void {
  DEFAULT_TIMEZONE = tz;
}

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

export function datetimeLocalFromEpoch(epoch: number, timezone = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(new Date(epoch * 1000));
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}T${lookup.hour}:${lookup.minute}:${lookup.second}`;
}

export function epochFromDatetimeLocal(dt: string, timezone = DEFAULT_TIMEZONE): number {
  const [datePart, timePart] = dt.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const times = timePart.split(":").map(Number);
  const hour = times[0] ?? 0;
  const minute = times[1] ?? 0;
  const second = times[2] ?? 0;
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = timezoneOffsetMs(new Date(naiveUtc), timezone);
  return Math.floor((naiveUtc - offset) / 1000);
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

export function formatDateKeyDay(dateKey: string, locale = "zh-CN"): string {
  const d = dateKeyToNoonUtc(dateKey);
  if (locale === "en") {
    return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(d);
  }
  const [_year, month, day] = dateKey.split("-").map(Number);
  return `${month}月${day}日`;
}

export function formatDateKeyDayNumber(dateKey: string): string {
  return String(Number(dateKey.split("-")[2]));
}

export function formatDateKeyWeekday(dateKey: string, locale = "zh-CN"): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN", {
    weekday: "short"
  }).format(dateKeyToNoonUtc(dateKey));
}

export function monthLabelFromDateKey(dateKey: string, locale = "zh-CN"): string {
  const d = dateKeyToNoonUtc(dateKey);
  if (locale === "en") {
    return new Intl.DateTimeFormat("en", { year: "numeric", month: "long" }).format(d);
  }
  const [year, month] = dateKey.split("-").map(Number);
  return `${year}年${month}月`;
}

export function formatDay(value: Date, timezone = DEFAULT_TIMEZONE, locale = "zh-CN"): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN", {
    timeZone: timezone,
    month: "numeric",
    day: "numeric"
  }).format(value);
}

export function formatWeekday(value: Date, timezone = DEFAULT_TIMEZONE, locale = "zh-CN"): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN", {
    timeZone: timezone,
    weekday: "short"
  }).format(value);
}

export function formatTime(epoch: number, timezone = DEFAULT_TIMEZONE, locale = "zh-CN"): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en" : "zh-CN", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(epoch * 1000);
}

export function formatDueTime(epoch: number, timezone = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date(epoch * 1000));
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const nowParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric"
  }).formatToParts(new Date());
  const nowYear = Object.fromEntries(nowParts.map((p) => [p.type, p.value])).year;
  const hm = `${lookup.hour}:${lookup.minute}`;
  if (lookup.year === nowYear) {
    return `${lookup.month}-${lookup.day} ${hm}`;
  }
  return `${lookup.year}-${lookup.month}-${lookup.day} ${hm}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function firstWeekdayOfMonth(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

export function dateKeyFromParts(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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

export function isOverdueTodo(todo: { due_at: number | null; completed: boolean }): boolean {
  return todo.due_at !== null && !todo.completed && todo.due_at < Math.floor(Date.now() / 1000);
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

export function mondayOfDateKey(dateKey: string): string {
  return startOfWeekDateKey(dateKey, 1);
}

export function startOfWeekDateKey(dateKey: string, weekStart = 0): string {
  const d = dateKeyToNoonUtc(dateKey);
  const dow = d.getUTCDay();
  const normalizedWeekStart = weekStart === 1 ? 1 : 0;
  const offset = -((dow - normalizedWeekStart + 7) % 7);
  return addDaysToDateKey(dateKey, offset);
}

export function weekOfMonth(dateKey: string, weekStart = 1): number {
  const weekStartKey = startOfWeekDateKey(dateKey, weekStart);
  const [year, month] = weekStartKey.split("-").map(Number);
  const firstOfMonth = `${year}-${String(month).padStart(2, "0")}-01`;
  const firstWeekStart = startOfWeekDateKey(firstOfMonth, weekStart);
  const diffDays = Math.round(
    (startOfDateKeyEpoch(weekStartKey) - startOfDateKeyEpoch(firstWeekStart)) / 86400
  );
  return Math.floor(diffDays / 7) + 1;
}

/**
 * Format epoch to short MM/DD date string.
 */
export function formatDateShort(epoch: number, timezone = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(epoch * 1000));
  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${lookup.month}/${lookup.day}`;
}
