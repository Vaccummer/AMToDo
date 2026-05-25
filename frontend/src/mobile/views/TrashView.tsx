import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AMToDoApi, NotificationItem, ScheduleItem, TodoItem } from "../../api/client";
import type { ConnectionStatusSnapshot } from "../../api/connection-status";
import { formatTime } from "../../lib/time";
import { useConfirm } from "./ConfirmDialog";
import { useI18n } from "../../i18n";

type Props = {
  api: AMToDoApi;
  onOpenSettings?: (focusTarget?: "url" | "token") => void;
  connectionStatus?: ConnectionStatusSnapshot;
  onConnectionError?: (kind: "network" | "token" | null, message?: string) => void;
  onItemClick?: (type: "todo" | "schedule" | "notify", item: TodoItem | ScheduleItem | NotificationItem) => void;
};

type TrashMode = "todo" | "schedule" | "notify";
type TrashResult =
  | { type: "todo"; item: TodoItem }
  | { type: "schedule"; item: ScheduleItem }
  | { type: "notify"; item: NotificationItem };

type TimeGroup = "today" | "yesterday" | "this-week" | "this-month" | "earlier";

const TIME_GROUP_META: Record<TimeGroup, { label: string; dotClass: string }> = {
  today: { label: "今天", dotClass: "today" },
  yesterday: { label: "昨天", dotClass: "yesterday" },
  "this-week": { label: "本周", dotClass: "this-week" },
  "this-month": { label: "本月", dotClass: "this-month" },
  earlier: { label: "更早", dotClass: "earlier" },
};

const GROUP_ORDER: TimeGroup[] = ["today", "yesterday", "this-week", "this-month", "earlier"];

function startOfDay(ts: number): number {
  const d = new Date(ts * 1000);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function groupByDate(items: TrashResult[]): Map<TimeGroup, TrashResult[]> {
  const now = Math.floor(Date.now() / 1000);
  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - 86400;
  const d = new Date(todayStart * 1000);
  const dayOfWeek = d.getDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStart = todayStart - mondayOffset * 86400;

  // Start of current month
  const monthStart = Math.floor(new Date(d.getFullYear(), d.getMonth(), 1).getTime() / 1000);

  const groups = new Map<TimeGroup, TrashResult[]>();
  for (const g of GROUP_ORDER) groups.set(g, []);

  for (const entry of items) {
    const deleted = entry.item.deleted_at ?? now;
    let group: TimeGroup;
    if (deleted >= todayStart) group = "today";
    else if (deleted >= yesterdayStart) group = "yesterday";
    else if (deleted >= weekStart) group = "this-week";
    else if (deleted >= monthStart) group = "this-month";
    else group = "earlier";
    groups.get(group)!.push(entry);
  }
  return groups;
}

function getFilterTabs(t: (key: string) => string) {
  return [
    { value: "todo" as TrashMode, label: t("tab.todo"), dotClass: "todo" },
    { value: "schedule" as TrashMode, label: t("tab.schedule"), dotClass: "sch" },
    { value: "notify" as TrashMode, label: t("tab.notify"), dotClass: "notify" },
  ];
}

function RestoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      <path d="M876.89 535.11c3.22-107.02-35.43-208.89-108.85-286.85-139.4-148.03-365.98-166.35-526.67-50.07l-5.56-57.66c-2.36-24.48-24.16-42.41-48.61-40.07-24.48 2.36-42.43 24.12-40.07 48.61l17.92 185.8a44.52 44.52 0 0 0 17.77 31.48c1.51 1.13 3.07 2.13 4.68 3.04a44.528 44.528 0 0 0 30.61 4.89l178.1-35.47c24.11-4.8 39.77-28.25 34.96-52.39-4.78-24.15-28.22-39.78-52.39-34.96l-81.37 16.2c124.67-87.44 298.4-72.49 405.79 41.7 57.09 60.62 87.16 139.85 84.68 223.08-2.51 83.24-37.26 160.52-97.91 217.62C564.83 867.92 367 862.07 249.25 736.82c-16.83-17.92-45.05-18.76-62.97-1.88-17.89 16.87-18.74 45.06-1.88 62.97 28.36 30.1 60.28 54.83 94.56 74.18 148.83 83.98 341.29 66 472.1-57.18C829 741.5 873.69 642.14 876.89 535.11z" fill="currentColor"/>
      <path d="M423.44 378.04c-24.59 0.46-44.16 20.78-43.7 45.37l3.34 178.13c0.46 24.59 20.78 44.16 45.37 43.7l178.13-3.34c24.59-0.46 44.16-20.78 43.7-45.37s-20.78-44.16-45.37-43.7l-133.6 2.51-2.51-133.6c-0.46-24.59-20.77-44.16-45.36-43.7z" fill="currentColor"/>
    </svg>
  );
}

function PurgeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M16.5 16.5L21 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/* ── Status helpers ── */

type StatusTag = { label: string; className: string };

function getTodoStatus(item: TodoItem, t: (key: string) => string): StatusTag {
  if (item.completed) return { label: t("common.done"), className: "status-done" };
  if (item.priority >= 2) return { label: t("common.highPriority"), className: "status-high" };
  return { label: t("common.pending"), className: "status-pending" };
}

function getScheduleStatus(item: ScheduleItem, t: (key: string) => string): StatusTag {
  const now = Math.floor(Date.now() / 1000);
  if (now < item.start_at) return { label: t("common.upcoming"), className: "status-upcoming" };
  if (now <= item.end_at) return { label: t("common.inProgress"), className: "status-inprogress" };
  return { label: t("common.past"), className: "status-past" };
}

function getNotifyStatus(item: NotificationItem, t: (key: string) => string): StatusTag {
  const now = Math.floor(Date.now() / 1000);
  if (now < item.trigger_at) return { label: t("common.pending"), className: "status-upcoming" };
  return { label: t("common.sent"), className: "status-past" };
}

function getStatus(entry: TrashResult, t: (key: string) => string): StatusTag {
  if (entry.type === "todo") return getTodoStatus(entry.item as TodoItem, t);
  if (entry.type === "schedule") return getScheduleStatus(entry.item as ScheduleItem, t);
  return getNotifyStatus(entry.item as NotificationItem, t);
}

/* ── Swipeable Row ── */

const SWIPE_THRESHOLD = 60;
const SWIPE_MAX = 144;
const TAP_THRESHOLD = 8;

type SwipeRowProps = {
  entry: TrashResult;
  busy: boolean;
  onRestore: () => void;
  onPurge: () => void;
  onItemClick: () => void;
  status: StatusTag;
  t: (key: string) => string;
  index: number;
};

function SwipeRow({ entry, busy, onRestore, onPurge, onItemClick, status, t, index }: SwipeRowProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const currentX = useRef(0);
  const dragging = useRef(false);
  const moved = useRef(false);
  const pressed = useRef(false);

  const applyTransform = useCallback((x: number) => {
    const el = contentRef.current;
    if (!el) return;
    el.style.transform = `translateX(${x}px)`;
    el.style.transition = "none";
  }, []);

  const snapTo = useCallback((target: number, animate = true) => {
    const el = contentRef.current;
    if (!el) return;
    if (animate) {
      el.style.transition = "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1)";
    } else {
      el.style.transition = "none";
    }
    el.style.transform = `translateX(${target}px)`;
  }, []);

  const handleEnd = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    const dx = currentX.current;
    currentX.current = 0;
    if (revealed) {
      if (dx > SWIPE_THRESHOLD) {
        snapTo(0);
        setRevealed(false);
      } else {
        snapTo(-SWIPE_MAX);
      }
    } else {
      if (dx < -SWIPE_THRESHOLD) {
        snapTo(-SWIPE_MAX);
        setRevealed(true);
      } else {
        snapTo(0);
      }
    }
  }, [revealed, snapTo]);

  // Touch events
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    dragging.current = true;
    moved.current = false;
    pressed.current = true;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragging.current) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;
    if (Math.abs(dx) > TAP_THRESHOLD || Math.abs(dy) > TAP_THRESHOLD) moved.current = true;
    currentX.current = dx;
    const base = revealed ? -SWIPE_MAX : 0;
    const x = Math.max(-SWIPE_MAX, Math.min(0, base + dx));
    applyTransform(x);
  }, [revealed, applyTransform]);

  const onTouchEnd = useCallback(() => {
    const wasTap = pressed.current && !moved.current && !revealed;
    pressed.current = false;
    handleEnd();
    if (wasTap) onItemClick();
  }, [handleEnd, revealed, onItemClick]);

  // Mouse events
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    startX.current = e.clientX;
    startY.current = e.clientY;
    dragging.current = true;
    moved.current = false;
    pressed.current = true;
    e.preventDefault();
  }, []);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - startX.current;
      const dy = e.clientY - startY.current;
      if (Math.abs(dx) > TAP_THRESHOLD || Math.abs(dy) > TAP_THRESHOLD) moved.current = true;
      currentX.current = dx;
      const base = revealed ? -SWIPE_MAX : 0;
      const x = Math.max(-SWIPE_MAX, Math.min(0, base + dx));
      applyTransform(x);
    };
    const onMouseUp = () => {
      const wasTap = pressed.current && !moved.current && !revealed;
      pressed.current = false;
      handleEnd();
      if (wasTap) onItemClick();
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [revealed, applyTransform, handleEnd, onItemClick]);

  function handlePurgeClick() {
    onPurge();
    snapTo(0);
    setRevealed(false);
  }

  function handleRestoreClick() {
    onRestore();
    snapTo(0);
    setRevealed(false);
  }

  const statusClass = `row-status-tag ${status.className}`;

  return (
    <div className="trash-row-swipe" style={{ animationDelay: `${index * 0.04}s` }}>
      <div className="swipe-actions-bg">
        <button
          type="button"
          className="swipe-action-btn restore"
          disabled={busy}
          onClick={handleRestoreClick}
        >
          <RestoreIcon />
          {t("common.restore")}
        </button>
        <button
          type="button"
          className="swipe-action-btn purge"
          disabled={busy}
          onClick={handlePurgeClick}
        >
          <PurgeIcon />
          {t("common.purge")}
        </button>
      </div>
      <div
        className="swipe-content"
        data-status={status.className.replace("status-", "")}
        ref={contentRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onMouseDown={onMouseDown}
      >
        <div className="row-content">
          <div className="row-title">{entry.item.title}</div>
          <div className="row-meta">
            <span className={statusClass}>{status.label}</span>
            <span className="row-id">#{entry.item.id}</span>
            {renderMeta(entry, t)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function TrashView({ api, onOpenSettings, connectionStatus, onConnectionError, onItemClick }: Props) {
  const { t } = useI18n();
  const [mode, setMode] = useState<TrashMode>("todo");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<TrashResult[]>([]);
  const [status, setStatus] = useState<string>("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { ask, dialog: confirmDialog } = useConfirm();

  const toggleCollapse = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setStatus(t("common.loading"));
    setItems([]);

    const requests: Promise<TrashResult[]>[] = [];
    if (mode === "todo") {
      requests.push(api.listTodoTrash({ limit: 500 }).then((r) => r.todos.map((item) => ({ type: "todo" as const, item }))));
    }
    if (mode === "schedule") {
      requests.push(api.listScheduleTrash({ limit: 500 }).then((r) => r.schedules.map((item) => ({ type: "schedule" as const, item }))));
    }
    if (mode === "notify") {
      requests.push(api.listNotificationTrash().then((r) => r.notifications.map((item) => ({ type: "notify" as const, item }))));
    }

    Promise.all(requests)
      .then((results) => {
        if (cancelled) return;
        const merged = results.flat().sort((a, b) => {
          const da = a.item.deleted_at ?? 0;
          const db = b.item.deleted_at ?? 0;
          return db - da;
        });
        setItems(merged);
        onConnectionError?.(null);
        setStatus(merged.length ? "" : t("trash.empty"));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setItems([]);
        if (error instanceof TypeError) {
          onConnectionError?.("network", t("connection.cannotConnectDesc"));
          setStatus(t("common.connectionFailed"));
        } else {
          const msg = error instanceof Error ? error.message : t("trash.loadFailed");
          onConnectionError?.("token", msg);
          setStatus(msg);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api, mode]);

  const filteredItems = useMemo(() => {
    const trimmed = query.trim().toLocaleLowerCase();
    if (!trimmed) return items;
    return items.filter((entry) => {
      const haystack =
        entry.type === "todo"
          ? [entry.item.title, entry.item.description, (entry.item as TodoItem).tag].filter(Boolean).join(" ")
          : entry.type === "schedule"
            ? [entry.item.title, entry.item.description, (entry.item as ScheduleItem).category, (entry.item as ScheduleItem).location].filter(Boolean).join(" ")
            : [entry.item.title, entry.item.description].filter(Boolean).join(" ");
      return haystack.toLocaleLowerCase().includes(trimmed);
    });
  }, [items, query]);

  const countByType = useMemo(() => {
    const counts = { todo: 0, schedule: 0, notify: 0 };
    for (const entry of items) {
      counts[entry.type]++;
    }
    return counts;
  }, [items]);

  const grouped = useMemo(() => groupByDate(filteredItems), [filteredItems]);

  async function restore(entry: TrashResult) {
    const ok = await ask({
      title: t("trash.restoreConfirmTitle"),
      message: t("trash.restoreConfirmMessage"),
      confirmLabel: t("common.restore"),
    });
    if (!ok) return;
    const key = resultKey(entry);
    setBusyKey(key);
    try {
      if (entry.type === "todo") {
        const result = await api.restoreTodos([entry.item.id]);
        const failed = result.results.find((r) => !r.ok);
        if (failed) { setStatus(failed.error?.message ?? t("trash.restoreFailed")); return; }
      } else if (entry.type === "schedule") {
        const result = await api.restoreSchedules([entry.item.id]);
        const failed = result.results.find((r) => !r.ok);
        if (failed) { setStatus(failed.error?.message ?? t("trash.restoreFailed")); return; }
      } else {
        const result = await api.restoreNotification(entry.item.id);
        if (!result.ok) { setStatus(t("trash.restoreFailed")); return; }
      }
      setItems((prev) => prev.filter((item) => resultKey(item) !== key));
      setStatus(t("trash.restored"));
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : t("trash.restoreFailed"));
    } finally {
      setBusyKey(null);
    }
  }

  async function purge(entry: TrashResult) {
    const key = resultKey(entry);
    setBusyKey(key);
    try {
      if (entry.type === "todo") {
        const result = await api.purgeTodos([entry.item.id]);
        const failed = result.results.find((r) => !r.ok);
        if (failed) { setStatus(failed.error?.message ?? t("trash.purgeFailed")); return; }
      } else if (entry.type === "schedule") {
        const result = await api.purgeSchedules([entry.item.id]);
        const failed = result.results.find((r) => !r.ok);
        if (failed) { setStatus(failed.error?.message ?? t("trash.purgeFailed")); return; }
      } else {
        const result = await api.purgeNotification(entry.item.id);
        if (!result.ok) { setStatus(t("trash.purgeFailed")); return; }
      }
      setItems((prev) => prev.filter((item) => resultKey(item) !== key));
      setStatus(t("trash.purged"));
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : t("trash.purgeFailed"));
    } finally {
      setBusyKey(null);
    }
  }

  async function purgeAll() {
    if (filteredItems.length === 0) return;
    const counts = { todo: 0, schedule: 0, notify: 0 };
    for (const entry of filteredItems) counts[entry.type]++;
    const parts: string[] = [];
    if (counts.todo) parts.push(t("trash.todoCount", { count: counts.todo }));
    if (counts.schedule) parts.push(t("trash.scheduleCount", { count: counts.schedule }));
    if (counts.notify) parts.push(t("trash.notificationCount", { count: counts.notify }));
    const ok = await ask({
      title: t("trash.purgeFilterTitle"),
      message: t("trash.purgeFilterConfirm", { list: parts.join(t("common.separator")), count: filteredItems.length }),
      confirmLabel: t("common.purge"),
      danger: true,
    });
    if (!ok) return;
    setBusyKey("purge-all");
    try {
      const todoIds = filteredItems.filter((e) => e.type === "todo").map((e) => e.item.id);
      const scheduleIds = filteredItems.filter((e) => e.type === "schedule").map((e) => e.item.id);
      const notifyEntries = filteredItems.filter((e) => e.type === "notify");
      const promises: Promise<unknown>[] = [];
      if (todoIds.length) promises.push(api.purgeTodos(todoIds));
      if (scheduleIds.length) promises.push(api.purgeSchedules(scheduleIds));
      for (const ne of notifyEntries) promises.push(api.purgeNotification(ne.item.id));
      await Promise.all(promises);
      const deletedKeys = new Set(filteredItems.map(resultKey));
      setItems((prev) => prev.filter((item) => !deletedKeys.has(resultKey(item))));
      setStatus(t("trash.purgedCount", { count: filteredItems.length }));
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : t("common.batchDeleteFailed"));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="trash-view">
      <div className="trash-filter-bar">
        <div className="filter-tabs" role="tablist">
          {getFilterTabs(t).map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={mode === tab.value ? "active" : ""}
              onClick={() => { setMode(tab.value); setQuery(""); }}
            >
              {tab.dotClass && <span className={`ft-dot ${tab.dotClass}`} />}
              {tab.label}
              <span className="ft-count">
                {countByType[tab.value]}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="trash-search-bar">
        <div className="trash-search-wrap">
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("trash.searchTrash")}
          />
        </div>
        <button
          type="button"
          className="trash-restore-all-btn"
          disabled={items.length === 0 || busyKey === "restore-all"}
          onClick={async () => {
            const ok = await ask({
              title: t("trash.restoreAllConfirmTitle"),
              message: t("trash.restoreAllConfirmMessage", { count: items.length }),
              confirmLabel: t("common.restore"),
            });
            if (!ok) return;
            setBusyKey("restore-all");
            try {
              const todoIds = items.filter((e) => e.type === "todo").map((e) => e.item.id);
              const scheduleIds = items.filter((e) => e.type === "schedule").map((e) => e.item.id);
              const notifyEntries = items.filter((e) => e.type === "notify");
              const promises: Promise<unknown>[] = [];
              if (todoIds.length) promises.push(api.restoreTodos(todoIds));
              if (scheduleIds.length) promises.push(api.restoreSchedules(scheduleIds));
              for (const ne of notifyEntries) promises.push(api.restoreNotification(ne.item.id));
              await Promise.all(promises);
              setItems([]);
              setStatus(t("trash.restored"));
            } catch (error: unknown) {
              setStatus(error instanceof Error ? error.message : t("trash.restoreFailed"));
            } finally {
              setBusyKey(null);
            }
          }}
          title={t("common.restore")}
        >
          <RestoreIcon />
        </button>
        <button
          type="button"
          className="trash-clear-btn"
          disabled={filteredItems.length === 0 || busyKey === "purge-all"}
          onClick={() => void purgeAll()}
          title={t("trash.clearAllFilters")}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>

      <div className="trash-timeline">
        {GROUP_ORDER.map((groupKey) => {
          const groupItems = grouped.get(groupKey) ?? [];
          if (groupItems.length === 0) return null;
          const meta = TIME_GROUP_META[groupKey];
          const isCollapsed = collapsed.has(groupKey);
          return (
            <div className={`timeline-group${isCollapsed ? " collapsed" : ""}`} key={groupKey}>
              <div
                className="timeline-label"
                role="button"
                tabIndex={0}
                onClick={() => toggleCollapse(groupKey)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleCollapse(groupKey); }}
              >
                <span className={`timeline-dot ${meta.dotClass}`} />
                <span className="timeline-date">{meta.label}</span>
                <span className="timeline-count">{groupItems.length} 项</span>
                <svg className={`timeline-chevron${isCollapsed ? " collapsed" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
              <div className="row-list">
                {groupItems.map((entry, idx) => {
                  const busy = busyKey === resultKey(entry);
                  return (
                    <SwipeRow
                      key={resultKey(entry)}
                      entry={entry}
                      busy={busy}
                      onRestore={() => void restore(entry)}
                      onPurge={() => void purge(entry)}
                      onItemClick={() => onItemClick?.(entry.type, entry.item)}
                      status={getStatus(entry, t)}
                      t={t}
                      index={idx}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}

        {status ? (
          status === t("trash.empty") ? (
            <div className="trash-empty">
              <div className="trash-ghost-scene">
                <div className="trash-sparkle"></div>
                <div className="trash-sparkle"></div>
                <div className="trash-sparkle"></div>
                <div className="trash-ghost">
                  <div className="trash-ghost-body">
                    <div className="trash-ghost-eye left"></div>
                    <div className="trash-ghost-eye right"></div>
                    <div className="trash-ghost-cheek left"></div>
                    <div className="trash-ghost-cheek right"></div>
                  </div>
                </div>
                <div className="trash-bin-handle"></div>
                <div className="trash-bin-lid"></div>
                <div className="trash-bin-body">
                  <div className="trash-bin-line"></div>
                </div>
              </div>
              <div className="trash-empty-title">{t("trash.empty")}</div>
              <div className="trash-empty-desc">{t("trash.emptyDesc")}</div>
            </div>
          ) : (
            <div className="trash-empty">
              <span style={{ color: "var(--global-text-muted)", fontSize: "var(--font-md)" }}>{status}</span>
            </div>
          )
        ) : filteredItems.length === 0 ? (
          <div className="trash-empty">
            <div className="trash-ghost-scene">
              <div className="trash-sparkle"></div>
              <div className="trash-sparkle"></div>
              <div className="trash-sparkle"></div>
              <div className="trash-ghost">
                <div className="trash-ghost-body">
                  <div className="trash-ghost-eye left"></div>
                  <div className="trash-ghost-eye right"></div>
                  <div className="trash-ghost-cheek left"></div>
                  <div className="trash-ghost-cheek right"></div>
                </div>
              </div>
              <div className="trash-bin-handle"></div>
              <div className="trash-bin-lid"></div>
              <div className="trash-bin-body">
                <div className="trash-bin-line"></div>
              </div>
            </div>
            <div className="trash-empty-title">{t("trash.noMatch")}</div>
            <div className="trash-empty-desc">{t("trash.noMatchDesc")}</div>
          </div>
        ) : null}
      </div>

      {confirmDialog}
    </div>
  );
}

function resultKey(entry: TrashResult): string {
  return `${entry.type}:${entry.item.id}`;
}

function renderMeta(entry: TrashResult, t: (key: string) => string) {
  if (entry.type === "todo") {
    const todo = entry.item as TodoItem;
    return (
      <>
        {todo.due_at ? <span>{t("common.due")} {formatShortDate(todo.due_at)}</span> : null}
        {todo.tag ? <span>{todo.tag}</span> : null}
      </>
    );
  }
  if (entry.type === "schedule") {
    const sch = entry.item as ScheduleItem;
    return <span>{formatShortDate(sch.start_at)} - {formatShortDate(sch.end_at)}</span>;
  }
  const n = entry.item as NotificationItem;
  return <span>{t("common.trigger")} {formatShortDate(n.trigger_at)}</span>;
}

function formatShortDate(epoch: number): string {
  const d = new Date(epoch * 1000);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${month}-${day} ${formatTime(epoch)}`;
}
