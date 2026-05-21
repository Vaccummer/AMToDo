import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import {
  addDaysToDateKey,
  dateKeyFromParts,
  firstWeekdayOfMonth,
  formatDateKeyDayNumber,
  formatDateKeyWeekday,
  monthLabelFromDateKey
} from "../../lib/time";
import toTodayIcon from "../../assets/ToToday.svg";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hasError?: boolean;
  theme?: "green" | "gold";
  panelAlign?: "left" | "right";
  id?: string;
};

export function DatePicker({ value, onChange, placeholder, hasError, theme = "green", panelAlign = "left", id }: Props) {
  const { t, locale } = useI18n();

  const WEEKDAY_LABELS = [t("common.weekdayMon"), t("common.weekdayTue"), t("common.weekdayWed"), t("common.weekdayThu"), t("common.weekdayFri"), t("common.weekdaySat"), t("common.weekdaySun")];

  function fmtDisplay(dateKey: string): string {
    if (!dateKey) return "";
    const [y, m, d] = dateKey.split("-").map(Number);
    const weekday = formatDateKeyWeekday(dateKey);
    if (locale === "en") {
      return `${m}/${d}/${y} ${weekday}`;
    }
    return `${y}年${m}月${d}日 ${weekday}`;
  }

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const initialParts = value
    ? (([y, m]) => ({ year: Number(y), month: Number(m) }))(value.split("-"))
    : (() => {
        const d = new Date();
        return { year: d.getFullYear(), month: d.getMonth() + 1 };
      })();

  const [viewYear, setViewYear] = useState(initialParts.year);
  const [viewMonth, setViewMonth] = useState(initialParts.month);

  // Reset view when opening
  useEffect(() => {
    if (open) {
      if (value) {
        const [y, m] = value.split("-").map(Number);
        setViewYear(y);
        setViewMonth(m);
      }
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    const timer = setTimeout(() => {
      window.addEventListener("click", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("click", handleClick);
    };
  }, [open]);

  const monthLabel = useMemo(
    () => monthLabelFromDateKey(dateKeyFromParts(viewYear, viewMonth, 1)),
    [viewYear, viewMonth]
  );

  const days = useMemo(() => {
    const firstKey = dateKeyFromParts(viewYear, viewMonth, 1);
    const leadDays = firstWeekdayOfMonth(viewYear, viewMonth) === 0
      ? 6
      : firstWeekdayOfMonth(viewYear, viewMonth) - 1;
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
    if (viewMonth === 1) { setViewYear((y) => y - 1); setViewMonth(12); }
    else { setViewMonth((m) => m - 1); }
  }

  function nextMonth() {
    if (viewMonth === 12) { setViewYear((y) => y + 1); setViewMonth(1); }
    else { setViewMonth((m) => m + 1); }
  }

  const todayYear = useMemo(() => new Date().getFullYear(), []);
  const todayMonth = useMemo(() => new Date().getMonth() + 1, []);

  function goToToday() {
    setViewYear(todayYear);
    setViewMonth(todayMonth);
  }

  function handleSelect(dateKey: string) {
    onChange(dateKey);
    setOpen(false);
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange("");
  }

  const todayKey = useMemo(() => {
    const d = new Date();
    return dateKeyFromParts(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }, []);

  const display = fmtDisplay(value);

  return (
    <div className="date-picker" ref={containerRef}>
      <div
        className={`date-picker-field${hasError ? " error" : ""}${open ? " open" : ""} theme-${theme}`}
        onClick={() => setOpen(!open)}
        id={id}
        tabIndex={0}
        role="combobox"
        aria-expanded={open}
      >
        <svg
          className="date-picker-icon"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span className={`date-picker-text${display ? "" : " placeholder"}`}>
          {display || placeholder || t("common.selectDate")}
        </span>
        {value ? (
          <button
            type="button"
            className="date-picker-clear"
            onClick={handleClear}
            aria-label={t("common.clearDate")}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        ) : (
          <svg
            className="date-picker-chevron"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </div>

      {open ? (
        <div className={`date-picker-panel theme-${theme} align-${panelAlign}`}>
          <div className="dp-panel-header">
            <button type="button" className="dp-nav" aria-label={t("common.previousMonth")} onClick={prevMonth}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span className="dp-panel-label">{monthLabel}</span>
            <button type="button" className="dp-nav" aria-label={t("common.nextMonth")} onClick={nextMonth}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>

          <div className="dp-weekdays">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>

          <div className="dp-grid">
            {days.map(({ dateKey, isCurrentMonth }) => {
              const isToday = dateKey === todayKey;
              const isSelected = dateKey === value;
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
            <button
              type="button"
              className="dp-today-btn"
              onClick={goToToday}
            >
              <img src={toTodayIcon} alt="" />
              {t("common.backToToday")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
