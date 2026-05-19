import { useCallback, useEffect, useRef, useState } from "react";
import { AMToDoApi, API_NETWORK_STATUS_EVENT, type HealthResponse, type TodoItem } from "../api/client";
import { ACCESS_TOKEN, SERVER_URL } from "../config";
import { importP256PublicKey } from "../crypto/envelope";
import { type UISettings, DEFAULT_SETTINGS, parseSettings } from "../lib/settings";
import { dateKeyFromEpoch, setDefaultTimezone } from "../lib/time";
import { applyTheme, getTheme, DEFAULT_THEME } from "../themes";

export type Tab = "todo" | "schedule" | "search" | "trash" | "notify";
export type ConnectionStatus = "checking" | "online" | "offline";
export type PendingAction = {
  type: "todo" | "schedule" | "notify";
  id: number;
  action: "jump" | "edit";
  dateKey?: string;
};

export function useAppCore() {
  applyTheme(getTheme(DEFAULT_THEME));

  const shell = window.amtodoShell!;

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
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
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

  function goBack() {
    const h = tabHistory.current;
    if (h.index > 0) {
      h.index--;
      setActiveTab(h.stack[h.index]);
    }
  }

  function goForward() {
    const h = tabHistory.current;
    if (h.index < h.stack.length - 1) {
      h.index++;
      setActiveTab(h.stack[h.index]);
    }
  }

  async function handleMentionNavigate(type: "todo" | "schedule", id: number, action: "jump" | "edit") {
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

  // Listen for notification clicks -> navigate to schedule & open edit
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

  return {
    activeTab,
    health,
    healthError,
    connectionStatus,
    maximized,
    setMaximized,
    showSettings,
    setShowSettings,
    username,
    pendingAction,
    setPendingAction,
    selectedDateCache,
    setSelectedDateCache,
    crossTypeEdit,
    setCrossTypeEdit,
    settings,
    api,
    visitedTabs,
    visitedTick,
    navigateTab,
    goBack,
    goForward,
    handleMentionNavigate,
    handleTodoDateChange,
    handleScheduleDateChange,
    handleSettingsSave,
  };
}
