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
    onNotificationClicked?: (callback: (data: { id: number; trigger_at: number }) => void) => () => void;
    connectNotificationWebSocket?: (settings: SettingsData) => Promise<{ ok: boolean; error?: string; mode?: string }>;
    disconnectNotificationWebSocket?: () => Promise<{ ok: boolean; error?: string }>;
    onWsStatusChanged?: (callback: (data: { status: "connected" | "disconnected" | "reconnecting"; attempt?: number; maxRetries?: number }) => void) => () => void;
  };
}
