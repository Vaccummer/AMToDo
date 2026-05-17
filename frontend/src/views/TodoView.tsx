import { useEffect, useMemo, useRef, useState } from "react";
import type { AMToDoApi, TodoItem } from "../api/client";
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

type Props = {
  api: AMToDoApi;
  calendarDays?: number;
  weekStart?: number;
  cachedDateKey?: string;
  onDateChange?: (dateKey: string) => void;
  pendingAction?: { type: "todo" | "schedule"; id: number; action: "jump" | "edit"; dateKey?: string } | null;
  onPendingActionConsumed?: () => void;
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
  return (
    <svg className="todo-attachment-icon" viewBox="0 0 1024 1024" aria-hidden="true">
      <path d="M431.8 350c36.8 0 71.5 7.9 104.3 23.6 24.6 11.6 46.8 27.4 66.8 47.3 19.9 19.9 35.7 42.2 47.3 66.7-15.8 15.8-34.8 23.6-57 23.6-7.8 0-15.6-1.2-23.6-3.5-13.4-21.8-31.8-40.1-53.6-53.6-25.8-15.7-53.9-23.6-84.1-23.6-21 0-41.4 4-61.1 12-19.7 8-37.4 19.8-52.9 35.3l-121 121c-15.5 15.5-27.3 33.2-35.3 52.9-7.9 19.4-12 40.1-12 61.1s4 41.4 12 61.1c8 19.8 19.7 37.4 35.3 52.9 15.6 15.6 33.2 27.3 52.9 35.3 19.4 7.9 40.2 12 61.2 12s41.4-4 61.1-12c19.7-8 37.4-19.8 52.9-35.3l84.7-84.7c26.9 7.3 54.7 11 83.5 11 4.6 0 11.1-0.2 19.5-0.6-3.2 3.5-6.4 7-9.7 10.4l-121 121c-23.3 23.3-49.7 40.9-79.3 52.9-29.1 11.9-60.3 18-91.8 18s-62.2-6-91.8-18.1c-29.7-12.1-56.1-29.7-79.3-52.8-23.3-23.3-40.9-49.7-52.9-79.2-11.9-29.1-18-60.3-18-91.8s6.1-62.7 18-91.8c12-29.5 29.6-55.9 52.9-79.2l121-121c2.3-2.3 5.8-5.5 10.4-9.8 22.5-20 47.6-35.1 75.3-45.5 27.7-10.3 56.1-15.5 85.3-15.6zM714.1 67.8c31.5 0 62.7 6.1 91.8 18 29.5 11.9 55.9 29.6 79.3 52.9 23.3 23.3 41 49.7 52.9 79.2 11.9 29.2 18 60.3 17.9 91.8 0 31.5-6.1 62.1-18.1 91.8-12.1 29.7-29.7 56.1-52.8 79.2l-121 121c-2.3 2.4-5.8 5.6-10.4 9.8-22.4 20-47.5 35.1-75.3 45.5-27.3 10.3-56.2 15.6-85.4 15.6-36.7 0-71.5-7.9-104.3-23.6-24.6-11.6-46.8-27.4-66.8-47.3-19.9-19.9-35.7-42.2-47.3-66.7 15.7-15.8 34.7-23.6 57-23.6 7.8 0 15.7 1.2 23.6 3.5 13.4 21.8 31.7 40.1 53.5 53.6 25.9 15.7 53.9 23.6 84.1 23.6 21 0 41.4-4 61.1-12 19.8-8 37.4-19.8 52.9-35.3l121-121c15.6-15.5 27.3-33.2 35.3-52.9 7.9-19.4 12-40.1 12-61.1s-4-41.4-12-61.1c-8-19.8-19.8-37.4-35.3-52.9-15.6-15.6-33.2-27.3-52.9-35.3-19.4-7.9-40.2-12-61.1-12-21 0-41.4 4-61.1 12-19.8 8-37.4 19.8-52.9 35.3L515 280.5c-26.9-7.3-54.7-11-83.5-11-4.6 0-11.1 0.2-19.5 0.6 3.2-3.5 6.4-7 9.8-10.4l121-121c23.1-23.1 49.5-40.7 79.2-52.8 29.9-12.1 60.5-18.2 92.1-18.1z m0 0" />
    </svg>
  );
}

function IdIcon() {
  return (
    <svg className="todo-id-icon" viewBox="0 0 1024 1024" aria-hidden="true">
      <path d="M933.933489 392.327772a38.459877 38.459877 0 0 0 38.35759-38.35759 38.459877 38.459877 0 0 0-38.35759-38.35759h-205.187534L757.488576 42.813412A38.613307 38.613307 0 0 0 723.171318 0.210916 38.562164 38.562164 0 0 0 680.773396 34.732747l-29.151769 280.879845H413.395422l28.486904-272.79918A38.562164 38.562164 0 0 0 407.769642 0.210916a38.562164 38.562164 0 0 0-42.142205 34.317257l-29.407486 281.084419H90.066511a38.459877 38.459877 0 0 0-38.35759 38.35759 38.51102 38.51102 0 0 0 38.35759 38.35759h238.175062l-24.958006 238.635352H90.066511a38.35759 38.35759 0 1 0 0 76.71518h205.187534L266.511424 980.477484a38.35759 38.35759 0 1 0 76.71518 8.080665l29.356342-280.879845h238.226206l-28.486904 272.79918a38.35759 38.35759 0 1 0 76.254889 8.080665l29.407486-280.879845h245.948866a38.35759 38.35759 0 0 0 0-76.71518h-238.175062l24.958006-238.635352z m-315.299389 238.635352H380.407895l24.958005-238.635352h238.226205z" fill="#00C080" />
    </svg>
  );
}

function overdueDurationLabel(fromEpoch: number, toEpoch = Math.floor(Date.now() / 1000)): string {
  const seconds = Math.max(0, toEpoch - fromEpoch);
  const days = Math.floor(seconds / 86400);
  if (days > 0) return `${days} 天`;
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) return `${hours} 小时`;
  const minutes = Math.max(1, Math.floor(seconds / 60));
  return `${minutes} 分钟`;
}

export function TodoView({ api, calendarDays = 7, weekStart = 0, cachedDateKey, onDateChange, pendingAction, onPendingActionConsumed }: Props) {
  const todayKey = useMemo(() => dateKeyFromDate(new Date()), []);
  const normalizedWeekStart = weekStart === 1 ? 1 : 0;
  const [selectedDayKey, setSelectedDayKey] = useState(cachedDateKey ?? todayKey);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [status, setStatus] = useState<string>("加载中");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [showCalendar, setShowCalendar] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const calendarStripRef = useRef<HTMLDivElement>(null);
  const { ask, dialog: confirmDialog } = useConfirm();

  useEffect(() => {
    if (cachedDateKey) setSelectedDayKey(cachedDateKey);
  }, [cachedDateKey]);

  useEffect(() => {
    if (!pendingAction) return;
    if (pendingAction.dateKey) {
      setSelectedDayKey(pendingAction.dateKey);
    }
    if (pendingAction.action === "edit") {
      const item = todos.find((t) => t.id === pendingAction.id);
      if (item) {
        setDetailId(pendingAction.id);
      }
    }
    onPendingActionConsumed?.();
  }, [pendingAction, todos]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const labels = ["一", "二", "三", "四", "五", "六"];
    return `${year}年${month}月 第${labels[wn - 1] ?? wn}周`;
  }, [normalizedWeekStart, weekStartKey]);

  useEffect(() => {
    let cancelled = false;
    const start = startOfDateKeyEpoch(selectedDayKey);
    const end = startOfDateKeyEpoch(addDaysToDateKey(selectedDayKey, 1));
    api
      .listTodos(start, end)
      .then(async (result) => {
        if (cancelled) return;
        const todosWithDefaultCounts = result.todos.map((todo) => ({
          ...todo,
          attachment_count: todo.attachment_count ?? 0
        }));
        setTodos(todosWithDefaultCounts);
        setStatus("");
        const counts = await Promise.allSettled(
          result.todos.map(async (todo) => ({
            todoId: todo.id,
            count: (await api.listTodoAttachments(todo.id)).count
          }))
        );
        if (cancelled) return;
        const countByTodoId = new Map<number, number>();
        counts.forEach((entry) => {
          if (entry.status === "fulfilled") {
            countByTodoId.set(entry.value.todoId, entry.value.count);
          }
        });
        setTodos((items) =>
          items.map((item) => ({
            ...item,
            attachment_count: countByTodoId.get(item.id) ?? item.attachment_count ?? 0
          }))
        );
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setTodos([]);
        setStatus(error instanceof Error ? error.message : "无法加载 ToDo");
      });
    return () => {
      cancelled = true;
    };
  }, [api, selectedDayKey]);

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
    const title = "新待办";
    try {
      const plannedAt = startOfDateKeyEpoch(selectedDayKey);
      const result = await api.createTodo(title, plannedAt);
      setTodos((items) => [...items, { ...result.todo, attachment_count: 0 }]);
      setEditingId(result.todo.id);
      setEditText("");
      setStatus("");
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "无法创建 ToDo");
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
      title: "删除待办",
      message: "确定将这条待办移入回收站吗？之后可以在 Trash 中恢复。",
      confirmLabel: "移入回收站",
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
            title="添加待办"
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
        {status ? <div className="empty-state">{status}</div> : null}
        {!status && todos.length === 0 ? <div className="empty-state">这一天还没有 ToDo</div> : null}
        {todos.map((todo) => {
          const isEditing = editingId === todo.id;
          const overdue = isOverdueTodo(todo);
          const lateDone = Boolean(todo.completed && todo.due_at !== null && todo.completed_at !== null && todo.completed_at > todo.due_at);
          const hasDue = todo.due_at !== null;
          const statusLabel = overdue
            ? `逾期 ${overdueDurationLabel(todo.due_at!)}`
            : lateDone
              ? `逾期 ${overdueDurationLabel(todo.due_at!, todo.completed_at!)}完成`
              : todo.completed
                ? "已完成"
                : "进行中";
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
              {todo.completed ? "✓" : ""}
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
                  title="双击编辑"
                >
                  {todo.title}
                </span>
              )}
              <div className="todo-meta">
                <span className="todo-status-badge">{statusLabel}</span>
                {hasDue ? <span className="due-time">截止 {formatDueTime(todo.due_at!)}</span> : <span className="due-time">无截止时间</span>}
                {todo.completed_at ? <span className="todo-completed-time">完成于 {formatDueTime(todo.completed_at)}</span> : null}
              </div>
            </div>
            <div className="todo-right">
              <span className="todo-id-badge" title={`id:${todo.id}`}>
                <IdIcon />
                <span>{todo.id}</span>
              </span>
              <span className="todo-attachment-count" title={`附件 ${todo.attachment_count ?? 0}`}>
                <AttachmentCountIcon />
                <span>{todo.attachment_count ?? 0}</span>
              </span>
            </div>
          </div>
          );
        })}
        <button type="button" className="add-todo-button" onClick={() => void addTodo()}>
          <img src={addIcon} alt="" />
          添加待办
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
              label: "编辑",
              icon: <EditIcon />,
              action: () => setDetailId(contextMenu.id)
            },
            {
              label: "删除",
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
