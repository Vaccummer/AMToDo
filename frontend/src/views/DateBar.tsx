import { forwardRef, type ReactNode } from "react";
import { formatDateKeyDay, formatDateKeyWeekday } from "../lib/time";
import { useI18n } from "../i18n";
import leftIcon from "../assets/left.svg";
import rightIcon from "../assets/right.svg";
import toTodayIcon from "../assets/ToToday.svg";

type Props = {
  title: string;
  days: string[];
  selectedDateKey: string;
  todayKey: string;
  open: boolean;
  leftTool?: ReactNode;
  onPrevious: () => void;
  onNext: () => void;
  onTitleClick: () => void;
  onToday: () => void;
  onSelectDate: (dateKey: string) => void;
};

export const DateBar = forwardRef<HTMLDivElement, Props>(function DateBar(
  {
    title,
    days,
    selectedDateKey,
    todayKey,
    open,
    leftTool,
    onPrevious,
    onNext,
    onTitleClick,
    onToday,
    onSelectDate,
  },
  ref
) {
  const { t } = useI18n();
  return (
    <div className="datebar" ref={ref}>
      <div className="datebar-nav">
        <button type="button" className="datebar-nav-btn" aria-label={t("common.previousWeek")} onClick={onPrevious}>
          <img src={leftIcon} alt="" />
        </button>
        <div className="datebar-center">
          <button type="button" className="datebar-title-btn" onClick={onTitleClick}>
            {title}
            {open ? (
              <svg className="cal-month-arrow" width="14" height="14" viewBox="0 0 100 100">
                <path d="M18 22 H82 Q90 22 86 30 L56 74 Q50 82 44 74 L14 30 Q10 22 18 22 Z" fill="currentColor" />
              </svg>
            ) : null}
          </button>
          <button
            type="button"
            className="datebar-today-btn"
            aria-label={t("common.backToToday")}
            onClick={onToday}
            disabled={selectedDateKey === todayKey}
          >
            <img src={toTodayIcon} alt="" />
          </button>
        </div>
        <button type="button" className="datebar-nav-btn" aria-label={t("common.nextWeek")} onClick={onNext}>
          <img src={rightIcon} alt="" />
        </button>
      </div>
      <div className="datebar-days">
        <div className="datebar-side">{leftTool}</div>
        {days.map((dayKey) => {
          const isToday = dayKey === todayKey;
          const isSelected = dayKey === selectedDateKey;
          const className = ["datebar-day-surface", isSelected ? "selected" : "", isToday ? "today" : ""]
            .filter(Boolean)
            .join(" ");
          return (
            <div className="datebar-day-slot" key={dayKey}>
              <button
                type="button"
                className={className}
                onClick={() => onSelectDate(dayKey)}
              >
                <span>{formatDateKeyWeekday(dayKey)}</span>
                <strong>{formatDateKeyDay(dayKey)}</strong>
              </button>
            </div>
          );
        })}
        <div className="datebar-reserve" aria-hidden="true" />
      </div>
    </div>
  );
});
