import { useEffect, useMemo, useState } from "react";
import type { AMToDoApi, NotificationItem, ScheduleItem, TodoItem } from "../api/client";
import { formatTime } from "../lib/time";
import { useConfirm } from "./ConfirmDialog";

type Props = {
  api: AMToDoApi;
};

type TrashMode = "all" | "todo" | "schedule" | "notify";
type TrashResult =
  | { type: "todo"; item: TodoItem }
  | { type: "schedule"; item: ScheduleItem }
  | { type: "notify"; item: NotificationItem };

const FILTER_TABS: { value: TrashMode; label: string; dotClass?: string }[] = [
  { value: "all", label: "全部" },
  { value: "todo", label: "ToDo", dotClass: "todo" },
  { value: "schedule", label: "Schedule", dotClass: "sch" },
  { value: "notify", label: "Notify", dotClass: "notify" },
];

function TodoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ScheduleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function NotifyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
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

export function TrashView({ api }: Props) {
  const [mode, setMode] = useState<TrashMode>("all");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<TrashResult[]>([]);
  const [status, setStatus] = useState("加载中");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const { ask, dialog: confirmDialog } = useConfirm();

  useEffect(() => {
    let cancelled = false;
    setStatus("加载中");
    setItems([]);

    const requests: Promise<TrashResult[]>[] = [];
    if (mode === "all" || mode === "todo") {
      requests.push(api.listTodoTrash({ limit: 500 }).then((r) => r.todos.map((item) => ({ type: "todo" as const, item }))));
    }
    if (mode === "all" || mode === "schedule") {
      requests.push(api.listScheduleTrash({ limit: 500 }).then((r) => r.schedules.map((item) => ({ type: "schedule" as const, item }))));
    }
    if (mode === "all" || mode === "notify") {
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
        setStatus(merged.length ? "" : "回收站为空");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setItems([]);
        setStatus(error instanceof Error ? error.message : "回收站加载失败");
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

  async function restore(entry: TrashResult) {
    const key = resultKey(entry);
    setBusyKey(key);
    try {
      if (entry.type === "todo") {
        const result = await api.restoreTodos([entry.item.id]);
        const failed = result.results.find((r) => !r.ok);
        if (failed) { setStatus(failed.error?.message ?? "恢复失败"); return; }
      } else if (entry.type === "schedule") {
        const result = await api.restoreSchedules([entry.item.id]);
        const failed = result.results.find((r) => !r.ok);
        if (failed) { setStatus(failed.error?.message ?? "恢复失败"); return; }
      } else {
        const result = await api.restoreNotification(entry.item.id);
        if (!result.ok) { setStatus("恢复失败"); return; }
      }
      setItems((prev) => prev.filter((item) => resultKey(item) !== key));
      setStatus("已恢复");
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "恢复失败");
    } finally {
      setBusyKey(null);
    }
  }

  async function purge(entry: TrashResult) {
    const typeLabel = entry.type === "todo" ? "待办" : entry.type === "schedule" ? "日程" : "通知";
    const ok = await ask({
      title: `永久删除${typeLabel}`,
      message: "永久删除后无法恢复，相关附件也会被清除。",
      confirmLabel: "永久删除",
      danger: true,
    });
    if (!ok) return;

    const key = resultKey(entry);
    setBusyKey(key);
    try {
      if (entry.type === "todo") {
        const result = await api.purgeTodos([entry.item.id]);
        const failed = result.results.find((r) => !r.ok);
        if (failed) { setStatus(failed.error?.message ?? "永久删除失败"); return; }
      } else if (entry.type === "schedule") {
        const result = await api.purgeSchedules([entry.item.id]);
        const failed = result.results.find((r) => !r.ok);
        if (failed) { setStatus(failed.error?.message ?? "永久删除失败"); return; }
      } else {
        const result = await api.purgeNotification(entry.item.id);
        if (!result.ok) { setStatus("永久删除失败"); return; }
      }
      setItems((prev) => prev.filter((item) => resultKey(item) !== key));
      setStatus("已永久删除");
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "永久删除失败");
    } finally {
      setBusyKey(null);
    }
  }

  async function purgeAll() {
    if (filteredItems.length === 0) return;
    const counts = { todo: 0, schedule: 0, notify: 0 };
    for (const entry of filteredItems) counts[entry.type]++;
    const parts: string[] = [];
    if (counts.todo) parts.push(`${counts.todo} 个待办`);
    if (counts.schedule) parts.push(`${counts.schedule} 个日程`);
    if (counts.notify) parts.push(`${counts.notify} 个通知`);
    const ok = await ask({
      title: "永久删除筛选结果",
      message: `即将永久删除 ${parts.join("、")}，共 ${filteredItems.length} 项。此操作不可撤销，相关附件也会被清除。`,
      confirmLabel: "永久删除",
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
      setStatus(`已永久删除 ${filteredItems.length} 项`);
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "批量删除失败");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="trash-view">
      <div className="trash-filter-bar">
        <div className="filter-tabs" role="tablist">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={mode === tab.value ? "active" : ""}
              onClick={() => { setMode(tab.value); setQuery(""); }}
            >
              {tab.dotClass && <span className={`ft-dot ${tab.dotClass}`} />}
              {tab.label}
              <span className="ft-count">
                {tab.value === "all" ? items.length : countByType[tab.value]}
              </span>
            </button>
          ))}
        </div>
        <div className="trash-search-wrap">
          <SearchIcon />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索回收站..."
          />
        </div>
        <button
          type="button"
          className="trash-clear-btn"
          disabled={filteredItems.length === 0 || busyKey === "purge-all"}
          onClick={() => void purgeAll()}
          title="清除全部筛选结果"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          {filteredItems.length > 0 && <span className="count-dot">{filteredItems.length}</span>}
        </button>
      </div>

      <div className="trash-list">
        {filteredItems.map((entry) => {
          const busy = busyKey === resultKey(entry);
          return (
            <div className="trash-item" key={resultKey(entry)}>
              <div className={`trash-type-icon ${entry.type}`}>
                {entry.type === "todo" ? <TodoIcon /> : entry.type === "schedule" ? <ScheduleIcon /> : <NotifyIcon />}
              </div>
              <div className="trash-item-content">
                <div className="trash-item-title">{entry.item.title}</div>
                <div className="trash-item-meta">
                  <span className={`trash-item-type-tag ${entry.type}`}>
                    {entry.type === "todo" ? "ToDo" : entry.type === "schedule" ? "Schedule" : "Notify"}
                  </span>
                  <span className="trash-item-id" title={`id:${entry.item.id}`}>#{entry.item.id}</span>
                  {renderMeta(entry)}
                </div>
              </div>
              <span className="trash-item-deleted">{formatDeletedAt(entry.item.deleted_at)}</span>
              <div className="trash-item-actions">
                <button
                  type="button"
                  className="trash-action-btn restore"
                  disabled={busy}
                  onClick={() => void restore(entry)}
                  title="恢复"
                >
                  <RestoreIcon />
                </button>
                <button
                  type="button"
                  className="trash-action-btn purge"
                  disabled={busy}
                  onClick={() => void purge(entry)}
                  title="永久删除"
                >
                  <PurgeIcon />
                </button>
              </div>
            </div>
          );
        })}
        {status && <div className="trash-empty"><span>{status}</span></div>}
        {!status && filteredItems.length === 0 && <div className="trash-empty"><span>没有匹配的已删除项目</span></div>}
      </div>

      {confirmDialog}
    </div>
  );
}

function resultKey(entry: TrashResult): string {
  return `${entry.type}:${entry.item.id}`;
}

function renderMeta(entry: TrashResult) {
  if (entry.type === "todo") {
    const todo = entry.item as TodoItem;
    return (
      <>
        {todo.due_at ? <span>截止 {formatShortDate(todo.due_at)}</span> : null}
        {todo.tag ? <span>{todo.tag}</span> : null}
      </>
    );
  }
  if (entry.type === "schedule") {
    const sch = entry.item as ScheduleItem;
    return <span>{formatShortDate(sch.start_at)} - {formatShortDate(sch.end_at)}</span>;
  }
  const n = entry.item as NotificationItem;
  return <span>触发 {formatShortDate(n.trigger_at)}</span>;
}

function formatDeletedAt(epoch?: number | null): string {
  if (!epoch) return "";
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.max(0, now - epoch);
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  const days = Math.floor(diff / 86400);
  if (days <= 30) return `${days} 天前`;
  return formatDateTime(epoch);
}

function formatShortDate(epoch: number): string {
  const d = new Date(epoch * 1000);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${month}-${day} ${formatTime(epoch)}`;
}

function formatDateTime(epoch: number): string {
  const d = new Date(epoch * 1000);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${mo}-${day} ${h}:${mi}`;
}
