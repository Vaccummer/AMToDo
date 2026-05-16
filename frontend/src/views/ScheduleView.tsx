import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { AMToDoApi, ScheduleItem } from "../api/client";
import {
  addDaysToDateKey,
  dateKeyFromDate,
  dateKeyFromEpoch,
  formatTime,
  startOfWeekDateKey,
  startOfDateKeyEpoch,
  weekOfMonth
} from "../lib/time";
import { CalendarPopup } from "./CalendarPopup";
import { ContextMenu, TrashIcon } from "./ContextMenu";
import { DateBar } from "./DateBar";
import { useConfirm } from "./ConfirmDialog";
import { ScheduleCreateModal } from "./ScheduleCreateModal";
import { ScheduleDetailModal } from "./ScheduleDetailModal";
import scheduleNormalIcon from "../assets/schedule-normal.svg";
import scheduleFullIcon from "../assets/schedule-full.svg";

type Props = {
  api: AMToDoApi;
  startHour?: number;
  endHour?: number;
  slotMinutes?: number;
  weekStart?: number;
  cachedDateKey?: string;
  onDateChange?: (dateKey: string) => void;
};

const HOUR_HEIGHT = 64;
const EVENT_COLOR_COUNT = 5;
const SLOT_MINUTE_OPTIONS = [15, 30, 45, 60];

type ScheduleTextMode = "tiny" | "mini" | "mid" | "full";

type ScheduleSlot = {
  key: string;
  minutes: number;
  label: string;
};

type RenderedScheduleBlock = {
  item: ScheduleItem;
  top: number;
  height: number;
  colorClass: string;
  textMode: ScheduleTextMode;
  titleLines: number;
};

type ScheduleEditPointerMode = "move" | "resize-start" | "resize-end";

type EditingSchedule = {
  id: number;
  original: ScheduleItem;
  draft: ScheduleItem;
  dirty: boolean;
  saving: boolean;
};

type PointerEditState = {
  id: number;
  mode: ScheduleEditPointerMode;
  startClientX: number;
  startClientY: number;
  initialStartAt: number;
  initialEndAt: number;
  initialDayIndex: number;
  initialMinuteOfDay: number;
  durationSeconds: number;
  moved: boolean;
};

const MIN_DURATION_SECONDS = 60;

export function ScheduleView({ api, startHour = 6, endHour = 24, slotMinutes = 30, weekStart = 0, cachedDateKey, onDateChange }: Props) {
  const todayKey = useMemo(() => dateKeyFromDate(new Date()), []);
  const normalizedWeekStart = weekStart === 1 ? 1 : 0;
  const naturalWeekStartKey = useMemo(
    () => startOfWeekDateKey(todayKey, normalizedWeekStart),
    [todayKey, normalizedWeekStart]
  );

  const initDateKey = cachedDateKey ?? todayKey;
  const initTargetWeekStart = startOfWeekDateKey(initDateKey, normalizedWeekStart);
  const initDiff = Math.round((startOfDateKeyEpoch(initTargetWeekStart) - startOfDateKeyEpoch(naturalWeekStartKey)) / 86400);
  const [weekOffset, setWeekOffset] = useState(Math.round(initDiff / 7));
  const [selectedDateKey, setSelectedDateKey] = useState<string>(initDateKey);
  const [showCalendar, setShowCalendar] = useState(false);
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [status, setStatus] = useState<string>("加载中");
  const [fullHours, setFullHours] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [editing, setEditing] = useState<EditingSchedule | null>(null);
  const [editStatus, setEditStatus] = useState<string>("");
  const [contextMenu, setContextMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const [emptyContextMenu, setEmptyContextMenu] = useState<{
    startAt: number;
    endAt: number;
    x: number;
    y: number;
  } | null>(null);
  const [createDraft, setCreateDraft] = useState<{ startAt: number; endAt: number } | null>(null);
  const dateBarRef = useRef<HTMLDivElement>(null);
  const { ask, dialog: confirmDialog } = useConfirm();
  const dayOverlayRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scheduleEventRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const editingRef = useRef<EditingSchedule | null>(null);
  const pointerEditRef = useRef<PointerEditState | null>(null);
  const suppressNextClickRef = useRef(false);
  const [calendarAnchor, setCalendarAnchor] = useState<DOMRect | null>(null);

  const normalizedSlotMinutes = useMemo(
    () => (SLOT_MINUTE_OPTIONS.includes(slotMinutes) ? slotMinutes : 30),
    [slotMinutes]
  );

  const normalizedStartHour = Math.min(23, Math.max(0, Math.trunc(startHour)));
  const normalizedEndHour = Math.min(24, Math.max(normalizedStartHour + 1, Math.trunc(endHour)));
  const visibleStartHour = fullHours ? 0 : normalizedStartHour;
  const visibleEndHour = fullHours ? 24 : normalizedEndHour;

  const slots = useMemo(
    () => buildScheduleSlots(visibleStartHour, visibleEndHour, normalizedSlotMinutes),
    [visibleStartHour, visibleEndHour, normalizedSlotMinutes]
  );

  const weekStartKey = useMemo(
    () => addDaysToDateKey(naturalWeekStartKey, weekOffset * 7),
    [naturalWeekStartKey, weekOffset]
  );

  useEffect(() => { onDateChange?.(selectedDateKey); }, [selectedDateKey, onDateChange]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysToDateKey(weekStartKey, i)),
    [weekStartKey]
  );

  const weekLabel = useMemo(() => {
    const [year, month] = weekStartKey.split("-").map(Number);
    const wn = weekOfMonth(weekStartKey, normalizedWeekStart);
    const labels = ["一", "二", "三", "四", "五", "六"];
    return `${year}年${month}月 第${labels[wn - 1] ?? wn}周`;
  }, [normalizedWeekStart, weekStartKey]);

  const renderItems = useMemo(
    () => (editing ? items.map((item) => (item.id === editing.id ? editing.draft : item)) : items),
    [editing, items]
  );

  const blocksByDay = useMemo(
    () => buildScheduleBlocks(renderItems, days, visibleStartHour, visibleEndHour),
    [renderItems, days, visibleStartHour, visibleEndHour]
  );
  const gridStyle = {
    "--schedule-slot-height": `${(HOUR_HEIGHT * normalizedSlotMinutes) / 60}px`
  } as CSSProperties;

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    scheduleEventRefs.current[editing.id]?.focus();
  }, [editing?.id, editing?.draft.start_at]);

  // Fetch schedules for the displayed week
  useEffect(() => {
    const start = startOfDateKeyEpoch(days[0]);
    const end = startOfDateKeyEpoch(addDaysToDateKey(days[6], 1));
    api
      .listSchedules(start, end)
      .then((result) => {
        setItems(result.schedules);
        setStatus("");
        if (editingRef.current && !result.schedules.some((item) => item.id === editingRef.current?.id)) {
          setEditing(null);
        }
      })
      .catch((error: unknown) => {
        setItems([]);
        setStatus(error instanceof Error ? error.message : "无法加载日程");
      });
  }, [api, days]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const pointerState = pointerEditRef.current;
      if (!pointerState) return;
      event.preventDefault();

      const deltaX = event.clientX - pointerState.startClientX;
      const deltaY = event.clientY - pointerState.startClientY;
      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        pointerState.moved = true;
      }

      const deltaMinutes = Math.round((deltaY / HOUR_HEIGHT) * 60);
      const deltaSeconds = deltaMinutes * 60;
      let nextStartAt = pointerState.initialStartAt;
      let nextEndAt = pointerState.initialEndAt;

      if (pointerState.mode === "move") {
        const dayWidth = dayOverlayRefs.current[days[pointerState.initialDayIndex]]?.getBoundingClientRect().width ?? 1;
        const nextDayIndex = clamp(
          pointerState.initialDayIndex + Math.round(deltaX / Math.max(1, dayWidth)),
          0,
          days.length - 1
        );
        const durationMinutes = Math.max(1, Math.round(pointerState.durationSeconds / 60));
        const nextMinute = clamp(pointerState.initialMinuteOfDay + deltaMinutes, 0, 1440 - durationMinutes);
        nextStartAt = startOfDateKeyEpoch(days[nextDayIndex]) + nextMinute * 60;
        nextEndAt = nextStartAt + pointerState.durationSeconds;
      } else if (pointerState.mode === "resize-start") {
        nextStartAt = Math.min(
          pointerState.initialStartAt + deltaSeconds,
          pointerState.initialEndAt - MIN_DURATION_SECONDS
        );
      } else {
        nextEndAt = Math.max(
          pointerState.initialEndAt + deltaSeconds,
          pointerState.initialStartAt + MIN_DURATION_SECONDS
        );
      }

      updateEditingDraft(pointerState.id, (draft) => ({
        ...draft,
        start_at: nextStartAt,
        end_at: nextEndAt,
        duration: nextEndAt - nextStartAt
      }));
    }

    function handlePointerUp() {
      if (pointerEditRef.current?.moved) {
        suppressNextClickRef.current = true;
      }
      pointerEditRef.current = null;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [days]);

  function prevWeek() {
    void commitEditingSchedule().then(() => {
      setWeekOffset((w) => w - 1);
    });
  }

  function nextWeek() {
    void commitEditingSchedule().then(() => {
      setWeekOffset((w) => w + 1);
    });
  }

  function goToToday() {
    void commitEditingSchedule().then(() => {
      setWeekOffset(0);
      setSelectedDateKey(todayKey);
    });
  }

  function goToDate(dateKey: string) {
    void commitEditingSchedule().then(() => {
      const targetWeekStartKey = startOfWeekDateKey(dateKey, normalizedWeekStart);
      const diffDays = Math.round(
        (startOfDateKeyEpoch(targetWeekStartKey) - startOfDateKeyEpoch(naturalWeekStartKey)) / 86400
      );
      setWeekOffset(Math.round(diffDays / 7));
      setSelectedDateKey(dateKey);
    });
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
      message: "确定将这条日程移入回收站吗？之后可以在 Trash 中恢复。",
      confirmLabel: "移入回收站",
      danger: true,
    });
    if (ok) deleteSchedule(id);
  }

  function scheduleWindowForSlot(dayKey: string, slot: ScheduleSlot): { startAt: number; endAt: number } {
    const startAt = startOfDateKeyEpoch(dayKey) + slot.minutes * 60;
    return {
      startAt,
      endAt: startAt + normalizedSlotMinutes * 60
    };
  }

  function beginCreate(dayKey: string, slot: ScheduleSlot) {
    setSelectedDateKey(dayKey);
    setEmptyContextMenu(null);
    void commitEditingSchedule().then(() => {
      setCreateDraft(scheduleWindowForSlot(dayKey, slot));
    });
  }

  function addSchedule(schedule: ScheduleItem) {
    setItems((prev) => [...prev, schedule].sort((a, b) => a.start_at - b.start_at || a.end_at - b.end_at || a.id - b.id));
  }

  function toggleCalendar() {
    if (!showCalendar && dateBarRef.current) {
      setCalendarAnchor(dateBarRef.current.getBoundingClientRect());
    }
    setShowCalendar((v) => !v);
  }

  function replaceScheduleItem(schedule: ScheduleItem) {
    setItems((prev) =>
      prev
        .map((item) => (item.id === schedule.id ? schedule : item))
        .sort((a, b) => a.start_at - b.start_at || a.end_at - b.end_at || a.id - b.id)
    );
  }

  function beginEditingSchedule(item: ScheduleItem) {
    setEditStatus("");
    setDetailId(null);
    setEditing({
      id: item.id,
      original: item,
      draft: item,
      dirty: false,
      saving: false
    });
    setSelectedDateKey(dateKeyFromEpoch(item.start_at));
  }

  async function commitEditingSchedule(target = editingRef.current, clearWhenDone = true) {
    if (!target) return;
    if (!target.dirty) {
      if (clearWhenDone && editingRef.current?.id === target.id) {
        setEditing(null);
      }
      return;
    }

    if (editingRef.current?.id === target.id) {
      setEditing((prev) => (prev ? { ...prev, saving: true } : prev));
    }
    try {
      const result = await api.updateSchedule(target.id, {
        start_at: target.draft.start_at,
        end_at: target.draft.end_at
      });
      replaceScheduleItem(result.schedule);
      setEditStatus("");
      if (editingRef.current?.id === target.id) {
        if (clearWhenDone) {
          setEditing(null);
        } else {
          setEditing({
            id: result.schedule.id,
            original: result.schedule,
            draft: result.schedule,
            dirty: false,
            saving: false
          });
        }
      }
    } catch (error: unknown) {
      try {
        const fresh = await api.getSchedule(target.id);
        replaceScheduleItem(fresh.schedule);
        if (editingRef.current?.id === target.id) {
          if (clearWhenDone) {
            setEditing(null);
          } else {
            setEditing({
              id: fresh.schedule.id,
              original: fresh.schedule,
              draft: fresh.schedule,
              dirty: false,
              saving: false
            });
          }
        }
      } catch {
        replaceScheduleItem(target.original);
        if (editingRef.current?.id === target.id) {
          setEditing(clearWhenDone ? null : { ...target, draft: target.original, dirty: false, saving: false });
        }
      }
      setEditStatus(error instanceof Error ? `日程保存失败，已恢复服务器状态：${error.message}` : "日程保存失败，已恢复服务器状态");
    }
  }

  function cancelEditingSchedule() {
    const current = editingRef.current;
    if (current?.dirty) {
      replaceScheduleItem(current.original);
    }
    setEditing(null);
    pointerEditRef.current = null;
  }

  function updateEditingDraft(id: number, transform: (draft: ScheduleItem) => ScheduleItem) {
    setEditing((prev) => {
      if (!prev || prev.id !== id || prev.saving) return prev;
      const draft = normalizeScheduleDraft(transform(prev.draft));
      return {
        ...prev,
        draft,
        dirty: draft.start_at !== prev.original.start_at || draft.end_at !== prev.original.end_at
      };
    });
  }

  function handleScheduleClick(item: ScheduleItem) {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    const current = editingRef.current;
    if (current?.id === item.id) return;
    if (current) {
      void commitEditingSchedule(current, true);
    }
    beginEditingSchedule(item);
  }

  function beginPointerEdit(
    event: React.PointerEvent,
    item: ScheduleItem,
    mode: ScheduleEditPointerMode
  ) {
    event.preventDefault();
    event.stopPropagation();
    focusScheduleEvent(event.currentTarget);
    const current = editingRef.current;
    if (current && current.id !== item.id) {
      void commitEditingSchedule(current, true);
    }
    const base = current?.id === item.id ? current.draft : item;
    if (current?.id !== item.id) {
      beginEditingSchedule(base);
    }

    const startDayKey = dateKeyFromEpoch(base.start_at);
    const initialDayIndex = Math.max(0, days.indexOf(startDayKey));
    const dayStart = startOfDateKeyEpoch(days[initialDayIndex] ?? startDayKey);
    pointerEditRef.current = {
      id: base.id,
      mode,
      startClientX: event.clientX,
      startClientY: event.clientY,
      initialStartAt: base.start_at,
      initialEndAt: base.end_at,
      initialDayIndex,
      initialMinuteOfDay: Math.round((base.start_at - dayStart) / 60),
      durationSeconds: Math.max(MIN_DURATION_SECONDS, base.end_at - base.start_at),
      moved: false
    };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  }

  function handleScheduleKeyDown(event: React.KeyboardEvent, item: ScheduleItem) {
    if (editingRef.current?.id !== item.id) return;

    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditingSchedule();
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      openScheduleDetail(item.id);
      return;
    }

    const minuteStep = event.shiftKey ? 5 : 1;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const deltaSeconds = (event.key === "ArrowUp" ? -minuteStep : minuteStep) * 60;
      updateEditingDraft(item.id, (draft) => moveScheduleVertically(draft, deltaSeconds));
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      updateEditingDraft(item.id, (draft) =>
        moveScheduleToAdjacentDay(draft, event.key === "ArrowLeft" ? -1 : 1, days)
      );
      return;
    }

    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      updateEditingDraft(item.id, (draft) => resizeScheduleEnd(draft, minuteStep * 60));
      return;
    }

    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      updateEditingDraft(item.id, (draft) => resizeScheduleEnd(draft, -minuteStep * 60));
    }
  }

  function openScheduleDetail(id: number) {
    const current = editingRef.current;
    if (current?.id === id) {
      void commitEditingSchedule(current, true).then(() => setDetailId(id));
      return;
    }
    setDetailId(id);
  }

  return (
    <div className="schedule-view">
      <DateBar
        ref={dateBarRef}
        title={weekLabel}
        days={days}
        selectedDateKey={selectedDateKey}
        todayKey={todayKey}
        open={showCalendar}
        leftTool={(
          <button
            type="button"
            className="datebar-side-btn"
            onClick={() => setFullHours((v) => !v)}
            title="切换时间范围"
          >
            <img src={fullHours ? scheduleFullIcon : scheduleNormalIcon} alt="" />
          </button>
        )}
        onPrevious={prevWeek}
        onNext={nextWeek}
        onTitleClick={toggleCalendar}
        onToday={goToToday}
        onSelectDate={setSelectedDateKey}
      />

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

      <div className="schedule-grid-scroll">
        <div className={`schedule-grid${editing ? " editing" : ""}`} style={gridStyle}>
          {slots.map((slot) => (
            <TimeRow
              key={slot.key}
              slot={slot}
              days={days}
              onCreate={beginCreate}
              onClick={(dayKey) => {
                setSelectedDateKey(dayKey);
                void commitEditingSchedule();
              }}
              onContextMenu={(dayKey, currentSlot, event) => {
                event.preventDefault();
                setSelectedDateKey(dayKey);
                setContextMenu(null);
                setEmptyContextMenu({
                  ...scheduleWindowForSlot(dayKey, currentSlot),
                  x: event.clientX,
                  y: event.clientY
                });
              }}
            />
          ))}
          <div className="schedule-events-layer">
            {days.map((dayKey, dayIndex) => (
              <div
                className="schedule-day-overlay"
                key={`${dayKey}-events`}
                ref={(node) => {
                  dayOverlayRefs.current[dayKey] = node;
                }}
                style={{ gridColumn: dayIndex + 2 }}
              >
                {(blocksByDay[dayKey] ?? []).map((block) => (
                  <ScheduleEventBlock
                    block={block}
                    key={`${dayKey}-${block.item.id}`}
                    ref={(node) => {
                      scheduleEventRefs.current[block.item.id] = node;
                    }}
                    selected={editing?.id === block.item.id}
                    saving={editing?.id === block.item.id && editing.saving}
                    onClick={() => handleScheduleClick(block.item)}
                    onDoubleClick={() => openScheduleDetail(block.item.id)}
                    onKeyDown={(event) => handleScheduleKeyDown(event, block.item)}
                    onPointerDown={(event) => beginPointerEdit(event, block.item, "move")}
                    onResizePointerDown={(event, mode) => beginPointerEdit(event, block.item, mode)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setEmptyContextMenu(null);
                      setContextMenu({ id: block.item.id, x: e.clientX, y: e.clientY });
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      {status || editStatus ? <div className="empty-state schedule-status">{editStatus || status}</div> : null}

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

      {createDraft ? (
        <ScheduleCreateModal
          api={api}
          startAt={createDraft.startAt}
          endAt={createDraft.endAt}
          onClose={() => setCreateDraft(null)}
          onCreate={addSchedule}
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
              action: () => openScheduleDetail(contextMenu.id)
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
      {emptyContextMenu ? (
        <ContextMenu
          x={emptyContextMenu.x}
          y={emptyContextMenu.y}
          items={[
            {
              label: "新建日程",
              icon: <PlusIcon />,
              action: () => {
                setCreateDraft({
                  startAt: emptyContextMenu.startAt,
                  endAt: emptyContextMenu.endAt
                });
              }
            }
          ]}
          onClose={() => setEmptyContextMenu(null)}
        />
      ) : null}
      {confirmDialog}
    </div>
  );
}

function TimeRow({ slot, days, onCreate, onClick, onContextMenu }: {
  slot: ScheduleSlot;
  days: string[];
  onCreate: (dayKey: string, slot: ScheduleSlot) => void;
  onClick: (dayKey: string) => void;
  onContextMenu: (dayKey: string, slot: ScheduleSlot, event: React.MouseEvent) => void;
}) {
  return (
    <>
      <div className="time-label">{slot.label}</div>
      {days.map((dayKey) => (
        <div
          className="schedule-cell"
          key={`${dayKey}-${slot.key}`}
          onClick={() => onClick(dayKey)}
          onDoubleClick={() => onCreate(dayKey, slot)}
          onContextMenu={(event) => onContextMenu(dayKey, slot, event)}
        />
      ))}
    </>
  );
}

function buildScheduleSlots(startHour: number, endHour: number, slotMinutes: number): ScheduleSlot[] {
  const totalMinutes = Math.max(0, (endHour - startHour) * 60);
  const count = Math.ceil(totalMinutes / slotMinutes);
  return Array.from({ length: count }, (_, index) => {
    const minutes = startHour * 60 + index * slotMinutes;
    return {
      key: String(minutes),
      minutes,
      label: formatSlotLabel(minutes)
    };
  });
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function formatSlotLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const ScheduleEventBlock = forwardRef<HTMLButtonElement, {
  block: RenderedScheduleBlock;
  selected?: boolean;
  saving?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onResizePointerDown?: (e: React.PointerEvent, mode: ScheduleEditPointerMode) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}>(function ScheduleEventBlock({ block, selected, saving, onClick, onDoubleClick, onKeyDown, onPointerDown, onResizePointerDown, onContextMenu }, ref) {
  const style = {
    top: `${block.top}px`,
    height: `${block.height}px`,
    "--title-lines": block.titleLines
  } as CSSProperties & Record<"--title-lines", number>;
  const className = [
    "schedule-event",
    block.colorClass,
    block.textMode,
    selected ? "selected" : "",
    saving ? "saving" : ""
  ].filter(Boolean).join(" ");
  const timeText = `${formatTime(block.item.start_at)}-${formatTime(block.item.end_at)}`;

  return (
    <button
      type="button"
      className={className}
      ref={ref}
      style={style}
      title={`${timeText} ${block.item.title}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      aria-pressed={selected}
    >
      {selected ? (
        <span
          className="schedule-resize-handle top"
          onPointerDown={(event) => onResizePointerDown?.(event, "resize-start")}
          aria-hidden="true"
        />
      ) : null}
      {block.textMode === "tiny" ? null : (
        <>
          {(block.textMode === "mid" || block.textMode === "full") ? (
            <span className="schedule-event-time">{timeText}</span>
          ) : null}
          <strong className="schedule-event-title">{block.item.title}</strong>
        </>
      )}
      {selected ? (
        <span
          className="schedule-resize-handle bottom"
          onPointerDown={(event) => onResizePointerDown?.(event, "resize-end")}
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
});

function normalizeScheduleDraft(item: ScheduleItem): ScheduleItem {
  const startAt = Math.trunc(item.start_at);
  const endAt = Math.max(startAt + MIN_DURATION_SECONDS, Math.trunc(item.end_at));
  return {
    ...item,
    start_at: startAt,
    end_at: endAt,
    duration: endAt - startAt
  };
}

function moveScheduleVertically(item: ScheduleItem, deltaSeconds: number): ScheduleItem {
  const duration = Math.max(MIN_DURATION_SECONDS, item.end_at - item.start_at);
  const dayKey = dateKeyFromEpoch(item.start_at);
  const dayStart = startOfDateKeyEpoch(dayKey);
  const maxStart = dayStart + 86400 - duration;
  const nextStart = clamp(item.start_at + deltaSeconds, dayStart, Math.max(dayStart, maxStart));
  return {
    ...item,
    start_at: nextStart,
    end_at: nextStart + duration,
    duration
  };
}

function moveScheduleToAdjacentDay(item: ScheduleItem, deltaDays: number, days: string[]): ScheduleItem {
  const dayKey = dateKeyFromEpoch(item.start_at);
  const currentIndex = days.indexOf(dayKey);
  if (currentIndex < 0) return item;
  const nextIndex = clamp(currentIndex + deltaDays, 0, days.length - 1);
  if (nextIndex === currentIndex) return item;
  const deltaSeconds = startOfDateKeyEpoch(days[nextIndex]) - startOfDateKeyEpoch(days[currentIndex]);
  return {
    ...item,
    start_at: item.start_at + deltaSeconds,
    end_at: item.end_at + deltaSeconds
  };
}

function resizeScheduleEnd(item: ScheduleItem, deltaSeconds: number): ScheduleItem {
  const endAt = Math.max(item.start_at + MIN_DURATION_SECONDS, item.end_at + deltaSeconds);
  return {
    ...item,
    end_at: endAt,
    duration: endAt - item.start_at
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function focusScheduleEvent(target: EventTarget) {
  if (!(target instanceof HTMLElement)) return;
  const button = target.closest<HTMLButtonElement>(".schedule-event");
  button?.focus();
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
