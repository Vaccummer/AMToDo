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
import gearIcon from "../assets/gear.svg";
import todoIcon from "../assets/todo.svg";
import scheduleIcon from "../assets/schedule.svg";
import searchIcon from "../assets/search.svg";
import trashIcon from "../assets/trash.svg";
import notifyIcon from "../assets/notify.svg";

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

type Props = {
  activeTab: Tab;
  health: import("../api/client").HealthResponse | null;
  healthError: string | null;
  connectionStatus: ConnectionStatus;
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
  navigateTab: (tab: Tab) => void;
  handleMentionNavigate: (type: "todo" | "schedule", id: number, action: "jump" | "edit") => void;
  handleTodoDateChange: (key: string) => void;
  handleScheduleDateChange: (key: string) => void;
  handleSettingsSave: (newSettings: UISettings) => void;
};

export function MobileLayout(props: Props) {
  const {
    activeTab, health, healthError, connectionStatus,
    showSettings, username, settings, api, pendingAction, setPendingAction,
    selectedDateCache, crossTypeEdit, setCrossTypeEdit,
    navigateTab, handleMentionNavigate,
    handleTodoDateChange, handleScheduleDateChange, handleSettingsSave, setShowSettings,
  } = props;

  const connectionOk = connectionStatus === "online";

  useEffect(() => {
    import("@capacitor/status-bar").then(({ StatusBar, Style }) => {
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      StatusBar.setBackgroundColor({ color: "#1a1a1a" }).catch(() => {});
    }).catch(() => {});
  }, []);

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
