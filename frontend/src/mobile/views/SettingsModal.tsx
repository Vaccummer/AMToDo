import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AMToDoApi } from "../../api/client";
import type { HealthResponse, UserResponse } from "../../api/client";
import type { ConnectionStatusSnapshot } from "../../api/connection-status";
import { clearAttachmentCache, getCacheSize } from "../../lib/attachmentCache";
import { clearDiskCache, getDiskCacheSize, isNative as isNativePlatform } from "../../lib/attachmentDiskCache";
import { clearCaptureTempMedia, getCaptureTempMediaSize } from "../../lib/captureTempMediaCache";
import type { CaptureTempMediaStats } from "../../lib/native-attachment";
import type { UISettings } from "../../lib/settings";
import { listThemes, applyTheme, getTheme } from "../../themes";
import { Dropdown } from "./Dropdown";
import { useConfirm } from "./ConfirmDialog";
import { setMainStatusBar, setSettingsStatusBar } from "../statusBar";
import { useI18n } from "../../i18n";

// ── Mobile-specific text (not shared with desktop i18n) ──

function createMobileSettingsText(t: (key: string, params?: Record<string, string | number>) => string) {
  return {
  title: t("settings.title"),
  tabConnection: t("settings.tabConnection"),
  tabGeneral: t("settings.tabGeneral"),
  tabNotification: t("settings.tabNotification"),
  // General
  appearance: t("settings.mobileAppearance"),
  theme: t("settings.theme"),
  chooseTheme: t("settings.mobileChooseTheme"),
  language: t("settings.language"),
  fontSize: t("settings.mobileFontSize"),
  calendar: t("settings.mobileCalendar"),
  weekStart: t("settings.weekStart"),
  sunday: t("settings.sunday"),
  monday: t("settings.monday"),
  scheduler: t("settings.mobileScheduler"),
  scheduleStart: t("settings.scheduleStart"),
  scheduleEnd: t("settings.scheduleEnd"),
  slotMinutes: t("settings.slotMinutes"),
  slotLabel: (n: number) => t("settings.slotMinutesLabel", { n }),
  scheduleWarn: t("settings.scheduleStartBeforeEnd"),
  globalHotkey: t("settings.globalHotkey"),
  hotkeyEnabled: t("settings.mobileHotkeyEnabled"),
  hotkeyCombo: t("settings.hotkeyCombo"),
  pressHotkey: t("settings.pressHotkey"),
  clickToRecord: t("settings.clickToRecordHotkey"),
  hotkeyHint: t("settings.hotkeyHint"),
  hotkeyRegFailed: t("settings.hotkeyRegisterFailed"),
  clearHotkey: t("settings.clearHotkey"),
  cache: t("settings.cache"),
  attachmentCache: t("settings.attachmentCache"),
  captureTempMedia: t("settings.mobileCaptureTempMedia"),
  cacheDetail: (count: number, size: string) => t("settings.mobileCacheDetail", { count, size }),
  cacheFileCount: (count: number) => t("settings.mobileCacheFileCount", { count }),
  captureTempDetail: (photoCount: number, videoCount: number) => t("settings.mobileCaptureTempDetail", { photoCount, videoCount }),
  cacheLoading: t("settings.cacheLoading"),
  clearCache: t("settings.clearCache"),
  clearCacheAction: t("common.clear"),
  clearingCache: t("settings.clearingCache"),
  clearCacheConfirm: t("settings.clearCacheConfirm"),
  clearCaptureTempConfirm: t("settings.mobileClearCaptureTempConfirm"),
  timezone: t("settings.timezone"),
  // Connection
  connToggle: t("settings.mobileConnectionSwitch"),
  connConnected: t("settings.mobileConnected"),
  connDisconnected: t("settings.mobileDisconnected"),
  lanAddress: t("settings.lanAddress"),
  fetch: t("settings.fetch"),
  fetching: t("settings.fetching"),
  serverUrl: t("settings.serverUrl"),
  serverInfo: t("settings.mobileServerInfo"),
  serverName: t("settings.mobileServerName"),
  serverVersion: t("settings.mobileServerVersion"),
  serverInfoUnavailable: t("settings.mobileServerInfoUnavailable"),
  serverPending: t("settings.mobilePendingCheck"),
  userName: t("settings.mobileUserName"),
  userId: t("settings.mobileUserId"),
  attachmentLimit: t("settings.mobileAttachmentLimit"),
  configureConnection: t("settings.mobileConfigureConnection"),
  connect: t("settings.mobileConnect"),
  disconnect: t("settings.mobileDisconnect"),
  reconnectNow: t("settings.mobileReconnectNow"),
  connecting: t("settings.mobileConnecting"),
  interrupted: t("settings.mobileInterrupted"),
  interruptedDesc: t("settings.mobileInterruptedDesc"),
  address: t("settings.mobileAddress"),
  userCreated: t("settings.mobileUserCreated"),
  unknownUser: t("settings.mobileUnknownUser"),
  unverified: t("settings.mobileUnverified"),
  retryState: t("settings.mobileRetryState"),
  currentStep: t("settings.currentStep"),
  unavailable: t("settings.mobileUnavailable"),
  tokenStep: t("settings.accessToken"),
  check: t("settings.check"),
  checking: t("settings.checking"),
  accessToken: t("settings.accessToken"),
  verify: t("settings.verify"),
  verifying: t("settings.verifying"),
  enterToken: t("settings.mobileEnterToken"),
  checkServerFirst: t("settings.checkServerFirst"),
  maxReconnect: t("settings.maxReconnect"),
  disconnectNotify: t("settings.disconnectNotify"),
  connSuccess: t("settings.connectionSuccess"),
  connSuccessDesc: (name: string, ver: string) => `${name} v${ver}`,
  connFailed: t("settings.connectionFailed"),
  connFailedDesc: t("settings.connectionFailedDesc"),
  responseFormatError: t("settings.responseFormatError"),
  verifyingToken: t("settings.verifyingToken"),
  tokenValid: t("settings.tokenValid"),
  userLabel: t("settings.userLabel"),
  tokenInvalid: t("settings.tokenInvalid"),
  tokenInvalidDesc: t("settings.tokenInvalidDesc"),
  tokenVerifyFailed: t("settings.tokenVerifyFailed"),
  detectingConn: t("settings.detectingConnection"),
  connectionOnlineDesc: t("settings.mobileConnectionOnlineDesc"),
  checkingServerDesc: t("settings.mobileCheckingServerDesc"),
  verifyingTokenDesc: t("settings.mobileVerifyingTokenDesc"),
  establishingRealtimeDesc: t("settings.mobileEstablishingRealtimeDesc"),
  connectionIdleDesc: t("settings.mobileConnectionIdleDesc"),
  realtimeOnline: t("settings.mobileRealtimeOnline"),
  maxSuffix: t("settings.mobileMaxSuffix"),
  // Notification
  notifyTitle: t("settings.tabNotification"),
  notifyEnabled: t("settings.notificationEnabled"),
  notifyDisabled: t("settings.notificationDisabled"),
  notifyEnabledDesc: t("settings.notificationEnabledDesc"),
  notifyDisabledDesc: t("settings.notificationDisabledDesc"),
  notifyToggle: t("settings.notificationToggle"),
  silentMode: t("settings.silentMode"),
  silentModeDesc: t("settings.silentModeDesc"),
  timeout: t("settings.timeout"),
  timeoutDesc: t("settings.timeoutDesc"),
  autoTimeout: t("settings.autoTimeout"),
  neverTimeout: t("settings.neverTimeout"),
  };
}

// ── SVG Icons ──

const CHECK_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const CROSS_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="15" y1="9" x2="9" y2="15" />
    <line x1="9" y1="9" x2="15" y2="15" />
  </svg>
);

const WARN_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const CHEVRON = (
  <svg className="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const TIMEZONE_OPTIONS = Intl.supportedValuesOf("timeZone").map((tz) => ({
  value: tz,
  label: tz,
}));

const SCHEDULE_START_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, "0")}:00`,
}));

const SCHEDULE_END_HOUR_OPTIONS = Array.from({ length: 24 }, (_, index) => {
  const hour = index + 1;
  return {
    value: String(hour),
    label: `${String(hour).padStart(2, "0")}:00`,
  };
});

// ── Types ──

type UrlCheckResult =
  | {
      kind: "ok";
      version: string;
      name?: string;
      ipv4?: string;
      ipv6?: string;
      bind?: string[];
      maxAttachmentSizeBytes?: number;
    }
  | { kind: "unreachable"; message: string }
  | { kind: "invalid"; message: string };

type TokenResult =
  | { ok: true; userId: number; userName: string; createdAt: number }
  | { ok: false; message: string };

type Props = {
  settings: UISettings;
  onUpdateField?: (fields: Partial<UISettings>) => void;
  onSaveConnection?: (fields: Partial<UISettings>) => void;
  onClose: () => void;
  focusTarget?: "url" | "token";
  connectionStatus?: ConnectionStatusSnapshot;
  health?: HealthResponse | null;
  currentUser?: UserResponse["user"] | null;
  onConnectionToggle?: (enabled: boolean) => void;
};

// ── Main Component ──

export function SettingsModal({ settings: initial, onUpdateField, onSaveConnection, onClose, focusTarget, connectionStatus, health, currentUser, onConnectionToggle }: Props) {
  const { t, locale } = useI18n();
  const MOB = useMemo(() => createMobileSettingsText(t), [t]);
  // Form fields
  const [serverUrl, setServerUrl] = useState(initial.server_url);
  const [accessToken, setAccessToken] = useState(initial.access_token);
  const [language, setLanguage] = useState(initial.language);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [theme, setTheme] = useState(initial.theme);
  const [weekStart, setWeekStart] = useState(String(initial.week_start));
  const [scheduleStartHour, setScheduleStartHour] = useState(String(initial.scheduler_start_hour));
  const [scheduleEndHour, setScheduleEndHour] = useState(String(initial.scheduler_end_hour));
  const [slotMinutes, setSlotMinutes] = useState(String(initial.scheduler_slot_minutes));
  const [showToken, setShowToken] = useState(false);
  const [connectionPage, setConnectionPage] = useState<"overview" | "config">("overview");
  const [connDescExpanded, setConnDescExpanded] = useState(false);
  const connectionPageRef = useRef<"overview" | "config">("overview");
  const onCloseRef = useRef(onClose);

  // Connection
  const [wsEnabled, setWsEnabled] = useState(initial.ws_enabled);
  const userToggledWsRef = useRef(false);
  const [reconnectMaxAttempts, setReconnectMaxAttempts] = useState(String(initial.reconnect_max_attempts));
  const [notifyOnDisconnect, setNotifyOnDisconnect] = useState(initial.notify_on_disconnect);
  const [lanAddress, setLanAddress] = useState(initial.lan_address || "");
  const [lanLoading, setLanLoading] = useState(false);

  // URL check
  const [urlChecking, setUrlChecking] = useState(false);
  const [urlCheckResult, setUrlCheckResult] = useState<UrlCheckResult | null>(null);

  // Token verify
  const [tokenVerifying, setTokenVerifying] = useState(false);
  const [tokenResult, setTokenResult] = useState<TokenResult | null>(null);

  const { ask, dialog: confirmDialog } = useConfirm();

  // Cache
  const [cacheSize, setCacheSize] = useState<{ count: number; bytes: number } | null>(null);
  const [clearingCache, setClearingCache] = useState(false);
  const [captureTempSize, setCaptureTempSize] = useState<CaptureTempMediaStats | null>(null);
  const [clearingCaptureTemp, setClearingCaptureTemp] = useState(false);

  // Notification
  const [notifyEnabled, setNotifyEnabled] = useState(initial.notification_enabled);
  const [notifSilent, setNotifSilent] = useState(initial.notification_silent);
  const [notifTimeout, setNotifTimeout] = useState(initial.notification_timeout);

  // Global hotkey
  const [hotkeyEnabled, setHotkeyEnabled] = useState(initial.global_hotkey_enabled);
  const [hotkeyValue, setHotkeyValue] = useState(initial.global_hotkey);
  const [recording, setRecording] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);

  const themeOptions = useMemo(
    () => listThemes().map((name) => ({ value: name, label: name })),
    []
  );

  function handleThemeChange(name: string) {
    setTheme(name);
    applyTheme(getTheme(name));
    onUpdateField?.({ theme: name });
  }

  const formatSize = useCallback((bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }, []);

  const loadCacheSize = useCallback(async () => {
    try {
      const size = isNativePlatform() ? await getDiskCacheSize() : await getCacheSize();
      setCacheSize(size);
    } catch {
      setCacheSize(null);
    }
  }, []);

  const loadCaptureTempSize = useCallback(async () => {
    if (!isNativePlatform()) {
      setCaptureTempSize({ count: 0, bytes: 0 });
      return;
    }
    try {
      setCaptureTempSize(await getCaptureTempMediaSize());
    } catch {
      setCaptureTempSize(null);
    }
  }, []);

  useEffect(() => {
    loadCacheSize().catch(() => setCacheSize(null));
    loadCaptureTempSize().catch(() => setCaptureTempSize(null));
  }, [loadCacheSize, loadCaptureTempSize]);

  useEffect(() => {
    connectionPageRef.current = connectionPage;
  }, [connectionPage]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Auto-revert wsEnabled if connection fails after user toggle
  useEffect(() => {
    if (!userToggledWsRef.current) return;
    if (!wsEnabled) return;
    const s = connectionStatus?.status;
    if (s === "token-error" || s === "offline") {
      userToggledWsRef.current = false;
      setWsEnabled(false);
      onConnectionToggle?.(false);
    } else if (s === "online") {
      userToggledWsRef.current = false;
    }
  }, [connectionStatus?.status, wsEnabled, onConnectionToggle]);

  // Status bar + browser back handling
  useEffect(() => {
    // Push a history entry so Android back gesture/button closes the modal
    history.pushState({ settingsModal: true }, "");
    const handleBack = (fromPopState: boolean) => {
      if (connectionPageRef.current === "config") {
        setConnectionPage("overview");
        if (fromPopState) history.pushState({ settingsModal: true }, "");
        return;
      }
      onCloseRef.current();
    };
    const handlePopState = () => handleBack(true);
    window.addEventListener("popstate", handlePopState);

    let capacitorHandle: { remove: () => Promise<void> } | undefined;
    import("@capacitor/app").then(({ App }) => {
      App.addListener("backButton", () => handleBack(false)).then((handle) => {
        capacitorHandle = handle;
      });
    }).catch(() => {});

    // Match status bar to settings background
    setSettingsStatusBar();

    return () => {
      window.removeEventListener("popstate", handlePopState);
      capacitorHandle?.remove();
      setMainStatusBar();
    };
  }, []);

  // ── Connection logic ──

  async function checkUrl(): Promise<boolean> {
    if (!serverUrl) {
      setUrlCheckResult(null);
      return false;
    }
    setUrlChecking(true);
    setUrlCheckResult(null);
    setTokenResult(null);
    try {
      onSaveConnection?.({ server_url: serverUrl });

      const api = new AMToDoApi(serverUrl, null);
      const result: HealthResponse = await api.health();

      if (!result || typeof result.version !== "string") {
        setUrlCheckResult({ kind: "invalid", message: MOB.responseFormatError });
        return false;
      }

      setUrlCheckResult({
        kind: "ok",
        version: result.version,
        name: result.name,
        ipv4: result.ipv4,
        ipv6: result.ipv6,
        bind: result.bind,
        maxAttachmentSizeBytes: result.limits?.max_attachment_size_bytes,
      });
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : MOB.connFailed;
      setUrlCheckResult({ kind: "unreachable", message: msg });
      return false;
    } finally {
      setUrlChecking(false);
    }
  }

  function handleUrlChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setServerUrl(value);
    if (urlCheckResult) {
      setUrlCheckResult(null);
      setTokenResult(null);
    }
  }

  async function verifyToken(opts?: { skipUrlCheck?: boolean }): Promise<boolean> {
    if (accessToken) {
      onSaveConnection?.({ access_token: accessToken });
    }
    if (!accessToken) return false;
    if (!opts?.skipUrlCheck && urlCheckResult?.kind !== "ok") return false;
    setTokenVerifying(true);
    setTokenResult(null);
    try {
      const api = new AMToDoApi(serverUrl, accessToken);
      const result = await api.verifyTokenHttp();
      if (result.ok) {
        setTokenResult({
          ok: true,
          userId: result.user.id,
          userName: result.user.name,
          createdAt: result.user.created_at,
        });
        return true;
      } else {
        setTokenResult({ ok: false, message: MOB.tokenInvalid });
        return false;
      }
    } catch (err: unknown) {
      setTokenResult({ ok: false, message: err instanceof Error ? err.message : MOB.tokenVerifyFailed });
      return false;
    } finally {
      setTokenVerifying(false);
    }
  }

  function handleReconnectBlur() {
    const n = Number(reconnectMaxAttempts);
    if (!Number.isFinite(n) || n < 0) {
      setReconnectMaxAttempts("3");
      onUpdateField?.({ reconnect_max_attempts: 3 });
    } else {
      onUpdateField?.({ reconnect_max_attempts: n });
    }
  }

  function handleNotifyDisconnectToggle() {
    setNotifyOnDisconnect((v) => {
      onUpdateField?.({ notify_on_disconnect: !v });
      return !v;
    });
  }

  function handleTokenChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setAccessToken(value);
    if (tokenResult) setTokenResult(null);
  }

  async function handleLanFetch() {
    if (!lanAddress) return;
    setLanLoading(true);
    try {
      const api = new AMToDoApi(lanAddress, null);
      const result = await api.health();
      if (!result.ipv4 && !result.ipv6) {
        setServerUrl(lanAddress);
        return;
      }
      const url = new URL(lanAddress);
      const port = url.port;
      const candidates: string[] = [];
      if (result.ipv6) candidates.push(`${url.protocol}//${result.ipv6}:${port}`);
      if (result.ipv4) candidates.push(`${url.protocol}//${result.ipv4}:${port}`);
      for (const candidate of candidates) {
        try {
          const verifyApi = new AMToDoApi(candidate, null);
          await Promise.race([
            verifyApi.health(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
          ]);
          setServerUrl(candidate);
          return;
        } catch {
          continue;
        }
      }
      setServerUrl(lanAddress);
    } catch {
      setServerUrl(lanAddress);
    } finally {
      setLanLoading(false);
    }
  }

  async function handleWsToggle() {
    if (wsEnabled) {
      setWsEnabled(false);
      onConnectionToggle?.(false);
      return;
    }

    let urlOk = urlCheckResult?.kind === "ok";
    if (!urlOk) {
      urlOk = await checkUrl();
      if (!urlOk) return;
    }

    let tokenOk = tokenResult?.ok === true;
    if (!tokenOk) {
      tokenOk = await verifyToken({ skipUrlCheck: true });
      if (!tokenOk) return;
    }

    setWsEnabled(true);
    userToggledWsRef.current = true;
    onSaveConnection?.({ ws_enabled: true });
    onConnectionToggle?.(true);
  }

  const validScheduleHours = Number(scheduleStartHour) < Number(scheduleEndHour);

  // Connection section state
  const connLocked = wsEnabled;
  const urlCheckPassed = urlCheckResult?.kind === "ok";
  const tokenEditable = urlCheckPassed && !connLocked;

  // Input classes
  const urlInputClass = [
    "settings-inline-input",
    urlCheckResult?.kind === "ok" ? "url-ok" : "",
    urlCheckResult?.kind === "unreachable" || urlCheckResult?.kind === "invalid" ? "url-err" : "",
  ].filter(Boolean).join(" ");

  const tokenInputClass = [
    "settings-inline-input",
    tokenResult?.ok === true ? "token-ok" : "",
    tokenResult?.ok === false ? "token-err" : "",
  ].filter(Boolean).join(" ");

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    }
  }

  async function handleClearCache() {
    const ok = await ask({
      title: MOB.clearCache,
      message: MOB.clearCacheConfirm,
      confirmLabel: MOB.clearCache,
      danger: true,
    });
    if (!ok) return;
    setClearingCache(true);
    try {
      if (isNativePlatform()) {
        await clearDiskCache();
      } else {
        await clearAttachmentCache();
      }
      await loadCacheSize();
    } catch {
      // ignore
    } finally {
      setClearingCache(false);
    }
  }

  async function handleClearCaptureTemp() {
    const ok = await ask({
      title: MOB.clearCache,
      message: MOB.clearCaptureTempConfirm,
      confirmLabel: MOB.clearCache,
      danger: true,
    });
    if (!ok) return;
    setClearingCaptureTemp(true);
    try {
      await clearCaptureTempMedia();
      await loadCaptureTempSize();
    } catch {
      // ignore
    } finally {
      setClearingCaptureTemp(false);
    }
  }

  useEffect(() => {
    if (hotkeyEnabled && hotkeyValue) {
      window.amtodoShell?.registerHotkey?.(hotkeyValue)?.then?.((result: { ok: boolean; error?: string }) => {
        if (!result?.ok) {
          setHotkeyError(result?.error || MOB.hotkeyRegFailed);
        }
      });
    } else {
      window.amtodoShell?.unregisterHotkey?.();
    }
  }, [hotkeyEnabled, hotkeyValue]);

  function formatKeyCombo(e: React.KeyboardEvent): string | null {
    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Super");

    const key = e.key;
    if (["Control", "Alt", "Shift", "Meta"].includes(key)) return null;
    if (key === "Escape") return null;

    let keyName = key;
    if (key.length === 1) keyName = key.toUpperCase();
    else if (key === " ") keyName = "Space";
    else if (key === "ArrowUp") keyName = "Up";
    else if (key === "ArrowDown") keyName = "Down";
    else if (key === "ArrowLeft") keyName = "Left";
    else if (key === "ArrowRight") keyName = "Right";

    parts.push(keyName);
    if (parts.length < 2) return null;
    return parts.join("+");
  }

  function handleHotkeyKeyDown(e: React.KeyboardEvent) {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    const combo = formatKeyCombo(e);
    if (combo) {
      setHotkeyValue(combo);
      setRecording(false);
      setHotkeyError(null);
      onUpdateField?.({ global_hotkey: combo });
    }
  }

  // ── Render helpers ──

  function renderUrlStatus() {
    if (urlChecking) {
      return (
        <div className="settings-inline-status">
          <span className="spinner-sm" />
          {MOB.detectingConn}
        </div>
      );
    }
    if (!urlCheckResult) return null;

    switch (urlCheckResult.kind) {
      case "ok":
        return (
          <div className="settings-inline-status ok">
            {CHECK_ICON} {MOB.connSuccess} &middot; {MOB.connSuccessDesc(urlCheckResult.name ?? "", urlCheckResult.version)}
          </div>
        );
      case "unreachable":
        return (
          <div className="settings-inline-status err">
            {CROSS_ICON} {urlCheckResult.message || MOB.connFailedDesc}
          </div>
        );
      case "invalid":
        return (
          <div className="settings-inline-status err">
            {CROSS_ICON} {urlCheckResult.message}
          </div>
        );
    }
  }

  function renderTokenStatus() {
    if (tokenVerifying) {
      return (
        <div className="settings-inline-status">
          <span className="spinner-sm" />
          {MOB.verifyingToken}
        </div>
      );
    }
    if (!tokenResult) return null;

    if (tokenResult.ok) {
      return (
        <div className="settings-inline-status ok">
          {CHECK_ICON} {MOB.tokenValid} &middot; {MOB.userLabel}{tokenResult.userName}
        </div>
      );
    }

    return (
      <div className="settings-inline-status err">
        {CROSS_ICON} {MOB.tokenInvalidDesc}
      </div>
    );
  }

  function formatUserCreated(ts?: number): string {
    if (!ts) return MOB.serverPending;
    return new Date(ts * 1000).toLocaleDateString(locale === "en" ? "en" : "zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  type ConnectionViewState = "online" | "connecting" | "interrupted" | "error" | "idle";

  function getConnectionViewState(): ConnectionViewState {
    if (urlChecking || tokenVerifying) return "connecting";

    switch (connectionStatus?.status) {
      case "online":
        return "online";
      case "checking":
        return "connecting";
      case "reconnecting":
        return tokenResult?.ok || connectionStatus.serverName ? "interrupted" : "connecting";
      case "idle":
        return "idle";
      case "offline":
        return wsEnabled && (tokenResult?.ok || connectionStatus.serverName) ? "interrupted" : "error";
      case "token-error":
        return "error";
      default:
        if (urlCheckResult?.kind === "unreachable" || urlCheckResult?.kind === "invalid" || tokenResult?.ok === false) return "error";
        if (wsEnabled) return "connecting";
        return "idle";
    }
  }

  const serverOk = urlCheckResult?.kind === "ok" ? urlCheckResult : null;
  const serverName = serverOk?.name || health?.name || connectionStatus?.serverName || MOB.serverInfoUnavailable;
  const serverVersion = serverOk?.version || health?.version || connectionStatus?.serverVersion || MOB.serverPending;
  const hasReliableServerInfo = Boolean(serverOk || health || connectionStatus?.serverName || connectionStatus?.serverVersion);
  const verifiedUser = tokenResult?.ok
    ? { id: tokenResult.userId, name: tokenResult.userName, created_at: tokenResult.createdAt }
    : currentUser;
  const userNameText = verifiedUser?.name || (connectionStatus?.status === "online" ? MOB.unknownUser : MOB.unverified);
  const userIdText = verifiedUser ? `No.${verifiedUser.id}` : MOB.serverPending;
  const userCreatedText = verifiedUser ? formatUserCreated(verifiedUser.created_at) : MOB.serverPending;
  const maxAttachmentSizeBytes = serverOk?.maxAttachmentSizeBytes ?? health?.limits?.max_attachment_size_bytes;
  const viewState = getConnectionViewState();
  const isWorking = viewState === "connecting";
  const canStartConnection = !isWorking;

  function primaryConnectionLabel(): string {
    if (isWorking) return MOB.connecting;
    if (viewState === "online" && wsEnabled) return MOB.disconnect;
    if (viewState === "interrupted") return MOB.reconnectNow;
    return MOB.connect;
  }

  function handlePrimaryConnectionAction() {
    if (viewState === "interrupted" && wsEnabled) {
      setWsEnabled(false);
      onConnectionToggle?.(false);
      window.setTimeout(() => {
        setWsEnabled(true);
        userToggledWsRef.current = true;
        onSaveConnection?.({ ws_enabled: true });
        onConnectionToggle?.(true);
      }, 0);
      return;
    }
    handleWsToggle();
  }

  function renderConnectionIcon() {
    if (viewState === "online") return CHECK_ICON;
    if (viewState === "interrupted") return WARN_ICON;
    if (viewState === "error") return CROSS_ICON;
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <path d="M21 12a9 9 0 0 1-9 9m0-18a9 9 0 0 1 9 9" />
        <path d="M3 12a9 9 0 0 1 9-9m0 18a9 9 0 0 1-9-9" />
      </svg>
    );
  }

  function connectionTitle(): string {
    if (viewState === "online") return MOB.connConnected;
    if (viewState === "connecting") return MOB.connecting;
    if (viewState === "interrupted") return MOB.interrupted;
    if (viewState === "idle") return MOB.connDisconnected;
    return MOB.connFailed;
  }

  function connectionDescription(): string {
    if (viewState === "online") return MOB.connectionOnlineDesc;
    if (viewState === "connecting") {
      if (!hasReliableServerInfo) return MOB.checkingServerDesc;
      return tokenVerifying ? MOB.verifyingTokenDesc : MOB.establishingRealtimeDesc;
    }
    if (viewState === "interrupted") return MOB.interruptedDesc;
    if (viewState === "idle") return MOB.connectionIdleDesc;
    return connectionStatus?.errorMessage || (tokenResult?.ok === false ? tokenResult.message : MOB.connFailedDesc);
  }

  function renderConnectionOverview() {
    const desc = connectionDescription();
    return (
      <div className={`settings-conn-result state-${viewState}`}>
        <div className="settings-conn-head">
          <div className="settings-conn-mark">{renderConnectionIcon()}</div>
          <div className="settings-conn-main">
            <div className="settings-conn-title-row">
              <span className="settings-conn-dot" />
              <span className="settings-conn-title">{connectionTitle()}</span>
            </div>
            <button
              type="button"
              className={`settings-conn-desc${connDescExpanded ? " expanded" : ""}`}
              onClick={() => setConnDescExpanded((v) => !v)}
              title={desc}
              aria-expanded={connDescExpanded}
            >
              <span>{desc}</span>
            </button>
          </div>
          <button
            type="button"
            className="settings-conn-config-btn"
            onClick={() => setConnectionPage("config")}
            aria-label={MOB.configureConnection}
          >
            {CHEVRON}
          </button>
        </div>

        {connDescExpanded ? (
          <div className="settings-conn-desc-full">
            {desc}
          </div>
        ) : null}

        <div className="settings-conn-grid">
          <div className="settings-conn-tile">
            <span>{MOB.serverName}</span>
            <strong>{hasReliableServerInfo ? serverName : MOB.serverInfoUnavailable}</strong>
          </div>
          <div className="settings-conn-tile">
            <span>{MOB.serverVersion}</span>
            <strong>{hasReliableServerInfo ? `v${serverVersion}` : MOB.serverPending}</strong>
          </div>
          <div className="settings-conn-tile">
            <span>{MOB.userName}</span>
            <strong>{userNameText}</strong>
          </div>
          <div className="settings-conn-tile">
            <span>{MOB.userId}</span>
            <strong>{userIdText}</strong>
          </div>
          <div className="settings-conn-tile">
            <span>{MOB.userCreated}</span>
            <strong>{userCreatedText}</strong>
          </div>
          <div className="settings-conn-tile">
            <span>{MOB.attachmentLimit}</span>
            <strong>{maxAttachmentSizeBytes ? formatSize(maxAttachmentSizeBytes) : MOB.serverPending}</strong>
          </div>
          <div className="settings-conn-tile wide">
            <span>{MOB.address}</span>
            <strong className="mono">{serverUrl || MOB.serverPending}</strong>
          </div>
        </div>

        <div className="settings-conn-meta">
          <div className="settings-conn-meta-row">
            <span>{MOB.retryState}</span>
            <strong>{viewState === "interrupted" ? `${reconnectMaxAttempts} ${MOB.maxSuffix}` : (viewState === "online" ? MOB.realtimeOnline : MOB.serverPending)}</strong>
          </div>
        </div>

        <div className="settings-conn-actions">
          <button
            type="button"
            className="settings-conn-primary"
            onClick={handlePrimaryConnectionAction}
            disabled={!canStartConnection}
          >
            {primaryConnectionLabel()}
          </button>
          <button type="button" className="settings-conn-secondary" onClick={() => setConnectionPage("config")}>
            {MOB.configureConnection}
          </button>
        </div>
      </div>
    );
  }

  function renderConnectionConfig() {
    return (
      <div className={`settings-group conn-group${connLocked ? " conn-locked" : ""}`}>
        <div className="settings-inline-field">
          <div className="settings-inline-label">{MOB.lanAddress}</div>
          <div className="settings-inline-row">
            <input
              type="text"
              className="settings-inline-input"
              value={lanAddress}
              onChange={(e) => setLanAddress(e.target.value)}
              onBlur={() => onUpdateField?.({ lan_address: lanAddress })}
              placeholder="https://todo.example.com"
              disabled={connLocked}
            />
            <button
              type="button"
              className="settings-inline-btn"
              onClick={handleLanFetch}
              disabled={connLocked || !lanAddress || lanLoading}
            >
              {lanLoading ? MOB.fetching : MOB.fetch}
            </button>
          </div>
        </div>

        <div className="settings-inline-field">
          <div className="settings-inline-label">{MOB.serverUrl}</div>
          <div className="settings-inline-row">
            <input
              type="text"
              className={urlInputClass}
              value={serverUrl}
              onChange={handleUrlChange}
              onBlur={() => onUpdateField?.({ server_url: serverUrl })}
              disabled={connLocked}
              placeholder="https://todo.example.com"
            />
            <button
              type="button"
              className="settings-inline-btn"
              onClick={() => checkUrl()}
              disabled={connLocked || !serverUrl || urlChecking}
            >
              {urlChecking ? MOB.checking : MOB.check}
            </button>
          </div>
          {renderUrlStatus()}
        </div>

        <div className="settings-inline-field">
          <div className="settings-inline-label">{MOB.accessToken}</div>
          <div className="settings-inline-row">
            <div className="settings-inline-input-wrap">
              <input
                type={showToken ? "text" : "password"}
                className={tokenInputClass}
                value={accessToken}
                onChange={handleTokenChange}
                onBlur={() => onUpdateField?.({ access_token: accessToken })}
                disabled={!tokenEditable}
                placeholder={!tokenEditable ? MOB.checkServerFirst : MOB.enterToken}
              />
              <button
                type="button"
                className="settings-inline-eye"
                onClick={() => setShowToken((v) => !v)}
                disabled={!tokenEditable}
              >
                {showToken ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            <button
              type="button"
              className="settings-inline-btn"
              onClick={() => verifyToken()}
              disabled={!tokenEditable || !accessToken || tokenVerifying}
            >
              {tokenVerifying ? MOB.verifying : MOB.verify}
            </button>
          </div>
          {renderTokenStatus()}
        </div>

        <div className="settings-divider" />

        <div className="settings-row">
          <span className="settings-row-label">{MOB.disconnectNotify}</span>
          <button
            type="button"
            className={`settings-sw${notifyOnDisconnect ? " on" : ""}`}
            onClick={handleNotifyDisconnectToggle}
            role="switch"
            aria-checked={notifyOnDisconnect}
          >
            <span className="settings-sw-knob" />
          </button>
        </div>

        <div className="settings-row">
          <span className="settings-row-label">{MOB.maxReconnect}</span>
          <div className="settings-row-right">
            <input
              type="number"
              className="settings-inline-number"
              value={reconnectMaxAttempts}
              min={0}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || /^\d+$/.test(v)) setReconnectMaxAttempts(v);
              }}
              onBlur={handleReconnectBlur}
            />
          </div>
        </div>
      </div>
    );
  }

  // ── JSX ──

  return (
    <div className="settings-modal-backdrop" onKeyDown={handleKeyDown}>
      <div className="settings-modal-card" role="dialog" aria-label={MOB.title}>
        {/* Header */}
        <div className="settings-modal-header">
          <div className="settings-modal-header-left">
            {connectionPage === "config" ? (
              <button type="button" className="settings-modal-back" onClick={() => setConnectionPage("overview")} aria-label={t("common.previous")}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            ) : null}
            <div className="settings-modal-dot" />
            <h2 className="settings-modal-title">{connectionPage === "config" ? MOB.configureConnection : MOB.title}</h2>
          </div>
          <button type="button" className="settings-modal-close" onClick={onClose} aria-label={t("common.close")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="settings-modal-body">

          {/* Connection */}
          {connectionPage === "overview" ? renderConnectionOverview() : renderConnectionConfig()}

          {/* General + Notification */}
          {connectionPage === "overview" ? <div className="settings-group">
            <div className="settings-row">
              <span className="settings-row-label">{MOB.theme}</span>
              <div className="settings-row-right">
                <Dropdown
                  value={theme}
                  options={themeOptions}
                  onChange={handleThemeChange}
                />
              </div>
            </div>
            <div className="settings-row">
              <span className="settings-row-label">{MOB.language}</span>
              <div className="settings-row-right">
                <Dropdown
                  value={language}
                  options={[{ value: "zh-CN", label: "中文" }, { value: "en", label: "English" }]}
                  onChange={(v) => { setLanguage(v); onUpdateField?.({ language: v }); }}
                />
              </div>
            </div>
            <div className="settings-row">
              <span className="settings-row-label">{MOB.timezone}</span>
              <div className="settings-row-right">
                <Dropdown
                  value={timezone}
                  options={TIMEZONE_OPTIONS}
                  onChange={(v) => { setTimezone(v); onUpdateField?.({ timezone: v }); }}
                  searchable
                />
              </div>
            </div>
            <div className="settings-row">
              <span className="settings-row-label">{MOB.tabNotification}</span>
              <button
                type="button"
                className={`settings-sw${notifyEnabled ? " on" : ""}`}
                onClick={() => setNotifyEnabled((v) => { onUpdateField?.({ notification_enabled: !v }); return !v; })}
                role="switch"
                aria-checked={notifyEnabled}
                aria-label={MOB.notifyToggle}
              >
                <span className="settings-sw-knob" />
              </button>
            </div>
            <div className="settings-row settings-cache-metric-row">
              <div className="settings-cache-metric-main">
                <span className="settings-row-label">{MOB.attachmentCache}</span>
                {cacheSize ? (
                  <span className="settings-cache-metric">
                    <span>{formatSize(cacheSize.bytes)}</span>
                    <span>{MOB.cacheFileCount(cacheSize.count)}</span>
                  </span>
                ) : (
                  <span className="settings-row-hint">{MOB.cacheLoading}</span>
                )}
              </div>
              <button
                type="button"
                className="settings-cache-clear-btn"
                disabled={clearingCache || !cacheSize || cacheSize.count === 0}
                onClick={handleClearCache}
              >
                {clearingCache ? MOB.clearingCache : MOB.clearCacheAction}
              </button>
            </div>
            <div className="settings-row settings-cache-metric-row">
              <div className="settings-cache-metric-main">
                <span className="settings-row-label">{MOB.captureTempMedia}</span>
                {captureTempSize ? (
                  <span className="settings-cache-metric">
                    <span>{formatSize(captureTempSize.bytes)}</span>
                    <span>{MOB.captureTempDetail(captureTempSize.photoCount, captureTempSize.videoCount)}</span>
                  </span>
                ) : (
                  <span className="settings-row-hint">{MOB.cacheLoading}</span>
                )}
              </div>
              <button
                type="button"
                className="settings-cache-clear-btn"
                disabled={clearingCaptureTemp || !captureTempSize || captureTempSize.count === 0}
                onClick={handleClearCaptureTemp}
              >
                {clearingCaptureTemp ? MOB.clearingCache : MOB.clearCacheAction}
              </button>
            </div>
          </div> : null}

        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
