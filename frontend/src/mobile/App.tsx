import { useCallback, useEffect, useRef, useState } from "react";
import { AMToDoApi, type HealthResponse, type TodoItem, type ScheduleItem, type NotificationItem } from "../api/client";
import { UiWsClient, RECONNECT_EXHAUSTED_CODE, type WsNotificationPayload } from "../api/ws-client";
import { ConnectionStatusManager, useConnectionStatus } from "../api/connection-status";
import { ACCESS_TOKEN, SERVER_URL } from "../config";
import { verifyOrEnrollKey, FingerprintMismatchError } from "../crypto/envelope";
import { type UISettings, DEFAULT_SETTINGS, parseSettings } from "../lib/settings";
import { dateKeyFromEpoch, setDefaultTimezone } from "../lib/time";
import { applyTheme, getTheme, DEFAULT_THEME } from "../themes";
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
    import("@capacitor/status-bar").then(({ StatusBar, Style }) => {
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      StatusBar.setBackgroundColor({ color: "#1a2820" }).catch(() => {});
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
    if (!settings.ws_enabled) {
      connectionManagerRef.current.reportIdle();
      setApi(new AMToDoApi(settings.server_url, settings.access_token));
      setHealth(null);
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

      // TOFU: verify server public key fingerprint
      let currentFingerprint = settings.known_key_fingerprint;
      if (result.public_key) {
        currentFingerprint = await verifyOrEnrollKey(result.public_key, currentFingerprint);
        if (currentFingerprint !== settings.known_key_fingerprint) {
          setSettings((prev) => ({ ...prev, known_key_fingerprint: currentFingerprint }));
          shell.writeSettings({ known_key_fingerprint: currentFingerprint }).catch(() => {});
        }
      }

      const limits = result.limits;

      // Phase 2: Connect UI WebSocket
      const wsClient = new UiWsClient(
        settings.server_url,
        settings.access_token,
        settings.ws_reconnect_interval_ms,
        currentFingerprint,
        (enrolledFp: string) => {
          setSettings((prev) => ({ ...prev, known_key_fingerprint: enrolledFp }));
          shell.writeSettings({ known_key_fingerprint: enrolledFp }).catch(() => {});
        },
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
        null,
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
        const message = error instanceof FingerprintMismatchError
          ? error.messageKey
          : error instanceof Error ? error.message : "common.connectionFailed";
        if (error instanceof FingerprintMismatchError) {
          mgr.reportFingerprintMismatch(message);
        } else {
          const kind = error instanceof TypeError ? "network" : "token";
          mgr.reportHealthError(kind, message);
        }
        setHealth(null);
        setHealthError(message);
        setConnectionStatus("offline");
        if (!(error instanceof FingerprintMismatchError)) scheduleRetry();
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

  // Disconnect WS when app goes to background, reconnect on foreground
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
        } else {
          ws.disconnect();
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
          />
        </div>
        <div style={{ display: activeTab === "search" ? "contents" : "none" }}>
          <SearchView api={api} onNavigate={(target, dateKey) => {
            if (dateKey) navigateTab(target as Tab);
          }} />
        </div>
        {/* Trash: remount on entry via key */}
        {activeTab === "trash" && (
          <TrashView key={trashKey} api={api} onItemClick={(type, item) => setEditingTrashItem({ type, item })} />
        )}
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
          onAcceptFingerprint={(fingerprint) => {
            setSettings((prev) => ({ ...prev, known_key_fingerprint: fingerprint }));
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
