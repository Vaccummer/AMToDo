import { useEffect, useMemo, useState } from "react";
import type { AMToDoApi, TodoItem } from "../api/client";
import {
  addDaysToDateKey,
  dateKeyFromDate,
  dateKeyFromEpoch,
  formatDateKeyDay,
  formatDateKeyWeekday,
  monthLabelFromDateKey,
  startOfDateKeyEpoch
} from "../lib/time";
import leftIcon from "../assets/left.svg";
import rightIcon from "../assets/right.svg";
import toTodayIcon from "../assets/ToToday.svg";

type Props = {
  api: AMToDoApi;
};

export function TodoView({ api }: Props) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedOffset, setSelectedOffset] = useState(0);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [status, setStatus] = useState<string>("加载中");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

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
      const result = await api.createTodo(title);
      const createdDayKey = dateKeyFromEpoch(result.todo.created_at);
      if (createdDayKey !== selectedDayKey) {
        goToToday();
        setTodos([result.todo]);
      } else {
        setTodos((items) => [...items, result.todo]);
      }
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
      await api.updateTodo(id, trimmed);
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

  return (
    <div className="todo-view">
      <div className="calendar-strip">
        <div className="cal-month-row">
          <button type="button" className="cal-month-label" onClick={goToToday}>{monthLabel}</button>
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

      <div className="todo-list">
        {status ? <div className="empty-state">{status}</div> : null}
        {!status && todos.length === 0 ? <div className="empty-state">这一天还没有 ToDo</div> : null}
        {todos.map((todo) => {
          const isEditing = editingId === todo.id;
          return (
          <div className={todo.completed ? "todo-row completed" : "todo-row"} key={todo.id}>
            <button type="button" className="check-button" onClick={() => void toggle(todo)}>
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
          </div>
          );
        })}
        <button type="button" className="add-todo-button" onClick={() => void addTodo()}>
          + 添加待办
        </button>
      </div>
    </div>
  );
}
