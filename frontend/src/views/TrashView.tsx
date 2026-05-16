import { useEffect, useMemo, useState } from "react";
import type { AMToDoApi, ScheduleItem, TodoItem } from "../api/client";
import { addDaysToDateKey, formatTime, startOfDateKeyEpoch } from "../lib/time";
import { DatePicker } from "./DatePicker";
import { useConfirm } from "./ConfirmDialog";

type Props = {
  api: AMToDoApi;
};

type TrashMode = "todo" | "schedule";
type TrashResult =
  | { type: "todo"; item: TodoItem }
  | { type: "schedule"; item: ScheduleItem };

function RestoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 7v6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 13A7 7 0 1 0 7 5.3L3 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PurgeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 6h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 6V4h8v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 6l1 14h10l1-14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 11v5M14 11v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function TrashView({ api }: Props) {
  const [mode, setMode] = useState<TrashMode>("todo");
  const [query, setQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [items, setItems] = useState<TrashResult[]>([]);
  const [status, setStatus] = useState("加载中");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const { ask, dialog: confirmDialog } = useConfirm();

  useEffect(() => {
    let cancelled = false;
    setStatus("加载中");
    setItems([]);
    const request = mode === "todo"
      ? api.listTodoTrash({ limit: 500 }).then((result) => result.todos.map((item) => ({ type: "todo" as const, item })))
      : api.listScheduleTrash({ limit: 500 }).then((result) => result.schedules.map((item) => ({ type: "schedule" as const, item })));
    request
      .then((next) => {
        if (cancelled) return;
        setItems(next);
        setStatus(next.length ? "" : "回收站为空");
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
    const start = startDate ? startOfDateKeyEpoch(startDate) : null;
    const end = endDate ? startOfDateKeyEpoch(addDaysToDateKey(endDate, 1)) : null;
    return items.filter((entry) => {
      const deletedAt = entry.item.deleted_at ?? null;
      if (start !== null && (deletedAt === null || deletedAt < start)) return false;
      if (end !== null && (deletedAt === null || deletedAt >= end)) return false;
      if (!trimmed) return true;
      const haystack = entry.type === "todo"
        ? [entry.item.title, entry.item.description, entry.item.tag].filter(Boolean).join(" ")
        : [entry.item.title, entry.item.description, entry.item.category, entry.item.location].filter(Boolean).join(" ");
      return haystack.toLocaleLowerCase().includes(trimmed);
    });
  }, [endDate, items, query, startDate]);

  function switchMode(next: TrashMode) {
    setMode(next);
    setQuery("");
    setStartDate("");
    setEndDate("");
  }

  async function restore(entry: TrashResult) {
    const key = resultKey(entry);
    setBusyKey(key);
    try {
      const result = entry.type === "todo"
        ? await api.restoreTodos([entry.item.id])
        : await api.restoreSchedules([entry.item.id]);
      const failed = result.results.find((item) => !item.ok);
      if (failed) {
        setStatus(failed.error?.message ?? "恢复失败");
        return;
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
    const ok = await ask({
      title: entry.type === "todo" ? "永久删除待办" : "永久删除日程",
      message: "永久删除后无法恢复，相关附件也会被清除。",
      confirmLabel: "永久删除",
      danger: true
    });
    if (!ok) return;

    const key = resultKey(entry);
    setBusyKey(key);
    try {
      const result = entry.type === "todo"
        ? await api.purgeTodos([entry.item.id])
        : await api.purgeSchedules([entry.item.id]);
      const failed = result.results.find((item) => !item.ok);
      if (failed) {
        setStatus(failed.error?.message ?? "永久删除失败");
        return;
      }
      setItems((prev) => prev.filter((item) => resultKey(item) !== key));
      setStatus("已永久删除");
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "永久删除失败");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="trash-view">
      <div className="trash-topbar">
        <div className="trash-tabs" role="tablist">
          <button
            type="button"
            className={mode === "todo" ? "active" : ""}
            onClick={() => switchMode("todo")}
          >
            ToDo
          </button>
          <button
            type="button"
            className={mode === "schedule" ? "active" : ""}
            onClick={() => switchMode("schedule")}
          >
            Schedule
          </button>
        </div>
        <input
          className="trash-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={mode === "todo" ? "搜索已删除待办" : "搜索已删除日程"}
        />
      </div>

      <div className="trash-filterbar">
        <span>{status || `${filteredItems.length}/${items.length} 项`}</span>
        <div className="trash-date-filters">
          <DatePicker value={startDate} onChange={setStartDate} placeholder="删除开始" />
          <DatePicker value={endDate} onChange={setEndDate} placeholder="删除结束" panelAlign="right" />
        </div>
      </div>

      <div className="trash-list">
        {filteredItems.map((entry) => (
          <article className={`trash-row ${entry.type}`} key={resultKey(entry)}>
            <span className="trash-kind">{entry.type === "todo" ? "ToDo" : "Schedule"}</span>
            <div className="trash-main">
              <strong>{entry.item.title}</strong>
              <div className="trash-meta">{renderMeta(entry)}</div>
              <div className="trash-deleted-at">删除于 {formatDeletedAt(entry.item.deleted_at)}</div>
            </div>
            <div className="trash-actions">
              <button
                type="button"
                className="trash-action-btn restore"
                disabled={busyKey === resultKey(entry)}
                onClick={() => void restore(entry)}
              >
                <RestoreIcon />
                恢复
              </button>
              <button
                type="button"
                className="trash-action-btn purge"
                disabled={busyKey === resultKey(entry)}
                onClick={() => void purge(entry)}
              >
                <PurgeIcon />
                永久删除
              </button>
            </div>
          </article>
        ))}
        {!status && filteredItems.length === 0 ? <div className="empty-state">没有匹配的已删除项目</div> : null}
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
    return (
      <>
        {entry.item.planned_at ? <span>计划 {formatShortDateTime(entry.item.planned_at)}</span> : null}
        {entry.item.due_at ? <span>截止 {formatShortDateTime(entry.item.due_at)}</span> : null}
        {entry.item.tag ? <span>{entry.item.tag}</span> : null}
        <span>{entry.item.completed ? "已完成" : "未完成"}</span>
      </>
    );
  }
  return (
    <>
      <span>{formatShortDateTime(entry.item.start_at)} - {formatShortDateTime(entry.item.end_at)}</span>
      {entry.item.category ? <span>{entry.item.category}</span> : null}
      {entry.item.location ? <span>{entry.item.location}</span> : null}
    </>
  );
}

function formatDeletedAt(epoch?: number | null): string {
  if (!epoch) return "未知时间";
  return formatDateTime(epoch);
}

function formatShortDateTime(epoch: number): string {
  const d = new Date(epoch * 1000);
  const nowYear = new Date().getFullYear();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hm = formatTime(epoch);
  if (year === nowYear) {
    return `${month}-${day} ${hm}`;
  }
  return `${year}-${month}-${day} ${hm}`;
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
