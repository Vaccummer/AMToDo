/// <reference types="vite/client" />

interface SettingsData {
  server_url?: string;
  access_token?: string;
  admin_token?: string;
  language?: string;
  timezone?: string;
  font_family?: string;
  font_size?: string;
  calendar_days?: string;
  week_start?: string;
  scheduler_start_hour?: string;
  scheduler_end_hour?: string;
  scheduler_slot_minutes?: string;
}

interface Window {
  amtodoShell?: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<void>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
    readSettings: () => Promise<SettingsData>;
    writeSettings: (settings: SettingsData) => Promise<{ ok: boolean; error?: string }>;
  };
}
