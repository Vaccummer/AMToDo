import { useEffect, useMemo, useState } from "react";
import type { AMToDoApi, ScheduleItem } from "../api/client";
import {
  addDays,
  formatDay,
  formatTime,
  formatWeekday,
  startOfLocalDayEpoch
} from "../lib/time";

type Props = {
  api: AMToDoApi;
};

const HOURS = Array.from({ length: 18 }, (_, index) => index + 6);

export function ScheduleView({ api }: Props) {
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [status, setStatus] = useState<string>("加载中");
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(new Date(), index)), []);

  useEffect(() => {
    const start = startOfLocalDayEpoch(days[0]);
    const end = startOfLocalDayEpoch(addDays(days[6], 1));
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

  return (
    <div className="schedule-view">
      <div className="schedule-grid">
        <div className="schedule-corner" />
        {days.map((day) => (
          <div className="schedule-day-header" key={day.toISOString()}>
            <span>{formatWeekday(day)}</span>
            <strong>{formatDay(day)}</strong>
          </div>
        ))}
        {HOURS.map((hour) => (
          <TimeRow key={hour} hour={hour} days={days} items={items} />
        ))}
      </div>
      {status ? <div className="empty-state schedule-status">{status}</div> : null}
    </div>
  );
}

function TimeRow({ hour, days, items }: { hour: number; days: Date[]; items: ScheduleItem[] }) {
  return (
    <>
      <div className="time-label">{hour.toString().padStart(2, "0")}:00</div>
      {days.map((day) => {
        const start = startOfLocalDayEpoch(day) + hour * 3600;
        const end = start + 3600;
        const hits = items.filter((item) => item.start_at < end && item.end_at > start);
        return (
          <div className="schedule-cell" key={`${day.toISOString()}-${hour}`}>
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
