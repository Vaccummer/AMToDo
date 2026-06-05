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
  attachment_download_root?: string;
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
    getDefaultAttachmentDownloadRoot?: () => Promise<{ ok: boolean; path: string }>;
    selectAttachmentDownloadRoot?: () => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
    getAttachmentCacheEntry?: (entry: AttachmentCacheEntryInput) => Promise<AttachmentCacheEntryResult>;
    appendAttachmentCacheChunk?: (entry: AttachmentCacheEntryInput & { offset: number }, data: Uint8Array) => Promise<{ ok: boolean; bytes?: number; error?: string }>;
    finalizeAttachmentCacheEntry?: (entry: AttachmentCacheEntryInput) => Promise<{ ok: boolean; filePath?: string; folderPath?: string; error?: string }>;
    deleteAttachmentCacheEntry?: (entry: AttachmentCacheEntryInput) => Promise<{ ok: boolean; error?: string }>;
    clearAttachmentDownloadCache?: (root?: string) => Promise<{ ok: boolean; error?: string }>;
    getAttachmentDownloadCacheSize?: (root?: string) => Promise<{ ok: boolean; count: number; bytes: number; error?: string }>;
    readAttachmentTextPreview?: (entry: AttachmentCacheEntryInput, maxBytes?: number) => Promise<{ ok: boolean; text?: string; truncated?: boolean; error?: string }>;
    openAttachmentCacheFolder?: (entry: AttachmentCacheEntryInput) => Promise<{ ok: boolean; error?: string }>;
    onNotificationClicked?: (callback: (data: { id: number; trigger_at: number }) => void) => () => void;
  };
}

interface AttachmentCacheEntryInput {
  root?: string;
  ownerType: "todo" | "schedule";
  ownerId: number;
  attachmentId: number;
  filename: string;
  size: number;
}

interface AttachmentCacheEntryResult {
  ok: boolean;
  exists: boolean;
  filePath: string;
  folderPath: string;
  partialBytes: number;
  sanitizedFilename: string;
  error?: string;
}
