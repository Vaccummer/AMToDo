import { useEffect, useMemo, useRef, useState } from "react";
import type { AMToDoApi, ScheduleItem } from "../api/client";
import {
  addDaysToDateKey,
  dateKeyFromDate,
  formatDateKeyDay,
  formatDateKeyWeekday,
  formatTime,
  mondayOfDateKey,
  startOfDateKeyEpoch,
  weekOfMonth
} from "../lib/time";
import { CalendarPopup } from "./CalendarPopup";
import leftIcon from "../assets/left.svg";
import rightIcon from "../assets/right.svg";
import toTodayIcon from "../assets/ToToday.svg";

type Props = {
  api: AMToDoApi;
};

export function ScheduleView({ api }: Props) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDateKey, setSelectedDateKey] = useState<string>(dateKeyFromDate(new Date()));
  const [showCalendar, setShowCalendar] = useState(false);
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [status, setStatus] = useState<string>("加载中");
  const [fullHours, setFullHours] = useState(false);
  const weekLabelRef = useRef<HTMLDivElement>(null);
  const [calendarAnchor, setCalendarAnchor] = useState<DOMRect | null>(null);

  const hours = useMemo(
    () => Array.from({ length: fullHours ? 24 : 18 }, (_, i) => i + (fullHours ? 0 : 6)),
    [fullHours]
  );

  const todayKey = useMemo(() => dateKeyFromDate(new Date()), []);

  const naturalMonday = useMemo(() => mondayOfDateKey(todayKey), [todayKey]);

  const weekMondayKey = useMemo(
    () => addDaysToDateKey(naturalMonday, weekOffset * 7),
    [naturalMonday, weekOffset]
  );

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysToDateKey(weekMondayKey, i)),
    [weekMondayKey]
  );

  const weekLabel = useMemo(() => {
    const [year, month] = weekMondayKey.split("-").map(Number);
    const wn = weekOfMonth(weekMondayKey);
    const labels = ["一", "二", "三", "四", "五", "六"];
    return `${year}年${month}月 第${labels[wn - 1] ?? wn}周`;
  }, [weekMondayKey]);

  const selectedInView = days.includes(selectedDateKey);

  // Fetch schedules for the displayed week
  useEffect(() => {
    const start = startOfDateKeyEpoch(days[0]);
    const end = startOfDateKeyEpoch(addDaysToDateKey(days[6], 1));
    api
      .listSchedules(start, end)
      .then((result) => {
        setItems(result.schedules);
        setStatus("");
      })
      .catch((error: unknown) => {
        setItems([]);
        setStatus(error instanceof Error ? error.message : "无法加载日程");
      });
  }, [api, days]);

  function prevWeek() {
    setWeekOffset((w) => w - 1);
  }

  function nextWeek() {
    setWeekOffset((w) => w + 1);
  }

  function goToToday() {
    setWeekOffset(0);
    setSelectedDateKey(todayKey);
  }

  function goToDate(dateKey: string) {
    const targetMonday = mondayOfDateKey(dateKey);
    const diffDays = Math.round(
      (startOfDateKeyEpoch(targetMonday) - startOfDateKeyEpoch(naturalMonday)) / 86400
    );
    setWeekOffset(Math.round(diffDays / 7));
    setSelectedDateKey(dateKey);
  }

  function toggleCalendar() {
    if (!showCalendar && weekLabelRef.current) {
      setCalendarAnchor(weekLabelRef.current.getBoundingClientRect());
    }
    setShowCalendar((v) => !v);
  }

  return (
    <div className="schedule-view">
      <div className="schedule-week-header" ref={weekLabelRef}>
        <button type="button" className="cal-nav" aria-label="上一周" onClick={prevWeek}>
          <img src={leftIcon} alt="" />
        </button>
        <button type="button" className="cal-month-label" onClick={toggleCalendar}>
          {weekLabel}
          <svg className="cal-month-arrow" width="14" height="14" viewBox="0 0 100 100">
            {showCalendar ? (
              <path d="M18 22 H82 Q90 22 86 30 L56 74 Q50 82 44 74 L14 30 Q10 22 18 22 Z" fill="currentColor" />
            ) : (
              <path d="M18 78 H82 Q90 78 86 70 L56 26 Q50 18 44 26 L14 70 Q10 78 18 78 Z" fill="currentColor" />
            )}
          </svg>
        </button>
        <button type="button" className="cal-nav" aria-label="下一周" onClick={nextWeek}>
          <img src={rightIcon} alt="" />
        </button>
        <button
          type="button"
          className="cal-today"
          aria-label="回到今天"
          onClick={goToToday}
          disabled={weekOffset === 0 && selectedDateKey === todayKey}
        >
          <img src={toTodayIcon} alt="" />
        </button>
      </div>

      {showCalendar && calendarAnchor ? (
        <CalendarPopup
          selectedDateKey={selectedDateKey}
          todayKey={todayKey}
          anchorRect={calendarAnchor}
          onSelect={goToDate}
          onClose={() => setShowCalendar(false)}
        />
      ) : null}

      <div className="schedule-day-headers">
        <button
          type="button"
          className="schedule-corner-btn"
          onClick={() => setFullHours((v) => !v)}
          title="切换时间范围"
        >
          {fullHours ? "00-24" : "06-24"}
        </button>
        {days.map((dayKey) => {
          const isToday = dayKey === todayKey;
          const isSelected = dayKey === selectedDateKey;
          const cls = [
            "schedule-day-header",
            isToday ? "today" : "",
            isSelected ? "selected-col" : ""
          ].filter(Boolean).join(" ");
          return (
            <button
              type="button"
              className={cls}
              key={dayKey}
              onClick={() => setSelectedDateKey(dayKey)}
            >
              <span>{formatDateKeyWeekday(dayKey)}</span>
              <strong>{formatDateKeyDay(dayKey)}</strong>
            </button>
          );
        })}
      </div>

      <div className="schedule-grid-scroll">
        <div className="schedule-grid">
          {hours.map((hour) => (
            <TimeRow key={hour} hour={hour} days={days} items={items} />
          ))}
        </div>
      </div>
      {status ? <div className="empty-state schedule-status">{status}</div> : null}
    </div>
  );
}

function TimeRow({ hour, days, items }: {
  hour: number;
  days: string[];
  items: ScheduleItem[];
}) {
  return (
    <>
      <div className="time-label">{hour.toString().padStart(2, "0")}:00</div>
      {days.map((dayKey) => {
        const dayStart = startOfDateKeyEpoch(dayKey);
        const start = dayStart + hour * 3600;
        const end = start + 3600;
        const hits = items.filter((item) => item.start_at < end && item.end_at > start);
        return (
          <div className="schedule-cell" key={`${dayKey}-${hour}`}>
            {hits.map((item) => (
              <button type="button" className="schedule-block" key={item.id}>
                <span>
                  {formatTime(item.start_at)}-{formatTime(item.end_at)}
                </span>
                <strong>{item.title}</strong>
              </button>
            ))}
          </div>
        );
      })}
    </>
  );
}
