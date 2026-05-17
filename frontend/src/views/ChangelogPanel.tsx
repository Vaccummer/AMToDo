import { useEffect, useState } from "react";
import type { AMToDoApi, ChangelogEntry } from "../api/client";
import { Dropdown } from "./Dropdown";

type EntityKind = "todo" | "schedule" | "notification";

type Props = {
  api: AMToDoApi;
  entityId: number;
  kind: EntityKind;
};

const ACTION_OPTIONS = [
  { value: "", label: "全部记录" },
  { value: "update", label: "修改" },
  { value: "delete", label: "移入回收站" },
  { value: "restore", label: "恢复" },
  { value: "attachment_add", label: "附件新增" },
  { value: "attachment_remove", label: "附件删除" },
  { value: "create", label: "创建" },
  { value: "purge", label: "永久删除" }
];

const ACTION_LABELS: Record<string, string> = {
  create: "创建",
  update: "修改",
  delete: "移入回收站",
  restore: "恢复",
  purge: "永久删除",
  attachment_add: "附件新增",
  attachment_remove: "附件删除"
};

const FIELD_LABELS: Record<string, string> = {
  title: "标题",
  description: "描述",
  planned_at: "计划时间",
  due_at: "截止时间",
  completed: "完成状态",
  priority: "优先级",
  tag: "标签",
  start_at: "开始时间",
  end_at: "结束时间",
  timezone: "时区",
  location: "地点",
  category: "分类",
  attachment: "附件"
};

export function ChangelogPanel({ api, entityId, kind }: Props) {
  const [action, setAction] = useState("");
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("加载中");
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    setStatus("加载中");
    setExpanded({});
    const params = { entity_id: entityId, action: action || null, limit: 50, offset: 0 };
    const request = kind === "todo" ? api.todoChangelog(params) : kind === "schedule" ? api.scheduleChangelog(params) : api.notificationChangelog(params);
    request
      .then((result) => {
        if (cancelled) return;
        setEntries(result.entries.map(normalizeEntry));
        setTotal(result.total);
        setStatus(result.entries.length ? "" : "暂无历史记录");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setEntries([]);
        setTotal(0);
        setStatus(error instanceof Error ? error.message : "历史记录加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, [api, action, entityId, kind]);

  return (
    <section className="changelog-panel">
      <div className="changelog-toolbar">
        <span>{status || `${entries.length}/${total} 条`}</span>
        <div className="changelog-filter">
          <Dropdown value={action} options={ACTION_OPTIONS} onChange={setAction} />
        </div>
      </div>

      <div className="changelog-list">
        {entries.map((entry) => {
          const fields = changedFields(entry);
          const open = expanded[entry.id] ?? false;
          const canExpand = fields.length > 0 || Boolean(snapshotSummary(entry));
          return (
            <article className={`changelog-entry action-${entry.action}`} key={entry.id}>
              <button
                type="button"
                className="changelog-entry-main"
                disabled={!canExpand}
                onClick={() => setExpanded((prev) => ({ ...prev, [entry.id]: !open }))}
              >
                <span className="changelog-action">{ACTION_LABELS[entry.action] ?? entry.action}</span>
                <span className="changelog-copy">
                  <strong>{entryTitle(entry, fields)}</strong>
                  <span>{formatDateTime(entry.created_at)}</span>
                </span>
                {canExpand ? <span className={`changelog-arrow${open ? " open" : ""}`}>⌄</span> : null}
              </button>
              {open ? (
                <div className="changelog-diff">
                  {fields.length > 0 ? (
                    fields.map((field) => (
                      <div className="changelog-diff-row" key={field}>
                        <span className="changelog-field-name">{FIELD_LABELS[field] ?? field}</span>
                        <span className="changelog-before">旧：{formatSnapshotValue(entry.before_snapshot?.[field])}</span>
                        <span className="changelog-after">新：{formatSnapshotValue(entry.after_snapshot?.[field])}</span>
                      </div>
                    ))
                  ) : (
                    <div className="changelog-diff-row">
                      <span className="changelog-field-name">摘要</span>
                      <span className="changelog-after">{snapshotSummary(entry) ?? "无字段差异"}</span>
                    </div>
                  )}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function normalizeEntry(entry: ChangelogEntry): ChangelogEntry {
  return {
    ...entry,
    changed_fields: normalizeChangedFields(entry.changed_fields)
  };
}

function normalizeChangedFields(fields: unknown): string[] {
  if (Array.isArray(fields)) return fields.map(String);
  if (typeof fields === "string") {
    try {
      const parsed = JSON.parse(fields);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return fields ? [fields] : [];
    }
  }
  return [];
}

function changedFields(entry: ChangelogEntry): string[] {
  if (entry.changed_fields.length > 0) return entry.changed_fields;
  if (entry.action !== "update" || !entry.before_snapshot || !entry.after_snapshot) return [];
  const keys = new Set([...Object.keys(entry.before_snapshot), ...Object.keys(entry.after_snapshot)]);
  return Array.from(keys).filter((key) => entry.before_snapshot?.[key] !== entry.after_snapshot?.[key]);
}

function entryTitle(entry: ChangelogEntry, fields: string[]): string {
  if (entry.action === "update" && fields.length > 0) {
    return `修改了 ${fields.map((field) => FIELD_LABELS[field] ?? field).join("、")}`;
  }
  if (entry.action === "attachment_add" || entry.action === "attachment_remove") {
    return attachmentName(entry) ?? (ACTION_LABELS[entry.action] ?? entry.action);
  }
  return ACTION_LABELS[entry.action] ?? entry.action;
}

function attachmentName(entry: ChangelogEntry): string | null {
  const snapshot = entry.after_snapshot ?? entry.before_snapshot;
  const filename = snapshot?.filename;
  return typeof filename === "string" ? filename : null;
}

function snapshotSummary(entry: ChangelogEntry): string | null {
  const snapshot = entry.after_snapshot ?? entry.before_snapshot;
  if (!snapshot) return null;
  const title = snapshot.title;
  if (typeof title === "string") return title;
  const filename = snapshot.filename;
  if (typeof filename === "string") return filename;
  return null;
}

function formatSnapshotValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "空";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number" && value > 1_000_000_000 && value < 4_102_444_800) {
    return formatDateTime(value);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
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
