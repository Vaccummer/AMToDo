import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AMToDoApi } from "../../api/client";
import type { ConnectionStatusSnapshot } from "../../api/connection-status";
import { FingerprintMismatchError, fingerprintPublicKey, importP256PublicKey, verifyOrEnrollKey } from "../../crypto/envelope";
import { clearAttachmentCache, getCacheSize } from "../../lib/attachmentCache";
import type { UISettings } from "../../lib/settings";
import { listThemes, applyTheme, getTheme } from "../../themes";
import { Dropdown } from "./Dropdown";
import { useConfirm } from "./ConfirmDialog";

// ── Mobile-specific text (not shared with desktop i18n) ──

const MOB = {
  title: "设置",
  tabConnection: "连接",
  tabGeneral: "通用",
  tabNotification: "通知",
  // General
  appearance: "外观",
  theme: "主题",
  chooseTheme: "选择配色方案",
  language: "语言",
  fontSize: "字体大小",
  calendar: "日历",
  weekStart: "每周起始",
  sunday: "周日",
  monday: "周一",
  scheduler: "时间规划器",
  scheduleStart: "起始时间",
  scheduleEnd: "结束时间",
  slotMinutes: "时间槽间隔",
  slotLabel: (n: number) => `${n} 分钟`,
  scheduleWarn: "起始时间须早于结束时间",
  globalHotkey: "全局快捷键",
  hotkeyEnabled: "启用快捷键",
  hotkeyCombo: "快捷键组合",
  pressHotkey: "请按下快捷键...",
  clickToRecord: "点击后按下快捷键",
  hotkeyHint: "需含至少一个修饰键",
  hotkeyRegFailed: "注册失败",
  clearHotkey: "清除",
  cache: "缓存",
  attachmentCache: "附件缓存",
  cacheDetail: (count: number, size: string) => `${count} 个文件 · ${size}`,
  cacheLoading: "加载中...",
  clearCache: "清除",
  clearingCache: "清除中...",
  clearCacheConfirm: "确定清除所有附件缓存？下次查看需重新下载。",
  timezone: "时区",
  // Connection
  connToggle: "连接开关",
  connConnected: "已连接",
  connDisconnected: "未连接",
  lanAddress: "内网地址",
  fetch: "获取",
  fetching: "获取中...",
  serverUrl: "服务器地址",
  check: "检测",
  checking: "检测中...",
  accessToken: "访问令牌",
  verify: "验证",
  verifying: "验证中...",
  enterToken: "输入令牌",
  checkServerFirst: "请先检测服务器",
  maxReconnect: "最大重连",
  disconnectNotify: "断开提醒",
  connSuccess: "连接成功",
  connSuccessDesc: (name: string, ver: string) => `${name} v${ver}`,
  connFailed: "连接失败",
  connFailedDesc: "请检查地址与网络",
  responseFormatError: "响应格式异常",
  fpMismatch: "指纹不匹配",
  fpChanged: "指纹已变更",
  localRecord: "本地",
  serverFp: "服务器",
  trustFp: "信任新指纹",
  reject: "拒绝",
  verifyingToken: "验证中...",
  tokenValid: "令牌有效",
  userLabel: "用户: ",
  tokenInvalid: "令牌无效",
  tokenInvalidDesc: "令牌被拒绝，请确认或重新生成",
  tokenVerifyFailed: "验证失败",
  detectingConn: "正在检测连接...",
  // Notification
  notifyTitle: "通知",
  notifyEnabled: "通知已开启",
  notifyDisabled: "通知已关闭",
  notifyEnabledDesc: "通过 WebSocket 实时推送",
  notifyDisabledDesc: "开启后实时接收通知",
  notifyToggle: "通知开关",
  silentMode: "静默模式",
  silentModeDesc: "不播放提示音",
  timeout: "弹窗策略",
  timeoutDesc: "通知弹窗显示方式",
  autoTimeout: "自动消失",
  neverTimeout: "常驻显示",
};

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
  | { kind: "ok"; version: string; name?: string; publicKey?: string }
  | { kind: "unreachable"; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "fingerprint"; old: string; new: string };

type TokenResult =
  | { ok: true; userName: string }
  | { ok: false; message: string };

type Props = {
  settings: UISettings;
  onUpdateField?: (fields: Partial<UISettings>) => void;
  onSaveConnection?: (fields: Partial<UISettings>) => void;
  onClose: () => void;
  focusTarget?: "url" | "token";
  connectionStatus?: ConnectionStatusSnapshot;
  onConnectionToggle?: (enabled: boolean) => void;
  onAcceptFingerprint?: (fingerprint: string) => void;
};

// ── Main Component ──

export function SettingsModal({ settings: initial, onUpdateField, onSaveConnection, onClose, focusTarget, connectionStatus, onConnectionToggle, onAcceptFingerprint }: Props) {
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
  const [activeSettingsTab, setActiveSettingsTab] = useState<"general" | "connection" | "notification">("connection");

  // Connection
  const [wsEnabled, setWsEnabled] = useState(initial.ws_enabled);
  const [reconnectMaxAttempts, setReconnectMaxAttempts] = useState(String(initial.reconnect_max_attempts));
  const [notifyOnDisconnect, setNotifyOnDisconnect] = useState(initial.notify_on_disconnect);
  const [lanAddress, setLanAddress] = useState(initial.lan_address || "");
  const [lanLoading, setLanLoading] = useState(false);

  // URL check
  const [urlChecking, setUrlChecking] = useState(false);
  const [urlCheckResult, setUrlCheckResult] = useState<UrlCheckResult | null>(null);
  const storedPublicKeyRef = useRef<string | null>(null);
  const validatedFingerprintRef = useRef<string | null>(null);

  // Token verify
  const [tokenVerifying, setTokenVerifying] = useState(false);
  const [tokenResult, setTokenResult] = useState<TokenResult | null>(null);

  // Toggle guard
  const userToggledWsRef = useRef(false);

  const { ask, dialog: confirmDialog } = useConfirm();

  // Cache
  const [cacheSize, setCacheSize] = useState<{ count: number; bytes: number } | null>(null);
  const [clearingCache, setClearingCache] = useState(false);

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
      const size = await getCacheSize();
      setCacheSize(size);
    } catch {
      setCacheSize(null);
    }
  }, []);

  useEffect(() => {
    loadCacheSize().catch(() => setCacheSize(null));
  }, [loadCacheSize]);

  // Auto-revert wsEnabled if connection fails after user toggle
  useEffect(() => {
    if (!userToggledWsRef.current) return;
    if (!wsEnabled) return;
    const s = connectionStatus?.status;
    if (s === "token-error" || s === "key-mismatch" || s === "fingerprint" || s === "replay-detected" || s === "offline") {
      userToggledWsRef.current = false;
      setWsEnabled(false);
      onConnectionToggle?.(false);
    } else if (s === "online") {
      userToggledWsRef.current = false;
    }
  }, [connectionStatus?.status, wsEnabled, onConnectionToggle]);

  // ── Connection logic ──

  async function checkUrl(): Promise<boolean> {
    if (!serverUrl) {
      setUrlCheckResult(null);
      storedPublicKeyRef.current = null;
      return false;
    }
    setUrlChecking(true);
    setUrlCheckResult(null);
    setTokenResult(null);
    storedPublicKeyRef.current = null;
    try {
      onSaveConnection?.({ server_url: serverUrl });

      const api = new AMToDoApi(serverUrl, null);
      const result = await api.health();

      if (!result || typeof result.version !== "string") {
        setUrlCheckResult({ kind: "invalid", message: MOB.responseFormatError });
        return false;
      }

      if (result.public_key) {
        const storedFp = serverUrl === initial.server_url ? initial.known_key_fingerprint : "";
        try {
          await verifyOrEnrollKey(result.public_key, storedFp);
          storedPublicKeyRef.current = result.public_key;
        } catch (e) {
          if (e instanceof FingerprintMismatchError) {
            setUrlCheckResult({ kind: "fingerprint", old: e.expected, new: e.actual });
            return false;
          }
          throw e;
        }
      }

      if (result.public_key) {
        const fp = await fingerprintPublicKey(result.public_key);
        validatedFingerprintRef.current = fp;
        onSaveConnection?.({ known_key_fingerprint: fp });
      }

      setUrlCheckResult({ kind: "ok", version: result.version, name: result.name, publicKey: result.public_key });
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
      storedPublicKeyRef.current = null;
      validatedFingerprintRef.current = null;
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
      let pubKey = storedPublicKeyRef.current;
      if (!pubKey) {
        const healthApi = new AMToDoApi(serverUrl, null);
        const health = await healthApi.health();
        if (health.public_key) {
          pubKey = health.public_key;
          storedPublicKeyRef.current = pubKey;
        }
      }
      let api: AMToDoApi;
      if (pubKey) {
        const p256Key = await importP256PublicKey(pubKey);
        api = new AMToDoApi(serverUrl, accessToken, p256Key);
      } else {
        api = new AMToDoApi(serverUrl, accessToken);
      }
      const result = await api.user();
      if (result.ok) {
        setTokenResult({ ok: true, userName: result.user.name });
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

  function handleAcceptFingerprint() {
    if (urlCheckResult?.kind === "fingerprint") {
      onSaveConnection?.({ known_key_fingerprint: urlCheckResult.new });
      onAcceptFingerprint?.(urlCheckResult.new);
      setTimeout(() => checkUrl(), 100);
    }
  }

  function handleRejectFingerprint() {
    setUrlCheckResult(null);
    storedPublicKeyRef.current = null;
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
    urlCheckResult?.kind === "fingerprint" ? "url-warn" : "",
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
      await clearAttachmentCache();
      await loadCacheSize();
    } catch {
      // ignore
    } finally {
      setClearingCache(false);
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
      case "fingerprint":
        return (
          <>
            <div className="settings-inline-status warn">
              {WARN_ICON} {MOB.fpMismatch}
            </div>
            <div className="settings-fp-compact">
              <div className="settings-fp-compact-title">
                {WARN_ICON} {MOB.fpChanged}
              </div>
              <div className="settings-fp-compact-row">
                <span className="settings-fp-compact-label">{MOB.localRecord}</span>
                <code className="settings-fp-compact-hash old">{urlCheckResult.old}</code>
              </div>
              <div className="settings-fp-compact-row">
                <span className="settings-fp-compact-label">{MOB.serverFp}</span>
                <code className="settings-fp-compact-hash new">{urlCheckResult.new}</code>
              </div>
              <div className="settings-fp-compact-actions">
                <button type="button" className="settings-fp-compact-btn accept" onClick={handleAcceptFingerprint}>
                  {MOB.trustFp}
                </button>
                <button type="button" className="settings-fp-compact-btn reject" onClick={handleRejectFingerprint}>
                  {MOB.reject}
                </button>
              </div>
            </div>
          </>
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

  // ── Tab items ──
  const tabItems = [
    { key: "connection" as const, label: MOB.tabConnection, icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> },
    { key: "general" as const, label: MOB.tabGeneral, icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
    { key: "notification" as const, label: MOB.tabNotification, icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> },
  ];

  // ── JSX ──

  return (
    <div className="settings-modal-backdrop" onKeyDown={handleKeyDown}>
      <div className="settings-modal-card" role="dialog" aria-label={MOB.title}>
        {/* Header */}
        <div className="settings-modal-header">
          <div className="settings-modal-header-left">
            <div className="settings-modal-dot" />
            <h2 className="settings-modal-title">{MOB.title}</h2>
          </div>
          <button type="button" className="settings-modal-close" onClick={onClose} aria-label="关闭">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="settings-modal-tabs" role="tablist">
          {tabItems.map(({ key, label, icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={activeSettingsTab === key}
              className={`settings-modal-tab${activeSettingsTab === key ? " active" : ""}`}
              onClick={() => setActiveSettingsTab(key)}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="settings-modal-body">

          {/* ══════════════════════════════════════ */}
          {/* Connection                             */}
          {/* ══════════════════════════════════════ */}
          {activeSettingsTab === "connection" && (
            <>
              <div className="settings-modal-section-label">{MOB.tabConnection}</div>

              <div className="settings-group">
                <div className="settings-row">
                  <div className="settings-row-left">
                    <div className="settings-row-icon blue">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    </div>
                    <div className="settings-row-text">
                      <span className="settings-row-label">{MOB.connToggle}</span>
                      <span className="settings-row-hint">{wsEnabled ? MOB.connConnected : MOB.connDisconnected}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`settings-sw${wsEnabled ? " on" : ""}`}
                    onClick={handleWsToggle}
                    role="switch"
                    aria-checked={wsEnabled}
                    aria-label={MOB.connToggle}
                  >
                    <span className="settings-sw-knob" />
                  </button>
                </div>
                <div className="settings-row">
                  <div className="settings-row-left">
                    <div className="settings-row-icon amber">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                    </div>
                    <div className="settings-row-text">
                      <span className="settings-row-label">{MOB.disconnectNotify}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`settings-sw${notifyOnDisconnect ? " on" : ""}`}
                    onClick={handleNotifyDisconnectToggle}
                    disabled={connLocked}
                    role="switch"
                    aria-checked={notifyOnDisconnect}
                  >
                    <span className="settings-sw-knob" />
                  </button>
                </div>
                <div className="settings-row">
                  <div className="settings-row-left">
                    <div className="settings-row-icon violet">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                    </div>
                    <div className="settings-row-text">
                      <span className="settings-row-label">{MOB.maxReconnect}</span>
                    </div>
                  </div>
                  <div className="settings-row-right">
                    <input
                      type="number"
                      className="settings-inline-number"
                      value={reconnectMaxAttempts}
                      min={0}
                      disabled={connLocked}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "" || /^\d+$/.test(v)) setReconnectMaxAttempts(v);
                      }}
                      onBlur={handleReconnectBlur}
                    />
                  </div>
                </div>
              </div>

              {/* Server URL */}
              <div className="settings-modal-section-label">{MOB.serverUrl}</div>
              <div className="settings-group">
                <div className="settings-inline-field">
                  <div className="settings-inline-row">
                    <input
                      type="text"
                      className={urlInputClass}
                      value={serverUrl}
                      onChange={handleUrlChange}
                      onBlur={() => onUpdateField?.({ server_url: serverUrl })}
                      disabled={connLocked}
                      placeholder="http://127.0.0.1:8000"
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
              </div>

              {/* LAN Address */}
              <div className="settings-modal-section-label">{MOB.lanAddress}</div>
              <div className="settings-group">
                <div className="settings-inline-field">
                  <div className="settings-inline-row">
                    <input
                      type="text"
                      className="settings-inline-input"
                      value={lanAddress}
                      onChange={(e) => setLanAddress(e.target.value)}
                      onBlur={() => onUpdateField?.({ lan_address: lanAddress })}
                      placeholder="http://192.168.x.x:8000"
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
              </div>

              {/* Access Token */}
              <div className="settings-modal-section-label">{MOB.accessToken}</div>
              <div className="settings-group">
                <div className="settings-inline-field">
                  <div className="settings-inline-row">
                    <div className="settings-inline-input-wrap">
                      <input
                        type={showToken ? "text" : "password"}
                        className={tokenInputClass}
                        value={accessToken}
                        onChange={handleTokenChange}
                        onBlur={() => onUpdateField?.({ access_token: accessToken })}
                        disabled={!tokenEditable}
                        placeholder={!tokenEditable && !connLocked ? MOB.checkServerFirst : MOB.enterToken}
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
              </div>
            </>
          )}

          {/* ══════════════════════════════════════ */}
          {/* General                                */}
          {/* ══════════════════════════════════════ */}
          {activeSettingsTab === "general" && (
            <>
              <div className="settings-modal-section-label">{MOB.appearance}</div>
              <div className="settings-group">
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
              </div>

              <div className="settings-modal-section-label">{MOB.calendar}</div>
              <div className="settings-group">
                <div className="settings-row">
                  <span className="settings-row-label">{MOB.weekStart}</span>
                  <div className="settings-row-right">
                    <Dropdown
                      value={weekStart}
                      options={[
                        { value: "0", label: MOB.sunday },
                        { value: "1", label: MOB.monday },
                      ]}
                      onChange={(v) => { setWeekStart(v); onUpdateField?.({ week_start: Number(v) }); }}
                    />
                  </div>
                </div>
              </div>

              <div className="settings-modal-section-label">{MOB.scheduler}</div>
              <div className="settings-group">
                <div className="settings-row">
                  <span className="settings-row-label">{MOB.scheduleStart}</span>
                  <div className="settings-row-right">
                    <Dropdown
                      value={scheduleStartHour}
                      options={SCHEDULE_START_HOUR_OPTIONS}
                      onChange={(v) => { setScheduleStartHour(v); onUpdateField?.({ scheduler_start_hour: Number(v) }); }}
                    />
                  </div>
                </div>
                <div className="settings-row">
                  <span className="settings-row-label">{MOB.scheduleEnd}</span>
                  <div className="settings-row-right">
                    <Dropdown
                      value={scheduleEndHour}
                      options={SCHEDULE_END_HOUR_OPTIONS}
                      onChange={(v) => { setScheduleEndHour(v); onUpdateField?.({ scheduler_end_hour: Number(v) }); }}
                    />
                  </div>
                </div>
                {!validScheduleHours && (
                  <div style={{ padding: "0 18px 12px" }}>
                    <span className="settings-field-msg err">{MOB.scheduleWarn}</span>
                  </div>
                )}
                <div className="settings-row">
                  <span className="settings-row-label">{MOB.slotMinutes}</span>
                  <div className="settings-row-right">
                    <Dropdown
                      value={slotMinutes}
                      options={[
                        { value: "15", label: MOB.slotLabel(15) },
                        { value: "30", label: MOB.slotLabel(30) },
                        { value: "45", label: MOB.slotLabel(45) },
                        { value: "60", label: MOB.slotLabel(60) },
                      ]}
                      onChange={(v) => { setSlotMinutes(v); onUpdateField?.({ scheduler_slot_minutes: Number(v) }); }}
                    />
                  </div>
                </div>
              </div>

              {/* Cache */}
              <div className="settings-modal-section-label">{MOB.cache}</div>
              <div className="settings-group">
                <div className="settings-cache-card">
                  <div className="settings-cache-left">
                    <div className="settings-cache-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </div>
                    <div className="settings-cache-text">
                      <span className="settings-cache-title">{MOB.attachmentCache}</span>
                      <span className="settings-cache-detail">
                        {cacheSize
                          ? MOB.cacheDetail(cacheSize.count, formatSize(cacheSize.bytes))
                          : MOB.cacheLoading}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="settings-cache-btn"
                    disabled={clearingCache || !cacheSize || cacheSize.count === 0}
                    onClick={handleClearCache}
                  >
                    {clearingCache ? MOB.clearingCache : MOB.clearCache}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ══════════════════════════════════════ */}
          {/* Notification                           */}
          {/* ══════════════════════════════════════ */}
          {activeSettingsTab === "notification" && (
            <>
              <div className="settings-modal-section-label">{MOB.tabNotification}</div>
              <div className="settings-group">
                <div className="settings-notify-header">
                  <div className="settings-notify-header-left">
                    <div className="settings-notify-bell">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                      </svg>
                    </div>
                    <div className="settings-notify-info">
                      <span className={`settings-notify-title${notifyEnabled ? "" : " off"}`}>
                        {notifyEnabled ? MOB.notifyEnabled : MOB.notifyDisabled}
                      </span>
                      <span className="settings-notify-sub">
                        {notifyEnabled ? MOB.notifyEnabledDesc : MOB.notifyDisabledDesc}
                      </span>
                    </div>
                  </div>
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
                <div className={`settings-notify-options${notifyEnabled ? "" : " hidden"}`}>
                  <div className="settings-row">
                    <div className="settings-row-left">
                      <div className="settings-row-icon rose">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 5L6 9H2v6h4l5 4V5z" />
                          <line x1="23" y1="9" x2="17" y2="15" />
                          <line x1="17" y1="9" x2="23" y2="15" />
                        </svg>
                      </div>
                      <div className="settings-row-text">
                        <span className="settings-row-label">{MOB.silentMode}</span>
                        <span className="settings-row-hint">{MOB.silentModeDesc}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`settings-sw${notifSilent ? " on" : ""}`}
                      onClick={() => setNotifSilent((v) => { onUpdateField?.({ notification_silent: !v }); return !v; })}
                      role="switch"
                      aria-checked={notifSilent}
                    >
                      <span className="settings-sw-knob" />
                    </button>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-left">
                      <div className="settings-row-icon amber">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="1" y="3" width="15" height="13" rx="2" />
                          <polygon points="23 7 16 12 23 17" />
                        </svg>
                      </div>
                      <div className="settings-row-text">
                        <span className="settings-row-label">{MOB.timeout}</span>
                        <span className="settings-row-hint">{MOB.timeoutDesc}</span>
                      </div>
                    </div>
                    <div className="settings-row-right">
                      <Dropdown
                        value={notifTimeout}
                        options={[
                          { value: "default", label: MOB.autoTimeout },
                          { value: "never", label: MOB.neverTimeout },
                        ]}
                        onChange={(v) => { setNotifTimeout(v as "default" | "never"); onUpdateField?.({ notification_timeout: v as "default" | "never" }); }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
