import { useCallback, useEffect, useMemo, useState } from "react";
import type { AMToDoApi, TodoItem } from "../api/client";
import { datetimeLocalFromEpoch, epochFromDatetimeLocal } from "../lib/time";
import { DatePicker } from "./DatePicker";

type Props = {
  todo: TodoItem;
  api: AMToDoApi;
  onClose: () => void;
  onDelete: (id: number) => void;
  onUpdate: (todo: TodoItem) => void;
};

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

function splitDatetime(dt: string) {
  const [date, time] = dt.split("T");
  return { date: date ?? "", time: time ?? "" };
}

function timeKeyValid(key: string) {
  return /^\d{2}:\d{2}(:\d{2})?$/.test(key);
}

export function TodoDetailModal({ todo: initial, api, onClose, onDelete, onUpdate }: Props) {
  const [todo, setTodo] = useState<TodoItem>(initial);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [plannedDate, setPlannedDate] = useState(
    initial.planned_at ? splitDatetime(datetimeLocalFromEpoch(initial.planned_at)).date : ""
  );
  const [plannedTime, setPlannedTime] = useState(
    initial.planned_at ? splitDatetime(datetimeLocalFromEpoch(initial.planned_at)).time : ""
  );
  const [dueDate, setDueDate] = useState(
    initial.due_at ? splitDatetime(datetimeLocalFromEpoch(initial.due_at)).date : ""
  );
  const [dueTime, setDueTime] = useState(
    initial.due_at ? splitDatetime(datetimeLocalFromEpoch(initial.due_at)).time : ""
  );

  const plannedAtKey = plannedDate && plannedTime ? `${plannedDate}T${plannedTime}` : "";
  const dueAtKey = dueDate && dueTime ? `${dueDate}T${dueTime}` : "";
  const [priority, setPriority] = useState(String(initial.priority));
  const [tag, setTag] = useState(initial.tag ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // fetch full todo on mount (the list item may omit fields)
  useEffect(() => {
    api.getTodo(todo.id).then((r) => {
      const t = r.todo;
      setTodo(t);
      setTitle(t.title);
      setDescription(t.description ?? "");
      setPlannedDate(t.planned_at ? splitDatetime(datetimeLocalFromEpoch(t.planned_at)).date : "");
      setPlannedTime(t.planned_at ? splitDatetime(datetimeLocalFromEpoch(t.planned_at)).time : "");
      setDueDate(t.due_at ? splitDatetime(datetimeLocalFromEpoch(t.due_at)).date : "");
      setDueTime(t.due_at ? splitDatetime(datetimeLocalFromEpoch(t.due_at)).time : "");
      setPriority(String(t.priority));
      setTag(t.tag ?? "");
    }).catch(() => { /* use initial data */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => {
    return (
      title !== todo.title ||
      description !== (todo.description ?? "") ||
      plannedAtKey !== (todo.planned_at ? datetimeLocalFromEpoch(todo.planned_at) : "") ||
      dueAtKey !== (todo.due_at ? datetimeLocalFromEpoch(todo.due_at) : "") ||
      Number(priority) !== todo.priority ||
      tag !== (todo.tag ?? "")
    );
  }, [title, description, plannedAtKey, dueAtKey, priority, tag, todo]);

  const plannedAtError = useMemo(
    () => !plannedDate || !plannedTime || !timeKeyValid(plannedTime) || isNaN(epochFromDatetimeLocal(plannedAtKey)),
    [plannedDate, plannedTime, plannedAtKey]
  );

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) return;
    },
    []
  );

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const fields: Record<string, unknown> = {};
      if (title !== todo.title) fields.title = title;
      if (description !== (todo.description ?? "")) fields.description = description || null;
      const newPlanned = plannedAtKey ? epochFromDatetimeLocal(plannedAtKey) : null;
      if (newPlanned !== todo.planned_at) fields.planned_at = newPlanned;
      const newDue = dueAtKey ? epochFromDatetimeLocal(dueAtKey) : null;
      if (newDue !== todo.due_at) fields.due_at = newDue;
      const newPriority = Number(priority);
      if (newPriority !== todo.priority) fields.priority = newPriority;
      if (tag !== (todo.tag ?? "")) fields.tag = tag || null;

      if (Object.keys(fields).length === 0) {
        onClose();
        return;
      }

      const result = await api.updateTodo(todo.id, fields);
      onUpdate(result.todo);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("确定删除这条待办吗？此操作不可撤销。")) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteTodo(todo.id);
      onDelete(todo.id);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "删除失败");
      setDeleting(false);
    }
  }

  async function toggleCompleted() {
    try {
      if (todo.completed) {
        await api.reopenTodo(todo.id);
      } else {
        await api.completeTodo(todo.id);
      }
      const updated = { ...todo, completed: !todo.completed, completed_at: todo.completed ? null : Math.floor(Date.now() / 1000) };
      setTodo(updated);
      onUpdate(updated);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "操作失败");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (dirty && !window.confirm("有未保存的更改，确定关闭吗？")) return;
      onClose();
    }
  }

  return (
    <div className="modal-backdrop" onClick={handleBackdrop} onKeyDown={handleKeyDown}>
      <div className="modal-card" role="dialog" aria-label="待办详情">
        <div className="modal-header">
          <h2 className="modal-title">待办详情</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          {/* Editable fields */}
          <div className="modal-section-label">可编辑字段</div>

          <div className="modal-field">
            <label className="modal-field-label" htmlFor="md-title">标题</label>
            <input
              id="md-title"
              type="text"
              className="modal-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="modal-field">
            <label className="modal-field-label" htmlFor="md-desc">描述</label>
            <textarea
              id="md-desc"
              className="modal-textarea"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="modal-field">
            <label className="modal-field-label">计划日期</label>
            <div className="modal-datetime-row">
              <DatePicker
                value={plannedDate}
                onChange={setPlannedDate}
                hasError={plannedAtError && plannedDate !== ""}
                theme="green"
              />
              <input
                type="text"
                className={`modal-input modal-datetime-time${plannedAtError && plannedDate ? " invalid" : ""}`}
                value={plannedTime}
                placeholder="HH:MM:SS"
                maxLength={8}
                onChange={(e) => setPlannedTime(e.target.value)}
              />
            </div>
            {plannedAtError ? (
              <span className="modal-field-hint">请填写有效的计划日期和时间 (如 14:30:00)</span>
            ) : null}
          </div>

          <div className="modal-field">
            <label className="modal-field-label">截止日期</label>
            <div className="modal-datetime-row">
              <DatePicker
                value={dueDate}
                onChange={setDueDate}
                theme="green"
              />
              <input
                type="text"
                className="modal-input modal-datetime-time"
                value={dueTime}
                placeholder="HH:MM:SS"
                maxLength={8}
                onChange={(e) => setDueTime(e.target.value)}
              />
            </div>
          </div>

          <div className="modal-field-row">
            <div className="modal-field modal-field-half">
              <label className="modal-field-label" htmlFor="md-priority">优先级</label>
              <input
                id="md-priority"
                type="number"
                className="modal-input"
                min={0}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
            </div>
            <div className="modal-field modal-field-half">
              <label className="modal-field-label" htmlFor="md-tag">标签</label>
              <input
                id="md-tag"
                type="text"
                className="modal-input"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
              />
            </div>
          </div>

          {/* Divider */}
          <div className="modal-divider" />

          {/* Read-only fields */}
          <div className="modal-section-label">只读信息</div>

          <div className="modal-field">
            <span className="modal-field-label">ID</span>
            <span className="modal-field-value">{todo.id}</span>
          </div>

          <div className="modal-field">
            <span className="modal-field-label">创建时间</span>
            <span className="modal-field-value">{fmtDatetime(todo.created_at)}</span>
          </div>

          <div className="modal-field">
            <span className="modal-field-label">更新时间</span>
            <span className="modal-field-value">{fmtDatetime(todo.updated_at)}</span>
          </div>

          <div className="modal-field">
            <span className="modal-field-label">完成状态</span>
            <button
              type="button"
              className={`modal-toggle ${todo.completed ? "on" : ""}`}
              onClick={toggleCompleted}
            >
              <span className="modal-toggle-knob" />
              <span className="modal-toggle-label">
                {todo.completed ? "已完成" : "未完成"}
              </span>
            </button>
          </div>

          {todo.completed_at ? (
            <div className="modal-field">
              <span className="modal-field-label">完成时间</span>
              <span className="modal-field-value">{fmtDatetime(todo.completed_at)}</span>
            </div>
          ) : null}
        </div>

        {error ? <div className="modal-error">{error}</div> : null}

        <div className="modal-actions">
          <button
            type="button"
            className="modal-btn modal-btn-save"
            disabled={!dirty || saving || plannedAtError}
            onClick={handleSave}
          >
            {saving ? "保存中..." : "保存更改"}
          </button>
          <button
            type="button"
            className="modal-btn modal-btn-delete"
            disabled={deleting}
            onClick={handleDelete}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
