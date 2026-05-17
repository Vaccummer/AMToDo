import { useEffect, useState } from "react";
import type { AMToDoApi } from "../api/client";
import { datetimeLocalFromEpoch, epochFromDatetimeLocal } from "../lib/time";
import { DatePicker } from "./DatePicker";
import { Dropdown } from "./Dropdown";
import { TimeInput } from "./TimeInput";
import { useConfirm } from "./ConfirmDialog";
import { ChangelogPanel } from "./ChangelogPanel";

type MentionDraft = {
  target_type: "todo" | "schedule";
  target_id: string;
};

type Props = {
  api: AMToDoApi;
  editId: number | null;
  initialTriggerAt?: number;
  onClose: () => void;
  onNavigate?: (type: "todo" | "schedule", id: number, action: "jump" | "edit") => void;
  onOpenScheduleDetail?: (id: number) => void;
};

const MENTION_TYPE_OPTIONS = [
  { value: "todo", label: "ToDo" },
  { value: "schedule", label: "Schedule" },
];

function splitDatetime(dt: string) {
  const [date, time] = dt.split("T");
  return { date: date ?? "", time: time ?? "" };
}

function timeKeyValid(key: string) {
  return /^\d{2}:\d{2}(:\d{2})?$/.test(key);
}

export function NotifyFormModal({ api, editId, initialTriggerAt, onClose, onNavigate, onOpenScheduleDetail }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [triggerDate, setTriggerDate] = useState("");
  const [triggerTime, setTriggerTime] = useState("");
  const [mentions, setMentions] = useState<MentionDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(editId));
  const [mentionErrors, setMentionErrors] = useState<Record<number, string>>({});
  const { ask, dialog: confirmDialog } = useConfirm();

  const isEdit = editId !== null;

  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    api
      .getNotification(editId)
      .then((res) => {
        if (cancelled) return;
        const n = res.notification;
        setTitle(n.title);
        setDescription(n.description ?? "");
        const dt = splitDatetime(datetimeLocalFromEpoch(n.trigger_at));
        setTriggerDate(dt.date);
        setTriggerTime(dt.time);
        setMentions(
          n.mentions.map((m) => ({
            target_type: m.target_type,
            target_id: String(m.target_id),
          }))
        );
      })
      .catch(() => {
        /* use empty defaults */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, editId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (editId || !initialTriggerAt) return;
    const dt = splitDatetime(datetimeLocalFromEpoch(initialTriggerAt));
    setTriggerDate(dt.date);
    setTriggerTime(dt.time);
  }, [editId, initialTriggerAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const triggerKey = triggerDate && triggerTime ? `${triggerDate}T${triggerTime}` : "";
  const triggerValid =
    triggerDate &&
    triggerTime &&
    timeKeyValid(triggerTime) &&
    !Number.isNaN(epochFromDatetimeLocal(triggerKey));

  const canSave = title.trim() && triggerValid && !saving && !loading;

  function handleBackdrop(e: React.MouseEvent) {
    if (e.target !== e.currentTarget) return;
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const triggerAt = epochFromDatetimeLocal(triggerKey);
      const mentionPayload = mentions
        .filter((m) => m.target_id.trim() !== "")
        .map((m) => ({
          target_type: m.target_type,
          target_id: Number(m.target_id),
        }));

      if (isEdit && editId !== null) {
        await api.updateNotification(editId, {
          title: title.trim(),
          description: description.trim() || null,
          trigger_at: triggerAt,
          mentions: mentionPayload,
        });
      } else {
        await api.createNotification({
          title: title.trim(),
          description: description.trim() || null,
          trigger_at: triggerAt,
          mentions: mentionPayload,
        });
      }
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (editId === null) return;
    const ok = await ask({
      title: "删除通知",
      message: "确定要删除这条通知吗？此操作不可撤销。",
      confirmLabel: "删除",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteNotification(editId);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  function addMention(type: "todo" | "schedule") {
    setMentions((prev) => [...prev, { target_type: type, target_id: "" }]);
  }

  async function removeMention(index: number) {
    const m = mentions[index];
    if (m && m.target_id.trim()) {
      const ok = await ask({
        title: "移除关联",
        message: `确定要移除 ${m.target_type === "todo" ? "ToDo" : "Schedule"} #${m.target_id} 的关联吗？`,
        confirmLabel: "移除",
        danger: true,
      });
      if (!ok) return;
    }
    setMentions((prev) => prev.filter((_, i) => i !== index));
    setMentionErrors((prev) => {
      if (!(index in prev)) return prev;
      const next = { ...prev };
      delete next[index];
      return next;
    });
  }

  function updateMentionId(index: number, value: string) {
    setMentions((prev) =>
      prev.map((m, i) => (i === index ? { ...m, target_id: value } : m))
    );
    setMentionErrors((prev) => {
      if (!(index in prev)) return prev;
      const next = { ...prev };
      delete next[index];
      return next;
    });
  }

  async function handleMentionClick(index: number, action: "jump" | "edit") {
    const m = mentions[index];
    if (!m || !m.target_id.trim()) return;
    const id = Number(m.target_id);
    try {
      if (m.target_type === "todo") {
        await api.getTodo(id);
      } else {
        await api.getSchedule(id);
      }
      setMentionErrors((prev) => {
        if (!(index in prev)) return prev;
        const next = { ...prev };
        delete next[index];
        return next;
      });
      if (action === "edit" && m.target_type === "schedule" && onOpenScheduleDetail) {
        onOpenScheduleDetail(id);
      } else if (onNavigate) {
        onNavigate(m.target_type, id, action);
      }
    } catch {
      setMentionErrors((prev) => ({ ...prev, [index]: "ID 不存在" }));
    }
  }

  function handleMentionTypeChange(index: number, value: string) {
    setMentions((prev) =>
      prev.map((item, idx) =>
        idx === index
          ? { ...item, target_type: value as "todo" | "schedule" }
          : item
      )
    );
  }

  if (loading) {
    return (
      <div className="schedule-modal-backdrop" onClick={handleBackdrop}>
        <div className="schedule-modal-card" role="dialog" aria-label="通知">
          <div className="schedule-modal-body" style={{ textAlign: "center", padding: "2rem" }}>
            加载中...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="schedule-modal-backdrop"
      onClick={handleBackdrop}
      onKeyDown={handleKeyDown}
    >
      <div className="schedule-modal-card" role="dialog" aria-label={isEdit ? "编辑通知" : "创建通知"}>
        <div className="schedule-modal-header">
          <div className="schedule-modal-header-left">
            <span className="schedule-modal-dot" />
            <h2 className="schedule-modal-title">{isEdit ? "编辑通知" : "创建通知"}{isEdit && editId != null && <span className="notify-modal-id-badge">#{editId}</span>}</h2>
          </div>
          <button
            type="button"
            className="schedule-modal-close"
            onClick={onClose}
            aria-label="关闭"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="schedule-modal-body">
          <div className="schedule-modal-section-label">基本信息</div>

          <div className="schedule-modal-field">
            <label className="schedule-modal-label" htmlFor="nfm-title">标题</label>
            <input
              id="nfm-title"
              type="text"
              className="schedule-modal-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <div className="schedule-modal-field">
            <label className="schedule-modal-label" htmlFor="nfm-desc">描述</label>
            <textarea
              id="nfm-desc"
              className="schedule-modal-textarea"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="schedule-modal-field">
            <label className="schedule-modal-label">触发时间</label>
            <div className="schedule-modal-datetime-row">
              <DatePicker
                value={triggerDate}
                onChange={setTriggerDate}
                hasError={triggerDate !== "" && !triggerValid}
                theme="gold"
              />
              <TimeInput
                className={`schedule-modal-input schedule-modal-datetime-time${triggerDate !== "" && !triggerValid ? " invalid" : ""}`}
                value={triggerTime}
                onChange={setTriggerTime}
              />
            </div>
          </div>

          <div className="schedule-modal-divider" />

          <div className="schedule-modal-section-label">关联项目</div>

          {mentions.map((m, i) => (
            <div className="schedule-modal-field" key={i}>
              <div className="schedule-modal-datetime-row">
                <div className="notify-mention-type-select">
                  <Dropdown
                    value={m.target_type}
                    options={MENTION_TYPE_OPTIONS}
                    onChange={(v) => handleMentionTypeChange(i, v)}
                  />
                </div>
                <input
                  type="number"
                  className={`schedule-modal-input notify-mention-id-input${mentionErrors[i] ? " invalid" : ""}`}
                  placeholder="ID"
                  value={m.target_id}
                  onChange={(e) => updateMentionId(i, e.target.value)}
                />
                <button
                  type="button"
                  className="notify-mention-icon-btn"
                  title="编辑"
                  disabled={!m.target_id.trim()}
                  onClick={() => void handleMentionClick(i, "edit")}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="notify-mention-icon-btn"
                  title="跳转"
                  disabled={!m.target_id.trim() || !onNavigate}
                  onClick={() => void handleMentionClick(i, "jump")}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="notify-mention-icon-btn notify-mention-icon-btn-delete"
                  title="移除"
                  onClick={() => void removeMention(i)}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </div>
              {mentionErrors[i] ? <span className="notify-mention-error">{mentionErrors[i]}</span> : null}
            </div>
          ))}

          <div className="schedule-modal-field">
            <div className="notify-mention-add-group">
              <button
                type="button"
                className="notify-mention-add-btn"
                onClick={() => addMention("todo")}
              >
                <span className="add-btn-icon todo-icon">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
                ToDo
              </button>
              <button
                type="button"
                className="notify-mention-add-btn"
                onClick={() => addMention("schedule")}
              >
                <span className="add-btn-icon sch-icon">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                </span>
                Schedule
              </button>
            </div>
          </div>

          {isEdit && editId !== null && (
            <>
              <div className="schedule-modal-divider" />
              <div className="schedule-modal-section-label">历史记录</div>
              <ChangelogPanel api={api} entityId={editId} kind="notification" />
            </>
          )}
        </div>

        {error ? <div className="schedule-modal-error">{error}</div> : null}

        <div className="schedule-modal-actions">
          <button
            type="button"
            className="schedule-modal-btn schedule-modal-btn-save"
            disabled={!canSave}
            onClick={() => void handleSave()}
          >
            {saving ? "保存中..." : isEdit ? "保存更改" : "创建通知"}
          </button>
          {isEdit ? (
            <button
              type="button"
              className="schedule-modal-btn schedule-modal-btn-delete"
              onClick={() => void handleDelete()}
            >
              删除
            </button>
          ) : (
            <button
              type="button"
              className="schedule-modal-btn schedule-modal-btn-delete"
              onClick={onClose}
            >
              取消
            </button>
          )}
        </div>
        {saving ? <div className="modal-save-progress" aria-label="保存中" /> : null}
      </div>
      {confirmDialog}
    </div>
  );
}
