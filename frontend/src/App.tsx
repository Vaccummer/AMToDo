import { useCallback, useEffect, useRef, useState } from "react";
import { AMToDoApi, API_NETWORK_STATUS_EVENT, type HealthResponse, type TodoItem } from "./api/client";
import { ACCESS_TOKEN, SERVER_URL } from "./config";
import { importP256PublicKey } from "./crypto/envelope";
import { type UISettings, DEFAULT_SETTINGS, parseSettings } from "./lib/settings";
import { dateKeyFromEpoch, setDefaultTimezone } from "./lib/time";
import { applyTheme, getTheme, DEFAULT_THEME } from "./themes";
import { SettingsModal } from "./views/SettingsModal";
import { ScheduleView } from "./views/ScheduleView";
import { SearchView } from "./views/SearchView";
import { TodoView } from "./views/TodoView";
import { TrashView } from "./views/TrashView";
import { NotifyView } from "./views/NotifyView";
import { TodoDetailModal } from "./views/TodoDetailModal";
import closeIcon from "./assets/close.svg";
import gearIcon from "./assets/gear.svg";
import maximumIcon from "./assets/maximum.svg";
import minimumIcon from "./assets/minimum.svg";
import todoIcon from "./assets/todo.svg";
import scheduleIcon from "./assets/schedule.svg";
import searchIcon from "./assets/search.svg";
import trashIcon from "./assets/trash.svg";
import notifyIcon from "./assets/notify.svg";
import userIcon from "./assets/user.svg";
import windowlizeIcon from "./assets/windowlize.svg";

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
  todo: "ToDo",
  schedule: "Schedule",
  search: "Search",
  trash: "Trash",
  notify: "Notify",
};

const shell = window.amtodoShell ?? {
  minimize: async () => undefined,
  toggleMaximize: async () => undefined,
  close: async () => undefined,
  isMaximized: async () => false,
  onMaximizedChange: () => () => undefined,
  readSettings: async () => ({}),
  writeSettings: async () => ({ ok: true }),
  startNotificationPolling: async () => ({ ok: true }),
  onNotificationClicked: () => () => {},
  connectNotificationWebSocket: async () => ({ ok: true }),
  disconnectNotificationWebSocket: async () => ({ ok: true }),
};

export function App() {
  // Apply default theme immediately on first render
  applyTheme(getTheme(DEFAULT_THEME));

  const [activeTab, setActiveTab] = useState<Tab>("todo");
  const visitedTabs = useRef<Set<Tab>>(new Set(["todo"])).current;
  const [visitedTick, setVisitedTick] = useState(0);
  const tabHistory = useRef<{ stack: Tab[]; index: number }>({ stack: ["todo"], index: 0 });
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("checking");
  const [maximized, setMaximized] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [username, setUsername] = useState("");
  const [pendingAction, setPendingAction] = useState<{
    type: "todo" | "schedule" | "notify";
    id: number;
    action: "jump" | "edit";
    dateKey?: string;
  } | null>(null);

  const [selectedDateCache, setSelectedDateCache] = useState<Record<string, string>>({});

  const [crossTypeEdit, setCrossTypeEdit] = useState<{
    type: "todo";
    item: TodoItem;
  } | null>(null);

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
    const h = tabHistory.current;
    h.stack = h.stack.slice(0, h.index + 1);
    h.stack.push(tab);
    h.index = h.stack.length - 1;
    if (!visitedTabs.has(tab)) {
      visitedTabs.add(tab);
      setVisitedTick((t) => t + 1);
    }
    setActiveTab(tab);
  }

  async function handleMentionNavigate(type: "todo" | "schedule", id: number, action: "jump" | "edit") {
    // Cross-type edit: open in current view without switching tabs
    if (action === "edit" && type !== activeTab) {
      try {
        if (type === "todo") {
          const r = await api.getTodo(id);
          setCrossTypeEdit({ type: "todo", item: r.todo });
          return;
        }
      } catch { /* fall through to normal navigation */ }
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

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (e.button === 3) {
        e.preventDefault();
        const h = tabHistory.current;
        if (h.index > 0) {
          h.index--;
          setActiveTab(h.stack[h.index]);
        }
      } else if (e.button === 4) {
        e.preventDefault();
        const h = tabHistory.current;
        if (h.index < h.stack.length - 1) {
          h.index++;
          setActiveTab(h.stack[h.index]);
        }
      }
    }
    window.addEventListener("mousedown", handleMouseDown);
    return () => window.removeEventListener("mousedown", handleMouseDown);
  }, []);

  // Load settings from disk on mount
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

  // Parallel startup: detect server_url and lan_address simultaneously
  useEffect(() => {
    if (!settings.lan_address) return;
    let cancelled = false;

    const healthWithTimeout = async (url: string, timeoutMs: number): Promise<HealthResponse> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const api = new AMToDoApi(url, null);
        const result = await api.health();
        return result;
      } finally {
        clearTimeout(timer);
      }
    };

    const verifyAddress = async (baseUrl: string, lanResult: HealthResponse): Promise<string | null> => {
      const url = new URL(baseUrl);
      const port = url.port;
      const candidates: string[] = [];
      if (lanResult.ipv6) candidates.push(`${url.protocol}//${lanResult.ipv6}:${port}`);
      if (lanResult.ipv4) candidates.push(`${url.protocol}//${lanResult.ipv4}:${port}`);
      for (const candidate of candidates) {
        try {
          await healthWithTimeout(candidate, 3000);
          return candidate;
        } catch {
          continue;
        }
      }
      return null;
    };

    const detect = async () => {
      const directPromise = healthWithTimeout(settings.server_url, 5000)
        .then((result) => ({ type: "direct" as const, result, url: settings.server_url }))
        .catch(() => null);

      const lanPromise = healthWithTimeout(settings.lan_address, 5000)
        .then((result) => ({ type: "lan" as const, result, url: settings.lan_address }))
        .catch(() => null);

      const winner = await Promise.race([directPromise, lanPromise]);
      if (cancelled || !winner) return;

      if (winner.type === "direct") {
        return;
      }

      const verified = await verifyAddress(settings.lan_address, winner.result);
      if (cancelled || !verified) return;

      setSettings((prev) => ({ ...prev, server_url: verified }));
      shell.writeSettings({ server_url: verified }).catch(() => {});
    };

    void detect();
    return () => { cancelled = true; };
  }, [settings.lan_address]);

  // Bootstrap API client with health check + encryption
  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;

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
    };

    const scheduleRetry = () => {
      retryTimer = window.setTimeout(() => {
        void runBootstrap();
      }, 2000);
    };

    const runBootstrap = async () => {
      if (cancelled) return;
      setConnectionStatus("checking");
      try {
        await bootstrap();
      } catch (error: unknown) {
        if (cancelled) return;
        setHealth(null);
        setHealthError(error instanceof Error ? error.message : "无法连接后端");
        setConnectionStatus("offline");
        scheduleRetry();
      }
    };

    void runBootstrap();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [settings.server_url, settings.access_token]);

  useEffect(() => {
    function handleNetworkStatus(event: Event) {
      const detail = (event as CustomEvent<{ online: boolean; message?: string }>).detail;
      if (detail.online) {
        setConnectionStatus("online");
        setHealthError(null);
      } else {
        setConnectionStatus("offline");
        setHealthError(detail.message ?? "网络错误");
      }
    }

    window.addEventListener(API_NETWORK_STATUS_EVENT, handleNetworkStatus);
    return () => window.removeEventListener(API_NETWORK_STATUS_EVENT, handleNetworkStatus);
  }, []);

  // Fetch current user display name
  useEffect(() => {
    api.user()
      .then((result) => setUsername(result.user.name))
      .catch(() => setUsername(""));
  }, [api]);

  // Listen for window maximize changes
  useEffect(() => {
    shell.isMaximized().then(setMaximized).catch(() => setMaximized(false));
    return shell.onMaximizedChange(setMaximized);
  }, []);

  // Listen for notification clicks → navigate to schedule & open edit
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
    }).then(() => {
      shell.startNotificationPolling?.({
        server_url: newSettings.server_url,
        access_token: newSettings.access_token,
        notification_poll_interval: String(newSettings.notification_poll_interval),
        notification_query_window: String(newSettings.notification_query_window),
      });
    }).catch(() => { /* keep going */ });
    setSettings(newSettings);
    setDefaultTimezone(newSettings.timezone);
    applyTheme(getTheme(newSettings.theme));
    document.documentElement.style.setProperty("--app-font-family", newSettings.font_family);
    document.documentElement.style.setProperty("--app-font-size", `${newSettings.font_size}px`);
    setShowSettings(false);
  }, []);

  const connectionOk = connectionStatus === "online";

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="titlebar-drag">
          <div className={connectionOk ? "brand-dot ok" : "brand-dot"} />
          <span className="brand-title">AMToDo</span>
          <span className={connectionOk ? "server-pill ok" : "server-pill"}>
            {connectionOk ? (health ? `API ${health.version}` : "API 在线") : healthError ? "API 离线" : "API 检查中"}
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
          <button type="button" aria-label="最小化" onClick={() => shell.minimize()}>
            <img src={minimumIcon} alt="" />
          </button>
          <button
            type="button"
            aria-label={maximized ? "还原" : "最大化"}
            onClick={() => shell.toggleMaximize()}
          >
            <img src={maximized ? windowlizeIcon : maximumIcon} alt="" />
          </button>
          <button
            type="button"
            aria-label="关闭"
            className="close"
            onClick={() => shell.close()}
          >
            <img src={closeIcon} alt="" />
          </button>
        </div>
      </header>

      <main className="workspace">
        <nav className="side-nav">
          {(["todo", "schedule", "search", "trash"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={activeTab === tab ? "active" : ""}
              onClick={() => navigateTab(tab)}
            >
              <img src={tabIcons[tab]} alt="" className="nav-icon" />
              {tabLabels[tab]}
            </button>
          ))}
        </nav>
        <section className="content-panel">
          {visitedTabs.has("todo") && (
            <div className="view-wrapper" data-active={activeTab === "todo" || undefined}>
              <TodoView
                api={api}
                calendarDays={settings.calendar_days}
                weekStart={settings.week_start}
                cachedDateKey={selectedDateCache.todo}
                onDateChange={handleTodoDateChange}
                pendingAction={pendingAction?.type === "todo" ? pendingAction : null}
                onPendingActionConsumed={() => setPendingAction(null)}
              />
            </div>
          )}
          {visitedTabs.has("schedule") && (
            <div className="view-wrapper" data-active={activeTab === "schedule" || undefined}>
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
            </div>
          )}
          {visitedTabs.has("search") && (
            <div className="view-wrapper" data-active={activeTab === "search" || undefined}>
              <SearchView api={api} onNavigate={(target, dateKey) => {
                if (dateKey) setSelectedDateCache((prev) => ({ ...prev, [target]: dateKey }));
                navigateTab(target as Tab);
              }} />
            </div>
          )}
          {visitedTabs.has("notify") && (
            <div className="view-wrapper" data-active={activeTab === "notify" || undefined}>
              <NotifyView api={api} settings={settings} onNavigate={handleMentionNavigate} />
            </div>
          )}
          {visitedTabs.has("trash") && (
            <div className="view-wrapper" data-active={activeTab === "trash" || undefined}>
              <TrashView api={api} />
            </div>
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

      {crossTypeEdit ? (
        <TodoDetailModal
          todo={crossTypeEdit.item}
          api={api}
          onClose={() => setCrossTypeEdit(null)}
          onDelete={() => setCrossTypeEdit(null)}
          onUpdate={(updated) => setCrossTypeEdit((prev) => prev ? { ...prev, item: updated } : null)}
        />
      ) : null}
    </div>
  );
}
