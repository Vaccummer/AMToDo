import { useCallback, useEffect, useMemo, useState } from "react";
import { AMToDoApi } from "../api/client";
import { importP256PublicKey } from "../crypto/envelope";
import { clearAttachmentCache, getCacheSize } from "../lib/attachmentCache";
import type { UISettings } from "../lib/settings";
import { Dropdown } from "./Dropdown";
import { useConfirm } from "./ConfirmDialog";

const TIMEZONE_OPTIONS = [
  { value: "Asia/Shanghai", label: "Asia/Shanghai" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo" },
  { value: "Asia/Seoul", label: "Asia/Seoul" },
  { value: "Asia/Singapore", label: "Asia/Singapore" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata" },
  { value: "Asia/Dubai", label: "Asia/Dubai" },
  { value: "Asia/Jerusalem", label: "Asia/Jerusalem" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "Europe/Paris", label: "Europe/Paris" },
  { value: "Europe/Berlin", label: "Europe/Berlin" },
  { value: "Europe/Moscow", label: "Europe/Moscow" },
  { value: "America/New_York", label: "America/New_York" },
  { value: "America/Chicago", label: "America/Chicago" },
  { value: "America/Denver", label: "America/Denver" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles" },
  { value: "America/Sao_Paulo", label: "America/Sao_Paulo" },
  { value: "America/Argentina/Buenos_Aires", label: "America/Argentina/Buenos_Aires" },
  { value: "Australia/Sydney", label: "Australia/Sydney" },
  { value: "Pacific/Auckland", label: "Pacific/Auckland" },
  { value: "Pacific/Honolulu", label: "Pacific/Honolulu" },
  { value: "UTC", label: "UTC" },
];

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

type Props = {
  settings: UISettings;
  onSave: (settings: UISettings) => void;
  onClose: () => void;
};

export function SettingsModal({ settings: initial, onSave, onClose }: Props) {
  const [serverUrl, setServerUrl] = useState(initial.server_url);
  const [accessToken, setAccessToken] = useState(initial.access_token);
  const [language, setLanguage] = useState(initial.language);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [weekStart, setWeekStart] = useState(String(initial.week_start));
  const [scheduleStartHour, setScheduleStartHour] = useState(String(initial.scheduler_start_hour));
  const [scheduleEndHour, setScheduleEndHour] = useState(String(initial.scheduler_end_hour));
  const [slotMinutes, setSlotMinutes] = useState(String(initial.scheduler_slot_minutes));
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // URL connection test
  const [testingUrl, setTestingUrl] = useState(false);
  const [urlTestResult, setUrlTestResult] = useState<{ ok: boolean; version?: string; message: string } | null>(null);
  const { ask, dialog: confirmDialog } = useConfirm();

  // Token verification
  const [verifyingToken, setVerifyingToken] = useState(false);
  const [tokenResult, setTokenResult] = useState<{ ok: boolean; userName?: string; message: string } | null>(null);

  // Cache
  const [cacheSize, setCacheSize] = useState<{ count: number; bytes: number } | null>(null);
  const [clearingCache, setClearingCache] = useState(false);

  // Global hotkey
  const [hotkeyEnabled, setHotkeyEnabled] = useState(initial.global_hotkey_enabled);
  const [hotkeyValue, setHotkeyValue] = useState(initial.global_hotkey);
  const [recording, setRecording] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);

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
    setServerUrl(initial.server_url);
    setAccessToken(initial.access_token);
    setLanguage(initial.language);
    setTimezone(initial.timezone);
    setWeekStart(String(initial.week_start));
    setScheduleStartHour(String(initial.scheduler_start_hour));
    setScheduleEndHour(String(initial.scheduler_end_hour));
    setSlotMinutes(String(initial.scheduler_slot_minutes));
    setHotkeyEnabled(initial.global_hotkey_enabled);
    setHotkeyValue(initial.global_hotkey);
    setRecording(false);
    setHotkeyError(null);
    setUrlTestResult(null);
    setTokenResult(null);
  }, [initial]);

  useEffect(() => {
    loadCacheSize().catch(() => setCacheSize(null));
  }, [loadCacheSize]);

  const dirty = useMemo(() => {
    return (
      serverUrl !== initial.server_url ||
      accessToken !== initial.access_token ||
      language !== initial.language ||
      timezone !== initial.timezone ||
      Number(weekStart) !== initial.week_start ||
      Number(scheduleStartHour) !== initial.scheduler_start_hour ||
      Number(scheduleEndHour) !== initial.scheduler_end_hour ||
      Number(slotMinutes) !== initial.scheduler_slot_minutes ||
      hotkeyEnabled !== initial.global_hotkey_enabled ||
      hotkeyValue !== initial.global_hotkey
    );
  }, [
    serverUrl,
    accessToken,
    language,
    timezone,
    weekStart,
    scheduleStartHour,
    scheduleEndHour,
    slotMinutes,
    hotkeyEnabled,
    hotkeyValue,
    initial
  ]);

  const validScheduleHours = Number(scheduleStartHour) < Number(scheduleEndHour);
  const canSave = dirty && validScheduleHours;
  const urlInputClass = [
    "settings-modal-input",
    urlTestResult ? (urlTestResult.ok ? "valid" : "invalid") : ""
  ].filter(Boolean).join(" ");
  const tokenInputClass = [
    "settings-modal-input",
    tokenResult ? (tokenResult.ok ? "valid" : "invalid") : ""
  ].filter(Boolean).join(" ");

  async function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (dirty) {
        const ok = await ask({
          title: "放弃更改",
          message: "有未保存的更改，确定关闭吗？",
          confirmLabel: "关闭",
          danger: true,
        });
        if (!ok) return;
      }
      onClose();
    }
  }

  async function handleTestUrl() {
    setTestingUrl(true);
    setUrlTestResult(null);
    try {
      const api = new AMToDoApi(serverUrl, null);
      const result = await api.health();
      setUrlTestResult({ ok: true, version: result.version, message: `连接成功 (${result.version})` });
    } catch (err: unknown) {
      setUrlTestResult({ ok: false, message: err instanceof Error ? err.message : "连接失败" });
    } finally {
      setTestingUrl(false);
    }
  }

  async function handleVerifyToken() {
    setVerifyingToken(true);
    setTokenResult(null);
    try {
      const plainApi = new AMToDoApi(serverUrl, null);
      const healthResult = await plainApi.health();
      let api: AMToDoApi;
      if (healthResult.public_key) {
        const p256Key = await importP256PublicKey(healthResult.public_key);
        api = new AMToDoApi(serverUrl, accessToken, p256Key);
      } else {
        api = new AMToDoApi(serverUrl, accessToken);
      }
      const result = await api.user();
      if (result.ok) {
        setTokenResult({ ok: true, userName: result.user.name, message: `令牌有效 — 用户: ${result.user.name}` });
      } else {
        setTokenResult({ ok: false, message: "令牌无效" });
      }
    } catch (err: unknown) {
      setTokenResult({ ok: false, message: err instanceof Error ? err.message : "验证失败" });
    } finally {
      setVerifyingToken(false);
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "缓存清除失败");
    } finally {
      setClearingCache(false);
    }
  }

  function handleSave() {
    setError(null);
    if (!validScheduleHours) {
      setError("Schedule 默认起始时间必须早于终止时间");
      return;
    }
    if (!canSave) return;
    const updated: UISettings = {
      ...initial,
      server_url: serverUrl,
      access_token: accessToken,
      language,
      timezone,
      week_start: Number(weekStart),
      scheduler_start_hour: Number(scheduleStartHour),
      scheduler_end_hour: Number(scheduleEndHour),
      scheduler_slot_minutes: Number(slotMinutes),
      global_hotkey_enabled: hotkeyEnabled,
      global_hotkey: hotkeyValue,
    };
    onSave(updated);
    if (hotkeyEnabled && hotkeyValue) {
      window.amtodoShell?.registerHotkey?.(hotkeyValue)?.then?.((result: { ok: boolean; error?: string }) => {
        if (!result?.ok) {
          setHotkeyError(result?.error || "快捷键注册失败");
        }
      });
    } else {
      window.amtodoShell?.unregisterHotkey?.();
    }
  }

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
    if (parts.length < 2) return null; // must have at least one modifier
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
    }
  }

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

        <div className="settings-modal-body">
          {/* Server Connection */}
          <div className="settings-modal-section-label">服务器连接</div>

          <div className="settings-modal-field">
            <label className="settings-modal-label" htmlFor="srv-url">服务器地址</label>
            <div className="settings-modal-input-row">
              <input
                id="srv-url"
                type="text"
                className={urlInputClass}
                value={serverUrl}
                onChange={(e) => { setServerUrl(e.target.value); setUrlTestResult(null); }}
              />
              <button
                type="button"
                className="settings-modal-inline-btn"
                disabled={testingUrl || !serverUrl}
                onClick={handleTestUrl}
              >
                {testingUrl ? "检测中..." : "检测"}
              </button>
            </div>
            {urlTestResult ? (
              <span className={`settings-modal-field-msg ${urlTestResult.ok ? "ok" : "err"}`}>
                {urlTestResult.message}
              </span>
            ) : null}
          </div>

          <div className="settings-modal-field">
            <label className="settings-modal-label" htmlFor="srv-token">访问令牌</label>
            <div className="settings-modal-input-row">
              <div className="settings-modal-input-wrap">
                <input
                  id="srv-token"
                  type={showToken ? "text" : "password"}
                  className={tokenInputClass}
                  value={accessToken}
                  onChange={(e) => { setAccessToken(e.target.value); setTokenResult(null); }}
                />
                <button
                  type="button"
                  className="settings-modal-input-eye"
                  onClick={() => setShowToken((v) => !v)}
                  title={showToken ? "隐藏" : "显示"}
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
                className="settings-modal-inline-btn"
                disabled={verifyingToken || !serverUrl || !accessToken}
                onClick={handleVerifyToken}
              >
                {verifyingToken ? "验证中..." : "验证"}
              </button>
            </div>
            {tokenResult ? (
              <span className={`settings-modal-field-msg ${tokenResult.ok ? "ok" : "err"}`}>
                {tokenResult.message}
              </span>
            ) : (
              <span className="settings-modal-hint">修改后需要重新连接服务器</span>
            )}
          </div>

          <div className="settings-modal-divider" />

          {/* Display */}
          <div className="settings-modal-section-label">显示设置</div>

          <div className="settings-modal-field-row">
            <div className="settings-modal-field settings-modal-field-half">
              <label className="settings-modal-label" htmlFor="sui-lang">语言</label>
              <Dropdown
                id="sui-lang"
                value={language}
                options={[{ value: "zh-CN", label: "中文 (zh-CN)" }]}
                onChange={setLanguage}
              />
            </div>
            <div className="settings-modal-field settings-modal-field-half">
              <label className="settings-modal-label" htmlFor="sui-tz">时区</label>
              <Dropdown
                id="sui-tz"
                value={timezone}
                options={TIMEZONE_OPTIONS}
                onChange={setTimezone}
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
                onChange={setWeekStart}
              />
            </div>
          </div>

          <div className="settings-modal-divider" />

          {/* Schedule */}
          <div className="settings-modal-section-label">Schedule设置</div>

          <div className="settings-modal-field-row">
            <div className="settings-modal-field settings-modal-field-half">
              <label className="settings-modal-label" htmlFor="sui-schedule-start">默认起始</label>
              <Dropdown
                id="sui-schedule-start"
                value={scheduleStartHour}
                options={SCHEDULE_START_HOUR_OPTIONS}
                onChange={setScheduleStartHour}
              />
            </div>
            <div className="settings-modal-field settings-modal-field-half">
              <label className="settings-modal-label" htmlFor="sui-schedule-end">默认终止</label>
              <Dropdown
                id="sui-schedule-end"
                value={scheduleEndHour}
                options={SCHEDULE_END_HOUR_OPTIONS}
                onChange={setScheduleEndHour}
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
                onChange={setSlotMinutes}
              />
            </div>
          </div>

          <div className="settings-modal-divider" />

          {/* Global Hotkey */}
          <div className="settings-modal-section-label">全局快捷键</div>

          <div className="settings-modal-field">
            <div className="settings-modal-input-row">
              <label className="settings-modal-label">快捷键组合</label>
              <button
                type="button"
                className={`toggle-switch${hotkeyEnabled ? " on" : ""}`}
                onClick={() => {
                  setHotkeyEnabled((v) => !v);
                  if (hotkeyEnabled) setHotkeyError(null);
                }}
                role="switch"
                aria-checked={hotkeyEnabled}
              >
                <span className="toggle-thumb" />
              </button>
            </div>
            <div className="settings-modal-input-row">
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
              {hotkeyValue && hotkeyEnabled ? (
                <button
                  type="button"
                  className="settings-modal-inline-btn"
                  onClick={() => { setHotkeyValue(""); setHotkeyError(null); }}
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

          {/* Cache */}
          <div className="settings-modal-section-label">缓存</div>

          <div className="settings-modal-field">
            <span className="settings-modal-label">附件缓存</span>
            <div className="settings-modal-input-row">
              <span className="settings-modal-cache-info">
                {cacheSize
                  ? `${cacheSize.count} 个文件，共 ${formatSize(cacheSize.bytes)}`
                  : "加载中..."}
              </span>
              <button
                type="button"
                className="settings-modal-inline-btn settings-modal-cache-clear"
                disabled={clearingCache || !cacheSize || cacheSize.count === 0}
                onClick={handleClearCache}
              >
                {clearingCache ? "清除中..." : "清除"}
              </button>
            </div>
          </div>
        </div>

        {error ? <div className="settings-modal-error">{error}</div> : null}

        <div className="settings-modal-actions">
          <button
            type="button"
            className="settings-modal-btn settings-modal-btn-save"
            disabled={!canSave}
            onClick={handleSave}
          >
            保存更改
          </button>
          <button
            type="button"
            className="settings-modal-btn settings-modal-btn-cancel"
            onClick={onClose}
          >
            取消
          </button>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
