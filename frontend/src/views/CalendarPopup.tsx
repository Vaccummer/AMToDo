import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  addDaysToDateKey,
  dateKeyFromParts,
  firstWeekdayOfMonth,
  formatDateKeyDayNumber,
  monthLabelFromDateKey
} from "../lib/time";
import leftIcon from "../assets/left.svg";
import rightIcon from "../assets/right.svg";

const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

type Props = {
  selectedDateKey: string;
  todayKey: string;
  anchorRect: DOMRect;
  onSelect: (dateKey: string) => void;
  onClose: () => void;
};

export function CalendarPopup({ selectedDateKey, todayKey, anchorRect, onSelect, onClose }: Props) {
  const [initialYear, initialMonth] = useMemo(() => {
    const [y, m] = selectedDateKey.split("-").map(Number);
    return [y, m];
  }, [selectedDateKey]);

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

  const days = useMemo(() => {
    const firstKey = dateKeyFromParts(viewYear, viewMonth, 1);
    const sunDay = firstWeekdayOfMonth(viewYear, viewMonth);
    const mondayOffset = (sunDay === 0 ? 6 : sunDay - 1);
    const startKey = addDaysToDateKey(firstKey, -mondayOffset);
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

  function prevYear() {
    setViewYear((y) => y - 1);
  }

  function nextYear() {
    setViewYear((y) => y + 1);
  }

  function handleSelect(dateKey: string) {
    onSelect(dateKey);
    onClose();
  }

  return createPortal(
    <div
      className="calendar-popup"
      ref={popupRef}
      style={{ position: "fixed", top: anchorRect.bottom + 4, left: anchorRect.left, width: anchorRect.width }}
    >
      <div className="cal-popup-header">
        <button type="button" className="cal-popup-nav" aria-label="上一年" onClick={prevYear}>
          <img src={leftIcon} alt="" className="cal-popup-double" />
          <img src={leftIcon} alt="" className="cal-popup-double" />
        </button>
        <button type="button" className="cal-popup-nav" aria-label="上一月" onClick={prevMonth}>
          <img src={leftIcon} alt="" />
        </button>
        <span className="cal-popup-label">{monthLabel}</span>
        <button type="button" className="cal-popup-nav" aria-label="下一月" onClick={nextMonth}>
          <img src={rightIcon} alt="" />
        </button>
        <button type="button" className="cal-popup-nav" aria-label="下一年" onClick={nextYear}>
          <img src={rightIcon} alt="" className="cal-popup-double" />
          <img src={rightIcon} alt="" className="cal-popup-double" />
        </button>
      </div>

      <div className="cal-popup-weekdays">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="cal-popup-grid">
        {days.map(({ dateKey, isCurrentMonth }) => {
          const isToday = dateKey === todayKey;
          const isSelected = dateKey === selectedDateKey;
          const classNames = ["cal-popup-day"];
          if (!isCurrentMonth) classNames.push("other-month");
          if (isToday) classNames.push("today");
          if (isSelected) classNames.push("selected");
          return (
            <button
              type="button"
              key={dateKey}
              className={classNames.join(" ")}
              onClick={() => handleSelect(dateKey)}
            >
              <span>{formatDateKeyDayNumber(dateKey)}</span>
            </button>
          );
        })}
      </div>

      <div className="cal-popup-footer">
        <button
          type="button"
          className="cal-popup-today-btn"
          onClick={() => handleSelect(todayKey)}
        >
          回到今天
        </button>
      </div>
    </div>,
    document.body
  );
}
