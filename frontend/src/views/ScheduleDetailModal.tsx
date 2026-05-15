import { useCallback, useEffect, useMemo, useState } from "react";
import type { AMToDoApi, ScheduleItem, ScheduleUpdateRequest } from "../api/client";
import { datetimeLocalFromEpoch, epochFromDatetimeLocal, formatTime } from "../lib/time";
import { DatePicker } from "./DatePicker";

type Props = {
  schedule: ScheduleItem;
  api: AMToDoApi;
  onClose: () => void;
  onDelete: (id: number) => void;
  onUpdate: (schedule: ScheduleItem) => void;
};

function splitDatetime(dt: string) {
  const [date, time] = dt.split("T");
  return { date: date ?? "", time: time ?? "" };
}

function timeKeyValid(key: string) {
  return /^\d{2}:\d{2}(:\d{2})?$/.test(key);
}

function fmtDatetime(epoch: number): string {
  const d = new Date(epoch * 1000);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${mo}-${day} ${h}:${mi}:${s}`;
}

export function ScheduleDetailModal({ schedule: initial, api, onClose, onDelete, onUpdate }: Props) {
  const [schedule, setSchedule] = useState<ScheduleItem>(initial);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [startDate, setStartDate] = useState(
    splitDatetime(datetimeLocalFromEpoch(initial.start_at)).date
  );
  const [startTime, setStartTime] = useState(
    splitDatetime(datetimeLocalFromEpoch(initial.start_at)).time
  );
  const [endDate, setEndDate] = useState(
    splitDatetime(datetimeLocalFromEpoch(initial.end_at)).date
  );
  const [endTime, setEndTime] = useState(
    splitDatetime(datetimeLocalFromEpoch(initial.end_at)).time
  );
  const [location, setLocation] = useState(initial.location ?? "");
  const [category, setCategory] = useState(initial.category ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch full schedule on mount (the list item may lack some fields)
  useEffect(() => {
    api.getSchedule(schedule.id).then((r) => {
      const s = r.schedule;
      setSchedule(s);
      setTitle(s.title);
      setDescription(s.description ?? "");
      setStartDate(splitDatetime(datetimeLocalFromEpoch(s.start_at)).date);
      setStartTime(splitDatetime(datetimeLocalFromEpoch(s.start_at)).time);
      setEndDate(splitDatetime(datetimeLocalFromEpoch(s.end_at)).date);
      setEndTime(splitDatetime(datetimeLocalFromEpoch(s.end_at)).time);
      setLocation(s.location ?? "");
      setCategory(s.category ?? "");
    }).catch(() => { /* keep initial data */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startKey = startDate && startTime ? `${startDate}T${startTime}` : "";
  const endKey = endDate && endTime ? `${endDate}T${endTime}` : "";

  function handleStartTimeChange(value: string) {
    setStartTime(value);
  }

  function handleEndTimeChange(value: string) {
    setEndTime(value);
  }

  // Validation
  const startValid = useMemo(() => {
    if (!startDate || !startTime || !timeKeyValid(startTime)) return false;
    return !isNaN(epochFromDatetimeLocal(startKey));
  }, [startDate, startTime, startKey]);

  const endValid = useMemo(() => {
    if (!endDate || !endTime || !timeKeyValid(endTime)) return false;
    return !isNaN(epochFromDatetimeLocal(endKey));
  }, [endDate, endTime, endKey]);

  // Dirty tracking: compare form fields against the fetched schedule
  const dirty = useMemo(() => {
    return (
      title !== schedule.title ||
      description !== (schedule.description ?? "") ||
      (startKey ? epochFromDatetimeLocal(startKey) : null) !== schedule.start_at ||
      (endKey ? epochFromDatetimeLocal(endKey) : null) !== schedule.end_at ||
      location !== (schedule.location ?? "") ||
      category !== (schedule.category ?? "")
    );
  }, [title, description, startKey, endKey, location, category, schedule]);

  // Timeline bar data
  const timeline = useMemo(() => {
    if (!startValid || !endValid) return null;
    const sEpoch = epochFromDatetimeLocal(startKey);
    const eEpoch = epochFromDatetimeLocal(endKey);
    if (eEpoch <= sEpoch) return null;
    const durMins = Math.round((eEpoch - sEpoch) / 60);
    return { startEpoch: sEpoch, endEpoch: eEpoch, durMins };
  }, [startValid, endValid, startKey, endKey]);

  const saveDisabled = !dirty || !startValid || !endValid || saving;

  // ── Backdrop & keyboard ──

  const handleBackdrop = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) return;
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (dirty && !window.confirm("有未保存的更改，确定关闭吗？")) return;
      onClose();
    }
  }

  // ── Save ──

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const fields: ScheduleUpdateRequest = {};
      if (title !== schedule.title) fields.title = title;
      if (description !== (schedule.description ?? "")) {
        fields.description = description || null;
      }
      const newStart = startKey ? epochFromDatetimeLocal(startKey) : null;
      if (newStart !== schedule.start_at) fields.start_at = newStart;
      const newEnd = endKey ? epochFromDatetimeLocal(endKey) : null;
      if (newEnd !== schedule.end_at) fields.end_at = newEnd;
      if (location !== (schedule.location ?? "")) {
        fields.location = location || null;
      }
      if (category !== (schedule.category ?? "")) {
        fields.category = category || null;
      }

      if (Object.keys(fields).length === 0) {
        onClose();
        return;
      }

      const result = await api.updateSchedule(schedule.id, fields);
      onUpdate(result.schedule);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ──

  async function handleDelete() {
    if (!window.confirm("确定删除这条日程吗？此操作不可撤销。")) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteSchedule(schedule.id);
      onDelete(schedule.id);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "删除失败");
      setDeleting(false);
    }
  }

  // ── Render ──

  return (
    <div
      className="schedule-modal-backdrop"
      onClick={handleBackdrop}
      onKeyDown={handleKeyDown}
    >
      <div className="schedule-modal-card" role="dialog" aria-label="日程详情">
        {/* Header */}
        <div className="schedule-modal-header">
          <div className="schedule-modal-header-left">
            <span className="schedule-modal-dot" />
            <h2 className="schedule-modal-title">日程详情</h2>
          </div>
          <button
            type="button"
            className="schedule-modal-close"
            onClick={onClose}
            aria-label="关闭"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="schedule-modal-body">
          {/* Editable fields */}
          <div className="schedule-modal-section-label">可编辑字段</div>

          <div className="schedule-modal-field">
            <label className="schedule-modal-label" htmlFor="smd-title">
              标题
            </label>
            <input
              id="smd-title"
              type="text"
              className="schedule-modal-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="schedule-modal-field">
            <label className="schedule-modal-label" htmlFor="smd-desc">
              描述
            </label>
            <textarea
              id="smd-desc"
              className="schedule-modal-textarea"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Start datetime */}
          <div className="schedule-modal-field">
            <label className="schedule-modal-label">
              开始时间
            </label>
            <div className="schedule-modal-datetime-row">
              <DatePicker
                value={startDate}
                onChange={setStartDate}
                hasError={!startValid && startDate !== ""}
                theme="gold"
              />
              <input
                type="text"
                className={`schedule-modal-input schedule-modal-datetime-time${!startValid && startDate !== "" ? " invalid" : ""}`}
                value={startTime}
                placeholder="HH:MM:SS"
                maxLength={8}
                onChange={(e) => handleStartTimeChange(e.target.value)}
              />
            </div>
          </div>

          {/* End datetime */}
          <div className="schedule-modal-field">
            <label className="schedule-modal-label">
              结束时间
            </label>
            <div className="schedule-modal-datetime-row">
              <DatePicker
                value={endDate}
                onChange={setEndDate}
                hasError={!endValid && endDate !== ""}
                theme="gold"
              />
              <input
                type="text"
                className={`schedule-modal-input schedule-modal-datetime-time${!endValid && endDate !== "" ? " invalid" : ""}`}
                value={endTime}
                placeholder="HH:MM:SS"
                maxLength={8}
                onChange={(e) => handleEndTimeChange(e.target.value)}
              />
            </div>
          </div>

          {/* Timeline bar */}
          {timeline ? (
            <div className="schedule-modal-timeline">
              <span className="schedule-modal-timeline-icon">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </span>
              <span className="schedule-modal-timeline-start">
                {formatTime(timeline.startEpoch)}
              </span>
              <div className="schedule-modal-timeline-bar" />
              <span className="schedule-modal-timeline-end">
                {formatTime(timeline.endEpoch)}
              </span>
              {timeline.durMins ? (
                <span className="schedule-modal-timeline-dur">
                  {timeline.durMins} 分钟
                </span>
              ) : null}
            </div>
          ) : null}

          {/* Location & Category */}
          <div className="schedule-modal-field-row">
            <div className="schedule-modal-field">
              <label className="schedule-modal-label" htmlFor="smd-location">
                地点
              </label>
              <input
                id="smd-location"
                type="text"
                className="schedule-modal-input"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
            <div className="schedule-modal-field">
              <label className="schedule-modal-label" htmlFor="smd-category">
                分类
              </label>
              <input
                id="smd-category"
                type="text"
                className="schedule-modal-input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </div>
          </div>

          {/* Divider */}
          <div className="schedule-modal-divider" />

          {/* Read-only fields */}
          <div className="schedule-modal-section-label">只读信息</div>

          <div className="schedule-modal-ro-field">
            <span className="schedule-modal-ro-label">ID</span>
            <span className="schedule-modal-ro-value">{schedule.id}</span>
          </div>

          <div className="schedule-modal-ro-field">
            <span className="schedule-modal-ro-label">创建时间</span>
            <span className="schedule-modal-ro-value">{fmtDatetime(schedule.created_at)}</span>
          </div>

          <div className="schedule-modal-ro-field">
            <span className="schedule-modal-ro-label">更新时间</span>
            <span className="schedule-modal-ro-value">{fmtDatetime(schedule.updated_at)}</span>
          </div>
        </div>

        {/* Error */}
        {error ? <div className="schedule-modal-error">{error}</div> : null}

        {/* Actions */}
        <div className="schedule-modal-actions">
          <button
            type="button"
            className="schedule-modal-btn schedule-modal-btn-save"
            disabled={saveDisabled}
            onClick={handleSave}
          >
            {saving ? "保存中..." : "保存更改"}
          </button>
          <button
            type="button"
            className="schedule-modal-btn schedule-modal-btn-delete"
            disabled={deleting}
            onClick={handleDelete}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
            {deleting ? "删除中..." : "删除"}
          </button>
        </div>
      </div>
    </div>
  );
}
