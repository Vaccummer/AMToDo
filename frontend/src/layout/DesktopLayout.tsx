import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { AMToDoApi, TodoItem } from "../api/client";
import type { UISettings } from "../lib/settings";
import type { Tab, ConnectionStatus, PendingAction } from "../hooks/useAppCore";
import { SettingsModal } from "../views/SettingsModal";
import { ScheduleView } from "../views/ScheduleView";
import { SearchView } from "../views/SearchView";
import { TodoView } from "../views/TodoView";
import { TrashView } from "../views/TrashView";
import { NotifyView } from "../views/NotifyView";
import { TodoDetailModal } from "../views/TodoDetailModal";
import closeIcon from "../assets/close.svg";
import gearIcon from "../assets/gear.svg";
import maximumIcon from "../assets/maximum.svg";
import minimumIcon from "../assets/minimum.svg";
import todoIcon from "../assets/todo.svg";
import scheduleIcon from "../assets/schedule.svg";
import searchIcon from "../assets/search.svg";
import trashIcon from "../assets/trash.svg";
import notifyIcon from "../assets/notify.svg";
import userIcon from "../assets/user.svg";
import windowlizeIcon from "../assets/windowlize.svg";

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

type Props = {
  activeTab: Tab;
  health: import("../api/client").HealthResponse | null;
  healthError: string | null;
  connectionStatus: ConnectionStatus;
  maximized: boolean;
  setMaximized: Dispatch<SetStateAction<boolean>>;
  showSettings: boolean;
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  username: string;
  settings: UISettings;
  api: AMToDoApi;
  pendingAction: PendingAction | null;
  setPendingAction: Dispatch<SetStateAction<PendingAction | null>>;
  selectedDateCache: Record<string, string>;
  setSelectedDateCache: Dispatch<SetStateAction<Record<string, string>>>;
  crossTypeEdit: { type: "todo"; item: TodoItem } | null;
  setCrossTypeEdit: Dispatch<SetStateAction<{ type: "todo"; item: TodoItem } | null>>;
  visitedTabs: Set<Tab>;
  navigateTab: (tab: Tab) => void;
  goBack: () => void;
  goForward: () => void;
  handleMentionNavigate: (type: "todo" | "schedule", id: number, action: "jump" | "edit") => void;
  handleTodoDateChange: (key: string) => void;
  handleScheduleDateChange: (key: string) => void;
  handleSettingsSave: (newSettings: UISettings) => void;
};

const shell = window.amtodoShell ?? {
  minimize: async () => undefined,
  toggleMaximize: async () => undefined,
  close: async () => undefined,
  isMaximized: async () => false,
  onMaximizedChange: () => () => undefined,
};

export function DesktopLayout(props: Props) {
  const {
    activeTab, health, healthError, connectionStatus, maximized, setMaximized,
    showSettings, username, settings, api, pendingAction, setPendingAction,
    selectedDateCache, setSelectedDateCache, crossTypeEdit, setCrossTypeEdit,
    visitedTabs, navigateTab, goBack, goForward, handleMentionNavigate,
    handleTodoDateChange, handleScheduleDateChange, handleSettingsSave, setShowSettings,
  } = props;

  const connectionOk = connectionStatus === "online";

  // Mouse button back/forward navigation
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (e.button === 3) {
        e.preventDefault();
        goBack();
      } else if (e.button === 4) {
        e.preventDefault();
        goForward();
      }
    }
    window.addEventListener("mousedown", handleMouseDown);
    return () => window.removeEventListener("mousedown", handleMouseDown);
  }, []);

  // Listen for window maximize changes
  useEffect(() => {
    shell.isMaximized().then(setMaximized).catch(() => setMaximized(false));
    return shell.onMaximizedChange(setMaximized);
  }, []);

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
