import { useMemo, useRef, useCallback } from "react";
import type { TodoItem } from "../../api/client";
import { formatDateKeyWeekday, formatDateKeyDayNumber, monthLabelFromDateKey } from "../../lib/time";

type Props = {
  todos: TodoItem[];
  selectedDateKey: string;
  todayKey: string;
  locale: string;
  onPrevDay: () => void;
  onNextDay: () => void;
  onOpenCalendar: (anchorRect: DOMRect) => void;
};

export function MobileTodoHero({
  todos,
  selectedDateKey,
  todayKey,
  locale,
  onPrevDay,
  onNextDay,
  onOpenCalendar,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const touchRef = useRef({ startX: 0, startY: 0, moved: false, cancelled: false });

  const stats = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    let onTimeDone = 0;
    let lateDone = 0;

    for (const item of todos) {
      if (item.completed) {
        if (item.due_at !== null && item.completed_at !== null && item.completed_at > item.due_at) {
          lateDone++;
        } else {
          onTimeDone++;
        }
      }
    }

    return { onTimeDone, lateDone };
  }, [todos]);

  const totalDone = stats.onTimeDone + stats.lateDone;
  const total = todos.length;
  const ringProgress = total > 0 ? totalDone / total : 0;
  const circumference = 2 * Math.PI * 25;

  const isToday = selectedDateKey === todayKey;
  const lang = locale === "en" ? "en" : "zh-CN";
  const weekday = formatDateKeyWeekday(selectedDateKey, lang);
  const dayNum = formatDateKeyDayNumber(selectedDateKey);
  const monthYear = monthLabelFromDateKey(selectedDateKey, lang);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    touchRef.current = { startX: t.clientX, startY: t.clientY, moved: false, cancelled: false };
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (touchRef.current.cancelled) return;
    const t = e.touches[0];
    const dx = t.clientX - touchRef.current.startX;
    const dy = t.clientY - touchRef.current.startY;
    if (!touchRef.current.moved && Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dy) > 10) {
      touchRef.current.cancelled = true;
      return;
    }
    if (Math.abs(dx) > 5) touchRef.current.moved = true;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchRef.current.cancelled || !touchRef.current.moved) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchRef.current.startX;
    if (Math.abs(dx) > 50) {
      if (dx < 0) onNextDay();
      else onPrevDay();
    }
  }, [onPrevDay, onNextDay]);

  return (
    <div className="mobile-hero">
      <div
        className={`hero-card${isToday ? " is-today" : ""}`}
        ref={cardRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="hero-left">
          <span className="hero-weekday">{weekday}</span>
          <span className="hero-date-big">{dayNum}</span>
          <span className="hero-month-row">
            <span className="hero-month-year">{monthYear}</span>
            <button
              type="button"
              className="hero-calendar-btn"
              onClick={(e) => onOpenCalendar(e.currentTarget.getBoundingClientRect())}
              aria-label="选择日期"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </button>
          </span>
        </div>
        <div className="hero-right">
          <div className="hero-ring-wrap">
            <svg viewBox="0 0 60 60">
              <circle className="hero-ring-bg" cx="30" cy="30" r="25" />
              <circle
                className="hero-ring-fill"
                cx="30"
                cy="30"
                r="25"
                strokeDasharray={`${ringProgress * circumference} ${circumference}`}
                strokeDashoffset="0"
              />
            </svg>
            <div className="hero-ring-center">
              {totalDone}/{total}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
