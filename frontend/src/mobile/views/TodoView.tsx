import { useEffect, useMemo, useRef, useState } from "react";
import type { AMToDoApi, TodoItem } from "../../api/client";
import type { ConnectionStatusSnapshot } from "../../api/connection-status";
import {
  addDaysToDateKey,
  dateKeyFromDate,
  dateKeyFromEpoch,
  formatDateShort,
  startOfDateKeyEpoch,
  startOfWeekDateKey,
  weekOfMonth
} from "../../lib/time";
import { CalendarPopup } from "./CalendarPopup";
import { ContextMenu, TrashIcon } from "./ContextMenu";
import { DateBar } from "./DateBar";
import { useConfirm } from "./ConfirmDialog";
import { TodoDetailModal } from "./TodoDetailModal";
import { MobileTodoHero } from "./MobileTodoHero";
import addIcon from "../../assets/add.svg";
import { useI18n } from "../../i18n";

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
  isActive?: boolean;
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

function relativeDateLabel(epoch: number, todayKey: string, locale: string): string {
  const dateKey = dateKeyFromEpoch(epoch);
  const diffDays = Math.round((startOfDateKeyEpoch(dateKey) - startOfDateKeyEpoch(todayKey)) / 86400);
  const relativeLabels: Record<number, string> = locale === "en"
    ? {
        [-2]: "2d ago",
        [-1]: "Yesterday",
        0: "Today",
        1: "Tomorrow",
        2: "In 2d",
      }
    : {
        [-2]: "前天",
        [-1]: "昨天",
        0: "今天",
        1: "明天",
        2: "后天",
      };
  return relativeLabels[diffDays] ?? formatDateShort(epoch);
}

function dueDateDisplay(epoch: number, todayKey: string, locale: string): { label: string; tone: "past" | "today" | "future" } {
  const dueKey = dateKeyFromEpoch(epoch);
  const label = relativeDateLabel(epoch, todayKey, locale);
  if (dueKey === todayKey) {
    return { label, tone: "today" };
  }
  if (dueKey < todayKey) {
    return { label, tone: "past" };
  }
  return { label, tone: "future" };
}

function rowStatus(todo: TodoItem): string {
  if (todo.completed) {
    if (todo.due_at != null && todo.completed_at != null && todo.completed_at > todo.due_at) return "late-done";
    return "completed";
  }
  if (todo.due_at != null && todo.due_at < Math.floor(Date.now() / 1000)) return "overdue";
  return "";
}

export function TodoView({ api, calendarDays = 7, weekStart = 0, cachedDateKey, onDateChange, pendingAction, onPendingActionConsumed, onOpenSettings, connectionStatus, onConnectionError, isActive = true }: Props) {
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

  const [showCalendar, setShowCalendar] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [todoRefreshKey, setTodoRefreshKey] = useState(0);
  const [swipedId, setSwipedId] = useState<number | null>(null);
  const swipeTouchRef = useRef({ id: 0, startX: 0, startY: 0, moved: false, cancelled: false });
  const calendarStripRef = useRef<HTMLDivElement>(null);
  const { ask, dialog: confirmDialog } = useConfirm();
  const { t, locale } = useI18n();

  useEffect(() => {
    if (isActive) return;
    setShowCalendar(false);
    setAnchorRect(null);
  }, [isActive]);

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
    if (creating) return;
    setCreating(true);
    try {
      const result = await api.createTodo(t("todo.newTodo"), startOfDateKeyEpoch(selectedDayKey), {
        due_at: null,
        description: null,
        priority: 0,
        tag: null,
      });
      const created = { ...result.todo, attachment_count: result.todo.attachment_count ?? 0 };
      setTodos((items) => [...items, created]);
      setDetailId(created.id);
      onConnectionError?.(null);
    } catch (error: unknown) {
      if (error instanceof TypeError) {
        onConnectionError?.("network", t("connection.cannotConnectDesc"));
      } else {
        onConnectionError?.("token", error instanceof Error ? error.message : t("todo.createFailed"));
      }
    } finally {
      setCreating(false);
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

  function prevDay() {
    setSelectedDayKey(addDaysToDateKey(selectedDayKey, -1));
  }

  function nextDay() {
    setSelectedDayKey(addDaysToDateKey(selectedDayKey, 1));
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
      <MobileTodoHero
        todos={todos}
        selectedDateKey={selectedDayKey}
        todayKey={todayKey}
        locale={locale}
        onPrevDay={prevDay}
        onNextDay={nextDay}
        onOpenCalendar={(rect) => {
          setAnchorRect(rect);
          setShowCalendar((v) => !v);
        }}
      />
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
            disabled={creating}
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
          inline
        />
      ) : null}

      <div className="mobile-glass-panel">
        <div className="mobile-panel-header">
          <span className="mobile-panel-title">{t("todo.taskList")}</span>
          <button
            type="button"
            className="mobile-panel-sort-btn"
            onClick={() => setHideCompleted((v) => !v)}
          >
            {hideCompleted ? t("todo.showCompleted") : t("todo.hideCompleted")}
          </button>
        </div>
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
                  <svg viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </div>
              </div>
              <p className="empty-state-title">{t("todo.emptyTitle")}</p>
              <p className="empty-state-subtitle">{t("todo.emptySubtitle")}</p>
            </div>
          ) : null}
          {(!connectionStatus || connectionStatus.status === "online" || connectionStatus.status === "idle" || connectionStatus.status === "checking" || connectionStatus.status === "reconnecting") && todos
            .filter((t) => !hideCompleted || !t.completed)
            .map((todo) => {
              const rs = rowStatus(todo);
              const isSwiped = swipedId === todo.id;
              const dueDisplay = todo.due_at != null ? dueDateDisplay(todo.due_at, todayKey, locale) : null;
              const showDuePlaceholder = todo.due_at == null && todo.completed_at != null;
              const showDueDate = dueDisplay != null || showDuePlaceholder;
              const completedDisplay = todo.completed_at != null ? relativeDateLabel(todo.completed_at, todayKey, locale) : "";
              return (
                <div className="todo-row-wrapper" key={todo.id}>
                  {isSwiped && (
                    <button
                      type="button"
                      className="todo-swipe-delete"
                      onClick={() => { setSwipedId(null); void askDeleteTodo(todo.id); }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  )}
                  <div
                    className={`todo-row m-compact${rs ? ` ${rs}` : ""}${isSwiped ? " swiped" : ""}`}
                    onContextMenu={(e) => handleContextMenu(e, todo.id)}
                    onTouchStart={(e) => {
                      const touch = e.touches[0];
                      swipeTouchRef.current = { id: todo.id, startX: touch.clientX, startY: touch.clientY, moved: false, cancelled: false };
                    }}
                    onTouchMove={(e) => {
                      if (swipeTouchRef.current.cancelled || swipeTouchRef.current.id !== todo.id) return;
                      const touch = e.touches[0];
                      const dx = touch.clientX - swipeTouchRef.current.startX;
                      const dy = touch.clientY - swipeTouchRef.current.startY;
                      if (!swipeTouchRef.current.moved && Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dy) > 10) {
                        swipeTouchRef.current.cancelled = true;
                        return;
                      }
                      if (Math.abs(dx) > 5) swipeTouchRef.current.moved = true;
                    }}
                    onTouchEnd={(e) => {
                      if (swipeTouchRef.current.id !== todo.id) return;
                      if (swipeTouchRef.current.cancelled || !swipeTouchRef.current.moved) {
                        if (isSwiped) { setSwipedId(null); e.preventDefault(); }
                        return;
                      }
                      const touch = e.changedTouches[0];
                      const dx = touch.clientX - swipeTouchRef.current.startX;
                      if (dx < -50) {
                        setSwipedId(todo.id);
                      } else if (dx > 30 && isSwiped) {
                        setSwipedId(null);
                      }
                    }}
                    onDoubleClick={() => setDetailId(todo.id)}
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
                    <div className="todo-content">
                      <div className="todo-line1">
                        <span className="todo-label">{todo.title}</span>
                        {showDueDate ? (
                          <span className={`todo-due${dueDisplay ? ` todo-due-${dueDisplay.tone}` : " todo-due-placeholder"}`}>
                            <svg width="14" height="14" viewBox="0 0 1024 1024" className="todo-date-icon" aria-hidden="true">
                              <path d="M983.637333 302.933333A502.101333 502.101333 0 0 0 719.957333 40.106667C751.786667 15.189333 792.149333 0 836.010667 0 939.861333 0 1024 83.882667 1024 187.306667c0 43.690667-15.104 83.797333-40.362667 115.626666z m-7.68 207.104a459.264 459.264 0 0 1-126.72 316.928l64.853334 64.597334a47.36 47.36 0 1 1-67.157334 66.901333l-69.632-69.461333a462.762667 462.762667 0 0 1-265.386666 83.285333 462.762667 462.762667 0 0 1-264.704-82.944l-69.290667 68.949333a47.872 47.872 0 0 1-67.84-67.584l64.341333-64.170666A459.264 459.264 0 0 1 47.957333 510.037333C47.957333 254.805333 255.744 47.786667 512 47.786667c256.256 0 464.042667 207.018667 464.042667 462.250666z m-271.957333 47.786667a47.872 47.872 0 1 0 0-95.573333H560.042667V255.146667a47.872 47.872 0 0 0-96.085334 0v254.976c0 26.453333 21.504 47.786667 48.042667 47.786666h192zM41.216 309.504A189.781333 189.781333 0 0 1 0 191.146667 191.658667 191.658667 0 0 1 192 0c44.8 0 85.930667 15.36 118.613333 40.96A512.853333 512.853333 0 0 0 41.216 309.504z" fill="#FA6935" />
                            </svg>
                            <span className="todo-date-text">{dueDisplay ? dueDisplay.label : t("common.noDueDate")}</span>
                          </span>
                        ) : null}
                      </div>
                      <div className="todo-line2">
                        <div className="todo-row2">
                          <span className="todo-meta-item todo-attach-pill">🔗 {todo.attachment_count ?? 0}</span>
                          {todo.tag ? (
                            <span className="todo-meta-item todo-tag-pill">
                              <svg width="12" height="12" viewBox="0 0 1024 1024" fill="currentColor" style={{ verticalAlign: "-1px", marginRight: 2 }}>
                                <path d="M745.0624 123.1872H252.928a108.8512 108.8512 0 0 0-108.8512 108.8512v612.3008a83.456 83.456 0 0 0 131.6352 68.1472L445.44 792.6272a108.8 108.8 0 0 1 128.3072 1.8944l146.7904 110.4896a83.456 83.456 0 0 0 133.632-66.56V232.0384a108.8512 108.8512 0 0 0-109.1072-108.8512z m-118.6304 169.984H371.5584a30.72 30.72 0 0 1 0-61.44h254.8736a30.72 30.72 0 0 1 0 61.44z" />
                              </svg>
                              {todo.tag}
                            </span>
                          ) : null}
                        </div>
                        {completedDisplay ? (
                          <span className="todo-completed-date">
                            <svg width="14" height="14" viewBox="0 0 1024 1024" className="todo-date-icon" aria-hidden="true">
                              <path d="M38.04 518.35a475.12 487.33 0 1 0 950.24 0 475.12 487.33 0 1 0-950.24 0Z" fill="#07AA74" />
                              <path d="M513.16 18.75C258.74 18.75 52.5 224.99 52.5 479.41c0 254.42 206.25 460.66 460.66 460.66s460.66-206.25 460.66-460.66c0.01-254.42-206.24-460.66-460.66-460.66z m0 769.72c-170.69 0-309.06-138.37-309.06-309.06s138.37-309.06 309.06-309.06 309.06 138.37 309.06 309.06c0.01 170.69-138.37 309.06-309.06 309.06z" fill="#56D8B0" />
                              <path d="M716.75 407.79L507.91 616.64c-9.06 9.06-20.93 13.59-32.8 13.59-11.88 0-23.76-4.53-32.81-13.59L309.58 483.92c-18.12-18.11-18.12-47.49 0-65.62 18.12-18.11 47.49-18.11 65.62 0l99.91 99.91 176.03-176.04c18.12-18.11 47.5-18.11 65.62 0 18.11 18.13 18.11 47.51-0.01 65.62z" fill="#FFFFFF" />
                            </svg>
                            <span className="todo-date-text">{completedDisplay}</span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      </div>
      <div className="todo-bottom-bar">
        <button type="button" className="add-todo-button todo-bottom-primary" onClick={() => void addTodo()} disabled={creating}>
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
            <path d="M528.896 998.4c-262.656 0-476.672-214.016-476.672-476.672S266.24 45.056 528.896 45.056c163.84 0 314.368 82.432 402.432 221.184 14.336 22.528 7.68 53.248-14.848 67.584a49.3568 49.3568 0 0 1-67.584-14.848 377.2416 377.2416 0 0 0-320-175.616c-208.896 0-378.88 169.984-378.88 378.88s169.984 378.88 378.88 378.88a378.88 378.88 0 0 0 349.184-231.424c10.752-25.088 39.424-36.352 64-26.112 25.088 10.752 36.352 39.424 26.112 64a476.16 476.16 0 0 1-439.296 290.816z" fill="currentColor" />
            <path d="M889.344 341.504h-217.6a49.152 49.152 0 0 1 0-98.304h168.96v-168.96a49.152 49.152 0 0 1 98.304 0v218.112c-1.024 27.136-22.528 49.152-49.664 49.152z" fill="currentColor" />
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

      {selectedDayKey !== todayKey && (
        <button
          type="button"
          className="mobile-fab go-today-fab"
          onClick={goToToday}
          title={locale === "en" ? "Go to today" : "回到今天"}
        >
          <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
            <path d="M1001.235558 448.9728L860.179558 329.2672V166.4a64 64 0 0 0-128 0v54.272l-161.792-137.2672-20.48-17.2032A63.0272 63.0272 0 0 0 512.019558 51.2a63.0272 63.0272 0 0 0-37.9392 15.0016l-20.48 17.2032-430.7968 365.568a65.3824 65.3824 0 0 0-7.8848 91.1872 63.6928 63.6928 0 0 0 90.1632 7.9872L512.019558 202.8032l406.9376 345.344a63.6928 63.6928 0 0 0 90.1632-7.9872 65.3824 65.3824 0 0 0-7.8848-91.1872z" fill="#FFFFFF" />
            <path d="M512.019558 332.8l-384 307.2v256a76.8 76.8 0 0 0 76.8 76.8h192v-281.6h230.4v281.6H819.219558a76.8 76.8 0 0 0 76.8-76.8v-256z" fill="#FFFFFF" />
          </svg>
        </button>
      )}
      <button
        type="button"
        className="mobile-fab"
        onClick={() => void addTodo()}
        disabled={creating}
        title={t("todo.addTodo")}
      >
        +
      </button>

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
              action: () => { },
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
