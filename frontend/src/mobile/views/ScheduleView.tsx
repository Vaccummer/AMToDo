import { Fragment, forwardRef, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { AMToDoApi, ScheduleItem, NotificationItem } from "../../api/client";
import type { ConnectionStatusSnapshot } from "../../api/connection-status";
import type { UISettings } from "../../lib/settings";
import {
  addDaysToDateKey,
  dateKeyFromDate,
  dateKeyFromEpoch,
  formatDateKeyWeekday,
  formatTime,
  monthLabelFromDateKey,
  startOfWeekDateKey,
  startOfDateKeyEpoch,
  weekOfMonth
} from "../../lib/time";
import { CalendarPopup } from "./CalendarPopup";
import { ContextMenu, TrashIcon } from "./ContextMenu";
import { DateBar } from "./DateBar";
import { useConfirm } from "./ConfirmDialog";
import { ScheduleCreateModal } from "./ScheduleCreateModal";
import { ScheduleDetailModal } from "./ScheduleDetailModal";
import { NotifyFormModal } from "./NotifyFormModal";
import { getEventColors, getNotifyEventColors } from "../../themes";
import { useGlassTooltip, GlassTooltip } from "../../hooks/useGlassTooltip";
import { useI18n } from "../../i18n";

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function formatTimeShort(epoch: number): string {
  const d = new Date(epoch * 1000);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type TimeOfDay = "morning" | "afternoon" | "evening";

function getTimeOfDay(startAt: number): TimeOfDay {
  const hour = new Date(startAt * 1000).getHours();
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function groupByTimeOfDay(
  items: { type: "schedule" | "notify"; item: ScheduleItem | NotificationItem; color: string }[]
): Record<TimeOfDay, typeof items> {
  const result: Record<TimeOfDay, typeof items> = {
    morning: [],
    afternoon: [],
    evening: [],
  };
  for (const entry of items) {
    const ts =
      entry.type === "schedule"
        ? (entry.item as ScheduleItem).start_at
        : (entry.item as NotificationItem).trigger_at;
    result[getTimeOfDay(ts)].push(entry);
  }
  return result;
}

type Props = {
  api: AMToDoApi;
  settings: UISettings;
  startHour?: number;
  endHour?: number;
  slotMinutes?: number;
  weekStart?: number;
  cachedDateKey?: string;
  onDateChange?: (dateKey: string) => void;
  onNavigate?: (type: "todo" | "schedule", id: number, action: "jump" | "edit") => void;
  pendingAction?: { type: "todo" | "schedule" | "notify"; id: number; action: "jump" | "edit"; dateKey?: string } | null;
  onPendingActionConsumed?: () => void;
  onOpenSettings?: (focusTarget?: "url" | "token") => void;
  connectionStatus?: ConnectionStatusSnapshot;
  onConnectionError?: (kind: "network" | "token" | null, message?: string) => void;
};

const HOUR_HEIGHT = 64;
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
  backgroundColor: string;
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

type EditingNotify = {
  id: number;
  original: NotificationItem;
  draft: NotificationItem;
  dirty: boolean;
  saving: boolean;
};

type NotifyPointerEditState = {
  id: number;
  startClientX: number;
  startClientY: number;
  initialTriggerAt: number;
  initialDayIndex: number;
  initialMinuteOfDay: number;
  moved: boolean;
};

const MIN_DURATION_SECONDS = 60;

export function ScheduleView({ api, settings, startHour = 6, endHour = 24, slotMinutes = 30, weekStart = 0, cachedDateKey, onDateChange, onNavigate, pendingAction, onPendingActionConsumed, onOpenSettings, connectionStatus, onConnectionError }: Props) {
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
  const [isLoading, setIsLoading] = useState(true);
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
  const calendarBtnRef = useRef<HTMLButtonElement>(null);
  const { ask, dialog: confirmDialog } = useConfirm();
  const { t, locale } = useI18n();

  useEffect(() => {
    if (!pendingAction) return;
    if (pendingAction.dateKey) {
      const targetWeekStart = startOfWeekDateKey(pendingAction.dateKey, normalizedWeekStart);
      const diff = Math.round((startOfDateKeyEpoch(targetWeekStart) - startOfDateKeyEpoch(naturalWeekStartKey)) / 86400);
      setWeekOffset(Math.round(diff / 7));
      setSelectedDateKey(pendingAction.dateKey);
    }
    if (pendingAction.action === "edit") {
      if (pendingAction.type === "notify") {
        setNotifyEditId(pendingAction.id);
      } else {
        const item = items.find((s: any) => s.id === pendingAction.id);
        if (item) {
          setDetailId(pendingAction.id);
        }
      }
    }
    onPendingActionConsumed?.();
  }, [pendingAction, items]); // eslint-disable-line react-hooks/exhaustive-deps

  const dayOverlayRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scheduleEventRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const editingRef = useRef<EditingSchedule | null>(null);
  const pointerEditRef = useRef<PointerEditState | null>(null);
  const suppressNextClickRef = useRef(false);
  const [calendarAnchor, setCalendarAnchor] = useState<DOMRect | null>(null);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notifyEditId, setNotifyEditId] = useState<number | null>(null);
  const [notifyContextMenu, setNotifyContextMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  const [editingNotify, setEditingNotify] = useState<EditingNotify | null>(null);
  const editingNotifyRef = useRef<EditingNotify | null>(null);
  const notifyPointerEditRef = useRef<NotifyPointerEditState | null>(null);
  const notifyEventRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const [notifyFormOpen, setNotifyFormOpen] = useState(false);
  const [notifyFormTriggerAt, setNotifyFormTriggerAt] = useState<number | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);

  const dayStripSwipeRef = useRef({ startX: 0, startY: 0, moved: false, cancelled: false });
  const [isDayStripAnimating, setIsDayStripAnimating] = useState(false);
  const agendaSwipeRef = useRef({ startX: 0, startY: 0, moved: false, cancelled: false });
  const [isAgendaAnimating, setIsAgendaAnimating] = useState(false);

  function handleDayStripTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    dayStripSwipeRef.current = { startX: t.clientX, startY: t.clientY, moved: false, cancelled: false };
  }

  function handleDayStripTouchMove(e: React.TouchEvent) {
    const t = e.touches[0];
    const dx = t.clientX - dayStripSwipeRef.current.startX;
    const dy = t.clientY - dayStripSwipeRef.current.startY;
    if (!dayStripSwipeRef.current.cancelled && Math.abs(dy) > 10 && Math.abs(dy) / Math.max(Math.abs(dx), 1) > 1.5) {
      dayStripSwipeRef.current.cancelled = true;
    }
    if (Math.abs(dx) > 5) dayStripSwipeRef.current.moved = true;
  }

  function handleDayStripTouchEnd(e: React.TouchEvent) {
    if (dayStripSwipeRef.current.cancelled || isDayStripAnimating) return;
    const dx = e.changedTouches[0].clientX - dayStripSwipeRef.current.startX;
    if (Math.abs(dx) > 50) {
      setIsDayStripAnimating(true);
      if (dx > 0) prevWeek(); else nextWeek();
      setTimeout(() => setIsDayStripAnimating(false), 300);
    }
  }

  function handleAgendaTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    agendaSwipeRef.current = { startX: t.clientX, startY: t.clientY, moved: false, cancelled: false };
  }

  function handleAgendaTouchMove(e: React.TouchEvent) {
    const t = e.touches[0];
    const dx = t.clientX - agendaSwipeRef.current.startX;
    const dy = t.clientY - agendaSwipeRef.current.startY;
    if (!agendaSwipeRef.current.cancelled && Math.abs(dy) > 10 && Math.abs(dy) / Math.max(Math.abs(dx), 1) > 1.5) {
      agendaSwipeRef.current.cancelled = true;
    }
    if (Math.abs(dx) > 5) agendaSwipeRef.current.moved = true;
  }

  function handleAgendaTouchEnd(e: React.TouchEvent) {
    if (agendaSwipeRef.current.cancelled || isAgendaAnimating) return;
    const dx = e.changedTouches[0].clientX - agendaSwipeRef.current.startX;
    if (Math.abs(dx) > 50) {
      setIsAgendaAnimating(true);
      if (dx > 0) prevSelectedDay(); else nextSelectedDay();
      setTimeout(() => setIsAgendaAnimating(false), 300);
    }
  }

  useEffect(() => {
    if (!cachedDateKey) return;
    setSelectedDateKey(cachedDateKey);
    const targetWeekStart = startOfWeekDateKey(cachedDateKey, normalizedWeekStart);
    const diff = Math.round((startOfDateKeyEpoch(targetWeekStart) - startOfDateKeyEpoch(naturalWeekStartKey)) / 86400);
    setWeekOffset(Math.round(diff / 7));
  }, [cachedDateKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const normalizedSlotMinutes = useMemo(
    () => (SLOT_MINUTE_OPTIONS.includes(slotMinutes) ? slotMinutes : 30),
    [slotMinutes]
  );

  const normalizedStartHour = Math.min(23, Math.max(0, Math.trunc(startHour)));
  const normalizedEndHour = Math.min(24, Math.max(normalizedStartHour + 1, Math.trunc(endHour)));
  const visibleStartHour = normalizedStartHour;
  const visibleEndHour = normalizedEndHour;

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
    const weekStr = locale === "en" ? ordinal(wn) : String(wn);
    return t("common.weekOfYear", { year, month, week: weekStr });
  }, [normalizedWeekStart, weekStartKey, t, locale]);

  const renderItems = useMemo(
    () => (editing ? items.map((item) => (item.id === editing.id ? editing.draft : item)) : items),
    [editing, items]
  );

  const blocksByDay = useMemo(
    () => buildScheduleBlocks(renderItems, days, visibleStartHour, visibleEndHour),
    [renderItems, days, visibleStartHour, visibleEndHour]
  );

  const notifyRenderItems = useMemo(
    () => (editingNotify ? notifications.map((n) => (n.id === editingNotify.id ? editingNotify.draft : n)) : notifications),
    [editingNotify, notifications]
  );

  const notifyBlocksByDay = useMemo(
    () => buildNotifyBlocks(notifyRenderItems, days, visibleStartHour, visibleEndHour, getNotifyEventColors()),
    [notifyRenderItems, days, visibleStartHour, visibleEndHour]
  );
  const gridStyle = {
    "--schedule-slot-height": `${(HOUR_HEIGHT * normalizedSlotMinutes) / 60}px`
  } as CSSProperties;

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  useEffect(() => {
    editingNotifyRef.current = editingNotify;
  }, [editingNotify]);

  useEffect(() => {
    if (!editing) return;
    scheduleEventRefs.current[editing.id]?.focus();
  }, [editing?.id, editing?.draft.start_at]);

  useEffect(() => {
    if (!editingNotify) return;
    notifyEventRefs.current[editingNotify.id]?.focus();
  }, [editingNotify?.id, editingNotify?.draft.trigger_at]);

  // Fetch schedules for the displayed week
  useEffect(() => {
    setIsLoading(true);
    setItems([]);
    const start = startOfDateKeyEpoch(days[0]);
    const end = startOfDateKeyEpoch(addDaysToDateKey(days[6], 1));
    api
      .listSchedules(start, end)
      .then((result) => {
        setItems(result.schedules);
        onConnectionError?.(null);
        setIsLoading(false);
        if (editingRef.current && !result.schedules.some((item) => item.id === editingRef.current?.id)) {
          setEditing(null);
        }
      })
      .catch((error: unknown) => {
        setItems([]);
        setIsLoading(false);
        if (error instanceof TypeError) {
          onConnectionError?.("network", t("connection.cannotConnectDesc"));
        } else {
          onConnectionError?.("token", error instanceof Error ? error.message : t("connection.authFailed"));
        }
      });
  }, [api, days, refreshKey]);

  // Fetch notifications for the displayed week
  useEffect(() => {
    const start = startOfDateKeyEpoch(days[0]);
    const end = startOfDateKeyEpoch(addDaysToDateKey(days[6], 1));
    api
      .listNotifications({ start_at: start, end_at: end })
      .then((result) => setNotifications(result.notifications))
      .catch(() => setNotifications([]));
  }, [api, days, refreshKey]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const scheduleState = pointerEditRef.current;
      const notifyState = notifyPointerEditRef.current;
      if (!scheduleState && !notifyState) return;
      event.preventDefault();

      if (scheduleState) {
        const deltaX = event.clientX - scheduleState.startClientX;
        const deltaY = event.clientY - scheduleState.startClientY;
        if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
          scheduleState.moved = true;
        }

        const deltaMinutes = Math.round((deltaY / HOUR_HEIGHT) * 60);
        const deltaSeconds = deltaMinutes * 60;
        let nextStartAt = scheduleState.initialStartAt;
        let nextEndAt = scheduleState.initialEndAt;

        if (scheduleState.mode === "move") {
          const dayWidth = dayOverlayRefs.current[days[scheduleState.initialDayIndex]]?.getBoundingClientRect().width ?? 1;
          const nextDayIndex = clamp(
            scheduleState.initialDayIndex + Math.round(deltaX / Math.max(1, dayWidth)),
            0,
            days.length - 1
          );
          const durationMinutes = Math.max(1, Math.round(scheduleState.durationSeconds / 60));
          const nextMinute = clamp(scheduleState.initialMinuteOfDay + deltaMinutes, 0, 1440 - durationMinutes);
          nextStartAt = startOfDateKeyEpoch(days[nextDayIndex]) + nextMinute * 60;
          nextEndAt = nextStartAt + scheduleState.durationSeconds;
        } else if (scheduleState.mode === "resize-start") {
          nextStartAt = Math.min(
            scheduleState.initialStartAt + deltaSeconds,
            scheduleState.initialEndAt - MIN_DURATION_SECONDS
          );
        } else {
          nextEndAt = Math.max(
            scheduleState.initialEndAt + deltaSeconds,
            scheduleState.initialStartAt + MIN_DURATION_SECONDS
          );
        }

        updateEditingDraft(scheduleState.id, (draft) => ({
          ...draft,
          start_at: nextStartAt,
          end_at: nextEndAt,
          duration: nextEndAt - nextStartAt
        }));
      }

      if (notifyState) {
        const deltaX = event.clientX - notifyState.startClientX;
        const deltaY = event.clientY - notifyState.startClientY;
        if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
          notifyState.moved = true;
        }

        const deltaMinutes = Math.round((deltaY / HOUR_HEIGHT) * 60);
        const dayWidth = dayOverlayRefs.current[days[notifyState.initialDayIndex]]?.getBoundingClientRect().width ?? 1;
        const nextDayIndex = clamp(
          notifyState.initialDayIndex + Math.round(deltaX / Math.max(1, dayWidth)),
          0,
          days.length - 1
        );
        const nextMinute = clamp(notifyState.initialMinuteOfDay + deltaMinutes, 0, 1439);
        const nextTriggerAt = startOfDateKeyEpoch(days[nextDayIndex]) + nextMinute * 60;

        updateNotifyDraft(notifyState.id, (draft) => ({
          ...draft,
          trigger_at: nextTriggerAt,
        }));
      }
    }

    function handlePointerUp() {
      if (pointerEditRef.current?.moved || notifyPointerEditRef.current?.moved) {
        suppressNextClickRef.current = true;
      }
      pointerEditRef.current = null;
      notifyPointerEditRef.current = null;
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
    void commitEditingNotify();
    void commitEditingSchedule().then(() => {
      setWeekOffset((w) => w - 1);
    });
  }

  function nextWeek() {
    void commitEditingNotify();
    void commitEditingSchedule().then(() => {
      setWeekOffset((w) => w + 1);
    });
  }

  function goToToday() {
    void commitEditingNotify();
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

  function prevSelectedDay() {
    void commitEditingNotify();
    void commitEditingSchedule().then(() => {
      const newKey = addDaysToDateKey(selectedDateKey, -1);
      const newWeekStart = startOfWeekDateKey(newKey, normalizedWeekStart);
      const diff = Math.round(
        (startOfDateKeyEpoch(newWeekStart) - startOfDateKeyEpoch(naturalWeekStartKey)) / 86400
      );
      setWeekOffset(Math.round(diff / 7));
      setSelectedDateKey(newKey);
    });
  }

  function nextSelectedDay() {
    void commitEditingNotify();
    void commitEditingSchedule().then(() => {
      const newKey = addDaysToDateKey(selectedDateKey, 1);
      const newWeekStart = startOfWeekDateKey(newKey, normalizedWeekStart);
      const diff = Math.round(
        (startOfDateKeyEpoch(newWeekStart) - startOfDateKeyEpoch(naturalWeekStartKey)) / 86400
      );
      setWeekOffset(Math.round(diff / 7));
      setSelectedDateKey(newKey);
    });
  }

  async function deleteSchedule(id: number) {
    try {
      await api.deleteSchedule(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch {
      // Re-query to check if delete actually succeeded on the server
      try {
        const fresh = await api.getSchedule(id);
        replaceScheduleItem(fresh.schedule);
      } catch {
        // Item not found on server, remove locally
        setItems((prev) => prev.filter((item) => item.id !== id));
      }
    }
    if (detailId === id) setDetailId(null);
    if (contextMenu?.id === id) setContextMenu(null);
  }

  async function askDeleteSchedule(id: number) {
    const ok = await ask({
      title: t("schedule.deleteSchedule"),
      message: t("schedule.deleteScheduleConfirm"),
      confirmLabel: t("common.moveToTrash"),
      danger: true,
    });
    if (ok) deleteSchedule(id);
  }

  async function deleteNotification(id: number) {
    try {
      await api.deleteNotification(id);
    } catch {
      // keep going
    }
    if (notifyEditId === id) setNotifyEditId(null);
    if (notifyContextMenu?.id === id) setNotifyContextMenu(null);
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }

  async function askDeleteNotification(id: number) {
    const ok = await ask({
      title: t("schedule.deleteNotification"),
      message: t("schedule.deleteNotificationConfirm"),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (ok) deleteNotification(id);
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

  function toggleCalendar(anchorRect?: DOMRect) {
    if (!showCalendar) {
      setCalendarAnchor(anchorRect ?? dateBarRef.current?.getBoundingClientRect() ?? null);
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
      setEditStatus(error instanceof Error ? `${t("schedule.saveFailedRestore")}: ${error.message}` : t("schedule.saveFailedRestore"));
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

  // ── Notify editing functions ──

  function beginEditingNotify(item: NotificationItem) {
    setNotifyEditId(null);
    setEditingNotify({
      id: item.id,
      original: item,
      draft: item,
      dirty: false,
      saving: false
    });
    setSelectedDateKey(dateKeyFromEpoch(item.trigger_at));
  }

  async function commitEditingNotify(target = editingNotifyRef.current, clearWhenDone = true) {
    if (!target) return;
    if (!target.dirty) {
      if (clearWhenDone && editingNotifyRef.current?.id === target.id) {
        setEditingNotify(null);
      }
      return;
    }
    if (editingNotifyRef.current?.id === target.id) {
      setEditingNotify((prev) => (prev ? { ...prev, saving: true } : prev));
    }
    try {
      const result = await api.updateNotification(target.id, { trigger_at: target.draft.trigger_at });
      replaceNotificationItem(result.notification);
      if (editingNotifyRef.current?.id === target.id) {
        if (clearWhenDone) {
          setEditingNotify(null);
        } else {
          setEditingNotify({
            id: result.notification.id,
            original: result.notification,
            draft: result.notification,
            dirty: false,
            saving: false
          });
        }
      }
    } catch {
      replaceNotificationItem(target.original);
      if (editingNotifyRef.current?.id === target.id) {
        setEditingNotify(clearWhenDone ? null : { ...target, draft: target.original, dirty: false, saving: false });
      }
    }
  }

  function cancelEditingNotify() {
    const current = editingNotifyRef.current;
    if (current?.dirty) {
      replaceNotificationItem(current.original);
    }
    setEditingNotify(null);
    notifyPointerEditRef.current = null;
  }

  function updateNotifyDraft(id: number, transform: (draft: NotificationItem) => NotificationItem) {
    setEditingNotify((prev) => {
      if (!prev || prev.id !== id || prev.saving) return prev;
      const draft = transform(prev.draft);
      return {
        ...prev,
        draft,
        dirty: draft.trigger_at !== prev.original.trigger_at
      };
    });
  }

  function replaceNotificationItem(notification: NotificationItem) {
    setNotifications((prev) =>
      prev
        .map((n) => (n.id === notification.id ? notification : n))
        .sort((a, b) => a.trigger_at - b.trigger_at || a.id - b.id)
    );
  }

  function handleNotifyClick(item: NotificationItem) {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    const current = editingNotifyRef.current;
    if (current?.id === item.id) return;
    if (current) {
      void commitEditingNotify(current, true);
    }
    // Also commit any schedule editing
    if (editingRef.current) {
      void commitEditingSchedule(editingRef.current, true);
    }
    beginEditingNotify(item);
  }

  function beginNotifyPointerEdit(event: React.PointerEvent, item: NotificationItem) {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    target.focus();

    // Commit any schedule editing
    const schedCurrent = editingRef.current;
    if (schedCurrent) {
      void commitEditingSchedule(schedCurrent, true);
    }

    const notifyCurrent = editingNotifyRef.current;
    if (notifyCurrent && notifyCurrent.id !== item.id) {
      void commitEditingNotify(notifyCurrent, true);
    }
    const base = notifyCurrent?.id === item.id ? notifyCurrent.draft : item;
    if (notifyCurrent?.id !== item.id) {
      beginEditingNotify(base);
    }

    const startDayKey = dateKeyFromEpoch(base.trigger_at);
    const initialDayIndex = Math.max(0, days.indexOf(startDayKey));
    const dayStart = startOfDateKeyEpoch(days[initialDayIndex] ?? startDayKey);
    notifyPointerEditRef.current = {
      id: base.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      initialTriggerAt: base.trigger_at,
      initialDayIndex,
      initialMinuteOfDay: Math.round((base.trigger_at - dayStart) / 60),
      moved: false
    };
    target.setPointerCapture(event.pointerId);
  }

  function handleNotifyKeyDown(event: React.KeyboardEvent, item: NotificationItem) {
    const current = editingNotifyRef.current;
    if (!current || current.id !== item.id) return;
    const draft = current.draft;
    const minuteStep = event.shiftKey ? 5 : 1;

    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditingNotify();
    } else if (event.key === "Enter") {
      event.preventDefault();
      void commitEditingNotify(current, true).then(() => setNotifyEditId(item.id));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      updateNotifyDraft(item.id, (d) => moveNotifyVertically(d, -minuteStep * 60));
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      updateNotifyDraft(item.id, (d) => moveNotifyVertically(d, minuteStep * 60));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      updateNotifyDraft(item.id, (d) => moveNotifyToAdjacentDay(d, -1, days));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      updateNotifyDraft(item.id, (d) => moveNotifyToAdjacentDay(d, 1, days));
    }
  }

  function handleScheduleClick(item: ScheduleItem) {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    const current = editingRef.current;
    if (current?.id === item.id) return;
    // Commit any notify editing first
    if (editingNotifyRef.current) {
      void commitEditingNotify(editingNotifyRef.current, true);
    }
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
    // Commit any notify editing first
    if (editingNotifyRef.current) {
      void commitEditingNotify(editingNotifyRef.current, true);
    }
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

  function pseudoHasEvent(dayKey: string, slot: ScheduleSlot): boolean {
    let hash = 0;
    const str = dayKey + slot.key;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % 100 < 30;
  }

  // ── Agenda data computation ──
  const monthLabel = monthLabelFromDateKey(weekStartKey, locale);
  const agendaDays = useMemo(
    () =>
      days.map((dk) => ({
        dateKey: dk,
        dayNum: Number(dk.split("-")[2]),
        weekday: formatDateKeyWeekday(dk, locale),
        isToday: dk === todayKey,
      })),
    [days, todayKey, locale]
  );

  const eventColors = useMemo(() => getEventColors(), []);
  const notifyColors = useMemo(() => getNotifyEventColors(), []);

  const agendaItemsByDay = useMemo(() => {
    const map: Record<string, { type: "schedule" | "notify"; item: ScheduleItem | NotificationItem; color: string }[]> = {};
    for (const dk of days) {
      map[dk] = [];
    }
    for (let i = 0; i < renderItems.length; i++) {
      const item = renderItems[i];
      const dk = dateKeyFromEpoch(item.start_at);
      if (map[dk]) {
        map[dk].push({ type: "schedule", item, color: eventColors[map[dk].filter((e) => e.type === "schedule").length % eventColors.length] });
      }
    }
    for (let i = 0; i < notifyRenderItems.length; i++) {
      const n = notifyRenderItems[i];
      const dk = dateKeyFromEpoch(n.trigger_at);
      if (map[dk]) {
        map[dk].push({ type: "notify", item: n, color: notifyColors[map[dk].filter((e) => e.type === "notify").length % notifyColors.length] });
      }
    }
    for (const dk of days) {
      map[dk].sort((a, b) => {
        const aTime = a.type === "schedule" ? (a.item as ScheduleItem).start_at : (a.item as NotificationItem).trigger_at;
        const bTime = b.type === "schedule" ? (b.item as ScheduleItem).start_at : (b.item as NotificationItem).trigger_at;
        return aTime - bTime;
      });
    }
    return map;
  }, [renderItems, notifyRenderItems, days, eventColors, notifyColors]);

  const agendaStats = useMemo(() => {
    let weekCount = 0;
    const todayItems = agendaItemsByDay[todayKey] ?? [];
    const todayCount = todayItems.filter((e) => e.type === "schedule").length;
    const tomorrowKey = addDaysToDateKey(todayKey, 1);
    const tomorrowItems = agendaItemsByDay[tomorrowKey] ?? [];
    const tomorrowCount = tomorrowItems.filter((e) => e.type === "schedule").length;
    for (const dk of days) {
      weekCount += (agendaItemsByDay[dk] ?? []).filter((e) => e.type === "schedule").length;
    }
    return { weekCount, todayCount, tomorrowCount };
  }, [agendaItemsByDay, days, todayKey]);

  const selectedDayItems = useMemo(
    () => agendaItemsByDay[selectedDateKey] ?? [],
    [agendaItemsByDay, selectedDateKey]
  );

  const groupedItems = useMemo(
    () => groupByTimeOfDay(selectedDayItems),
    [selectedDayItems]
  );

  const nextUpItem = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return selectedDayItems.find(
      (e) => e.type === "schedule" && (e.item as ScheduleItem).start_at >= now
    )?.item as ScheduleItem | undefined;
  }, [selectedDayItems]);

  function handleFabClick() {
    const targetDay = selectedDateKey;
    const now = new Date();
    const targetDate = new Date(now);
    if (dateKeyFromDate(now) !== targetDay) {
      const [y, m, d] = targetDay.split("-").map(Number);
      targetDate.setFullYear(y, m - 1, d);
    }
    const nextHour = new Date(targetDate);
    nextHour.setMinutes(0, 0, 0);
    nextHour.setHours(nextHour.getHours() + 1);
    const startAt = Math.floor(nextHour.getTime() / 1000);
    setCreateDraft({ startAt, endAt: startAt + 3600 });
  }

  return (
    <div className="schedule-view">
      {/* ── F4 Top Block: merged month header + day strip ── */}
      <div className="top-block">
        <div className="top-row">
          <span className="month-title">{monthLabel}</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              ref={calendarBtnRef}
              type="button"
              className="month-btn"
              onClick={(e) => toggleCalendar(e.currentTarget.getBoundingClientRect())}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </button>
          </div>
        </div>
        <div
          className="day-strip"
          onTouchStart={handleDayStripTouchStart}
          onTouchMove={handleDayStripTouchMove}
          onTouchEnd={handleDayStripTouchEnd}
        >
          {agendaDays.map((day) => {
            const hasEvents = (agendaItemsByDay[day.dateKey] ?? []).length > 0;
            return (
              <button
                key={day.dateKey}
                type="button"
                className={`day-cell${day.dateKey === selectedDateKey ? " active" : ""}${day.isToday ? " is-today" : ""}${hasEvents ? " has-event" : ""}`}
                onClick={() => setSelectedDateKey(day.dateKey)}
              >
                <span className="d-name">{day.weekday}</span>
                <span className="d-num">{day.dayNum}</span>
                <div className="d-bar" />
              </button>
            );
          })}
        </div>
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

      {/* ── Agenda Panel with swipe ── */}
      <div
        className="schedule-agenda-panel"
        onTouchStart={handleAgendaTouchStart}
        onTouchMove={handleAgendaTouchMove}
        onTouchEnd={handleAgendaTouchEnd}
      >
        {isLoading ? (
          <>
            <div className="schedule-skel-agenda">
              <div className="schedule-skel-day-header">
                <div className="schedule-skel-day-header-dot" />
                <div className="schedule-skel-day-header-line" />
              </div>
              {Array.from({ length: 3 }, (_, ci) => (
                <div className="schedule-skel-card" key={ci}>
                  <div className="schedule-skel-card-bar" />
                  <div className="schedule-skel-card-body">
                    <div className={`schedule-skel-line${ci % 2 === 0 ? "" : " short"}`} />
                    <div className={`schedule-skel-line${ci % 2 === 0 ? " medium" : " short"}`} />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            {/* Today Summary */}
            <div className="today-summary">
              <div className="ts-left">
                <span className="ts-count">{selectedDayItems.length}</span>
                <span className="ts-label">{locale === "en" ? "events" : "个安排"}</span>
              </div>
              <div className="ts-divider" />
              <div className="ts-next">
                {nextUpItem ? (
                  <>
                    <span className="ts-next-label">{locale === "en" ? "Next up" : "下一个"}</span>
                    <div className="ts-next-title">{nextUpItem.title}</div>
                    <span className="ts-next-time">
                      {formatTimeShort(nextUpItem.start_at)}
                      {nextUpItem.location ? ` · ${nextUpItem.location}` : ""}
                    </span>
                  </>
                ) : (
                  <span className="ts-next-label">{locale === "en" ? "No upcoming events" : "没有即将到来的安排"}</span>
                )}
              </div>
            </div>

            {/* Time-of-day blocks */}
            {(["morning", "afternoon", "evening"] as TimeOfDay[]).map((period) => {
              const periodItems = groupedItems[period];
              return (
                <div className="time-block" key={period}>
                  <div className="block-header">
                    <div className={`block-dot ${period}`} />
                    <span className="block-label">
                      {locale === "en"
                        ? period.charAt(0).toUpperCase() + period.slice(1)
                        : period === "morning" ? "上午" : period === "afternoon" ? "下午" : "晚上"}
                    </span>
                    <div className="block-line" />
                  </div>
                  {periodItems.length === 0 ? (
                    <div className="empty-slot">— {locale === "en" ? "No events" : "没有安排"} —</div>
                  ) : (
                    periodItems.map((entry) => {
                      if (entry.type === "schedule") {
                        const item = entry.item as ScheduleItem;
                        return (
                          <div
                            className="schedule-agenda-card"
                            key={`s-${item.id}`}
                            onClick={() => handleScheduleClick(item)}
                            onDoubleClick={() => openScheduleDetail(item.id)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setEmptyContextMenu(null);
                              setContextMenu({ id: item.id, x: e.clientX, y: e.clientY });
                            }}
                          >
                            <div className="schedule-agenda-card-color" style={{ background: entry.color }} />
                            <div className="schedule-agenda-card-body">
                              <div className="event-top">
                                <span className="event-time">{formatTimeShort(item.start_at)} — {formatTimeShort(item.end_at)}</span>
                                {item.category ? <span className="event-tag">{item.category}</span> : null}
                              </div>
                              <div className="schedule-agenda-card-title">{item.title}</div>
                              <div className="schedule-agenda-card-meta">
                                {item.location ? (
                                  <>
                                    <span className="schedule-agenda-card-meta-icon">📍</span>
                                    {item.location}
                                  </>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      }
                      const n = entry.item as NotificationItem;
                      return (
                        <div
                          className="schedule-agenda-card"
                          key={`n-${n.id}`}
                          onClick={() => handleNotifyClick(n)}
                          onDoubleClick={() => setNotifyEditId(n.id)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setNotifyContextMenu({ id: n.id, x: e.clientX, y: e.clientY });
                          }}
                        >
                          <div className="schedule-agenda-card-color" style={{ background: entry.color }} />
                          <div className="schedule-agenda-card-body">
                            <div className="schedule-agenda-card-title">
                              <span className="schedule-agenda-card-notify-icon">🔔</span>{" "}
                              {n.title}
                            </div>
                            <div className="schedule-agenda-card-meta">
                              <span className="schedule-agenda-card-meta-icon">🕐</span>
                              {formatTimeShort(n.trigger_at)}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* FABs */}
      {selectedDateKey !== todayKey && (
        <button
          type="button"
          className="schedule-agenda-fab go-today-fab"
          onClick={goToToday}
          title={locale === "en" ? "Go to today" : "回到今天"}
        >
          <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
            <path d="M1001.235558 448.9728L860.179558 329.2672V166.4a64 64 0 0 0-128 0v54.272l-161.792-137.2672-20.48-17.2032A63.0272 63.0272 0 0 0 512.019558 51.2a63.0272 63.0272 0 0 0-37.9392 15.0016l-20.48 17.2032-430.7968 365.568a65.3824 65.3824 0 0 0-7.8848 91.1872 63.6928 63.6928 0 0 0 90.1632 7.9872L512.019558 202.8032l406.9376 345.344a63.6928 63.6928 0 0 0 90.1632-7.9872 65.3824 65.3824 0 0 0-7.8848-91.1872z" fill="#FFFFFF" />
            <path d="M512.019558 332.8l-384 307.2v256a76.8 76.8 0 0 0 76.8 76.8h192v-281.6h230.4v281.6H819.219558a76.8 76.8 0 0 0 76.8-76.8v-256z" fill="#FFFFFF" />
          </svg>
        </button>
      )}
      <button type="button" className="schedule-agenda-fab" onClick={handleFabClick}>+</button>

      {editStatus ? <div className="empty-state schedule-status">{editStatus}</div> : null}

      {detailId != null ? (
        <ScheduleDetailModal
          schedule={items.find((s) => s.id === detailId)!}
          api={api}
          onClose={() => setDetailId(null)}
          onDelete={(id) => deleteSchedule(id)}
          onUpdate={(updated) => {
            setItems((prev) =>
              prev
                .map((item) => (item.id === updated.id ? updated : item))
                .sort((a, b) => a.start_at - b.start_at || a.end_at - b.end_at || a.id - b.id)
            );
            // If the updated item is currently being edited, clear editing state
            // so the fresh data from the detail modal is reflected on the grid
            if (editing?.id === updated.id) {
              setEditing(null);
              pointerEditRef.current = null;
            }
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

      {(notifyEditId != null || notifyFormOpen) ? (
        <NotifyFormModal
          api={api}
          editId={notifyEditId}
          initialTriggerAt={notifyFormTriggerAt}
          onNavigate={onNavigate}
          onOpenScheduleDetail={(id) => {
            setNotifyEditId(null);
            setNotifyFormOpen(false);
            setDetailId(id);
          }}
          onClose={() => {
            setNotifyEditId(null);
            setNotifyFormOpen(false);
            setNotifyFormTriggerAt(undefined);
            // Reload notifications
            const start = startOfDateKeyEpoch(days[0]);
            const end = startOfDateKeyEpoch(addDaysToDateKey(days[6], 1));
            api.listNotifications({ start_at: start, end_at: end })
              .then((result) => setNotifications(result.notifications))
              .catch(() => {});
          }}
        />
      ) : null}

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            {
              label: `id:${contextMenu.id}`,
              icon: null,
              action: () => {},
              disabled: true
            },
            {
              label: t("common.edit"),
              icon: (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              ),
              action: () => openScheduleDetail(contextMenu.id)
            },
            {
              label: t("common.delete"),
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
              label: t("schedule.newSchedule"),
              icon: <PlusIcon />,
              action: () => {
                setCreateDraft({
                  startAt: emptyContextMenu.startAt,
                  endAt: emptyContextMenu.endAt
                });
              }
            },
            {
              label: t("schedule.newNotification"),
              icon: (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
              ),
              action: () => {
                setNotifyFormTriggerAt(emptyContextMenu.startAt);
                setEmptyContextMenu(null);
                setNotifyFormOpen(true);
              }
            },
            {
              label: t("common.refresh"),
              icon: <RefreshIcon />,
              action: () => {
                setRefreshKey((k) => k + 1);
              }
            }
          ]}
          onClose={() => setEmptyContextMenu(null)}
        />
      ) : null}
      {notifyContextMenu ? (
        <ContextMenu
          x={notifyContextMenu.x}
          y={notifyContextMenu.y}
          items={[
            {
              label: `id:${notifyContextMenu.id}`,
              icon: null,
              action: () => {},
              disabled: true
            },
            {
              label: t("common.edit"),
              icon: (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
              ),
              action: () => setNotifyEditId(notifyContextMenu.id)
            },
            {
              label: t("common.delete"),
              icon: <TrashIcon />,
              danger: true,
              action: () => askDeleteNotification(notifyContextMenu.id)
            }
          ]}
          onClose={() => setNotifyContextMenu(null)}
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

function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M528.896 998.4c-262.656 0-476.672-214.016-476.672-476.672S266.24 45.056 528.896 45.056c163.84 0 314.368 82.432 402.432 221.184 14.336 22.528 7.68 53.248-14.848 67.584a49.3568 49.3568 0 0 1-67.584-14.848 377.2416 377.2416 0 0 0-320-175.616c-208.896 0-378.88 169.984-378.88 378.88s169.984 378.88 378.88 378.88a378.88 378.88 0 0 0 349.184-231.424c10.752-25.088 39.424-36.352 64-26.112 25.088 10.752 36.352 39.424 26.112 64a476.16 476.16 0 0 1-439.296 290.816z" fill="currentColor"/>
      <path d="M889.344 341.504h-217.6a49.152 49.152 0 0 1 0-98.304h168.96v-168.96a49.152 49.152 0 0 1 98.304 0v218.112c-1.024 27.136-22.528 49.152-49.664 49.152z" fill="currentColor"/>
    </svg>
  );
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
  const tooltip = useGlassTooltip();
  const { t } = useI18n();
  const style = {
    top: `${block.top}px`,
    height: `${block.height}px`,
    backgroundColor: block.backgroundColor,
    "--title-lines": block.titleLines
  } as CSSProperties & Record<"--title-lines", number>;
  const className = [
    "schedule-event",
    block.textMode,
    selected ? "selected" : "",
    saving ? "saving" : ""
  ].filter(Boolean).join(" ");
  const timeText = `${formatTime(block.item.start_at)}-${formatTime(block.item.end_at)}`;

  return (
    <>
      <button
        type="button"
        className={className}
        ref={ref}
        style={style}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
        onMouseEnter={(e) => tooltip.show(e.currentTarget.getBoundingClientRect())}
        onMouseLeave={tooltip.hide}
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
      <GlassTooltip
        visible={tooltip.visible}
        pos={tooltip.pos}
        content={{
          dotColor: block.backgroundColor,
          title: block.item.title,
          id: block.item.id,
          fields: [
            { icon: "\u{1F552}", label: t("common.duration"), value: formatDuration(block.item.duration) },
            { icon: "\u{1F4DD}", label: t("common.description"), value: block.item.description || "-" },
            { icon: "\u{1F4C2}", label: t("common.category"), value: block.item.category || "-" },
            { icon: "\u{1F4CD}", label: t("common.location"), value: block.item.location || "-" },
          ],
        }}
        onMouseEnter={tooltip.keepVisible}
        onMouseLeave={tooltip.hide}
        onMeasure={tooltip.adjustPos}
      />
    </>
  );
});

const NotifyEventBlock = forwardRef<HTMLButtonElement, {
  item: NotificationItem;
  top: number;
  backgroundColor: string;
  selected?: boolean;
  saving?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}>(function NotifyEventBlock({ item, top, backgroundColor, selected, saving, onClick, onDoubleClick, onKeyDown, onPointerDown, onContextMenu }, ref) {
  const tooltip = useGlassTooltip();
  const { t } = useI18n();
  const timeText = formatTime(item.trigger_at);
  const className = [
    "notify-event",
    selected ? "selected" : "",
    saving ? "saving" : ""
  ].filter(Boolean).join(" ");
  return (
    <>
      <button
        type="button"
        className={className}
        ref={ref}
        style={{ top: `${top}px`, backgroundColor }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
        onMouseEnter={(e) => tooltip.show(e.currentTarget.getBoundingClientRect())}
        onMouseLeave={tooltip.hide}
        aria-pressed={selected}
      >
        <span className="notify-icon">🔔</span>
        <span className="notify-title">{item.title}</span>
        <span className="notify-time">{timeText}</span>
      </button>
      <GlassTooltip
        visible={tooltip.visible}
        pos={tooltip.pos}
        content={{
          dotColor: backgroundColor,
          title: item.title,
          id: item.id,
          fields: [
            { icon: "\u{1F552}", label: t("common.triggerTime"), value: timeText },
            { icon: "\u{1F4DD}", label: t("common.description"), value: item.description || "-" },
          ],
        }}
        onMouseEnter={tooltip.keepVisible}
        onMouseLeave={tooltip.hide}
        onMeasure={tooltip.adjustPos}
      />
    </>
  );
});

function buildNotifyBlocks(
  notifications: NotificationItem[],
  days: string[],
  visibleStartHour: number,
  visibleEndHour: number,
  eventColors: string[]
): Record<string, { item: NotificationItem; top: number; backgroundColor: string }[]> {
  return Object.fromEntries(
    days.map((dayKey) => {
      const dayStart = startOfDateKeyEpoch(dayKey);
      const visibleStart = dayStart + visibleStartHour * 3600;
      const visibleEnd = dayStart + visibleEndHour * 3600;
      const blocks = notifications
        .filter((n) => n.trigger_at >= visibleStart && n.trigger_at < visibleEnd)
        .sort((a, b) => a.trigger_at - b.trigger_at || a.id - b.id)
        .map((item, index) => ({
          item,
          top: ((item.trigger_at - visibleStart) / 3600) * HOUR_HEIGHT,
          backgroundColor: eventColors[index % eventColors.length],
        }));
      return [dayKey, blocks];
    })
  );
}

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

function moveNotifyVertically(item: NotificationItem, deltaSeconds: number): NotificationItem {
  const dayKey = dateKeyFromEpoch(item.trigger_at);
  const dayStart = startOfDateKeyEpoch(dayKey);
  const nextTrigger = clamp(item.trigger_at + deltaSeconds, dayStart, dayStart + 86399);
  return { ...item, trigger_at: nextTrigger };
}

function moveNotifyToAdjacentDay(item: NotificationItem, deltaDays: number, days: string[]): NotificationItem {
  const dayKey = dateKeyFromEpoch(item.trigger_at);
  const currentIndex = days.indexOf(dayKey);
  if (currentIndex < 0) return item;
  const nextIndex = clamp(currentIndex + deltaDays, 0, days.length - 1);
  if (nextIndex === currentIndex) return item;
  const deltaSeconds = startOfDateKeyEpoch(days[nextIndex]) - startOfDateKeyEpoch(days[currentIndex]);
  return { ...item, trigger_at: item.trigger_at + deltaSeconds };
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

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "-";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function buildScheduleBlocks(
  items: ScheduleItem[],
  days: string[],
  visibleStartHour: number,
  visibleEndHour: number
): Record<string, RenderedScheduleBlock[]> {
  const eventColors = getEventColors();
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
            backgroundColor: eventColors[index % eventColors.length],
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
  return Math.max(1, Math.min(4, Math.floor((height - 36) / 18)));
}
