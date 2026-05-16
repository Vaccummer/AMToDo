import { useEffect, useState } from "react";
import type { AMToDoApi, NotificationMentionItem } from "../api/client";
import { datetimeLocalFromEpoch, epochFromDatetimeLocal } from "../lib/time";
import { DatePicker } from "./DatePicker";
import { TimeInput } from "./TimeInput";

type MentionDraft = {
  target_type: "todo" | "schedule";
  target_id: string;
};

type Props = {
  api: AMToDoApi;
  editId: number | null;
  onClose: () => void;
};

function splitDatetime(dt: string) {
  const [date, time] = dt.split("T");
  return { date: date ?? "", time: time ?? "" };
}

function timeKeyValid(key: string) {
  return /^\d{2}:\d{2}(:\d{2})?$/.test(key);
}

export function NotificationFormModal({ api, editId, onClose }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [triggerDate, setTriggerDate] = useState("");
  const [triggerTime, setTriggerTime] = useState("");
  const [mentions, setMentions] = useState<MentionDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(editId));

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

  function addMention(type: "todo" | "schedule") {
    setMentions((prev) => [...prev, { target_type: type, target_id: "" }]);
  }

  function removeMention(index: number) {
    setMentions((prev) => prev.filter((_, i) => i !== index));
  }

  function updateMentionId(index: number, value: string) {
    setMentions((prev) =>
      prev.map((m, i) => (i === index ? { ...m, target_id: value } : m))
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
            <h2 className="schedule-modal-title">{isEdit ? "编辑通知" : "创建通知"}</h2>
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
                <select
                  className="schedule-modal-input"
                  value={m.target_type}
                  onChange={(e) =>
                    setMentions((prev) =>
                      prev.map((item, idx) =>
                        idx === i
                          ? { ...item, target_type: e.target.value as "todo" | "schedule" }
                          : item
                      )
                    )
                  }
                >
                  <option value="todo">ToDo</option>
                  <option value="schedule">Schedule</option>
                </select>
                <input
                  type="number"
                  className="schedule-modal-input"
                  placeholder="ID"
                  value={m.target_id}
                  onChange={(e) => updateMentionId(i, e.target.value)}
                />
                <button
                  type="button"
                  className="schedule-modal-btn schedule-modal-btn-delete"
                  onClick={() => removeMention(i)}
                >
                  移除
                </button>
              </div>
            </div>
          ))}

          <div className="schedule-modal-field" style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              className="schedule-modal-btn schedule-modal-btn-save"
              onClick={() => addMention("todo")}
            >
              + ToDo
            </button>
            <button
              type="button"
              className="schedule-modal-btn schedule-modal-btn-save"
              onClick={() => addMention("schedule")}
            >
              + Schedule
            </button>
          </div>
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
          <button
            type="button"
            className="schedule-modal-btn schedule-modal-btn-delete"
            onClick={onClose}
          >
            取消
          </button>
        </div>
        {saving ? <div className="modal-save-progress" aria-label="保存中" /> : null}
      </div>
    </div>
  );
}
