import { useEffect, useMemo, useRef, useState } from "react";
import type { AMToDoApi, TodoItem } from "../api/client";
import {
  addDaysToDateKey,
  dateKeyFromDate,
  formatDateKeyDay,
  formatDateKeyWeekday,
  formatTime,
  isOverdueTodo,
  monthLabelFromDateKey,
  startOfDateKeyEpoch
} from "../lib/time";
import { CalendarPopup } from "./CalendarPopup";
import { ContextMenu, TrashIcon } from "./ContextMenu";
import { TodoDetailModal } from "./TodoDetailModal";
import leftIcon from "../assets/left.svg";
import rightIcon from "../assets/right.svg";
import toTodayIcon from "../assets/ToToday.svg";

type Props = {
  api: AMToDoApi;
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

export function TodoView({ api }: Props) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedOffset, setSelectedOffset] = useState(0);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [status, setStatus] = useState<string>("加载中");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [showCalendar, setShowCalendar] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const calendarStripRef = useRef<HTMLDivElement>(null);

  const todayKey = useMemo(() => dateKeyFromDate(new Date()), []);
  const weekStart = useMemo(() => addDaysToDateKey(todayKey, weekOffset * 7), [todayKey, weekOffset]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysToDateKey(weekStart, i)),
    [weekStart]
  );
  const selectedDayKey = days[selectedOffset];

  const isTodaySelected = selectedDayKey === todayKey;
  const monthLabel = monthLabelFromDateKey(selectedDayKey);

  useEffect(() => {
    const start = startOfDateKeyEpoch(selectedDayKey);
    const end = startOfDateKeyEpoch(addDaysToDateKey(selectedDayKey, 1));
    api
      .listTodos(start, end)
      .then((result) => {
        setTodos(result.todos);
        setStatus("");
      })
      .catch((error: unknown) => {
        setTodos([]);
        setStatus(error instanceof Error ? error.message : "无法加载 ToDo");
      });
  }, [api, selectedDayKey]);

  async function toggle(todo: TodoItem) {
    if (todo.completed) {
      await api.reopenTodo(todo.id);
    } else {
      await api.completeTodo(todo.id);
    }
    setTodos((items) =>
      items.map((item) => (item.id === todo.id ? { ...item, completed: !item.completed } : item))
    );
  }

  async function addTodo() {
    const title = "新待办";
    try {
      const plannedAt = startOfDateKeyEpoch(selectedDayKey);
      const result = await api.createTodo(title, plannedAt);
      setTodos((items) => [...items, result.todo]);
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
    setWeekOffset((w) => w - 1);
    setSelectedOffset(0);
  }

  function nextWeek() {
    setWeekOffset((w) => w + 1);
    setSelectedOffset(0);
  }

  function goToToday() {
    setWeekOffset(0);
    setSelectedOffset(0);
  }

  function goToDate(dateKey: string) {
    const todayEpoch = startOfDateKeyEpoch(todayKey);
    const targetEpoch = startOfDateKeyEpoch(dateKey);
    const diff = Math.round((targetEpoch - todayEpoch) / 86400);
    setWeekOffset(Math.floor(diff / 7));
    setSelectedOffset(((diff % 7) + 7) % 7);
  }

  async function deleteTodo(id: number) {
    try {
      await api.deleteTodo(id);
    } catch {
      // remove locally even if API fails to keep UI responsive
    }
    setTodos((items) => items.filter((t) => t.id !== id));
  }

  function handleContextMenu(e: React.MouseEvent, id: number) {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  }

  return (
    <div className="todo-view">
      <div className="calendar-strip" ref={calendarStripRef}>
        <div className="cal-month-row">
          <button
            type="button"
            className="cal-month-label"
            onClick={() => {
              if (!showCalendar && calendarStripRef.current) {
                setAnchorRect(calendarStripRef.current.getBoundingClientRect());
              }
              setShowCalendar((v) => !v);
            }}
          >
            {monthLabel}
            <svg className="cal-month-arrow" width="14" height="14" viewBox="0 0 100 100">
              {showCalendar ? (
                <path d="M18 22 H82 Q90 22 86 30 L56 74 Q50 82 44 74 L14 30 Q10 22 18 22 Z" fill="currentColor" />
              ) : (
                <path d="M18 78 H82 Q90 78 86 70 L56 26 Q50 18 44 26 L14 70 Q10 78 18 78 Z" fill="currentColor" />
              )}
            </svg>
          </button>
        </div>
        <div className="cal-day-row">
        <button type="button" className="cal-nav" aria-label="上一周" onClick={prevWeek}>
          <img src={leftIcon} alt="" />
        </button>
        {days.map((dayKey, index) => {
          const isToday = dayKey === todayKey;
          const isSelected = index === selectedOffset;
          const className = ["day-cell", isSelected ? "selected" : "", isToday ? "today" : ""]
            .filter(Boolean)
            .join(" ");
          return (
          <button
            type="button"
            key={dayKey}
            className={className}
            onClick={() => setSelectedOffset(index)}
          >
            <span>{formatDateKeyWeekday(dayKey)}</span>
            <strong>{formatDateKeyDay(dayKey)}</strong>
          </button>
          );
        })}
        <button type="button" className="cal-nav" aria-label="下一周" onClick={nextWeek}>
          <img src={rightIcon} alt="" />
        </button>
        <button type="button" className="cal-today" aria-label="回到今天" onClick={goToToday} disabled={isTodaySelected}>
          <img src={toTodayIcon} alt="" />
        </button>
        </div>
      </div>

      {showCalendar && anchorRect ? (
        <CalendarPopup
          selectedDateKey={selectedDayKey}
          todayKey={todayKey}
          anchorRect={anchorRect}
          onSelect={goToDate}
          onClose={() => setShowCalendar(false)}
        />
      ) : null}

      <div className="todo-list">
        {status ? <div className="empty-state">{status}</div> : null}
        {!status && todos.length === 0 ? <div className="empty-state">这一天还没有 ToDo</div> : null}
        {todos.map((todo) => {
          const isEditing = editingId === todo.id;
          const overdue = isOverdueTodo(todo);
          const hasDue = todo.due_at !== null;
          const rowClass = ["todo-row", todo.completed ? "completed" : "", overdue ? "overdue" : ""]
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
            {isEditing ? (
              <input
                type="text"
                className="todo-edit-input"
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
            {hasDue ? <span className="due-time">{formatTime(todo.due_at!)}</span> : null}
          </div>
          );
        })}
        <button type="button" className="add-todo-button" onClick={() => void addTodo()}>
          + 添加待办
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
              items.map((item) => (item.id === updated.id ? updated : item))
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
              label: "编辑",
              icon: <EditIcon />,
              action: () => setDetailId(contextMenu.id)
            },
            {
              label: "删除",
              icon: <TrashIcon />,
              danger: true,
              action: () => deleteTodo(contextMenu.id)
            }
          ]}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </div>
  );
}
