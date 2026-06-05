import { useEffect, useMemo, useRef, useState } from "react";
import type { AMToDoApi, TodoItem } from "../api/client";
import type { ConnectionStatusSnapshot } from "../api/connection-status";
import {
  addDaysToDateKey,
  dateKeyFromDate,
  formatDueTime,
  isOverdueTodo,
  startOfDateKeyEpoch,
  startOfWeekDateKey,
  weekOfMonth
} from "../lib/time";
import { CalendarPopup } from "./CalendarPopup";
import { ContextMenu, TrashIcon } from "./ContextMenu";
import { DateBar } from "./DateBar";
import { useConfirm } from "./ConfirmDialog";
import { TodoDetailModal } from "./TodoDetailModal";
import addIcon from "../assets/add.svg";
import { useI18n } from "../i18n";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

type Props = {
  api: AMToDoApi;
  calendarDays?: number;
  weekStart?: number;
  cachedDateKey?: string;
  onDateChange?: (dateKey: string) => void;
  pendingAction?: { type: "todo" | "schedule" | "notify"; id: number; action: "jump" | "edit"; dateKey?: string } | null;
  onPendingActionConsumed?: () => void;
  onOpenSettings?: (focusTarget?: "url" | "token") => void;
  connectionStatus?: ConnectionStatusSnapshot;
  onConnectionError?: (kind: "network" | "token" | null, message?: string) => void;
  attachmentDownloadRoot?: string;
};

function EditIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function AttachmentCountIcon() {
  return <span className="todo-attachment-icon">📂</span>;
}

function IdIcon() {
  return <span className="todo-id-icon">🆔</span>;
}

function TagIcon() {
  return <span className="todo-tag-icon">#</span>;
}

function overdueDurationLabel(fromEpoch: number, toEpoch: number | undefined, t: (key: string, params?: Record<string, string | number>) => string): string {
  const effectiveToEpoch = toEpoch ?? Math.floor(Date.now() / 1000);
  const seconds = Math.max(0, effectiveToEpoch - fromEpoch);
  const days = Math.floor(seconds / 86400);
  if (days > 0) return t("common.days", { count: days });
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) return t("common.hours", { count: hours });
  const minutes = Math.max(1, Math.floor(seconds / 60));
  return t("common.minutes", { count: minutes });
}

export function TodoView({ api, calendarDays = 7, weekStart = 0, cachedDateKey, onDateChange, pendingAction, onPendingActionConsumed, onOpenSettings, connectionStatus, onConnectionError, attachmentDownloadRoot }: Props) {
  const todayKey = useMemo(() => dateKeyFromDate(new Date()), []);
  const normalizedWeekStart = weekStart === 1 ? 1 : 0;
  const [selectedDayKey, setSelectedDayKey] = useState(cachedDateKey ?? todayKey);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const todosRef = useRef(todos);
  useEffect(() => { todosRef.current = todos; }, [todos]);
  const [isLoading, setIsLoading] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setShowSkeleton(false);
      return;
    }
    const timer = setTimeout(() => setShowSkeleton(true), 300);
    return () => clearTimeout(timer);
  }, [isLoading]);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [showCalendar, setShowCalendar] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [todoRefreshKey, setTodoRefreshKey] = useState(0);
  const calendarStripRef = useRef<HTMLDivElement>(null);
  const { ask, dialog: confirmDialog } = useConfirm();
  const { t, locale } = useI18n();

  useEffect(() => {
    if (cachedDateKey) setSelectedDayKey(cachedDateKey);
  }, [cachedDateKey]);

  useEffect(() => {
    if (!pendingAction) return;
    if (pendingAction.dateKey) {
      setSelectedDayKey(pendingAction.dateKey);
    }
    if (pendingAction.action === "edit") {
      const item = todosRef.current.find((t) => t.id === pendingAction.id);
      if (item) {
        setDetailId(pendingAction.id);
      }
    }
    onPendingActionConsumed?.();
  }, [pendingAction]); // eslint-disable-line react-hooks/exhaustive-deps

  const weekStartKey = useMemo(
    () => startOfWeekDateKey(selectedDayKey, normalizedWeekStart),
    [normalizedWeekStart, selectedDayKey]
  );
  const days = useMemo(
    () => Array.from({ length: calendarDays }, (_, i) => addDaysToDateKey(weekStartKey, i)),
    [weekStartKey, calendarDays]
  );

  useEffect(() => { onDateChange?.(selectedDayKey); }, [selectedDayKey, onDateChange]);

  const weekLabel = useMemo(() => {
    const [year, month] = weekStartKey.split("-").map(Number);
    const wn = weekOfMonth(weekStartKey, normalizedWeekStart);
    const weekStr = locale === "en" ? ordinal(wn) : String(wn);
    return t("common.weekOfYear", { year, month, week: weekStr });
  }, [normalizedWeekStart, weekStartKey, t, locale]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setTodos([]);
    const start = startOfDateKeyEpoch(selectedDayKey);
    const end = startOfDateKeyEpoch(addDaysToDateKey(selectedDayKey, 1));
    api
      .listTodos(start, end)
      .then((result) => {
        if (cancelled) return;
        setTodos(result.todos.map((todo) => ({
          ...todo,
          attachment_count: todo.attachment_count ?? 0,
        })));
        onConnectionError?.(null);
        setIsLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setTodos([]);
        setIsLoading(false);
        if (error instanceof TypeError) {
          onConnectionError?.("network", t("connection.cannotConnectDesc"));
        } else {
          onConnectionError?.("token", error instanceof Error ? error.message : t("connection.authFailed"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, selectedDayKey, todoRefreshKey]);

  async function toggle(todo: TodoItem) {
    const completed = !todo.completed;
    if (todo.completed) {
      await api.reopenTodo(todo.id);
    } else {
      await api.completeTodo(todo.id);
    }
    setTodos((items) =>
      items.map((item) => (
        item.id === todo.id
          ? { ...item, completed, completed_at: completed ? Math.floor(Date.now() / 1000) : null }
          : item
      ))
    );
  }

  async function addTodo() {
    const title = t("todo.newTodo");
    try {
      const plannedAt = startOfDateKeyEpoch(selectedDayKey);
      const result = await api.createTodo(title, plannedAt);
      setTodos((items) => [...items, { ...result.todo, attachment_count: 0 }]);
      setEditingId(result.todo.id);
      setEditText("");
      onConnectionError?.(null);
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        onConnectionError?.("network", t("connection.cannotConnectDesc"));
      } else {
        onConnectionError?.("token", error instanceof Error ? error.message : t("todo.createFailed"));
      }
    }
  }

  function startEdit(todo: TodoItem) {
    setEditingId(todo.id);
    setEditText(todo.title);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText("");
  }

  async function saveEdit(id: number) {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === todos.find((t) => t.id === id)?.title) {
      cancelEdit();
      return;
    }
    try {
      await api.updateTodo(id, { title: trimmed });
      setTodos((items) =>
        items.map((item) => (item.id === id ? { ...item, title: trimmed } : item))
      );
    } catch {
      // keep old title on failure
    }
    cancelEdit();
  }

  function handleEditKey(e: React.KeyboardEvent, id: number) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveEdit(id);
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  }

  function prevWeek() {
    setSelectedDayKey(addDaysToDateKey(weekStartKey, -1));
  }

  function nextWeek() {
    setSelectedDayKey(addDaysToDateKey(weekStartKey, calendarDays));
  }

  function goToToday() {
    setSelectedDayKey(todayKey);
  }

  function goToDate(dateKey: string) {
    setSelectedDayKey(dateKey);
  }

  async function deleteTodo(id: number) {
    try {
      await api.deleteTodo(id);
    } catch {
      // remove locally even if API fails to keep UI responsive
    }
    setTodos((items) => items.filter((t) => t.id !== id));
  }

  async function askDeleteTodo(id: number) {
    const ok = await ask({
      title: t("todo.deleteTodo"),
      message: t("todo.deleteTodoConfirm"),
      confirmLabel: t("common.moveToTrash"),
      danger: true,
    });
    if (ok) deleteTodo(id);
  }

  function handleContextMenu(e: React.MouseEvent, id: number) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  }

  return (
    <div className="todo-view">
      <DateBar
        ref={calendarStripRef}
        title={weekLabel}
        days={days}
        selectedDateKey={selectedDayKey}
        todayKey={todayKey}
        open={showCalendar}
        onPrevious={prevWeek}
        onNext={nextWeek}
        onTitleClick={() => {
          if (!showCalendar && calendarStripRef.current) {
            setAnchorRect(calendarStripRef.current.getBoundingClientRect());
          }
          setShowCalendar((v) => !v);
        }}
        onToday={goToToday}
        onSelectDate={setSelectedDayKey}
        leftTool={
          <button
            type="button"
            className="datebar-side-btn datebar-add-btn"
            onClick={() => void addTodo()}
            title={t("todo.addTodo")}
          >
            <img src={addIcon} alt="" />
          </button>
        }
      />

      {showCalendar && anchorRect ? (
        <CalendarPopup
          selectedDateKey={selectedDayKey}
          todayKey={todayKey}
          anchorRect={anchorRect}
          onSelect={goToDate}
          onClose={() => setShowCalendar(false)}
          weekStart={weekStart}
        />
      ) : null}

      <div className="todo-list">
        {(() => {
          const completedTodos = todos.filter((t) => t.completed);
          const lateCompleted = completedTodos.filter(
            (t) => t.due_at !== null && t.completed_at !== null && t.completed_at > t.due_at
          );
          const onTimeCompleted = completedTodos.length - lateCompleted.length;
          if (!hideCompleted || completedTodos.length === 0) return null;
          const total = completedTodos.length;
          const circumference = 2 * Math.PI * 20;
          const onTimeRatio = onTimeCompleted / total;
          const lateRatio = lateCompleted.length / total;
          return (
            <div className="todo-summary-bar">
              <div className="ring-wrap">
                <svg viewBox="0 0 52 52">
                  <circle className="ring-bg" cx="26" cy="26" r="20" />
                  {onTimeCompleted > 0 && (
                    <circle
                      className="ring-on-time"
                      cx="26" cy="26" r="20"
                      strokeDasharray={`${circumference * onTimeRatio} ${circumference}`}
                      strokeDashoffset="0"
                    />
                  )}
                  {lateCompleted.length > 0 && (
                    <circle
                      className="ring-late"
                      cx="26" cy="26" r="20"
                      strokeDasharray={`${circumference * lateRatio} ${circumference}`}
                      strokeDashoffset={`${-circumference * onTimeRatio}`}
                    />
                  )}
                </svg>
                <div className="ring-center">
                  {total}
                </div>
              </div>
              <div className="stats-col">
                <div className="stat-row">
                  <div className="stat-dot green" />
                  <span className="stat-label">{t("common.onTime")}</span>
                  <span className="stat-value">{onTimeCompleted}</span>
                </div>
                <div className="stat-row">
                  <div className="stat-dot amber" />
                  <span className="stat-label">{t("common.overdueCompleted")}</span>
                  <span className="stat-value">{lateCompleted.length}</span>
                </div>
              </div>
            </div>
          );
        })()}
        {isLoading ? showSkeleton ? (
          <>
            {Array.from({ length: 4 }, (_, i) => (
              <div className="skel-row" key={i}>
                <div className="skel-circle" />
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div className="skel-block" style={{ width: `${55 + i * 8}%`, height: 14 }} />
                  <div className="skel-block" style={{ width: `${30 + i * 5}%`, height: 10 }} />
                </div>
                <div className="skel-block" style={{ width: 52, height: 20, borderRadius: "var(--radius-pill)" }} />
              </div>
            ))}
          </>
        ) : null : todos.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-illustration">
              <div className="paper">
                <div className="paper-line" />
                <div className="paper-line" />
                <div className="paper-line" />
              </div>
              <div className="check">
                <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
            </div>
            <p className="empty-state-title">{t("todo.emptyTitle")}</p>
            <p className="empty-state-subtitle">{t("todo.emptySubtitle")}</p>
          </div>
        ) : null}
        {(!connectionStatus || connectionStatus.status === "online" || connectionStatus.status === "idle" || connectionStatus.status === "checking" || connectionStatus.status === "reconnecting") && todos
          .filter((t) => !hideCompleted || !t.completed)
          .map((todo) => {
          const isEditing = editingId === todo.id;
          const overdue = isOverdueTodo(todo);
          const lateDone = Boolean(todo.completed && todo.due_at !== null && todo.completed_at !== null && todo.completed_at > todo.due_at);
          const hasDue = todo.due_at !== null;
          const statusLabel = overdue
            ? `${t("common.overdue")} ${overdueDurationLabel(todo.due_at!, undefined, t)}`
            : lateDone
              ? `${t("common.overdue")} ${overdueDurationLabel(todo.due_at!, todo.completed_at!, t)}${t("common.completed")}`
              : todo.completed
                ? t("common.completed")
                : t("common.inProgress");
          const rowClass = [
            "todo-row",
            todo.completed ? "completed" : "",
            overdue ? "overdue" : "",
            lateDone ? "late-done" : ""
          ]
            .filter(Boolean).join(" ");
          return (
          <div
            className={rowClass}
            key={todo.id}
            onContextMenu={(e) => handleContextMenu(e, todo.id)}
          >
            <button type="button" className="check-button" onClick={(e) => { e.stopPropagation(); void toggle(todo); }}>
              {todo.completed ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="3" width="18" height="18" rx="5" fill="currentColor" />
                  <polyline points="8 12 11 15 16 9" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                  <rect x="3.5" y="3.5" width="17" height="17" rx="5" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              )}
            </button>
            <div className="todo-main">
              {isEditing ? (
                <input
                  type="text"
                  className="todo-edit-input"
                  size={Math.max(editText.length + 4, 8)}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => handleEditKey(e, todo.id)}
                  onBlur={() => saveEdit(todo.id)}
                  autoFocus
                />
              ) : (
                <span
                  className="todo-title"
                  onDoubleClick={() => startEdit(todo)}
                  title={t("common.doubleClickEdit")}
                >
                  {todo.title}
                </span>
              )}
              <div className="todo-meta">
                <span className="todo-status-badge">{statusLabel}</span>
                {hasDue ? <span className="due-time">{t("common.due")} {formatDueTime(todo.due_at!)}</span> : <span className="due-time">{t("common.noDueDate")}</span>}
                {todo.completed_at ? <span className="todo-completed-time">{t("common.finishedAt")} {formatDueTime(todo.completed_at)}</span> : null}
              </div>
            </div>
            <div className="todo-right">
              <div className="todo-right-top">
                {todo.tag ? (
                  <span className="todo-tag-badge" title={todo.tag}>
                    <TagIcon />
                    <span>{todo.tag}</span>
                  </span>
                ) : null}
                <span className="todo-id-badge" title={`id:${todo.id}`}>
                  <IdIcon />
                  <span>{todo.id}</span>
                </span>
              </div>
              <span className="todo-attachment-count" title={`${t("common.attachments")} ${todo.attachment_count ?? 0}`}>
                <AttachmentCountIcon />
                <span>{todo.attachment_count ?? 0}</span>
              </span>
            </div>
          </div>
          );
        })}
      </div>
      <div className="todo-bottom-bar">
        <button type="button" className="add-todo-button todo-bottom-primary" onClick={() => void addTodo()}>
          <img src={addIcon} alt="" />
          {t("todo.addTodo")}
        </button>
        <button
          type="button"
          className="todo-bottom-icon-btn"
          onClick={() => setTodoRefreshKey((k) => k + 1)}
          title={t("todo.refreshDay")}
        >
          <svg width="18" height="18" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
            <path d="M528.896 998.4c-262.656 0-476.672-214.016-476.672-476.672S266.24 45.056 528.896 45.056c163.84 0 314.368 82.432 402.432 221.184 14.336 22.528 7.68 53.248-14.848 67.584a49.3568 49.3568 0 0 1-67.584-14.848 377.2416 377.2416 0 0 0-320-175.616c-208.896 0-378.88 169.984-378.88 378.88s169.984 378.88 378.88 378.88a378.88 378.88 0 0 0 349.184-231.424c10.752-25.088 39.424-36.352 64-26.112 25.088 10.752 36.352 39.424 26.112 64a476.16 476.16 0 0 1-439.296 290.816z" fill="currentColor"/>
            <path d="M889.344 341.504h-217.6a49.152 49.152 0 0 1 0-98.304h168.96v-168.96a49.152 49.152 0 0 1 98.304 0v218.112c-1.024 27.136-22.528 49.152-49.664 49.152z" fill="currentColor"/>
          </svg>
        </button>
        <button
          type="button"
          className={`todo-bottom-icon-btn${hideCompleted ? " active" : ""}`}
          onClick={() => setHideCompleted((v) => !v)}
          title={hideCompleted ? t("todo.showCompleted") : t("todo.hideCompleted")}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 11 12 14 22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </button>
      </div>

      {detailId != null ? (
        <TodoDetailModal
          todo={todos.find((t) => t.id === detailId)!}
          api={api}
          onClose={() => setDetailId(null)}
          onDelete={(id) => deleteTodo(id)}
          onUpdate={(updated) => {
            setTodos((items) =>
              items.map((item) => (
                item.id === updated.id
                  ? { ...item, ...updated, attachment_count: updated.attachment_count ?? item.attachment_count ?? 0 }
                  : item
              ))
            );
          }}
          attachmentDownloadRoot={attachmentDownloadRoot}
        />
      ) : null}

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            {
              label: `id:${contextMenu.id}`,
              icon: null,
              action: () => {},
              disabled: true
            },
            {
              label: t("common.edit"),
              icon: <EditIcon />,
              action: () => setDetailId(contextMenu.id)
            },
            {
              label: t("common.delete"),
              icon: <TrashIcon />,
              danger: true,
              action: () => askDeleteTodo(contextMenu.id)
            }
          ]}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}
