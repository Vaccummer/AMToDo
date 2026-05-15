import { useCallback, useEffect, useState } from "react";
import { AMToDoApi, type HealthResponse } from "./api/client";
import { ACCESS_TOKEN, SERVER_URL } from "./config";
import { importP256PublicKey } from "./crypto/envelope";
import { type UISettings, DEFAULT_SETTINGS, parseSettings } from "./lib/settings";
import { setDefaultTimezone } from "./lib/time";
import { SettingsModal } from "./views/SettingsModal";
import { ScheduleView } from "./views/ScheduleView";
import { TodoView } from "./views/TodoView";
import closeIcon from "./assets/close.svg";
import gearIcon from "./assets/gear.svg";
import maximumIcon from "./assets/maximum.svg";
import minimumIcon from "./assets/minimum.svg";
import userIcon from "./assets/user.svg";
import windowlizeIcon from "./assets/windowlize.svg";

type Tab = "todo" | "schedule";

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>("todo");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [username, setUsername] = useState("");

  const [settings, setSettings] = useState<UISettings>(() => ({
    ...DEFAULT_SETTINGS,
    server_url: SERVER_URL || DEFAULT_SETTINGS.server_url,
    access_token: ACCESS_TOKEN || DEFAULT_SETTINGS.access_token,
  }));

  const [api, setApi] = useState<AMToDoApi>(
    () => new AMToDoApi(settings.server_url, settings.access_token)
  );

  // Load settings from disk on mount
  useEffect(() => {
    window.amtodoShell.readSettings()
      .then((raw) => {
        const parsed = parseSettings(raw as Record<string, string | undefined>);
        setSettings(parsed);
        setDefaultTimezone(parsed.timezone);
        document.documentElement.style.setProperty("--app-font-family", parsed.font_family);
        document.documentElement.style.setProperty("--app-font-size", `${parsed.font_size}px`);
      })
      .catch(() => { /* keep defaults */ });
  }, []);

  // Bootstrap API client with health check + encryption
  useEffect(() => {
    const bootstrap = async () => {
      const baseApi = new AMToDoApi(settings.server_url, settings.access_token);
      const result = await baseApi.health();
      setHealth(result);
      setHealthError(null);

      const limits = result.limits;
      if (result.public_key) {
        const p256Key = await importP256PublicKey(result.public_key);
        setApi(new AMToDoApi(settings.server_url, settings.access_token, p256Key, limits.max_attachment_size_bytes, limits.max_attachments_per_todo));
      } else {
        baseApi.maxAttachmentSize = limits.max_attachment_size_bytes;
        baseApi.maxAttachmentsPerTodo = limits.max_attachments_per_todo;
        setApi(baseApi);
      }
    };

    bootstrap().catch((error: unknown) => {
      setHealth(null);
      setHealthError(error instanceof Error ? error.message : "无法连接后端");
    });
  }, [settings.server_url, settings.access_token]);

  // Fetch current user display name
  useEffect(() => {
    api.user()
      .then((result) => setUsername(result.user.name))
      .catch(() => setUsername(""));
  }, [api]);

  // Listen for window maximize changes
  useEffect(() => {
    window.amtodoShell.isMaximized().then(setMaximized).catch(() => setMaximized(false));
    return window.amtodoShell.onMaximizedChange(setMaximized);
  }, []);

  const handleSettingsSave = useCallback((newSettings: UISettings) => {
    window.amtodoShell.writeSettings({
      server_url: newSettings.server_url,
      access_token: newSettings.access_token,
      admin_token: newSettings.admin_token,
      language: newSettings.language,
      timezone: newSettings.timezone,
      font_family: newSettings.font_family,
      font_size: String(newSettings.font_size),
      calendar_days: String(newSettings.calendar_days),
      week_start: String(newSettings.week_start),
      scheduler_start_hour: String(newSettings.scheduler_start_hour),
      scheduler_end_hour: String(newSettings.scheduler_end_hour),
      scheduler_slot_minutes: String(newSettings.scheduler_slot_minutes),
    }).catch(() => { /* keep going */ });
    setSettings(newSettings);
    setDefaultTimezone(newSettings.timezone);
    document.documentElement.style.setProperty("--app-font-family", newSettings.font_family);
    document.documentElement.style.setProperty("--app-font-size", `${newSettings.font_size}px`);
    setShowSettings(false);
  }, []);

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="titlebar-drag">
          <div className={health ? "brand-dot ok" : "brand-dot"} />
          <span className="brand-title">AMToDo</span>
          <span className={health ? "server-pill ok" : "server-pill"}>
            {health ? `API ${health.version}` : healthError ? "API 离线" : "API 检查中"}
          </span>
        </div>
        {username ? (
          <div className="titlebar-user">
            <img className="titlebar-user-icon" src={userIcon} alt="" />
            <span className="titlebar-user-name">{username}</span>
          </div>
        ) : null}
        <div className="window-controls">
          <button
            type="button"
            aria-label="设置"
            className="settings-btn"
            onClick={() => setShowSettings(true)}
          >
            <img src={gearIcon} alt="" />
          </button>
          <button type="button" aria-label="最小化" onClick={() => window.amtodoShell.minimize()}>
            <img src={minimumIcon} alt="" />
          </button>
          <button
            type="button"
            aria-label={maximized ? "还原" : "最大化"}
            onClick={() => window.amtodoShell.toggleMaximize()}
          >
            <img src={maximized ? windowlizeIcon : maximumIcon} alt="" />
          </button>
          <button
            type="button"
            aria-label="关闭"
            className="close"
            onClick={() => window.amtodoShell.close()}
          >
            <img src={closeIcon} alt="" />
          </button>
        </div>
      </header>

      <main className="workspace">
        <nav className="side-nav">
          <button
            type="button"
            className={activeTab === "todo" ? "active" : ""}
            onClick={() => setActiveTab("todo")}
          >
            ToDo
          </button>
          <button
            type="button"
            className={activeTab === "schedule" ? "active" : ""}
            onClick={() => setActiveTab("schedule")}
          >
            Schedule
          </button>
        </nav>
        <section className="content-panel">
          {activeTab === "todo" ? (
            <TodoView
              api={api}
              calendarDays={settings.calendar_days}
              weekStart={settings.week_start}
            />
          ) : (
            <ScheduleView
              api={api}
              startHour={settings.scheduler_start_hour}
              endHour={settings.scheduler_end_hour}
              slotMinutes={settings.scheduler_slot_minutes}
              weekStart={settings.week_start}
            />
          )}
        </section>
      </main>

      {showSettings ? (
        <SettingsModal
          settings={settings}
          onSave={handleSettingsSave}
          onClose={() => setShowSettings(false)}
        />
      ) : null}
    </div>
  );
}
