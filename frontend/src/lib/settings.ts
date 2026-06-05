export interface UISettings {
  server_url: string;
  lan_address: string;
  access_token: string;
  admin_token: string;
  language: string;
  timezone: string;
  font_family: string;
  font_size: number;
  theme: string;
  calendar_days: number;
  week_start: number;
  scheduler_start_hour: number;
  scheduler_end_hour: number;
  scheduler_slot_minutes: number;
  global_hotkey_enabled: boolean;
  global_hotkey: string;
  notification_enabled: boolean;
  notification_poll_interval: number;
  notification_query_window: number;
  notification_silent: boolean;
  notification_timeout: "default" | "never";
  ws_enabled: boolean;
  ws_reconnect_retries: number;
  reconnect_max_attempts: number;
  notify_on_disconnect: boolean;
  ws_reconnect_interval_ms: number;
  attachment_download_root: string;
}

export const DEFAULT_SETTINGS: UISettings = {
  server_url: "http://127.0.0.1:8000",
  lan_address: "",
  access_token: "",
  admin_token: "",
  language: "zh-CN",
  timezone: "Asia/Shanghai",
  font_family: "JetBrainsMono Nerd Font, Microsoft YaHei UI, Segoe UI, sans-serif",
  font_size: 28,
  theme: "warm-light",
  calendar_days: 7,
  week_start: 0,
  scheduler_start_hour: 6,
  scheduler_end_hour: 24,
  scheduler_slot_minutes: 30,
  global_hotkey_enabled: false,
  global_hotkey: "",
  notification_enabled: true,
  notification_poll_interval: 30,
  notification_query_window: 60,
  notification_silent: false,
  notification_timeout: "default",
  ws_enabled: true,
  ws_reconnect_retries: 3,
  reconnect_max_attempts: 3,
  notify_on_disconnect: true,
  ws_reconnect_interval_ms: 3000,
  attachment_download_root: "",
};

export function parseSettings(raw: { [key: string]: string | undefined }): UISettings {
  const schedulerStartHour = parseNumberSetting(
    raw.scheduler_start_hour,
    DEFAULT_SETTINGS.scheduler_start_hour
  );
  const schedulerEndHour = parseNumberSetting(
    raw.scheduler_end_hour,
    DEFAULT_SETTINGS.scheduler_end_hour
  );

  const globalHotkeyEnabled = raw.global_hotkey_enabled === "true";
  const globalHotkey = raw.global_hotkey ?? "";
  const notificationPollInterval = parseNumberSetting(raw.notification_poll_interval, DEFAULT_SETTINGS.notification_poll_interval);
  const notificationQueryWindow = parseNumberSetting(raw.notification_query_window, DEFAULT_SETTINGS.notification_query_window);

  return {
    server_url: raw.server_url ?? DEFAULT_SETTINGS.server_url,
    lan_address: raw.lan_address ?? DEFAULT_SETTINGS.lan_address,
    access_token: raw.access_token ?? DEFAULT_SETTINGS.access_token,
    admin_token: raw.admin_token ?? DEFAULT_SETTINGS.admin_token,
    language: raw.language ?? DEFAULT_SETTINGS.language,
    timezone: raw.timezone ?? DEFAULT_SETTINGS.timezone,
    font_family: raw.font_family ?? DEFAULT_SETTINGS.font_family,
    font_size: Number(raw.font_size) || DEFAULT_SETTINGS.font_size,
    theme: raw.theme ?? DEFAULT_SETTINGS.theme,
    calendar_days: Number(raw.calendar_days) || DEFAULT_SETTINGS.calendar_days,
    week_start: raw.week_start !== undefined ? Number(raw.week_start) : DEFAULT_SETTINGS.week_start,
    scheduler_start_hour: clampHour(schedulerStartHour, 0, 23),
    scheduler_end_hour: clampHour(schedulerEndHour, 1, 24),
    scheduler_slot_minutes: parseNumberSetting(
      raw.scheduler_slot_minutes,
      DEFAULT_SETTINGS.scheduler_slot_minutes
    ),
    global_hotkey_enabled: globalHotkeyEnabled,
    global_hotkey: globalHotkey,
    notification_enabled: raw.notification_enabled !== "false",
    notification_poll_interval: notificationPollInterval,
    notification_query_window: notificationQueryWindow,
    notification_silent: raw.notification_silent === "true",
    notification_timeout: (raw.notification_timeout === "never" ? "never" : "default") as "default" | "never",
    ws_enabled: raw.ws_enabled !== "false",
    ws_reconnect_retries: parseNumberSetting(raw.ws_reconnect_retries, DEFAULT_SETTINGS.ws_reconnect_retries),
    reconnect_max_attempts: parseNumberSetting(
      raw.reconnect_max_attempts ?? raw.ws_reconnect_retries,
      DEFAULT_SETTINGS.reconnect_max_attempts
    ),
    notify_on_disconnect: raw.notify_on_disconnect !== "false",
    ws_reconnect_interval_ms: parseNumberSetting(raw.ws_reconnect_interval_ms, DEFAULT_SETTINGS.ws_reconnect_interval_ms),
    attachment_download_root: raw.attachment_download_root ?? DEFAULT_SETTINGS.attachment_download_root,
  };
}

function parseNumberSetting(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampHour(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
