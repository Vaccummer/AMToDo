import { useCallback, useEffect, useState } from "react";
import { AMToDoApi, notifyNetworkStatus, type HealthResponse, type TodoItem } from "../api/client";
import { ACCESS_TOKEN, SERVER_URL } from "../config";
import { importP256PublicKey } from "../crypto/envelope";
import { type UISettings, DEFAULT_SETTINGS, parseSettings } from "../lib/settings";
import { dateKeyFromEpoch, setDefaultTimezone } from "../lib/time";
import { applyTheme, getTheme, DEFAULT_THEME } from "../themes";
import { SettingsModal } from "../views/SettingsModal";
import { ScheduleView } from "../views/ScheduleView";
import { SearchView } from "../views/SearchView";
import { TodoView } from "../views/TodoView";
import { TrashView } from "../views/TrashView";
import { NotifyView } from "../views/NotifyView";
import { TodoDetailModal } from "../views/TodoDetailModal";
import gearIcon from "../assets/gear.svg";
import todoIcon from "../assets/todo.svg";
import scheduleIcon from "../assets/schedule.svg";
import searchIcon from "../assets/search.svg";
import trashIcon from "../assets/trash.svg";
import notifyIcon from "../assets/notify.svg";

type Tab = "todo" | "schedule" | "search" | "trash" | "notify";
type ConnectionStatus = "checking" | "online" | "offline";

const tabIcons: Record<Tab, string> = {
  todo: todoIcon,
  schedule: scheduleIcon,
  search: searchIcon,
  trash: trashIcon,
  notify: notifyIcon,
};

const tabLabels: Record<Tab, string> = {
  todo: "待办",
  schedule: "日程",
  search: "搜索",
  trash: "回收站",
  notify: "通知",
};

const shell = window.amtodoShell!;

export function App() {
  applyTheme(getTheme(DEFAULT_THEME));

  const [activeTab, setActiveTab] = useState<Tab>("todo");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("checking");
  const [showSettings, setShowSettings] = useState(false);
  const [username, setUsername] = useState("");
  const [pendingAction, setPendingAction] = useState<{
    type: "todo" | "schedule" | "notify";
    id: number;
    action: "jump" | "edit";
    dateKey?: string;
  } | null>(null);
  const [selectedDateCache, setSelectedDateCache] = useState<Record<string, string>>({});
  const [crossTypeEdit, setCrossTypeEdit] = useState<{ type: "todo"; item: TodoItem } | null>(null);

  const [settings, setSettings] = useState<UISettings>(() => ({
    ...DEFAULT_SETTINGS,
    server_url: SERVER_URL || DEFAULT_SETTINGS.server_url,
    access_token: ACCESS_TOKEN || DEFAULT_SETTINGS.access_token,
  }));

  const [api, setApi] = useState<AMToDoApi>(
    () => new AMToDoApi(settings.server_url, settings.access_token)
  );

  const handleTodoDateChange = useCallback((key: string) => {
    setSelectedDateCache((prev) => prev.todo === key ? prev : { ...prev, todo: key });
  }, []);
  const handleScheduleDateChange = useCallback((key: string) => {
    setSelectedDateCache((prev) => prev.schedule === key ? prev : { ...prev, schedule: key });
  }, []);

  function navigateTab(tab: Tab) {
    setActiveTab(tab);
  }

  async function handleMentionNavigate(type: "todo" | "schedule", id: number, action: "jump" | "edit") {
    if (action === "edit" && type !== activeTab) {
      try {
        if (type === "todo") {
          const r = await api.getTodo(id);
          setCrossTypeEdit({ type: "todo", item: r.todo });
          return;
        }
      } catch { /* fall through */ }
    }

    let dateKey: string | undefined;
    try {
      if (type === "todo") {
        const r = await api.getTodo(id);
        if (r.todo.planned_at) dateKey = dateKeyFromEpoch(r.todo.planned_at);
      } else {
        const r = await api.getSchedule(id);
        dateKey = dateKeyFromEpoch(r.schedule.start_at);
      }
    } catch { /* navigate without date */ }
    navigateTab(type);
    setPendingAction({ type, id, action, dateKey });
  }

  // Configure status bar
  useEffect(() => {
    import("@capacitor/status-bar").then(({ StatusBar, Style }) => {
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      StatusBar.setBackgroundColor({ color: "#1a1a1a" }).catch(() => {});
    }).catch(() => {});
  }, []);

  // Load settings
  useEffect(() => {
    shell.readSettings()
      .then((raw) => {
        const parsed = parseSettings(raw as Record<string, string | undefined>);
        setSettings(parsed);
        setDefaultTimezone(parsed.timezone);
        applyTheme(getTheme(parsed.theme));
        document.documentElement.style.setProperty("--app-font-family", parsed.font_family);
        document.documentElement.style.setProperty("--app-font-size", `${parsed.font_size}px`);
      })
      .catch(() => { /* keep defaults */ });
  }, []);

  // Bootstrap API
  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    let wasOffline = false;

    const bootstrap = async () => {
      const baseApi = new AMToDoApi(settings.server_url, settings.access_token);
      const result = await baseApi.health();

      const limits = result.limits;
      let readyApi = baseApi;
      if (result.public_key) {
        const p256Key = await importP256PublicKey(result.public_key);
        readyApi = new AMToDoApi(
          settings.server_url,
          settings.access_token,
          p256Key,
          limits.max_attachment_size_bytes,
          limits.max_attachments_per_todo
        );
      } else {
        baseApi.maxAttachmentSize = limits.max_attachment_size_bytes;
        baseApi.maxAttachmentsPerTodo = limits.max_attachments_per_todo;
      }

      if (cancelled) return;
      setHealth(result);
      setHealthError(null);
      setApi(readyApi);
      setConnectionStatus("online");
      if (wasOffline) {
        notifyNetworkStatus(true);
      }
      wasOffline = false;
    };

    const runBootstrap = async () => {
      if (cancelled) return;
      setConnectionStatus("checking");
      try {
        await bootstrap();
      } catch (error: unknown) {
        if (cancelled) return;
        wasOffline = true;
        setHealth(null);
        setHealthError(error instanceof Error ? error.message : "无法连接后端");
        setConnectionStatus("offline");
        retryTimer = window.setTimeout(() => void runBootstrap(), 2000);
      }
    };

    void runBootstrap();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [settings.server_url, settings.access_token]);

  // Fetch username
  useEffect(() => {
    api.user()
      .then((result) => setUsername(result.user.name))
      .catch(() => setUsername(""));
  }, [api]);

  // Notification click handler
  useEffect(() => {
    return shell.onNotificationClicked?.((data: { id: number; trigger_at: number }) => {
      const { id, trigger_at } = data;
      const dateKey = dateKeyFromEpoch(trigger_at, settings.timezone);
      navigateTab("schedule");
      setPendingAction({ type: "notify", id, action: "edit", dateKey });
    });
  }, [settings.timezone]);

  const handleSettingsSave = useCallback((newSettings: UISettings) => {
    shell.writeSettings({
      server_url: newSettings.server_url,
      lan_address: newSettings.lan_address,
      access_token: newSettings.access_token,
      admin_token: newSettings.admin_token,
      language: newSettings.language,
      timezone: newSettings.timezone,
      font_family: newSettings.font_family,
      font_size: String(newSettings.font_size),
      theme: newSettings.theme,
      calendar_days: String(newSettings.calendar_days),
      week_start: String(newSettings.week_start),
      scheduler_start_hour: String(newSettings.scheduler_start_hour),
      scheduler_end_hour: String(newSettings.scheduler_end_hour),
      scheduler_slot_minutes: String(newSettings.scheduler_slot_minutes),
      notification_enabled: String(newSettings.notification_enabled),
      notification_poll_interval: String(newSettings.notification_poll_interval),
      notification_query_window: String(newSettings.notification_query_window),
      global_hotkey_enabled: String(newSettings.global_hotkey_enabled),
      global_hotkey: newSettings.global_hotkey,
      notification_silent: String(newSettings.notification_silent),
      notification_timeout: newSettings.notification_timeout,
    }).catch(() => {});
    setSettings(newSettings);
    setDefaultTimezone(newSettings.timezone);
    applyTheme(getTheme(newSettings.theme));
    document.documentElement.style.setProperty("--app-font-family", newSettings.font_family);
    document.documentElement.style.setProperty("--app-font-size", `${newSettings.font_size}px`);
    setShowSettings(false);
  }, []);

  const connectionOk = connectionStatus === "online";

  return (
    <div className="mobile-shell">
      <header className="mobile-header">
        <div className="mobile-header-left">
          <div className={connectionOk ? "brand-dot ok" : "brand-dot"} />
          <span className="brand-title">AMToDo</span>
          <span className={connectionOk ? "server-pill ok" : "server-pill"}>
            {connectionOk ? (health ? `v${health.version}` : "在线") : healthError ? "离线" : "..."}
          </span>
        </div>
        <div className="mobile-header-right">
          {username && <span className="mobile-username">{username}</span>}
          <button
            type="button"
            className="mobile-settings-btn"
            onClick={() => setShowSettings(true)}
            aria-label="设置"
          >
            <img src={gearIcon} alt="" />
          </button>
        </div>
      </header>

      <main className="mobile-content">
        {activeTab === "todo" && (
          <TodoView
            api={api}
            calendarDays={settings.calendar_days}
            weekStart={settings.week_start}
            cachedDateKey={selectedDateCache.todo}
            onDateChange={handleTodoDateChange}
            pendingAction={pendingAction?.type === "todo" ? pendingAction : null}
            onPendingActionConsumed={() => setPendingAction(null)}
          />
        )}
        {activeTab === "schedule" && (
          <ScheduleView
            api={api}
            settings={settings}
            startHour={settings.scheduler_start_hour}
            endHour={settings.scheduler_end_hour}
            slotMinutes={settings.scheduler_slot_minutes}
            weekStart={settings.week_start}
            cachedDateKey={selectedDateCache.schedule}
            onDateChange={handleScheduleDateChange}
            onNavigate={handleMentionNavigate}
            pendingAction={pendingAction?.type === "schedule" || pendingAction?.type === "notify" ? pendingAction : null}
            onPendingActionConsumed={() => setPendingAction(null)}
          />
        )}
        {activeTab === "search" && (
          <SearchView api={api} onNavigate={(target, dateKey) => {
            if (dateKey) navigateTab(target as Tab);
          }} />
        )}
        {activeTab === "notify" && (
          <NotifyView api={api} settings={settings} onNavigate={handleMentionNavigate} />
        )}
        {activeTab === "trash" && (
          <TrashView api={api} />
        )}
      </main>

      <nav className="mobile-tab-bar">
        {(["todo", "schedule", "search", "notify", "trash"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className={activeTab === tab ? "active" : ""}
            onClick={() => navigateTab(tab)}
          >
            <img src={tabIcons[tab]} alt="" />
            <span>{tabLabels[tab]}</span>
          </button>
        ))}
      </nav>

      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={handleSettingsSave}
          onClose={() => setShowSettings(false)}
        />
      )}

      {crossTypeEdit && (
        <TodoDetailModal
          todo={crossTypeEdit.item}
          api={api}
          onClose={() => setCrossTypeEdit(null)}
          onDelete={() => setCrossTypeEdit(null)}
          onUpdate={(updated) => setCrossTypeEdit((prev) => prev ? { ...prev, item: updated } : null)}
        />
      )}
    </div>
  );
}
