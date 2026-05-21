import { useEffect, useState } from "react";
import type { AMToDoApi, ChangelogEntry } from "../../api/client";
import { useI18n } from "../../i18n";
import { Dropdown } from "./Dropdown";

type EntityKind = "todo" | "schedule" | "notification";

type Props = {
  api: AMToDoApi;
  entityId: number;
  kind: EntityKind;
};

export function ChangelogPanel({ api, entityId, kind }: Props) {
  const { t } = useI18n();
  const [action, setAction] = useState("");
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState(t("common.loadingEllipsis"));
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  const actionOptions = [
    { value: "", label: t("changelog.allRecords") },
    { value: "update", label: t("changelog.update") },
    { value: "delete", label: t("changelog.moveToTrash") },
    { value: "restore", label: t("changelog.restore") },
    { value: "attachment_add", label: t("changelog.attachmentAdd") },
    { value: "attachment_remove", label: t("changelog.attachmentRemove") },
    { value: "create", label: t("changelog.create") },
    { value: "purge", label: t("changelog.purge") }
  ];

  const actionLabels: Record<string, string> = {
    create: t("changelog.create"),
    update: t("changelog.update"),
    delete: t("changelog.moveToTrash"),
    restore: t("changelog.restore"),
    purge: t("changelog.purge"),
    attachment_add: t("changelog.attachmentAdd"),
    attachment_remove: t("changelog.attachmentRemove")
  };

  const fieldLabels: Record<string, string> = {
    title: t("common.title"),
    description: t("common.description"),
    planned_at: t("common.plannedTime"),
    due_at: t("common.dueTime"),
    completed: t("common.completedStatus"),
    priority: t("common.priority"),
    tag: t("common.tag"),
    start_at: t("common.startTime"),
    end_at: t("common.endTime"),
    timezone: t("common.timezone"),
    location: t("common.location"),
    category: t("common.category"),
    attachment: t("common.attachments")
  };

  useEffect(() => {
    let cancelled = false;
    setStatus(t("common.loadingEllipsis"));
    setExpanded({});
    const params = { entity_id: entityId, action: action || null, limit: 50, offset: 0 };
    const request = kind === "todo" ? api.todoChangelog(params) : kind === "schedule" ? api.scheduleChangelog(params) : api.notificationChangelog(params);
    request
      .then((result) => {
        if (cancelled) return;
        setEntries(result.entries.map(normalizeEntry));
        setTotal(result.total);
        setStatus(result.entries.length ? "" : t("common.noHistory"));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setEntries([]);
        setTotal(0);
        setStatus(error instanceof Error ? error.message : t("common.historyLoadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [api, action, entityId, kind, t]);

  return (
    <section className="changelog-panel">
      <div className="changelog-toolbar">
        <span>{status || `${entries.length}/${total} ${t("common.items")}`}</span>
        <div className="changelog-filter">
          <Dropdown value={action} options={actionOptions} onChange={setAction} />
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
                <span className="changelog-action">{actionLabels[entry.action] ?? entry.action}</span>
                <span className="changelog-copy">
                  <strong>{entryTitle(entry, fields, actionLabels, fieldLabels, t)}</strong>
                  <span>{formatDateTime(entry.created_at)}</span>
                </span>
                {canExpand ? <span className={`changelog-arrow${open ? " open" : ""}`}>⌄</span> : null}
              </button>
              {open ? (
                <div className="changelog-diff">
                  {fields.length > 0 ? (
                    fields.map((field) => (
                      <div className="changelog-diff-row" key={field}>
                        <span className="changelog-field-name">{fieldLabels[field] ?? field}</span>
                        <span className="changelog-before">{t("changelog.oldValue")}{formatSnapshotValue(entry.before_snapshot?.[field], t)}</span>
                        <span className="changelog-after">{t("changelog.newValue")}{formatSnapshotValue(entry.after_snapshot?.[field], t)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="changelog-diff-row">
                      <span className="changelog-field-name">{t("changelog.summary")}</span>
                      <span className="changelog-after">{snapshotSummary(entry) ?? t("changelog.noDiff")}</span>
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

function entryTitle(
  entry: ChangelogEntry,
  fields: string[],
  actionLabels: Record<string, string>,
  fieldLabels: Record<string, string>,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  if (entry.action === "update" && fields.length > 0) {
    const fieldNames = fields.map((field) => fieldLabels[field] ?? field).join(t("changelog.fieldSeparator"));
    return t("changelog.updatedFields", { fields: fieldNames });
  }
  if (entry.action === "attachment_add" || entry.action === "attachment_remove") {
    return attachmentName(entry) ?? (actionLabels[entry.action] ?? entry.action);
  }
  return actionLabels[entry.action] ?? entry.action;
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

function formatSnapshotValue(value: unknown, t: (key: string) => string): string {
  if (value === null || value === undefined || value === "") return t("common.empty");
  if (typeof value === "boolean") return value ? t("common.yes") : t("common.no");
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
