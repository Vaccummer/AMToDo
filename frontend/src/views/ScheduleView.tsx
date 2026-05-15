import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
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
import { ContextMenu, TrashIcon } from "./ContextMenu";
import { useConfirm } from "./ConfirmDialog";
import { ScheduleDetailModal } from "./ScheduleDetailModal";
import leftIcon from "../assets/left.svg";
import rightIcon from "../assets/right.svg";
import toTodayIcon from "../assets/ToToday.svg";
import scheduleNormalIcon from "../assets/schedule-normal.svg";
import scheduleFullIcon from "../assets/schedule-full.svg";

type Props = {
  api: AMToDoApi;
  startHour?: number;
  endHour?: number;
  slotMinutes?: number;
  weekStart?: number;
};

const HOUR_HEIGHT = 64;
const EVENT_COLOR_COUNT = 5;

type ScheduleTextMode = "tiny" | "mini" | "mid" | "full";

type RenderedScheduleBlock = {
  item: ScheduleItem;
  top: number;
  height: number;
  colorClass: string;
  textMode: ScheduleTextMode;
  titleLines: number;
};

export function ScheduleView({ api, startHour = 6, endHour = 24, slotMinutes: _slotMinutes = 30, weekStart = 0 }: Props) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDateKey, setSelectedDateKey] = useState<string>(dateKeyFromDate(new Date()));
  const [showCalendar, setShowCalendar] = useState(false);
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [status, setStatus] = useState<string>("加载中");
  const [fullHours, setFullHours] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const weekLabelRef = useRef<HTMLDivElement>(null);
  const { ask, dialog: confirmDialog } = useConfirm();
  const dayHeadersRef = useRef<HTMLDivElement>(null);
  const [calendarAnchor, setCalendarAnchor] = useState<DOMRect | null>(null);

  const hours = useMemo(
    () => Array.from({ length: fullHours ? 24 : endHour - startHour }, (_, i) => i + (fullHours ? 0 : startHour)),
    [fullHours, startHour, endHour]
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

  const visibleStartHour = fullHours ? 0 : startHour;
  const blocksByDay = useMemo(
    () => buildScheduleBlocks(items, days, visibleStartHour, endHour),
    [items, days, visibleStartHour, endHour]
  );
  const gridStyle = {
    "--schedule-hour-height": `${HOUR_HEIGHT}px`
  } as CSSProperties;

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

  async function deleteSchedule(id: number) {
    try {
      await api.deleteSchedule(id);
    } catch {
      // keep going
    }
    if (detailId === id) setDetailId(null);
    if (contextMenu?.id === id) setContextMenu(null);
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  async function askDeleteSchedule(id: number) {
    const ok = await ask({
      title: "删除日程",
      message: "确定删除这条日程吗？此操作不可撤销。",
      confirmLabel: "删除",
      danger: true,
    });
    if (ok) deleteSchedule(id);
  }

  function toggleCalendar() {
    if (!showCalendar && dayHeadersRef.current) {
      setCalendarAnchor(dayHeadersRef.current.getBoundingClientRect());
    }
    setShowCalendar((v) => !v);
  }

  return (
    <div className="schedule-view">
      <div className="schedule-week-header" ref={weekLabelRef}>
        <button type="button" className="cal-nav" aria-label="上一周" onClick={prevWeek}>
          <img src={leftIcon} alt="" />
        </button>
        <div className="schedule-week-center">
          <button type="button" className="cal-month-label" onClick={toggleCalendar}>
            {weekLabel}
            {showCalendar ? (
              <svg className="cal-month-arrow" width="14" height="14" viewBox="0 0 100 100">
                <path d="M18 22 H82 Q90 22 86 30 L56 74 Q50 82 44 74 L14 30 Q10 22 18 22 Z" fill="currentColor" />
              </svg>
            ) : null}
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
        <button type="button" className="cal-nav" aria-label="下一周" onClick={nextWeek}>
          <img src={rightIcon} alt="" />
        </button>
      </div>

      {showCalendar && calendarAnchor ? (
        <CalendarPopup
          selectedDateKey={selectedDateKey}
          todayKey={todayKey}
          anchorRect={calendarAnchor}
          onSelect={goToDate}
          onClose={() => setShowCalendar(false)}
          weekStart={weekStart}
        />
      ) : null}

      <div className="schedule-day-headers" ref={dayHeadersRef}>
        <button
          type="button"
          className="schedule-corner-btn"
          onClick={() => setFullHours((v) => !v)}
          title="切换时间范围"
        >
          <img src={fullHours ? scheduleFullIcon : scheduleNormalIcon} alt="" />
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
        <div className="schedule-grid" style={gridStyle}>
          {hours.map((hour) => (
            <TimeRow key={hour} hour={hour} days={days} />
          ))}
          <div className="schedule-events-layer">
            {days.map((dayKey, dayIndex) => (
              <div
                className="schedule-day-overlay"
                key={`${dayKey}-events`}
                style={{ gridColumn: dayIndex + 2 }}
              >
                {(blocksByDay[dayKey] ?? []).map((block) => (
                  <ScheduleEventBlock
                    block={block}
                    key={`${dayKey}-${block.item.id}`}
                    onClick={() => setDetailId(block.item.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu({ id: block.item.id, x: e.clientX, y: e.clientY });
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      {status ? <div className="empty-state schedule-status">{status}</div> : null}

      {detailId != null ? (
        <ScheduleDetailModal
          schedule={items.find((s) => s.id === detailId)!}
          api={api}
          onClose={() => setDetailId(null)}
          onDelete={(id) => deleteSchedule(id)}
          onUpdate={(updated) => {
            setItems((prev) =>
              prev.map((item) => (item.id === updated.id ? updated : item))
            );
          }}
        />
      ) : null}

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            {
              label: "编辑",
              icon: (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              ),
              action: () => setDetailId(contextMenu.id)
            },
            {
              label: "删除",
              icon: <TrashIcon />,
              danger: true,
              action: () => askDeleteSchedule(contextMenu.id)
            }
          ]}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}

function TimeRow({ hour, days }: {
  hour: number;
  days: string[];
}) {
  return (
    <>
      <div className="time-label">{hour.toString().padStart(2, "0")}:00</div>
      {days.map((dayKey) => (
        <div className="schedule-cell" key={`${dayKey}-${hour}`} />
      ))}
    </>
  );
}

function ScheduleEventBlock({ block, onClick, onContextMenu }: {
  block: RenderedScheduleBlock;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const style = {
    top: `${block.top}px`,
    height: `${block.height}px`,
    "--title-lines": block.titleLines
  } as CSSProperties & Record<"--title-lines", number>;
  const className = ["schedule-event", block.colorClass, block.textMode].join(" ");
  const timeText = `${formatTime(block.item.start_at)}-${formatTime(block.item.end_at)}`;

  return (
    <button
      type="button"
      className={className}
      style={style}
      title={`${timeText} ${block.item.title}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {block.textMode === "tiny" ? null : (
        <>
          {(block.textMode === "mid" || block.textMode === "full") ? (
            <span className="schedule-event-time">{timeText}</span>
          ) : null}
          <strong className="schedule-event-title">{block.item.title}</strong>
        </>
      )}
    </button>
  );
}

function buildScheduleBlocks(
  items: ScheduleItem[],
  days: string[],
  visibleStartHour: number,
  visibleEndHour: number
): Record<string, RenderedScheduleBlock[]> {
  return Object.fromEntries(
    days.map((dayKey) => {
      const dayStart = startOfDateKeyEpoch(dayKey);
      const visibleStart = dayStart + visibleStartHour * 3600;
      const visibleEnd = dayStart + visibleEndHour * 3600;
      const blocks = items
        .filter((item) => item.start_at < visibleEnd && item.end_at > visibleStart)
        .sort((a, b) => a.start_at - b.start_at || a.end_at - b.end_at || a.id - b.id)
        .map((item, index) => {
          const clippedStart = Math.max(item.start_at, visibleStart);
          const clippedEnd = Math.min(item.end_at, visibleEnd);
          const top = ((clippedStart - visibleStart) / 3600) * HOUR_HEIGHT;
          const height = Math.max(2, ((clippedEnd - clippedStart) / 3600) * HOUR_HEIGHT);
          return {
            item,
            top,
            height,
            colorClass: `event-color-${index % EVENT_COLOR_COUNT}`,
            textMode: textModeForHeight(height),
            titleLines: titleLinesForHeight(height)
          };
        });
      return [dayKey, blocks];
    })
  );
}

function textModeForHeight(height: number): ScheduleTextMode {
  if (height < 18) return "tiny";
  if (height < 34) return "mini";
  if (height < 58) return "mid";
  return "full";
}

function titleLinesForHeight(height: number): number {
  if (height < 58) return 1;
  return Math.max(1, Math.min(4, Math.floor((height - 24) / 18)));
}
