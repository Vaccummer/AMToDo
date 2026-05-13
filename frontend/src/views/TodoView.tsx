import { useEffect, useMemo, useState } from "react";
import type { AMToDoApi, TodoItem } from "../api/client";
import { addDays, formatDay, formatWeekday, startOfLocalDayEpoch } from "../lib/time";
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

  const weekStart = useMemo(() => addDays(new Date(), weekOffset * 7), [weekOffset]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const selectedDay = days[selectedOffset];

  const todayStr = useMemo(() => new Date().toDateString(), []);
  const isTodaySelected = days[selectedOffset]?.toDateString() === todayStr;
  const monthLabel = `${selectedDay.getFullYear()}年${selectedDay.getMonth() + 1}月`;

  useEffect(() => {
    const start = startOfLocalDayEpoch(selectedDay);
    const end = startOfLocalDayEpoch(addDays(selectedDay, 1));
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
  }, [api, selectedDay]);

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
        {days.map((day, index) => {
          const isToday = day.toDateString() === todayStr;
          const isSelected = index === selectedOffset;
          const className = ["day-cell", isSelected ? "selected" : "", isToday ? "today" : ""]
            .filter(Boolean)
            .join(" ");
          return (
          <button
            type="button"
            key={day.toISOString()}
            className={className}
            onClick={() => setSelectedOffset(index)}
          >
            <span>{formatWeekday(day)}</span>
            <strong>{formatDay(day)}</strong>
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
        {todos.map((todo) => (
          <div className={todo.completed ? "todo-row completed" : "todo-row"} key={todo.id}>
            <button type="button" className="check-button" onClick={() => void toggle(todo)}>
              {todo.completed ? "✓" : ""}
            </button>
            <span>{todo.title}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
