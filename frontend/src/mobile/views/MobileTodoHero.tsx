import { useMemo } from "react";
import type { TodoItem } from "../../api/client";
import { monthLabelFromDateKey, formatDateKeyWeekday, formatDateKeyDayNumber } from "../../lib/time";

type Props = {
  todos: TodoItem[];
  selectedDateKey: string;
  todayKey: string;
  weekDays: string[];
  locale: string;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onToday: () => void;
  onSelectDate: (dateKey: string) => void;
};

export function MobileTodoHero({
  todos,
  selectedDateKey,
  todayKey,
  weekDays,
  locale,
  onPrevWeek,
  onNextWeek,
  onToday,
  onSelectDate,
}: Props) {
  const stats = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    let onTimeDone = 0;
    let lateDone = 0;
    let pending = 0;
    let overdue = 0;

    for (const item of todos) {
      if (item.completed) {
        if (item.due_at !== null && item.completed_at !== null && item.completed_at > item.due_at) {
          lateDone++;
        } else {
          onTimeDone++;
        }
      } else {
        if (item.due_at !== null && item.due_at < now) {
          overdue++;
        } else {
          pending++;
        }
      }
    }

    return { onTimeDone, lateDone, pending, overdue };
  }, [todos]);

  const totalDone = stats.onTimeDone + stats.lateDone;
  const total = todos.length;
  const ringProgress = total > 0 ? totalDone / total : 0;

  const monthLabel = monthLabelFromDateKey(selectedDateKey, locale === "en" ? "en" : "zh-CN");

  return (
    <div className="mobile-hero">
      {/* Week strip header: month label + nav arrows */}
      <div className="mobile-hero-week-header">
        <button
          type="button"
          className="mobile-hero-nav-btn"
          onClick={onPrevWeek}
          aria-label="Previous week"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="mobile-hero-month-label">{monthLabel}</span>
        <button
          type="button"
          className={`mobile-hero-today-btn${selectedDateKey === todayKey ? " active" : ""}`}
          onClick={onToday}
        >
          {locale === "en" ? "Today" : "今天"}
        </button>
        <button
          type="button"
          className="mobile-hero-nav-btn"
          onClick={onNextWeek}
          aria-label="Next week"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      {/* Week strip: 7 day cells */}
      <div className="mobile-hero-week-strip">
        {weekDays.map((dateKey) => {
          const isToday = dateKey === todayKey;
          const isSelected = dateKey === selectedDateKey;
          const weekday = formatDateKeyWeekday(dateKey, locale === "en" ? "en" : "zh-CN");
          const dayNum = formatDateKeyDayNumber(dateKey);
          const cellClass = [
            "mobile-hero-day-cell",
            isToday ? "today" : "",
            isSelected ? "selected" : "",
          ].filter(Boolean).join(" ");

          return (
            <button
              type="button"
              key={dateKey}
              className={cellClass}
              onClick={() => onSelectDate(dateKey)}
            >
              <span className="mobile-hero-day-label">{weekday}</span>
              <span className="mobile-hero-day-num">{dayNum}</span>
              {/* Placeholder dot -- could be wired to per-day task data */}
              <span className="mobile-hero-day-dot-spacer" />
            </button>
          );
        })}
      </div>

      {/* Micro ring stats */}
      <div className="mobile-hero-ring-stats">
        <svg className="mobile-hero-ring" viewBox="0 0 36 36" width="36" height="36">
          <circle
            cx="18"
            cy="18"
            r="14"
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="3"
          />
          <circle
            cx="18"
            cy="18"
            r="14"
            fill="none"
            stroke="#4ade80"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${ringProgress * 2 * Math.PI * 14} ${2 * Math.PI * 14}`}
            strokeDashoffset="0"
            transform="rotate(-90 18 18)"
          />
        </svg>
        <span className="mobile-hero-ring-text">
          {total > 0 ? (
            <>
              <strong>{totalDone}</strong>{" "}
              {locale === "en" ? "done" : "完成"}
              {", "}
              {stats.pending}{" "}
              {locale === "en" ? "left" : "待办"}
              {stats.overdue > 0 ? (
                <>
                  {", "}
                  <strong className="mobile-hero-overdue">{stats.overdue}</strong>{" "}
                  {locale === "en" ? "overdue" : "逾期"}
                </>
              ) : null}
            </>
          ) : (
            <span className="mobile-hero-ring-empty">
              {locale === "en" ? "No tasks" : "暂无任务"}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
