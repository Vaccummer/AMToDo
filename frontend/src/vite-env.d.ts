/// <reference types="vite/client" />

interface SettingsData {
  server_url?: string;
  lan_address?: string;
  access_token?: string;
  admin_token?: string;
  language?: string;
  timezone?: string;
  font_family?: string;
  font_size?: string;
  theme?: string;
  calendar_days?: string;
  week_start?: string;
  scheduler_start_hour?: string;
  scheduler_end_hour?: string;
  scheduler_slot_minutes?: string;
  global_hotkey_enabled?: string;
  global_hotkey?: string;
  notification_enabled?: string;
  notification_poll_interval?: string;
  notification_query_window?: string;
  notification_silent?: string;
  notification_timeout?: string;
  ws_reconnect_retries?: string;
  reconnect_max_attempts?: string;
  ws_enabled?: string;
  notify_on_disconnect?: string;
  ws_reconnect_interval_ms?: string;
  known_key_fingerprint?: string;
}


interface Window {
  Capacitor?: {
    isNativePlatform: (() => boolean) | boolean;
    getPlatform: () => string;
  };
  amtodoShell?: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
    readSettings: () => Promise<SettingsData>;
    writeSettings: (settings: SettingsData) => Promise<{ ok: boolean; error?: string }>;
    registerHotkey?: (accelerator: string) => Promise<{ ok: boolean; error?: string }>;
    unregisterHotkey?: () => Promise<void>;
    startNotificationPolling?: (settings: SettingsData) => Promise<{ ok: boolean; error?: string }>;
    stopNotificationPolling?: () => Promise<{ ok: boolean; error?: string }>;
    showSystemNotification?: (params: { title: string; body: string; id: number; trigger_at: number }) => Promise<{ ok: boolean; error?: string }>;
    onNotificationClicked?: (callback: (data: { id: number; trigger_at: number }) => void) => () => void;
  };
}
