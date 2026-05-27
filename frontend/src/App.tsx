import { useCallback, useEffect, useRef, useState } from "react";
import { AMToDoApi, type HealthResponse, type TodoItem } from "./api/client";
import { UiWsClient, RECONNECT_EXHAUSTED_CODE, type WsNotificationPayload } from "./api/ws-client";
import { ConnectionStatusManager, useConnectionStatus } from "./api/connection-status";
import { ACCESS_TOKEN, SERVER_URL } from "./config";
import { type UISettings, DEFAULT_SETTINGS, parseSettings } from "./lib/settings";
import { dateKeyFromEpoch, setDefaultTimezone } from "./lib/time";
import { applyTheme, getTheme, DEFAULT_THEME } from "./themes";
import { I18nProvider, createTranslator } from "./i18n";
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

const tabIcons: Record<Tab, string> = {
  todo: todoIcon,
  schedule: scheduleIcon,
  search: searchIcon,
  trash: trashIcon,
  notify: notifyIcon,
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
  stopNotificationPolling: async () => ({ ok: true }),
  onNotificationClicked: () => () => {},
  showSystemNotification: async () => ({ ok: true }),
};

export function App() {
  // Apply default theme once on mount (settings load effect will override later)
  useEffect(() => {
    applyTheme(getTheme(DEFAULT_THEME));
  }, []);

  const [activeTab, setActiveTab] = useState<Tab>("todo");
  const visitedTabs = useRef<Set<Tab>>(new Set(["todo"])).current;
  const [visitedTick, setVisitedTick] = useState(0);
  const tabHistory = useRef<{ stack: Tab[]; index: number }>({ stack: ["todo"], index: 0 });
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsFocusTarget, setSettingsFocusTarget] = useState<"url" | "token" | undefined>();
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

  const connectionManagerRef = useRef(new ConnectionStatusManager());
  const connStatus = useConnectionStatus(connectionManagerRef.current);

  const handleConnectionError = useCallback((kind: "network" | "token" | null, message?: string) => {
    const mgr = connectionManagerRef.current;
    if (kind === null) {
      mgr.reportApiOk();
    } else {
      mgr.reportApiError(kind, message ?? (kind === "token" ? "common.authFailed" : "common.connectionFailed"));
    }
  }, []);

  const wsClientRef = useRef<UiWsClient | null>(null);

  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const [settings, setSettings] = useState<UISettings>(() => ({
    ...DEFAULT_SETTINGS,
    server_url: SERVER_URL || DEFAULT_SETTINGS.server_url,
    access_token: ACCESS_TOKEN || DEFAULT_SETTINGS.access_token,
  }));

  const [api, setApi] = useState<AMToDoApi | null>(null);

  // Fire system notification when reconnect attempts are exhausted (respects notify_on_disconnect)
  useEffect(() => {
    const mgr = connectionManagerRef.current;
    const t = createTranslator(settings.language);
    let hasBeenOnline = mgr.getSnapshot().status === "online";
    return mgr.onChange((snap) => {
      if (snap.status === "online") hasBeenOnline = true;
      if (!settings.notify_on_disconnect) return;
      if (!hasBeenOnline) return;
      if (snap.status === "offline") {
        fireDisconnectNotice(t("disconnect.interrupted"), snap.errorMessage ? t(snap.errorMessage) || snap.errorMessage : t("common.connectionFailed"));
      } else if (snap.status === "token-error") {
        fireDisconnectNotice(t("disconnect.authError"), snap.errorMessage ? t(snap.errorMessage) || snap.errorMessage : t("disconnect.authErrorDesc"));
      }
    });
  }, [settings.notify_on_disconnect, settings.language]);

  function fireDisconnectNotice(title: string, body: string) {
    const handleClick = () => {
      window.focus();
      setShowSettings(true);
    };
    // Use Electron IPC notification (supports click → open settings via onNotificationClicked)
    if (shell.showSystemNotification) {
      shell.showSystemNotification({ title, body, id: -1, trigger_at: 0 })
        .then((r: { ok: boolean }) => { if (!r.ok) throw 0; })
        .catch(() => {
          // Fallback to Web Notification API
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification(title, { body }).onclick = handleClick;
          }
        });
    } else if (typeof Notification !== "undefined") {
      if (Notification.permission === "granted") {
        new Notification(title, { body }).onclick = handleClick;
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then((p) => {
          if (p === "granted") new Notification(title, { body }).onclick = handleClick;
        });
      }
    }
  }

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
    if (!api) return;
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
      .catch(() => { /* keep defaults */ })
      .finally(() => { setSettingsLoaded(true); });
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

  // Bootstrap: health check (HTTP) → WS connect → API ready
  useEffect(() => {
    if (!settingsLoaded) return;
    let cancelled = false;
    let retryTimer: number | undefined;
    const MAX_STARTUP_ATTEMPTS = 3;
    const STARTUP_DELAYS = [0, 1000, 2000];
    let startupAttempt = 0;

    const bootstrap = async () => {
      const mgr = connectionManagerRef.current;

      // Phase 1: Health check via HTTP (needed for server version + limits)
      const baseApi = new AMToDoApi(settings.server_url, settings.access_token);
      const result = await baseApi.health();

      if (cancelled) return;
      setHealth(result);
      mgr.reportHealthOk(result.version, result.name);

      const limits = result.limits;

      // Phase 2: Connect UI WebSocket
      const wsClient = new UiWsClient(
        settings.server_url,
        settings.access_token,
        settings.ws_reconnect_interval_ms,
        settings.reconnect_max_attempts
      );

      // Feed WS status into the connection manager
      const unsubStatus = wsClient.onStatusChange((status) => {
        if (!cancelled) mgr.reportWsStatus(status);
      });

      // Feed WS auth rejection close codes into the manager
      const unsubDisconnect = wsClient.onDisconnectReason((code) => {
        if (cancelled) return;
        if (code === RECONNECT_EXHAUSTED_CODE) {
          mgr.reportReconnectExhausted();
        } else {
          mgr.reportWsStatus("disconnected", code);
        }
      });

      // Listen for notification pushes
      const unsubNotif = wsClient.onNotification((notification) => {
        if (cancelled) return;
        showSystemNotification(notification);
      });

      await wsClient.connect();

      if (cancelled) {
        unsubStatus();
        unsubDisconnect();
        unsubNotif();
        wsClient.disconnect();
        return;
      }

      wsClientRef.current = wsClient;

      // Phase 3: Create API client with WS transport
      const readyApi = new AMToDoApi(
        settings.server_url,
        settings.access_token,
        limits.max_attachment_size_bytes,
        wsClient
      );

      setApi(readyApi);
      startupAttempt = 0;
    };

    const scheduleRetry = () => {
      if (startupAttempt >= MAX_STARTUP_ATTEMPTS) return;
      const delay = STARTUP_DELAYS[startupAttempt] ?? 2000;
      startupAttempt++;
      retryTimer = window.setTimeout(() => {
        void runBootstrap();
      }, delay);
    };

    const runBootstrap = async () => {
      if (cancelled) return;
      try {
        await bootstrap();
      } catch (error: unknown) {
        if (cancelled) return;
        setHealth(null);
        const mgr = connectionManagerRef.current;
        const message = error instanceof Error ? error.message : "common.connectionFailed";
        const kind = error instanceof TypeError ? "network" : "token";
        mgr.reportHealthError(kind, message);
        scheduleRetry();
      }
    };

    void runBootstrap();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      if (wsClientRef.current) {
        wsClientRef.current.disconnect();
        wsClientRef.current = null;
      }
    };
  }, [settingsLoaded, settings.server_url, settings.access_token]);

  function showSystemNotification(notification: WsNotificationPayload) {
    const epoch = typeof notification.trigger_at === "number" ? notification.trigger_at : 0;
    const d = new Date(epoch * 1000);
    const timeStr = isNaN(d.getTime())
      ? ""
      : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
    const desc = notification.description ?? "";
    const t = createTranslator(settings.language);
    const triggerLabel = t("common.trigger");
    const body = desc ? `${desc}\n${triggerLabel}: ${timeStr}` : `${triggerLabel}: ${timeStr}`;

    const handleClick = () => {
      window.focus();
      const dateKey = dateKeyFromEpoch(notification.trigger_at, settings.timezone);
      navigateTab("schedule");
      setPendingAction({ type: "notify", id: notification.id, action: "edit", dateKey });
    };

    // Try Electron main process notification first, fallback to Web Notification API
    if (shell.showSystemNotification) {
      shell.showSystemNotification({
        title: notification.title || "AMToDo",
        body,
        id: notification.id,
        trigger_at: notification.trigger_at,
      }).then((result: { ok: boolean }) => {
        if (!result.ok) throw new Error("main process notification failed");
      }).catch(() => {
        // Fallback to Web Notification API
        if (typeof Notification !== "undefined") {
          if (Notification.permission === "granted") {
            new Notification(notification.title || "AMToDo", { body }).onclick = handleClick;
          } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then((perm) => {
              if (perm === "granted") {
                new Notification(notification.title || "AMToDo", { body }).onclick = handleClick;
              }
            });
          }
        }
      });
    } else if (typeof Notification !== "undefined") {
      if (Notification.permission === "granted") {
        new Notification(notification.title || "AMToDo", { body }).onclick = handleClick;
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then((perm) => {
          if (perm === "granted") {
            new Notification(notification.title || "AMToDo", { body }).onclick = handleClick;
          }
        });
      }
    }
  }

  // Fetch current user display name
  useEffect(() => {
    if (!api) return;
    api.user()
      .then((result) => setUsername(result.user.name))
      .catch(() => setUsername(""));
  }, [api]);

  // Listen for window maximize changes
  useEffect(() => {
    shell.isMaximized().then(setMaximized).catch(() => setMaximized(false));
    return shell.onMaximizedChange(setMaximized);
  }, []);

  // Listen for notification clicks → navigate to schedule & open edit, or open settings for disconnect
  useEffect(() => {
    return shell.onNotificationClicked?.((data: { id: number; trigger_at: number }) => {
      if (data.id === -1) {
        setShowSettings(true);
        return;
      }
      const { id, trigger_at } = data;
      const dateKey = dateKeyFromEpoch(trigger_at, settings.timezone);
      navigateTab("schedule");
      setPendingAction({ type: "notify", id, action: "edit", dateKey });
    });
  }, [settings.timezone]);

  const flushSettings = useCallback((s: UISettings) => {
    shell.writeSettings({
      server_url: s.server_url,
      lan_address: s.lan_address,
      access_token: s.access_token,
      admin_token: s.admin_token,
      language: s.language,
      timezone: s.timezone,
      font_family: s.font_family,
      font_size: String(s.font_size),
      theme: s.theme,
      calendar_days: String(s.calendar_days),
      week_start: String(s.week_start),
      scheduler_start_hour: String(s.scheduler_start_hour),
      scheduler_end_hour: String(s.scheduler_end_hour),
      scheduler_slot_minutes: String(s.scheduler_slot_minutes),
      notification_enabled: String(s.notification_enabled),
      notification_poll_interval: String(s.notification_poll_interval),
      notification_query_window: String(s.notification_query_window),
      global_hotkey_enabled: String(s.global_hotkey_enabled),
      global_hotkey: s.global_hotkey,
      notification_silent: String(s.notification_silent),
      notification_timeout: s.notification_timeout,
      ws_reconnect_interval_ms: String(s.ws_reconnect_interval_ms),
      reconnect_max_attempts: String(s.reconnect_max_attempts),
      notify_on_disconnect: String(s.notify_on_disconnect),
    }).then(() => {
      shell.startNotificationPolling?.({
        server_url: s.server_url,
        access_token: s.access_token,
        notification_poll_interval: String(s.notification_poll_interval),
        notification_query_window: String(s.notification_query_window),
      });
    }).catch(() => { /* keep going */ });
  }, []);

  const dotClass = connStatus.status === "online" ? " ok"
    : connStatus.status === "token-error" ? " token-error"
    : connStatus.status === "checking" ? ""
    : connStatus.status === "idle" ? " idle"
    : " network-error";

  const tApp = createTranslator(settings.language);
  const tabLabels: Record<Tab, string> = {
    todo: tApp("tab.todo"),
    schedule: tApp("tab.schedule"),
    search: tApp("tab.search"),
    trash: tApp("tab.trash"),
    notify: tApp("tab.notify"),
  };
  const pillText = connStatus.status === "online"
    ? (connStatus.serverVersion ? `API ${connStatus.serverVersion}` : `API ${tApp("settings.connectionSuccess")}`)
    : connStatus.status === "checking" ? `API ${tApp("settings.checking")}`
    : connStatus.status === "token-error" ? tApp("settings.tokenInvalid")
    : connStatus.status === "idle" ? tApp("disconnect.disconnected")
    : `API ${tApp("common.networkError")}`;

  return (
    <I18nProvider locale={settings.language}>
    <div className="app-shell">
      <header className="titlebar">
        <div className="titlebar-drag">
          <div className={`brand-dot${dotClass}`} />
          <span className="brand-title">AMToDo</span>
          <span className={`server-pill${dotClass}`}>
            {pillText}
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
            aria-label={tApp("settings.title")}
            className="settings-btn"
            onClick={() => setShowSettings(true)}
          >
            <img src={gearIcon} alt="" />
          </button>
          <button type="button" aria-label="Minimize" onClick={() => shell.minimize()}>
            <img src={minimumIcon} alt="" />
          </button>
          <button
            type="button"
            aria-label={maximized ? "Restore" : "Maximize"}
            onClick={() => shell.toggleMaximize()}
          >
            <img src={maximized ? windowlizeIcon : maximumIcon} alt="" />
          </button>
          <button
            type="button"
            aria-label="Close"
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
          {connStatus.status !== "online" && connStatus.status !== "checking" && (
            <div className={`ws-banner ${
              connStatus.status === "reconnecting" ? "ws-reconnecting"
              : connStatus.status === "idle" ? "ws-idle"
              : "ws-disconnected"
            }`}>
              <div className="ws-dot" />
              <span className="ws-text">
                {connStatus.status === "reconnecting" ? tApp("connection.reconnectingDesc")
                  : connStatus.status === "idle" ? tApp("disconnect.disconnected")
                  : connStatus.status === "token-error" ? tApp("connection.authFailed")
                  : connStatus.status === "offline" ? tApp("connection.cannotConnect")
                  : tApp("disconnect.disconnected")}
              </span>
            </div>
          )}
        </nav>
        <section className="content-panel">
          {api && visitedTabs.has("todo") && (
            <div className="view-wrapper" data-active={activeTab === "todo" || undefined}>
              <TodoView
                api={api}
                calendarDays={settings.calendar_days}
                weekStart={settings.week_start}
                cachedDateKey={selectedDateCache.todo}
                onDateChange={handleTodoDateChange}
                pendingAction={pendingAction?.type === "todo" ? pendingAction : null}
                onPendingActionConsumed={() => setPendingAction(null)}
                onOpenSettings={(focusTarget) => {
                  setSettingsFocusTarget(focusTarget);
                  setShowSettings(true);
                }}
                connectionStatus={connStatus}
                onConnectionError={handleConnectionError}
              />
            </div>
          )}
          {api && visitedTabs.has("schedule") && (
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
                onOpenSettings={(focusTarget) => {
                  setSettingsFocusTarget(focusTarget);
                  setShowSettings(true);
                }}
                connectionStatus={connStatus}
                onConnectionError={handleConnectionError}
              />
            </div>
          )}
          {api && visitedTabs.has("search") && (
            <div className="view-wrapper" data-active={activeTab === "search" || undefined}>
              <SearchView
                api={api}
                onNavigate={(target, dateKey) => {
                  if (dateKey) setSelectedDateCache((prev) => ({ ...prev, [target]: dateKey }));
                  navigateTab(target as Tab);
                }}
                onOpenSettings={(focusTarget) => {
                  setSettingsFocusTarget(focusTarget);
                  setShowSettings(true);
                }}
                connectionStatus={connStatus}
                onConnectionError={handleConnectionError}
              />
            </div>
          )}
          {api && visitedTabs.has("notify") && (
            <div className="view-wrapper" data-active={activeTab === "notify" || undefined}>
              <NotifyView api={api} settings={settings} onNavigate={handleMentionNavigate} />
            </div>
          )}
          {api && visitedTabs.has("trash") && (
            <div className="view-wrapper" data-active={activeTab === "trash" || undefined}>
              <TrashView
                api={api}
                onOpenSettings={(focusTarget) => {
                  setSettingsFocusTarget(focusTarget);
                  setShowSettings(true);
                }}
                connectionStatus={connStatus}
                onConnectionError={handleConnectionError}
              />
            </div>
          )}
          {(connStatus.status === "idle" || connStatus.status === "offline" || connStatus.status === "token-error") && (
            <div className={`signal-overlay${connStatus.status !== "idle" ? " signal-overlay-warn" : ""}`}>
              <div className="signal-overlay-icon">
                <div className="signal-overlay-wave" />
                <div className="signal-overlay-wave" />
                <div className="signal-overlay-wave" />
                <svg viewBox="0 0 24 24">
                  <line x1="1" y1="1" x2="23" y2="23" />
                  <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
                  <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
                  <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
                  <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
                  <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                  <line x1="12" y1="20" x2="12.01" y2="20" />
                </svg>
              </div>
              <span className="signal-overlay-title">
                {connStatus.status === "idle" ? tApp("disconnect.disconnected") : tApp("disconnect.interrupted")}
              </span>
              <span className="signal-overlay-sub">
                {connStatus.status === "idle" ? tApp("connection.reconnectingDesc")
                  : connStatus.status === "token-error" ? tApp("connection.authFailedDesc")
                  : tApp("connection.cannotConnectDesc")}
              </span>
            </div>
          )}
        </section>
      </main>

      {showSettings ? (
        <SettingsModal
          settings={settings}
          onUpdateField={(fields) => {
            setSettings((prev) => {
              const next = { ...prev, ...fields };
              if (fields.theme) applyTheme(getTheme(fields.theme));
              if (fields.timezone) setDefaultTimezone(fields.timezone);
              if (fields.font_family) document.documentElement.style.setProperty("--app-font-family", fields.font_family);
              if (fields.font_size) document.documentElement.style.setProperty("--app-font-size", `${fields.font_size}px`);
              return next;
            });
          }}
          onSaveConnection={(fields) => {
            const entries: Record<string, string> = {};
            for (const [k, v] of Object.entries(fields)) {
              entries[k] = String(v);
            }
            shell.writeSettings(entries).catch(() => {});
            setSettings((prev) => ({ ...prev, ...fields }));
          }}
          onConnectionToggle={(enabled) => {
            setSettings((prev) => ({ ...prev, ws_enabled: enabled }));
          }}
          onClose={() => {
            flushSettings(settings);
            setShowSettings(false);
          }}
          focusTarget={settingsFocusTarget}
          connectionStatus={connStatus}
        />
      ) : null}

      {crossTypeEdit && api ? (
        <TodoDetailModal
          todo={crossTypeEdit.item}
          api={api}
          onClose={() => setCrossTypeEdit(null)}
          onDelete={() => setCrossTypeEdit(null)}
          onUpdate={(updated) => setCrossTypeEdit((prev) => prev ? { ...prev, item: updated } : null)}
        />
      ) : null}
    </div>
    </I18nProvider>
  );
}
