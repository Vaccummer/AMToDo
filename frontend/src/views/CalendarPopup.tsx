import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  addDaysToDateKey,
  dateKeyFromParts,
  firstWeekdayOfMonth,
  formatDateKeyDayNumber,
  monthLabelFromDateKey
} from "../lib/time";
import toTodayIcon from "../assets/ToToday.svg";

const WEEKDAY_LABELS_SUN = ["日", "一", "二", "三", "四", "五", "六"];
const WEEKDAY_LABELS_MON = ["一", "二", "三", "四", "五", "六", "日"];

type Props = {
  selectedDateKey: string;
  todayKey: string;
  anchorRect: DOMRect;
  onSelect: (dateKey: string) => void;
  onClose: () => void;
  weekStart?: number;
};

export function CalendarPopup({ selectedDateKey, todayKey, anchorRect, onSelect, onClose, weekStart = 0 }: Props) {
  const [initialYear, initialMonth] = useMemo(() => {
    const [y, m] = selectedDateKey.split("-").map(Number);
    return [y, m];
  }, [selectedDateKey]);

  const [todayYear, todayMonth] = useMemo(() => {
    const [y, m] = todayKey.split("-").map(Number);
    return [y, m];
  }, [todayKey]);

  const [viewYear, setViewYear] = useState(initialYear);
  const [viewMonth, setViewMonth] = useState(initialMonth);
  const popupRef = useRef<HTMLDivElement>(null);

  // Reset view when reopened
  useEffect(() => {
    setViewYear(initialYear);
    setViewMonth(initialMonth);
  }, [initialYear, initialMonth]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    const timer = setTimeout(() => {
      window.addEventListener("click", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("click", handleClick);
    };
  }, [onClose]);

  const monthLabel = useMemo(
    () => monthLabelFromDateKey(dateKeyFromParts(viewYear, viewMonth, 1)),
    [viewYear, viewMonth]
  );

  const weekdayLabels = weekStart === 1 ? WEEKDAY_LABELS_MON : WEEKDAY_LABELS_SUN;

  const days = useMemo(() => {
    const firstKey = dateKeyFromParts(viewYear, viewMonth, 1);
    const sunDay = firstWeekdayOfMonth(viewYear, viewMonth);
    const leadDays = weekStart === 1
      ? (sunDay === 0 ? 6 : sunDay - 1)
      : sunDay;
    const startKey = addDaysToDateKey(firstKey, -leadDays);
    const cells: { dateKey: string; isCurrentMonth: boolean }[] = [];
    for (let i = 0; i < 42; i++) {
      const dateKey = addDaysToDateKey(startKey, i);
      const [y, m] = dateKey.split("-").map(Number);
      cells.push({ dateKey, isCurrentMonth: m === viewMonth && y === viewYear });
    }
    return cells;
  }, [viewYear, viewMonth]);

  function prevMonth() {
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  function goToToday() {
    setViewYear(todayYear);
    setViewMonth(todayMonth);
  }

  function handleSelect(dateKey: string) {
    onSelect(dateKey);
    onClose();
  }

  return createPortal(
    <div
      className="calendar-popup"
      ref={popupRef}
      style={{ position: "fixed", top: anchorRect.bottom, left: anchorRect.left + anchorRect.width / 2 }}
    >
      <div className="calendar-popup-inner date-picker-panel theme-green">
        <div className="dp-panel-header">
          <button type="button" className="dp-nav" aria-label="上一月" onClick={prevMonth}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <span className="dp-panel-label">{monthLabel}</span>
          <button type="button" className="dp-nav" aria-label="下一月" onClick={nextMonth}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        <div className="dp-weekdays">
          {weekdayLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>

        <div className="dp-grid">
          {days.map(({ dateKey, isCurrentMonth }) => {
            const isToday = dateKey === todayKey;
            const isSelected = dateKey === selectedDateKey;
            const cls = ["dp-day"];
            if (!isCurrentMonth) cls.push("other-month");
            if (isToday) cls.push("today");
            if (isSelected) cls.push("selected");
            return (
              <button
                type="button"
                key={dateKey}
                className={cls.join(" ")}
                onClick={() => handleSelect(dateKey)}
              >
                <span>{formatDateKeyDayNumber(dateKey)}</span>
              </button>
            );
          })}
        </div>

        <div className="dp-footer">
          <button type="button" className="dp-today-btn" onClick={goToToday}>
            <img src={toTodayIcon} alt="" />
            回到今天
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
