import { useCallback, useEffect, useRef, useState } from "react";
import { AMToDoApi, type HealthResponse, type UserResponse, type TodoItem, type ScheduleItem, type NotificationItem } from "../api/client";
import { UiWsClient, RECONNECT_EXHAUSTED_CODE, type WsNotificationPayload } from "../api/ws-client";
import { ConnectionStatusManager, useConnectionStatus } from "../api/connection-status";
import { ACCESS_TOKEN, SERVER_URL } from "../config";
import { type UISettings, DEFAULT_SETTINGS, parseSettings } from "../lib/settings";
import { dateKeyFromEpoch, setDefaultTimezone } from "../lib/time";
import { applyTheme, getTheme, DEFAULT_THEME } from "../themes";
import { isBackgroundWsAvailable, requestBackgroundWsNotificationPermission, startBackgroundWs, stopBackgroundWs } from "../lib/background-ws";
import { I18nProvider, createTranslator } from "../i18n";
import { SettingsModal } from "./views/SettingsModal";
import { ScheduleView } from "./views/ScheduleView";
import { SearchView } from "./views/SearchView";
import { TodoView } from "./views/TodoView";
import { TrashView } from "./views/TrashView";
import { TodoDetailModal } from "./views/TodoDetailModal";
import { ScheduleDetailModal } from "./views/ScheduleDetailModal";
import { NotifyFormModal } from "./views/NotifyFormModal";
import { TrashStyleDemo } from "./views/TrashStyleDemo";
import { setMainStatusBar } from "./statusBar";
import gearIcon from "../assets/gear.svg";
import todoIcon from "../assets/todo.svg";
import scheduleIcon from "../assets/schedule.svg";
import searchIcon from "../assets/search.svg";
import trashIcon from "../assets/trash.svg";

type Tab = "todo" | "schedule" | "search" | "trash" | "settings";
type ConnectionStatus = "checking" | "online" | "offline";

// Main tabs that persist without unmounting
const MAIN_TABS: Tab[] = ["todo", "schedule", "search"];

const tabIcons: Record<Tab, string> = {
  todo: todoIcon,
  schedule: scheduleIcon,
  search: searchIcon,
  trash: trashIcon,
  settings: gearIcon,
};

const shell = window.amtodoShell!;

export function App() {
  applyTheme(getTheme(DEFAULT_THEME));

  const isTrashDemo =
    new URLSearchParams(window.location.search).has("trash-demo") ||
    window.location.hash.includes("trash-demo");

  if (isTrashDemo) {
    return <TrashStyleDemo />;
  }

  const [activeTab, setActiveTab] = useState<Tab>("todo");
  const [previousTab, setPreviousTab] = useState<Tab | null>(null);
  const [trashKey, setTrashKey] = useState(0);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<UserResponse["user"] | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("checking");
  const [pendingAction, setPendingAction] = useState<{
    type: "todo" | "schedule" | "notify";
    id: number;
    action: "jump" | "edit";
    dateKey?: string;
  } | null>(null);
  const [selectedDateCache, setSelectedDateCache] = useState<Record<string, string>>({});
  const [crossTypeEdit, setCrossTypeEdit] = useState<{ type: "todo"; item: TodoItem } | null>(null);
  const [editingTrashItem, setEditingTrashItem] = useState<{
    type: "todo" | "schedule" | "notify";
    item: TodoItem | ScheduleItem | NotificationItem;
  } | null>(null);

  function handleTrashItemUpdated(type: "todo" | "schedule" | "notify", item: TodoItem | ScheduleItem | NotificationItem) {
    setEditingTrashItem({ type, item });
    setTrashKey((k) => k + 1);
  }

  const [settings, setSettings] = useState<UISettings>(() => ({
    ...DEFAULT_SETTINGS,
    server_url: SERVER_URL || DEFAULT_SETTINGS.server_url,
    access_token: ACCESS_TOKEN || DEFAULT_SETTINGS.access_token,
  }));

  const [api, setApi] = useState<AMToDoApi>(
    () => new AMToDoApi(settings.server_url, settings.access_token)
  );

  const wsClientRef = useRef<UiWsClient | null>(null);
  const connectionManagerRef = useRef(new ConnectionStatusManager());
  const connStatus = useConnectionStatus(connectionManagerRef.current);

  const handleTodoDateChange = useCallback((key: string) => {
    setSelectedDateCache((prev) => prev.todo === key ? prev : { ...prev, todo: key });
  }, []);
  const handleScheduleDateChange = useCallback((key: string) => {
    setSelectedDateCache((prev) => prev.schedule === key ? prev : { ...prev, schedule: key });
  }, []);

  function navigateTab(tab: Tab) {
    if (tab === "settings") {
      setPreviousTab(activeTab);
      setActiveTab("settings");
      return;
    }
    if (tab === "trash" && activeTab !== "trash") {
      setTrashKey((k) => k + 1);
    }
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

  function handleWsNotification(notification: WsNotificationPayload) {
    const epoch = typeof notification.trigger_at === "number" ? notification.trigger_at : 0;
    const d = new Date(epoch * 1000);
    const timeStr = isNaN(d.getTime())
      ? ""
      : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
    const desc = notification.description ?? "";
    const t = createTranslator(settings.language);
    const triggerLabel = t("common.trigger");
    const body = desc ? `${desc}\n${triggerLabel}: ${timeStr}` : `${triggerLabel}: ${timeStr}`;

    import("@capacitor/local-notifications").then(({ LocalNotifications }) => {
      LocalNotifications.schedule({
        notifications: [{
          title: notification.title || "AMToDo",
          body,
          id: notification.id % 2147483647,
          extra: { id: notification.id, trigger_at: notification.trigger_at },
        }],
      }).catch(() => {});
    }).catch(() => {});
  }

  // Lock shell height to prevent viewport resize when keyboard opens
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(".mobile-shell");
    if (!el) return;
    const shellEl = el;
    const h = window.innerHeight;
    shellEl.style.height = `${h}px`;
    shellEl.style.maxHeight = `${h}px`;

    // Counteract viewport resize (e.g. keyboard opening)
    const vv = window.visualViewport;
    if (!vv) return;
    function onResize() {
      shellEl.style.height = `${h}px`;
      shellEl.style.maxHeight = `${h}px`;
    }
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  // Configure status bar
  useEffect(() => {
    if (activeTab !== "settings") {
      setMainStatusBar();
    }
  }, [activeTab, settings.theme]);

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
    if (!settings.ws_enabled) {
      connectionManagerRef.current.reportIdle();
      setApi(new AMToDoApi(settings.server_url, settings.access_token));
      setHealth(null);
      setCurrentUser(null);
      setConnectionStatus("offline");
      return;
    }
    let cancelled = false;
    let retryTimer: number | undefined;

    const bootstrap = async () => {
      const mgr = connectionManagerRef.current;

      console.log("[AMToDo] bootstrap start: server_url=%s, token_len=%d, token_prefix=%s...",
        settings.server_url, settings.access_token.length,
        settings.access_token.slice(0, 8));

      // Phase 1: Health check via HTTP
      const baseApi = new AMToDoApi(settings.server_url, settings.access_token);
      const result = await baseApi.health();
      console.log("[AMToDo] health OK: version=%s", result.version);

      if (cancelled) return;
      setHealth(result);
      mgr.reportHealthOk(result.version, result.name);

      const limits = result.limits;

      const userResult = await baseApi.verifyTokenHttp();
      if (cancelled) return;
      setCurrentUser(userResult.user);

      // Phase 2: Connect UI WebSocket
      const wsClient = new UiWsClient(
        settings.server_url,
        settings.access_token,
        settings.ws_reconnect_interval_ms,
        settings.reconnect_max_attempts
      );

      const unsubStatus = wsClient.onStatusChange((status) => {
        if (!cancelled) mgr.reportWsStatus(status);
      });

      const unsubDisconnect = wsClient.onDisconnectReason((code) => {
        if (cancelled) return;
        if (code === RECONNECT_EXHAUSTED_CODE) {
          mgr.reportReconnectExhausted();
        } else {
          mgr.reportWsStatus("disconnected", code);
        }
      });

      const unsubNotif = wsClient.onNotification((notification) => {
        if (cancelled) return;
        if (isBackgroundWsAvailable()) return;
        handleWsNotification(notification);
      });

      console.log("[AMToDo] WS connecting...");
      await wsClient.connect();
      console.log("[AMToDo] WS connected OK");

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

      if (cancelled) return;
      setHealthError(null);
      setApi(readyApi);
      setConnectionStatus("online");
    };

    const scheduleRetry = () => {
      retryTimer = window.setTimeout(() => {
        if (!cancelled) void runBootstrap();
      }, 2000);
    };

    const runBootstrap = async () => {
      if (cancelled) return;
      setConnectionStatus("checking");
      try {
        await bootstrap();
      } catch (error: unknown) {
        console.error("[AMToDo] bootstrap failed:", error);
        if (cancelled) return;
        const mgr = connectionManagerRef.current;
        const message = error instanceof Error ? error.message : "common.connectionFailed";
        const kind = error instanceof TypeError ? "network" : "token";
        mgr.reportHealthError(kind, message);
        setHealth(null);
        setCurrentUser(null);
        setHealthError(message);
        setConnectionStatus("offline");
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
  }, [settings.server_url, settings.access_token, settings.ws_enabled]);

  useEffect(() => {
    if (!isBackgroundWsAvailable()) return;
    if (!settings.ws_enabled || !settings.server_url || !settings.access_token) {
      stopBackgroundWs().catch(() => {});
      return;
    }
    if (settings.notification_enabled) {
      requestBackgroundWsNotificationPermission().catch(() => false);
    }
    startBackgroundWs({
      serverUrl: settings.server_url,
      accessToken: settings.access_token,
      reconnectIntervalMs: settings.ws_reconnect_interval_ms,
    }).catch((err: unknown) => {
      connectionManagerRef.current.reportHealthError(
        "network",
        err instanceof Error ? err.message : "Background WebSocket start failed"
      );
    });
  }, [settings.server_url, settings.access_token, settings.ws_enabled, settings.ws_reconnect_interval_ms, settings.notification_enabled]);

  // Keep the UI WebSocket alive while backgrounded; Android native services now
  // handle long-running background work, and the UI connection can resume if the
  // system or network closes it.
  useEffect(() => {
    let listenerHandle: { remove: () => Promise<void> } | undefined;
    let aborted = false;

    import("@capacitor/app").then(({ App }) => {
      if (aborted) return;
      App.addListener("appStateChange", ({ isActive }) => {
        const ws = wsClientRef.current;
        if (!ws) return;

        if (isActive) {
          if (ws.connectionStatus === "disconnected") {
            ws.connect().catch((err: unknown) => {
              connectionManagerRef.current.reportHealthError(
                "network",
                err instanceof Error ? err.message : "common.connectionFailed"
              );
            });
          }
        }
      }).then((handle) => {
        if (!aborted) listenerHandle = handle;
      });
    }).catch(() => {});

    return () => {
      aborted = true;
      listenerHandle?.remove();
    };
  }, []);

  // Notification click handler
  useEffect(() => {
    return shell.onNotificationClicked?.((data: { id: number; trigger_at: number }) => {
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
      ws_enabled: String(s.ws_enabled),
      ws_reconnect_retries: String(s.ws_reconnect_retries),
      reconnect_max_attempts: String(s.reconnect_max_attempts),
      notify_on_disconnect: String(s.notify_on_disconnect),
      ws_reconnect_interval_ms: String(s.ws_reconnect_interval_ms),
    }).catch(() => {});
  }, []);

  const tApp = createTranslator(settings.language);
  const tabLabels: Record<Tab, string> = {
    todo: tApp("tab.todo"),
    schedule: tApp("tab.schedule"),
    search: tApp("tab.search"),
    trash: tApp("tab.trash"),
    settings: tApp("settings.title"),
  };

  function connectionBlockInfo() {
    switch (connStatus.status) {
      case "online":
        return null;
      case "checking":
        return {
          title: tApp("mobile.connection.connectingTitle"),
          desc: tApp("mobile.connection.connectingDesc"),
          tone: "working" as const,
        };
      case "reconnecting":
        return {
          title: tApp("mobile.connection.reconnectingTitle"),
          desc: connStatus.errorMessage || tApp("mobile.connection.reconnectingDesc"),
          tone: "working" as const,
        };
      case "token-error":
        return {
          title: tApp("mobile.connection.tokenTitle"),
          desc: connStatus.errorMessage || tApp("mobile.connection.tokenDesc"),
          tone: "error" as const,
        };
      case "idle":
        return {
          title: tApp("mobile.connection.idleTitle"),
          desc: tApp("mobile.connection.idleDesc"),
          tone: "idle" as const,
        };
      case "offline":
      default:
        return {
          title: tApp("mobile.connection.offlineTitle"),
          desc: connStatus.errorMessage || healthError || tApp("mobile.connection.offlineDesc"),
          tone: "error" as const,
        };
    }
  }

  const connectionBlock = activeTab !== "settings" ? connectionBlockInfo() : null;

  return (
    <I18nProvider locale={settings.language}>
    <div className="mobile-shell">
      <main className="mobile-content">
        {/* Main tabs: always mounted, hidden when inactive */}
        <div style={{ display: activeTab === "todo" ? "contents" : "none" }}>
          <TodoView
            api={api}
            calendarDays={settings.calendar_days}
            weekStart={settings.week_start}
            cachedDateKey={selectedDateCache.todo}
            onDateChange={handleTodoDateChange}
            pendingAction={pendingAction?.type === "todo" ? pendingAction : null}
            onPendingActionConsumed={() => setPendingAction(null)}
            connectionStatus={connStatus}
            onOpenSettings={() => navigateTab("settings")}
            isActive={activeTab === "schedule"}
          />
        </div>
        <div style={{ display: activeTab === "schedule" ? "contents" : "none" }}>
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
            connectionStatus={connStatus}
            onOpenSettings={() => navigateTab("settings")}
            isActive={activeTab === "todo"}
          />
        </div>
        <div style={{ display: activeTab === "search" ? "contents" : "none" }}>
          <SearchView api={api} connectionStatus={connStatus} onOpenSettings={() => navigateTab("settings")} onNavigate={(target, dateKey) => {
            if (dateKey) navigateTab(target as Tab);
          }} />
        </div>
        {/* Trash: remount on entry via key */}
        {activeTab === "trash" && (
          <TrashView
            key={trashKey}
            api={api}
            connectionStatus={connStatus}
            onOpenSettings={() => navigateTab("settings")}
            onItemClick={(type, item) => setEditingTrashItem({ type, item })}
          />
        )}

        {connectionBlock ? (
          <div className={`mobile-connection-block ${connectionBlock.tone}`} role="status" aria-live="polite">
            <div className="mobile-connection-block-card">
              <div className="mobile-connection-block-icon">
                {connectionBlock.tone === "working" ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M21 12a9 9 0 0 1-9 9m0-18a9 9 0 0 1 9 9" />
                    <path d="M3 12a9 9 0 0 1 9-9m0 18a9 9 0 0 1-9-9" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                )}
              </div>
              <div className="mobile-connection-block-body">
                <div className="mobile-connection-block-title">{connectionBlock.title}</div>
                <div className="mobile-connection-block-desc">{connectionBlock.desc}</div>
              </div>
              <button type="button" className="mobile-connection-block-btn" onClick={() => navigateTab("settings")}>
                {tApp("mobile.connection.openSettings")}
              </button>
            </div>
          </div>
        ) : null}
      </main>

      <nav className="mobile-tab-bar">
        {(["todo", "schedule", "search", "trash", "settings"] as const).map((tab) => (
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

      {/* Settings: overlay on top of content */}
      {activeTab === "settings" && (
        <SettingsModal
          settings={settings}
          connectionStatus={connStatus}
          health={health}
          currentUser={currentUser}
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
            setSettings((prev) => ({ ...prev, ...fields }));
          }}
          onConnectionToggle={(enabled) => {
            setSettings((prev) => ({ ...prev, ws_enabled: enabled }));
          }}
          onClose={() => {
            flushSettings(settings);
            setActiveTab(previousTab ?? "todo");
            setPreviousTab(null);
          }}
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

      {editingTrashItem && editingTrashItem.type === "todo" && (
        <TodoDetailModal
          todo={editingTrashItem.item as TodoItem}
          api={api}
          trashMode
          onClose={() => setEditingTrashItem(null)}
          onDelete={() => setEditingTrashItem(null)}
          onUpdate={(updated) => handleTrashItemUpdated("todo", updated)}
        />
      )}
      {editingTrashItem && editingTrashItem.type === "schedule" && (
        <ScheduleDetailModal
          schedule={editingTrashItem.item as ScheduleItem}
          api={api}
          trashMode
          onClose={() => setEditingTrashItem(null)}
          onDelete={() => setEditingTrashItem(null)}
          onUpdate={(updated) => handleTrashItemUpdated("schedule", updated)}
        />
      )}
      {editingTrashItem && editingTrashItem.type === "notify" && (
        <NotifyFormModal
          editId={editingTrashItem.item.id}
          api={api}
          trashMode
          onUpdate={(updated) => handleTrashItemUpdated("notify", updated)}
          onClose={() => setEditingTrashItem(null)}
        />
      )}
    </div>
    </I18nProvider>
  );
}
