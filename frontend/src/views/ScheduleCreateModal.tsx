import { useMemo, useState } from "react";
import type { AMToDoApi, ScheduleItem, ScheduleCreateParams } from "../api/client";
import { datetimeLocalFromEpoch, epochFromDatetimeLocal, formatTime } from "../lib/time";
import { DatePicker } from "./DatePicker";
import { TimeInput } from "./TimeInput";
import { useConfirm } from "./ConfirmDialog";

type Props = {
  api: AMToDoApi;
  startAt: number;
  endAt: number;
  onClose: () => void;
  onCreate: (schedule: ScheduleItem) => void;
};

function splitDatetime(dt: string) {
  const [date, time] = dt.split("T");
  return { date: date ?? "", time: time ?? "" };
}

function timeKeyValid(key: string) {
  return /^\d{2}:\d{2}(:\d{2})?$/.test(key);
}

export function ScheduleCreateModal({ api, startAt, endAt, onClose, onCreate }: Props) {
  const initialStart = splitDatetime(datetimeLocalFromEpoch(startAt));
  const initialEnd = splitDatetime(datetimeLocalFromEpoch(endAt));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState(initialStart.date);
  const [startTime, setStartTime] = useState(initialStart.time);
  const [endDate, setEndDate] = useState(initialEnd.date);
  const [endTime, setEndTime] = useState(initialEnd.time);
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ask, dialog: confirmDialog } = useConfirm();

  const startKey = startDate && startTime ? `${startDate}T${startTime}` : "";
  const endKey = endDate && endTime ? `${endDate}T${endTime}` : "";

  const startValid = useMemo(() => {
    if (!startDate || !startTime || !timeKeyValid(startTime)) return false;
    return !Number.isNaN(epochFromDatetimeLocal(startKey));
  }, [startDate, startTime, startKey]);

  const endValid = useMemo(() => {
    if (!endDate || !endTime || !timeKeyValid(endTime)) return false;
    return !Number.isNaN(epochFromDatetimeLocal(endKey));
  }, [endDate, endTime, endKey]);

  const timeline = useMemo(() => {
    if (!startValid || !endValid) return null;
    const sEpoch = epochFromDatetimeLocal(startKey);
    const eEpoch = epochFromDatetimeLocal(endKey);
    if (eEpoch <= sEpoch) return null;
    return {
      startEpoch: sEpoch,
      endEpoch: eEpoch,
      durMins: Math.round((eEpoch - sEpoch) / 60)
    };
  }, [startValid, endValid, startKey, endKey]);

  const dirty = Boolean(
    title.trim() ||
    description.trim() ||
    location.trim() ||
    category.trim() ||
    startKey !== `${initialStart.date}T${initialStart.time}` ||
    endKey !== `${initialEnd.date}T${initialEnd.time}`
  );
  const saveDisabled = !title.trim() || !timeline || saving;

  function handleBackdrop(e: React.MouseEvent) {
    if (e.target !== e.currentTarget) return;
    onClose();
  }

  async function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Escape") return;
    if (dirty) {
      const ok = await ask({
        title: "放弃新建",
        message: "有未保存的新日程，确定关闭吗？",
        confirmLabel: "关闭",
        danger: true,
      });
      if (!ok) return;
    }
    onClose();
  }

  async function handleSave() {
    if (!timeline || !title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const fields: ScheduleCreateParams = {
        title: title.trim(),
        start_at: timeline.startEpoch,
        end_at: timeline.endEpoch,
        description: description.trim() || null,
        location: location.trim() || null,
        category: category.trim() || null,
      };
      const result = await api.createSchedule(fields);
      onCreate(result.schedule);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="schedule-modal-backdrop"
      onClick={handleBackdrop}
      onKeyDown={handleKeyDown}
    >
      <div className="schedule-modal-card" role="dialog" aria-label="创建日程">
        <div className="schedule-modal-header">
          <div className="schedule-modal-header-left">
            <span className="schedule-modal-dot" />
            <h2 className="schedule-modal-title">创建日程</h2>
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
          <div className="schedule-modal-section-label">可编辑字段</div>

          <div className="schedule-modal-field">
            <label className="schedule-modal-label" htmlFor="scm-title">标题</label>
            <input
              id="scm-title"
              type="text"
              className="schedule-modal-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          <div className="schedule-modal-field">
            <label className="schedule-modal-label" htmlFor="scm-desc">描述</label>
            <textarea
              id="scm-desc"
              className="schedule-modal-textarea"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="schedule-modal-field">
            <label className="schedule-modal-label">开始时间</label>
            <div className="schedule-modal-datetime-row">
              <DatePicker
                value={startDate}
                onChange={setStartDate}
                hasError={!startValid && startDate !== ""}
                theme="gold"
              />
              <TimeInput
                className={`schedule-modal-input schedule-modal-datetime-time${!startValid && startDate !== "" ? " invalid" : ""}`}
                value={startTime}
                onChange={setStartTime}
              />
            </div>
          </div>

          <div className="schedule-modal-field">
            <label className="schedule-modal-label">结束时间</label>
            <div className="schedule-modal-datetime-row">
              <DatePicker
                value={endDate}
                onChange={setEndDate}
                hasError={!endValid && endDate !== ""}
                theme="gold"
              />
              <TimeInput
                className={`schedule-modal-input schedule-modal-datetime-time${!endValid && endDate !== "" ? " invalid" : ""}`}
                value={endTime}
                onChange={setEndTime}
              />
            </div>
          </div>

          {timeline ? (
            <div className="schedule-modal-timeline">
              <span className="schedule-modal-timeline-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </span>
              <span className="schedule-modal-timeline-start">{formatTime(timeline.startEpoch)}</span>
              <div className="schedule-modal-timeline-bar" />
              <span className="schedule-modal-timeline-end">{formatTime(timeline.endEpoch)}</span>
              <span className="schedule-modal-timeline-dur">{timeline.durMins} 分钟</span>
            </div>
          ) : null}

          <div className="schedule-modal-field-row">
            <div className="schedule-modal-field">
              <label className="schedule-modal-label" htmlFor="scm-location">地点</label>
              <input
                id="scm-location"
                type="text"
                className="schedule-modal-input"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
            <div className="schedule-modal-field">
              <label className="schedule-modal-label" htmlFor="scm-category">分类</label>
              <input
                id="scm-category"
                type="text"
                className="schedule-modal-input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
          </div>
        </div>

        {error ? <div className="schedule-modal-error">{error}</div> : null}

        <div className="schedule-modal-actions">
          <button
            type="button"
            className="schedule-modal-btn schedule-modal-btn-save"
            disabled={saveDisabled}
            onClick={handleSave}
          >
            {saving ? "创建中..." : "创建日程"}
          </button>
          <button
            type="button"
            className="schedule-modal-btn schedule-modal-btn-delete"
            onClick={onClose}
          >
            取消
          </button>
        </div>
        {saving ? <div className="modal-save-progress" aria-label="创建中" /> : null}
      </div>
      {confirmDialog}
    </div>
  );
}
