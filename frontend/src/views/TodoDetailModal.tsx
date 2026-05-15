import { useCallback, useEffect, useMemo, useState } from "react";
import type { AMToDoApi, AttachmentMetadata, TodoItem } from "../api/client";
import { getAttachmentBlob } from "../lib/attachmentCache";
import { datetimeLocalFromEpoch, epochFromDatetimeLocal } from "../lib/time";
import { DatePicker } from "./DatePicker";
import { useConfirm } from "./ConfirmDialog";

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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
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
  const [attachments, setAttachments] = useState<AttachmentMetadata[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<number, string>>({});
  const [attachmentLoading, setAttachmentLoading] = useState<Record<number, boolean>>({});
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [preview, setPreview] = useState<AttachmentMetadata | null>(null);
  const [attachmentsChanged, setAttachmentsChanged] = useState(false);
  const { ask, dialog: confirmDialog } = useConfirm();

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

  const loadAttachments = useCallback(async () => {
    const result = await api.listTodoAttachments(todo.id);
    setAttachments(result.attachments);
    await Promise.all(
      result.attachments.map(async (attachment) => {
        if (attachment.preview_kind === "none") return;
        setAttachmentLoading((prev) => ({ ...prev, [attachment.id]: true }));
        try {
          const { blob } = await getAttachmentBlob(api, attachment);
          const url = URL.createObjectURL(blob);
          setAttachmentUrls((prev) => ({ ...prev, [attachment.id]: url }));
        } catch {
          // 单个文件加载失败不影响其他
        } finally {
          setAttachmentLoading((prev) => {
            const next = { ...prev };
            delete next[attachment.id];
            return next;
          });
        }
      })
    );
  }, [api, todo.id]);

  useEffect(() => {
    loadAttachments().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "附件加载失败");
    });
  }, [loadAttachments]);

  useEffect(() => {
    return () => {
      Object.values(attachmentUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [attachmentUrls]);

  const dirty = useMemo(() => {
    return (
      attachmentsChanged ||
      title !== todo.title ||
      description !== (todo.description ?? "") ||
      plannedAtKey !== (todo.planned_at ? datetimeLocalFromEpoch(todo.planned_at) : "") ||
      dueAtKey !== (todo.due_at ? datetimeLocalFromEpoch(todo.due_at) : "") ||
      Number(priority) !== todo.priority ||
      tag !== (todo.tag ?? "")
    );
  }, [attachmentsChanged, title, description, plannedAtKey, dueAtKey, priority, tag, todo]);

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
    const ok = await ask({
      title: "删除待办",
      message: "确定删除这条待办吗？此操作不可撤销。",
      confirmLabel: "删除",
      danger: true,
    });
    if (!ok) return;
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

  async function uploadFiles(files: FileList | File[]) {
    const selected = Array.from(files);
    if (selected.length === 0) return;

    // Check per-file size limit
    for (const file of selected) {
      if (file.size > api.maxAttachmentSize) {
        setError(`文件 "${file.name}" 大小 (${formatSize(file.size)}) 超过上限 (${formatSize(api.maxAttachmentSize)})`);
        return;
      }
    }

    // Check attachment count limit
    if (attachments.length + selected.length > api.maxAttachmentsPerTodo) {
      setError(`附件总数将超过上限 (${api.maxAttachmentsPerTodo})`);
      return;
    }

    setAttachmentBusy(true);
    setError(null);
    try {
      for (const file of selected) {
        await api.uploadTodoAttachment(todo.id, file);
      }
      setAttachmentsChanged(true);
      await loadAttachments();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "附件上传失败");
    } finally {
      setAttachmentBusy(false);
      setDragActive(false);
    }
  }

  async function openAttachment(attachment: AttachmentMetadata) {
    setDownloadingId(attachment.id);
    setError(null);
    try {
      const { blob } = await getAttachmentBlob(api, attachment);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "附件打开失败");
    } finally {
      setDownloadingId(null);
    }
  }

  async function removeAttachment(attachment: AttachmentMetadata) {
    const ok = await ask({
      title: "删除附件",
      message: `确定删除附件「${attachment.filename}」吗？`,
      confirmLabel: "删除",
      danger: true,
    });
    if (!ok) return;
    setAttachmentBusy(true);
    setError(null);
    try {
      await api.removeTodoAttachment(todo.id, attachment.id);
      setAttachmentsChanged(true);
      await loadAttachments();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "附件删除失败");
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (dirty) {
        const ok = await ask({
          title: "放弃更改",
          message: "有未保存的更改，确定关闭吗？",
          confirmLabel: "关闭",
          danger: true,
        });
        if (!ok) return;
      }
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

          <div className="modal-section-label">附件</div>
          <div
            className={`attachment-dropzone${dragActive ? " active" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              uploadFiles(e.dataTransfer.files);
            }}
          >
            <span>{attachmentBusy ? "处理中..." : "拖拽文件到这里"}</span>
            <label className="attachment-upload-button" htmlFor="todo-attachment-input">
              选择文件
            </label>
            <input
              id="todo-attachment-input"
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) uploadFiles(e.target.files);
                e.currentTarget.value = "";
              }}
            />
          </div>

          <div className="attachment-list">
            {attachments.map((attachment) => {
              const url = attachmentUrls[attachment.id];
              return (
                <div className="attachment-row" key={attachment.id}>
                  <button
                    type="button"
                    className="attachment-thumb"
                    onClick={() => {
                      if (attachment.preview_kind === "none") {
                        openAttachment(attachment);
                      } else {
                        setPreview(attachment);
                      }
                    }}
                    aria-label={`打开 ${attachment.filename}`}
                  >
                    {attachment.preview_kind === "image" && url ? (
                      <img src={url} alt="" />
                    ) : attachment.preview_kind === "video" && url ? (
                      <video src={url} muted />
                    ) : attachmentLoading[attachment.id] ? (
                      <span className="attachment-spinner" />
                    ) : (
                      <span>{attachment.filename.split(".").pop()?.slice(0, 4) || "FILE"}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="attachment-name"
                    onClick={() => openAttachment(attachment)}
                    disabled={downloadingId === attachment.id}
                  >
                    <span className="attachment-filename">{attachment.filename}</span>
                    <span className="attachment-size">
                      {downloadingId === attachment.id
                        ? "下载中..."
                        : formatSize(attachment.plain_size_bytes)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="attachment-remove"
                    disabled={attachmentBusy || downloadingId !== null}
                    onClick={() => removeAttachment(attachment)}
                    aria-label={`删除 ${attachment.filename}`}
                  >
                    <svg viewBox="0 0 1024 1024" width="14" height="14" fill="currentColor">
                      <path d="M909.5 242.1H147.6c-13.3 0-24.1-10.9-24.1-24.1v-8.4c0-13.3 10.9-24.1 24.1-24.1h761.9c13.3 0 24.1 10.9 24.1 24.1v8.4c0 13.2-10.8 24.1-24.1 24.1z" />
                      <path d="M701.8 870H351.9c-71 0-128.8-57.8-128.8-128.8V213.7h51.5v527.5c0 42.6 34.7 77.3 77.3 77.3h349.9c42.6 0 77.3-34.7 77.3-77.3V213.7h51.5v527.5c0 71-57.8 128.8-128.8 128.8zM647.7 186h-51.5c0-28.4-29.9-51.6-66.7-51.6-36.7 0-66.6 23.1-66.6 51.6h-51.5c0-56.9 53-103.1 118.1-103.1S647.7 129.1 647.7 186z" />
                      <path d="M384.2 708.5h-2.9c-13.4 0-24.3-10.9-24.3-24.3V373.8c0-13.4 10.9-24.3 24.3-24.3h2.9c13.4 0 24.3 10.9 24.3 24.3v310.4c0 13.3-10.9 24.3-24.3 24.3zM531 708.5h-2.9c-13.4 0-24.3-10.9-24.3-24.3V373.8c0-13.4 10.9-24.3 24.3-24.3h2.9c13.4 0 24.3 10.9 24.3 24.3v310.4c0 13.3-10.9 24.3-24.3 24.3zM677.8 708.5h-2.9c-13.4 0-24.3-10.9-24.3-24.3V373.8c0-13.4 10.9-24.3 24.3-24.3h2.9c13.4 0 24.3 10.9 24.3 24.3v310.4c0 13.3-11 24.3-24.3 24.3z" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>

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
      {preview ? (
        <div className="attachment-preview-backdrop" onClick={() => setPreview(null)}>
          <div className="attachment-preview-panel" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="modal-close attachment-preview-close"
              onClick={() => setPreview(null)}
              aria-label="关闭预览"
            >
              ×
            </button>
            {preview.preview_kind === "image" ? (
              <img src={attachmentUrls[preview.id]} alt={preview.filename} />
            ) : (
              <video src={attachmentUrls[preview.id]} controls autoPlay />
            )}
          </div>
        </div>
      ) : null}
      {confirmDialog}
    </div>
  );
}
