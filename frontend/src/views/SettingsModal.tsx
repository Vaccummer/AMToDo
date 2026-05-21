import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AMToDoApi } from "../api/client";
import type { ConnectionStatusSnapshot } from "../api/connection-status";
import { FingerprintMismatchError, fingerprintPublicKey, importP256PublicKey, verifyOrEnrollKey } from "../crypto/envelope";
import { clearAttachmentCache, getCacheSize } from "../lib/attachmentCache";
import type { UISettings } from "../lib/settings";
import { listThemes, applyTheme, getTheme } from "../themes";
import { Dropdown } from "./Dropdown";
import { useConfirm } from "./ConfirmDialog";

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

// ── Helpers ──

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

  // Check results reset when server URL changes (handled by handleUrlChange)

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

      // Validate response format
      if (!result || typeof result.version !== "string") {
        setUrlCheckResult({ kind: "invalid", message: "响应格式异常 — 服务器返回了非预期的响应格式" });
        return false;
      }

      // Check public key fingerprint
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

      // Save fingerprint on success
      if (result.public_key) {
        const fp = await fingerprintPublicKey(result.public_key);
        validatedFingerprintRef.current = fp;
        onSaveConnection?.({ known_key_fingerprint: fp });
      }

      setUrlCheckResult({ kind: "ok", version: result.version, name: result.name, publicKey: result.public_key });
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "连接失败";
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
      const pubKey = storedPublicKeyRef.current;
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
        setTokenResult({ ok: false, message: "令牌无效" });
        return false;
      }
    } catch (err: unknown) {
      setTokenResult({ ok: false, message: err instanceof Error ? err.message : "验证失败" });
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

  // LAN address: fetch and write to URL input
  async function handleLanFetch() {
    if (!lanAddress) return;
    setLanLoading(true);
    try {
      const api = new AMToDoApi(lanAddress, null);
      const result = await api.health();
      if (!result.ipv4 && !result.ipv6) {
        // Just use LAN address directly
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
      // Fallback: use LAN address
      setServerUrl(lanAddress);
    } catch {
      setServerUrl(lanAddress);
    } finally {
      setLanLoading(false);
    }
  }

  // Connection toggle
  async function handleWsToggle() {
    if (wsEnabled) {
      setWsEnabled(false);
      onConnectionToggle?.(false);
      return;
    }

    // ── Turning ON: validate URL and token first ──
    // 1. URL check (skip if already passed)
    let urlOk = urlCheckResult?.kind === "ok";
    if (!urlOk) {
      urlOk = await checkUrl();
      if (!urlOk) return; // URL check failed — abort
    }

    // 2. Token verification (skip if already passed)
    let tokenOk = tokenResult?.ok === true;
    if (!tokenOk) {
      tokenOk = await verifyToken({ skipUrlCheck: true });
      if (!tokenOk) return; // Token check failed — abort
    }

    // Both checks passed — enable
    setWsEnabled(true);
    userToggledWsRef.current = true;
    onSaveConnection?.({ ws_enabled: true });
    onConnectionToggle?.(true);
  }

  // Fingerprint accept/reject (from connectionStatus prop)
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
    "settings-modal-input",
    urlCheckResult?.kind === "ok" ? "url-ok" : "",
    urlCheckResult?.kind === "unreachable" || urlCheckResult?.kind === "invalid" ? "url-err" : "",
    urlCheckResult?.kind === "fingerprint" ? "url-warn" : "",
  ].filter(Boolean).join(" ");

  const tokenInputClass = [
    "settings-modal-input",
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
      title: "清除缓存",
      message: "确定清除所有附件缓存吗？下次查看附件时需要重新下载。",
      confirmLabel: "清除",
      danger: true,
    });
    if (!ok) return;
    setClearingCache(true);
    try {
      await clearAttachmentCache();
      await loadCacheSize();
    } catch {
      // ignore clear-cache errors
    } finally {
      setClearingCache(false);
    }
  }

  // Register/unregister global hotkey when settings change
  useEffect(() => {
    if (hotkeyEnabled && hotkeyValue) {
      window.amtodoShell?.registerHotkey?.(hotkeyValue)?.then?.((result: { ok: boolean; error?: string }) => {
        if (!result?.ok) {
          setHotkeyError(result?.error || "快捷键注册失败");
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
        <div className="settings-conn-status">
          <div className="settings-conn-status-inline" style={{ color: "var(--global-text-secondary)" }}>
            <span className="settings-modal-spinner" />
            正在检测连接...
          </div>
        </div>
      );
    }
    if (!urlCheckResult) return null;

    switch (urlCheckResult.kind) {
      case "ok":
        return (
          <div className="settings-conn-status">
            <div className="settings-conn-status-card ok">
              <div className="settings-conn-card-icon">{CHECK_ICON}</div>
              <div className="settings-conn-card-body">
                <div className="settings-conn-card-title">连接成功</div>
                <div className="settings-conn-card-desc">
                  服务器 {urlCheckResult.name ?? ""} v{urlCheckResult.version}，一切正常
                </div>
              </div>
            </div>
          </div>
        );
      case "unreachable":
        return (
          <div className="settings-conn-status">
            <div className="settings-conn-status-card err">
              <div className="settings-conn-card-icon">{CROSS_ICON}</div>
              <div className="settings-conn-card-body">
                <div className="settings-conn-card-title">连接失败</div>
                <div className="settings-conn-card-desc">
                  {urlCheckResult.message || "无法访问服务器，请检查地址是否正确、网络是否通畅"}
                </div>
              </div>
            </div>
          </div>
        );
      case "invalid":
        return (
          <div className="settings-conn-status">
            <div className="settings-conn-status-inline err">
              {CROSS_ICON}
              {urlCheckResult.message}
            </div>
          </div>
        );
      case "fingerprint":
        return (
          <div className="settings-conn-status">
            <div className="settings-conn-status-inline warn">
              {WARN_ICON}
              公钥指纹不匹配 — 服务器返回了与本地记录不同的指纹
            </div>
            <div className="settings-conn-fp-inline" style={{ marginTop: 6 }}>
              <div className="settings-conn-fp-title">
                {WARN_ICON}
                指纹已变更
              </div>
              <div className="settings-conn-fp-hashes">
                <div className="settings-conn-fp-hash-row">
                  <span className="settings-conn-fp-hash-label">本地记录</span>
                  <code className="settings-conn-fp-hash old">{urlCheckResult.old}</code>
                </div>
                <div className="settings-conn-fp-hash-row">
                  <span className="settings-conn-fp-hash-label">服务器新指纹</span>
                  <code className="settings-conn-fp-hash new">{urlCheckResult.new}</code>
                </div>
              </div>
              <div className="settings-conn-fp-actions">
                <button type="button" className="settings-conn-fp-btn settings-conn-fp-btn-accept" onClick={handleAcceptFingerprint}>
                  信任新指纹
                </button>
                <button type="button" className="settings-conn-fp-btn settings-conn-fp-btn-reject" onClick={handleRejectFingerprint}>
                  拒绝
                </button>
              </div>
            </div>
          </div>
        );
    }
  }

  function renderTokenStatus() {
    if (tokenVerifying) {
      return (
        <div className="settings-conn-status">
          <div className="settings-conn-status-inline" style={{ color: "var(--global-text-secondary)" }}>
            <span className="settings-modal-spinner" />
            正在验证令牌...
          </div>
        </div>
      );
    }
    if (!tokenResult) return null;

    if (tokenResult.ok) {
      return (
        <div className="settings-conn-status">
          <div className="settings-conn-status-card ok">
            <div className="settings-conn-card-icon">{CHECK_ICON}</div>
            <div className="settings-conn-card-body">
              <div className="settings-conn-card-title">令牌有效</div>
              <div className="settings-conn-card-desc">用户: {tokenResult.userName}</div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="settings-conn-status">
        <div className="settings-conn-status-card err">
          <div className="settings-conn-card-icon">{CROSS_ICON}</div>
          <div className="settings-conn-card-body">
            <div className="settings-conn-card-title">令牌无效</div>
            <div className="settings-conn-card-desc">
              服务器已连接，但拒绝了此访问令牌。请确认令牌正确或重新生成。
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── JSX ──

  return (
    <div className="settings-modal-backdrop" onKeyDown={handleKeyDown}>
      <div className="settings-modal-card" role="dialog" aria-label="设置">
        <div className="settings-modal-header">
          <div className="settings-modal-header-left">
            <div className="settings-modal-dot" />
            <h2 className="settings-modal-title">设置</h2>
          </div>
          <button type="button" className="settings-modal-close" onClick={onClose} aria-label="关闭">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="settings-modal-tabs" role="tablist">
          {([
            ["connection", "连接",
              <svg key="link" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
            ],
            ["general", "通用",
              <svg key="gear" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
            ],
            ["notification", "通知",
              <svg key="bell" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
            ],
          ] as const).map(([key, label, icon]) => (
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

        <div className="settings-modal-body">
          {/* ══════════════════════════════════════ */}
          {/* Connection Section (unified block)     */}
          {/* ══════════════════════════════════════ */}
          {activeSettingsTab === "connection" && (<>
          <div className="settings-modal-section-label">连接设置</div>

          <div className="settings-conn-section">
            <div className="settings-conn-header">
              <span className="settings-conn-header-label">连接总开关</span>
              <button
                type="button"
                className={`toggle-switch${wsEnabled ? " on" : ""}`}
                onClick={handleWsToggle}
                disabled={false}
                role="switch"
                aria-checked={wsEnabled}
                aria-label="连接总开关"
              >
                <span className="toggle-thumb" />
              </button>
            </div>

            <div className={`settings-conn-body${connLocked ? " locked" : ""}`}>
              {/* LAN Address */}
              <div className="settings-modal-field">
                <label className="settings-modal-label" htmlFor="lan-addr">内网地址</label>
                <div className="settings-conn-lan-row">
                  <input
                    id="lan-addr"
                    type="text"
                    className="settings-modal-input"
                    value={lanAddress}
                    onChange={(e) => setLanAddress(e.target.value)}
                    onBlur={() => onUpdateField?.({ lan_address: lanAddress })}
                    placeholder="http://192.168.x.x:8000"
                    disabled={connLocked}
                  />
                  <button
                    type="button"
                    className="settings-conn-lan-btn"
                    onClick={handleLanFetch}
                    disabled={connLocked || !lanAddress || lanLoading}
                  >
                    {lanLoading ? "获取中..." : "获取"}
                  </button>
                </div>
              </div>

              {/* Server URL */}
              <div className="settings-modal-field">
                <label className="settings-modal-label" htmlFor="srv-url">服务器地址</label>
                <div className="settings-conn-input-row">
                  <input
                    id="srv-url"
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
                    className="settings-conn-lan-btn"
                    onClick={() => checkUrl()}
                    disabled={connLocked || !serverUrl || urlChecking}
                  >
                    {urlChecking ? "检测中..." : "检测"}
                  </button>
                </div>
                {renderUrlStatus()}
              </div>

              {/* Access Token */}
              <div className={`settings-modal-field${!tokenEditable ? " settings-conn-field-disabled" : ""}`}>
                <label className="settings-modal-label" htmlFor="srv-token">
                  访问令牌
                  {!tokenEditable && !connLocked && (
                    <span className="settings-conn-field-hint">请先检测服务器地址</span>
                  )}
                </label>
                <div className="settings-conn-input-row">
                  <div className="settings-modal-input-wrap" style={{ flex: 1 }}>
                    <input
                      id="srv-token"
                      type={showToken ? "text" : "password"}
                      className={tokenInputClass}
                      value={accessToken}
                      onChange={handleTokenChange}
                      onBlur={() => onUpdateField?.({ access_token: accessToken })}
                      disabled={!tokenEditable}
                      placeholder={!tokenEditable && !connLocked ? "请先完成服务器地址检测" : "输入访问令牌"}
                    />
                    <button
                      type="button"
                      className="settings-modal-input-eye"
                      onClick={() => setShowToken((v) => !v)}
                      title={showToken ? "隐藏" : "显示"}
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
                    className="settings-conn-lan-btn"
                    onClick={() => verifyToken()}
                    disabled={!tokenEditable || !accessToken || tokenVerifying}
                  >
                    {tokenVerifying ? "验证中..." : "验证"}
                  </button>
                </div>
                {renderTokenStatus()}
              </div>

              {/* Connection sub-settings */}
              <div className="settings-modal-divider" style={{ margin: "2px 0" }} />

              <div className="settings-conn-sub-row">
                <div className="settings-conn-sub-left">
                  <span className="settings-conn-sub-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                  </span>
                  <span className="settings-conn-sub-label">最大重连次数</span>
                </div>
                <div className="settings-conn-sub-right">
                  <input
                    type="number"
                    className="settings-conn-sub-input"
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

              <div className="settings-conn-sub-row">
                <div className="settings-conn-sub-left">
                  <span className="settings-conn-sub-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                  </span>
                  <div className="settings-conn-sub-text">
                    <span className="settings-conn-sub-label">断开时标签提醒</span>
                  </div>
                </div>
                <div className="settings-conn-sub-right">
                  <button
                    type="button"
                    className={`toggle-switch${notifyOnDisconnect ? " on" : ""}`}
                    onClick={handleNotifyDisconnectToggle}
                    disabled={connLocked}
                    role="switch"
                    aria-checked={notifyOnDisconnect}
                    aria-label="断开时标签提醒"
                  >
                    <span className="toggle-thumb" />
                  </button>
                </div>
              </div>
            </div>
          </div>
          </>)}

          {activeSettingsTab === "general" && (<>
          <div className="settings-modal-divider" />

          {/* ══════════════════════════════════════ */}
          {/* Display                                */}
          {/* ══════════════════════════════════════ */}
          <div className="settings-modal-section-label">显示设置</div>

          <div className="settings-modal-field-row">
            <div className="settings-modal-field settings-modal-field-half">
              <label className="settings-modal-label" htmlFor="sui-lang">语言</label>
              <Dropdown
                id="sui-lang"
                value={language}
                options={[{ value: "zh-CN", label: "中文 (zh-CN)" }]}
                onChange={(v) => { setLanguage(v); onUpdateField?.({ language: v }); }}
              />
            </div>
            <div className="settings-modal-field settings-modal-field-half">
              <label className="settings-modal-label" htmlFor="sui-tz">时区</label>
              <Dropdown
                id="sui-tz"
                value={timezone}
                options={TIMEZONE_OPTIONS}
                onChange={(v) => { setTimezone(v); onUpdateField?.({ timezone: v }); }}
                searchable
              />
            </div>
          </div>

          <div className="settings-modal-field-row">
            <div className="settings-modal-field settings-modal-field-half">
              <label className="settings-modal-label" htmlFor="sui-wkstart">每周起始</label>
              <Dropdown
                id="sui-wkstart"
                value={weekStart}
                options={[
                  { value: "0", label: "周日" },
                  { value: "1", label: "周一" },
                ]}
                onChange={(v) => { setWeekStart(v); onUpdateField?.({ week_start: Number(v) }); }}
              />
            </div>
            <div className="settings-modal-field settings-modal-field-half">
              <label className="settings-modal-label" htmlFor="sui-theme">主题</label>
              <Dropdown
                id="sui-theme"
                value={theme}
                options={themeOptions}
                onChange={handleThemeChange}
              />
            </div>
          </div>

          <div className="settings-modal-divider" />

          {/* ══════════════════════════════════════ */}
          {/* Schedule                               */}
          {/* ══════════════════════════════════════ */}
          <div className="settings-modal-section-label">Schedule设置</div>

          <div className="settings-modal-field-row">
            <div className="settings-modal-field settings-modal-field-half">
              <label className="settings-modal-label" htmlFor="sui-schedule-start">默认起始</label>
              <Dropdown
                id="sui-schedule-start"
                value={scheduleStartHour}
                options={SCHEDULE_START_HOUR_OPTIONS}
                onChange={(v) => { setScheduleStartHour(v); onUpdateField?.({ scheduler_start_hour: Number(v) }); }}
              />
            </div>
            <div className="settings-modal-field settings-modal-field-half">
              <label className="settings-modal-label" htmlFor="sui-schedule-end">默认终止</label>
              <Dropdown
                id="sui-schedule-end"
                value={scheduleEndHour}
                options={SCHEDULE_END_HOUR_OPTIONS}
                onChange={(v) => { setScheduleEndHour(v); onUpdateField?.({ scheduler_end_hour: Number(v) }); }}
              />
            </div>
          </div>
          {!validScheduleHours ? (
            <span className="settings-modal-field-msg err">默认起始时间必须早于终止时间</span>
          ) : null}

          <div className="settings-modal-field-row">
            <div className="settings-modal-field settings-modal-field-half">
              <label className="settings-modal-label" htmlFor="sui-slot">时间粒度</label>
              <Dropdown
                id="sui-slot"
                value={slotMinutes}
                options={[
                  { value: "15", label: "15 分钟" },
                  { value: "30", label: "30 分钟" },
                  { value: "45", label: "45 分钟" },
                  { value: "60", label: "60 分钟" },
                ]}
                onChange={(v) => { setSlotMinutes(v); onUpdateField?.({ scheduler_slot_minutes: Number(v) }); }}
              />
            </div>
          </div>
          </>)}

          {/* ══════════════════════════════════════ */}
          {/* Notification                           */}
          {/* ══════════════════════════════════════ */}
          {activeSettingsTab === "notification" && (<>
          <div className="settings-modal-section-label">通知设置</div>

          <div className={`notify-card${notifyEnabled ? " on" : " off"}`}>
            {/* Header: master toggle */}
            <div className="settings-notify-header">
              <div className="settings-notify-header-left">
                <div className={`settings-notify-bell${notifyEnabled ? " on" : " off"}`}>
                  <svg key={String(notifyEnabled)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                </div>
                <div className="settings-notify-header-info">
                  <span className={`settings-notify-header-title${notifyEnabled ? "" : " off"}`}>
                    {notifyEnabled ? "启用通知" : "通知已关闭"}
                  </span>
                  <span className="settings-notify-header-sub">
                    {notifyEnabled ? "服务器通过 WebSocket 实时推送新通知" : "开启后将通过 WebSocket 实时接收通知"}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className={`toggle-switch${notifyEnabled ? " on" : ""}`}
                onClick={() => setNotifyEnabled((v) => { onUpdateField?.({ notification_enabled: !v }); return !v; })}
                role="switch"
                aria-checked={notifyEnabled}
                aria-label="通知总开关"
              >
                <span className="toggle-thumb" />
              </button>
            </div>

            {/* Options */}
            <div className={`notify-options${notifyEnabled ? "" : " hidden"}`}>
              {/* Silent Mode */}
              <div className="notify-row">
                <div className="notify-row-left">
                  <div className={`notify-row-icon mute${notifSilent ? " active" : ""}`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 5L6 9H2v6h4l5 4V5z" />
                      <line x1="23" y1="9" x2="17" y2="15" />
                      <line x1="17" y1="9" x2="23" y2="15" />
                    </svg>
                  </div>
                  <div className="notify-row-text">
                    <span className="notify-row-label">静默模式</span>
                    <span className="notify-row-hint">不播放提示音</span>
                  </div>
                </div>
                <div className="notify-row-right">
                  <button
                    type="button"
                    className={`toggle-switch${notifSilent ? " on" : ""}`}
                    onClick={() => setNotifSilent((v) => { onUpdateField?.({ notification_silent: !v }); return !v; })}
                    role="switch"
                    aria-checked={notifSilent}
                    aria-label="静默模式"
                  >
                    <span className="toggle-thumb" />
                  </button>
                </div>
              </div>

              {/* Timeout */}
              <div className="notify-row">
                <div className="notify-row-left">
                  <div className="notify-row-icon timeout">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="1" y="3" width="15" height="13" rx="2" />
                      <polygon points="23 7 16 12 23 17" />
                    </svg>
                  </div>
                  <div className="notify-row-text">
                    <span className="notify-row-label">消失时间</span>
                    <span className="notify-row-hint">通知弹窗的显示策略</span>
                  </div>
                </div>
                <div className="notify-row-right">
                  <Dropdown
                    value={notifTimeout}
                    options={[
                      { value: "default", label: "自动消失" },
                      { value: "never", label: "常驻不消失" },
                    ]}
                    onChange={(v) => { setNotifTimeout(v as "default" | "never"); onUpdateField?.({ notification_timeout: v as "default" | "never" }); }}
                  />
                </div>
              </div>
            </div>
          </div>
          </>)}

          {activeSettingsTab === "general" && (<>
          <div className="settings-modal-divider" />

          {/* ══════════════════════════════════════ */}
          {/* Global Hotkey                          */}
          {/* ══════════════════════════════════════ */}
          <div className="settings-modal-section-label">全局快捷键</div>

          <div className="settings-modal-field">
            <div className="settings-modal-input-row">
              <label className="settings-modal-label">快捷键组合</label>
              <button
                type="button"
                className={`toggle-switch${hotkeyEnabled ? " on" : ""}`}
                onClick={() => {
                  setHotkeyEnabled((v) => {
                    onUpdateField?.({ global_hotkey_enabled: !v });
                    if (v) setHotkeyError(null);
                    return !v;
                  });
                }}
                role="switch"
                aria-checked={hotkeyEnabled}
              >
                <span className="toggle-thumb" />
              </button>
            </div>
            <div className={`settings-modal-input-row${!hotkeyEnabled ? " disabled" : ""}`}>
              <input
                type="text"
                className="settings-modal-input"
                value={recording ? "请按下快捷键..." : hotkeyValue}
                readOnly
                disabled={!hotkeyEnabled}
                onClick={() => hotkeyEnabled && setRecording(true)}
                onKeyDown={handleHotkeyKeyDown}
                onBlur={() => setRecording(false)}
                style={{ cursor: hotkeyEnabled ? "pointer" : "default", color: recording ? "#999" : undefined }}
                placeholder="点击后按下快捷键组合"
              />
              {hotkeyValue ? (
                <button
                  type="button"
                  className="settings-modal-inline-btn"
                  disabled={!hotkeyEnabled}
                  onClick={() => { setHotkeyValue(""); setHotkeyError(null); onUpdateField?.({ global_hotkey: "" }); }}
                >
                  清除
                </button>
              ) : null}
            </div>
            <span className="settings-modal-hint">必须包含至少一个修饰键 (Ctrl/Alt/Shift/Super)</span>
            {hotkeyError ? (
              <span className="settings-modal-field-msg err">{hotkeyError}</span>
            ) : null}
          </div>

          <div className="settings-modal-divider" />

          {/* ══════════════════════════════════════ */}
          {/* Cache                                  */}
          {/* ══════════════════════════════════════ */}
          <div className="settings-modal-section-label">缓存</div>

          <div className="cache-compact-card">
            <div className="cache-compact-left">
              <div className="cache-compact-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </div>
              <div className="cache-compact-text">
                <span className="cache-compact-title">附件缓存</span>
                <span className="cache-compact-detail">
                  {cacheSize
                    ? `${cacheSize.count} 个文件 · ${formatSize(cacheSize.bytes)}`
                    : "加载中..."}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="cache-compact-btn"
              disabled={clearingCache || !cacheSize || cacheSize.count === 0}
              onClick={handleClearCache}
            >
              {clearingCache ? "清除中..." : "清除"}
            </button>
          </div>
          </>)}
        </div>

      </div>
      {confirmDialog}
    </div>
  );
}
