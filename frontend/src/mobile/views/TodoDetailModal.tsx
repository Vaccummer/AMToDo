import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n";
import type { AMToDoApi, AttachmentMetadata, TodoItem } from "../../api/client";
import { getAttachmentBlob } from "../../lib/attachmentCache";
import { datetimeLocalFromEpoch, epochFromDatetimeLocal } from "../../lib/time";
import { DatePicker } from "./DatePicker";
import { TimeInput } from "./TimeInput";
import { useConfirm } from "./ConfirmDialog";
import { ChangelogPanel } from "./ChangelogPanel";

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

function AttachmentMissingIcon() {
  return (
    <svg className="attachment-missing-icon" viewBox="0 0 1024 1024" aria-hidden="true">
      <path d="M128 597.333333l170.666667 106.666667 128-149.333333 128 170.666666 85.333333-106.666666 128 21.333333-128-128-85.333333 106.666667-128-213.333334-149.333334 160L128 426.666667V127.658667C128 104.746667 147.072 85.333333 170.581333 85.333333H597.333333v256a42.666667 42.666667 0 0 0 42.666667 42.666667h256v511.701333A42.666667 42.666667 0 0 1 853.632 938.666667H170.368A42.368 42.368 0 0 1 128 896.341333V597.333333z m768-298.666666h-213.333333V85.461333L896 298.666667z" />
    </svg>
  );
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
  const [attachmentErrors, setAttachmentErrors] = useState<Record<number, string>>({});
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [preview, setPreview] = useState<AttachmentMetadata | null>(null);
  const [attachmentsChanged, setAttachmentsChanged] = useState(false);
  const { ask, dialog: confirmDialog } = useConfirm();
  const { t } = useI18n();

  // fetch full todo on mount (the list item may omit fields)
  useEffect(() => {
    api.getTodo(todo.id).then((r) => {
      const fullTodo = {
        ...r.todo,
        attachment_count: r.todo.attachment_count ?? initial.attachment_count
      };
      setTodo(fullTodo);
      setTitle(fullTodo.title);
      setDescription(fullTodo.description ?? "");
      setPlannedDate(fullTodo.planned_at ? splitDatetime(datetimeLocalFromEpoch(fullTodo.planned_at)).date : "");
      setPlannedTime(fullTodo.planned_at ? splitDatetime(datetimeLocalFromEpoch(fullTodo.planned_at)).time : "");
      setDueDate(fullTodo.due_at ? splitDatetime(datetimeLocalFromEpoch(fullTodo.due_at)).date : "");
      setDueTime(fullTodo.due_at ? splitDatetime(datetimeLocalFromEpoch(fullTodo.due_at)).time : "");
      setPriority(String(fullTodo.priority));
      setTag(fullTodo.tag ?? "");
    }).catch(() => { /* use initial data */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAttachments = useCallback(async () => {
    const result = await api.listTodoAttachments(todo.id);
    setAttachments(result.attachments);
    setAttachmentErrors({});
    await Promise.all(
      result.attachments.map(async (attachment) => {
        if (attachment.preview_kind === "none") return;
        if (attachment.is_orphaned) return;
        setAttachmentLoading((prev) => ({ ...prev, [attachment.id]: true }));
        try {
          const { blob } = await getAttachmentBlob(
            () => api.downloadTodoAttachment(todo.id, attachment.id),
            attachment,
            `${attachment.user_id}:todo:${attachment.todo_id}:${attachment.id}`,
          );
          const url = URL.createObjectURL(blob);
          setAttachmentUrls((prev) => ({ ...prev, [attachment.id]: url }));
          setAttachmentErrors((prev) => {
            const next = { ...prev };
            delete next[attachment.id];
            return next;
          });
        } catch (err: unknown) {
          setAttachmentUrls((prev) => {
            const next = { ...prev };
            delete next[attachment.id];
            return next;
          });
          setAttachmentErrors((prev) => ({
            ...prev,
            [attachment.id]: err instanceof Error ? err.message : t("common.attachmentDataLoadFailed"),
          }));
        } finally {
          setAttachmentLoading((prev) => {
            const next = { ...prev };
            delete next[attachment.id];
            return next;
          });
        }
      })
    );
    return result.attachments;
  }, [api, todo.id]);

  useEffect(() => {
    loadAttachments().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : t("common.attachmentLoadFailed"));
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

  const datetimeValidation = useMemo(() => {
    let plannedDateError = !plannedDate;
    let plannedTimeError = !plannedTime || (plannedTime ? !timeKeyValid(plannedTime) : false);
    let dueDateError = false;
    let dueTimeError = false;
    let message = "";

    const plannedEpoch =
      plannedDate && plannedTime && timeKeyValid(plannedTime)
        ? epochFromDatetimeLocal(plannedAtKey)
        : NaN;
    if (plannedDate && plannedTime && timeKeyValid(plannedTime) && !Number.isFinite(plannedEpoch)) {
      plannedDateError = true;
      plannedTimeError = true;
    }
    if (plannedDateError || plannedTimeError) {
      message = t("todo.invalidPlannedDateTime");
    }

    const dueHasDate = dueDate !== "";
    const dueHasTime = dueTime !== "";
    if (dueHasDate !== dueHasTime) {
      dueDateError = !dueHasDate;
      dueTimeError = !dueHasTime;
      if (!message) message = t("todo.dueDateRequiresBoth");
    } else if (dueHasDate && dueHasTime) {
      if (!timeKeyValid(dueTime)) {
        dueTimeError = true;
        if (!message) message = t("todo.invalidDueDateTime");
      } else {
        const dueEpoch = epochFromDatetimeLocal(dueAtKey);
        if (!Number.isFinite(dueEpoch)) {
          dueDateError = true;
          dueTimeError = true;
          if (!message) message = t("todo.invalidDueDateTime");
        } else if (Number.isFinite(plannedEpoch) && dueEpoch <= plannedEpoch) {
          if (dueDate < plannedDate) {
            dueDateError = true;
          } else {
            dueTimeError = true;
          }
          if (!message) message = t("todo.dueDateAfterPlanned");
        }
      }
    }

    return {
      plannedDateError,
      plannedTimeError,
      dueDateError,
      dueTimeError,
      hasError: plannedDateError || plannedTimeError || dueDateError || dueTimeError,
      message
    };
  }, [t, plannedDate, plannedTime, plannedAtKey, dueDate, dueTime, dueAtKey]);

  const handleBackdrop = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) return;
    },
    []
  );

  async function handleSave() {
    if (datetimeValidation.hasError) {
      setError(datetimeValidation.message || t("todo.fixDatesBeforeSave"));
      return;
    }
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
      setError(err instanceof Error ? err.message : t("common.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const ok = await ask({
      title: t("todo.deleteTodo"),
      message: t("todo.deleteTodoConfirm"),
      confirmLabel: t("common.moveToTrash"),
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
      setError(err instanceof Error ? err.message : t("common.deleteFailed"));
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
      setError(err instanceof Error ? err.message : t("common.operationFailed"));
    }
  }

  async function uploadFiles(files: FileList | File[]) {
    const selected = Array.from(files);
    if (selected.length === 0) return;

    // Check per-file size limit
    for (const file of selected) {
      if (file.size > api.maxAttachmentSize) {
        setError(t("common.fileTooLarge", { name: file.name, size: formatSize(file.size), max: formatSize(api.maxAttachmentSize) }));
        return;
      }
    }

    // Check attachment count limit
    if (attachments.length + selected.length > api.maxAttachmentsPerTodo) {
      setError(t("common.tooManyAttachments", { max: api.maxAttachmentsPerTodo }));
      return;
    }

    setAttachmentBusy(true);
    setError(null);
    try {
      for (const file of selected) {
        await api.uploadTodoAttachment(todo.id, file);
      }
      setAttachmentsChanged(true);
      const updatedAttachments = await loadAttachments();
      const updatedTodo = { ...todo, attachment_count: updatedAttachments.length };
      setTodo(updatedTodo);
      onUpdate(updatedTodo);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("common.attachmentUploadFailed"));
    } finally {
      setAttachmentBusy(false);
      setDragActive(false);
    }
  }

  async function openAttachment(attachment: AttachmentMetadata) {
    if (attachment.is_orphaned) return;
    setDownloadingId(attachment.id);
    setError(null);
    try {
      const { blob } = await getAttachmentBlob(
        () => api.downloadTodoAttachment(todo.id, attachment.id),
        attachment,
        `${attachment.user_id}:todo:${attachment.todo_id}:${attachment.id}`,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = attachment.filename;
      link.click();
      URL.revokeObjectURL(url);
      setAttachmentErrors((prev) => {
        const next = { ...prev };
        delete next[attachment.id];
        return next;
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t("common.attachmentOpenFailed");
      setError(message);
      setAttachmentErrors((prev) => ({ ...prev, [attachment.id]: message }));
    } finally {
      setDownloadingId(null);
    }
  }

  async function removeAttachment(attachment: AttachmentMetadata) {
    const ok = await ask({
      title: t("common.deleteAttachment"),
      message: t("common.deleteAttachmentConfirm", { name: attachment.filename }),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    setAttachmentBusy(true);
    setError(null);
    try {
      await api.removeTodoAttachment(todo.id, attachment.id);
      setAttachmentsChanged(true);
      const updatedAttachments = await loadAttachments();
      const updatedTodo = { ...todo, attachment_count: updatedAttachments.length };
      setTodo(updatedTodo);
      onUpdate(updatedTodo);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("common.attachmentDeleteFailed"));
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (dirty) {
        const ok = await ask({
          title: t("common.discardChanges"),
          message: t("common.unsavedChanges"),
          confirmLabel: t("common.close"),
          danger: true,
        });
        if (!ok) return;
      }
      onClose();
    }
  }

  return (
    <div className="modal-backdrop" onClick={handleBackdrop} onKeyDown={handleKeyDown}>
      <div className="modal-card" role="dialog" aria-label={t("todo.detail")}>
        <div className="modal-header">
          <h2 className="modal-title">{t("todo.detail")}<span className="modal-id-badge">#{todo.id}</span></h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label={t("common.close")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          {/* Editable fields */}
          <div className="modal-section-label">{t("common.editableFields")}</div>

          <div className="modal-field">
            <label className="modal-field-label" htmlFor="md-title">{t("common.title")}</label>
            <input
              id="md-title"
              type="text"
              className="modal-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="modal-field">
            <label className="modal-field-label" htmlFor="md-desc">{t("common.description")}</label>
            <textarea
              id="md-desc"
              className="modal-textarea"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="modal-field">
            <label className="modal-field-label">{t("todo.plannedDate")}</label>
            <div className="modal-datetime-row">
              <DatePicker
                value={plannedDate}
                onChange={(dateKey) => {
                  setPlannedDate(dateKey);
                  if (!plannedTime) setPlannedTime("00:00:00");
                }}
                hasError={datetimeValidation.plannedDateError}
                theme="green"
              />
              <TimeInput
                className={`modal-input modal-datetime-time${datetimeValidation.plannedTimeError ? " invalid" : ""}`}
                value={plannedTime}
                onChange={setPlannedTime}
              />
            </div>
          </div>

          <div className="modal-field">
            <label className="modal-field-label">{t("todo.dueDate")}</label>
            <div className="modal-datetime-row">
              <DatePicker
                value={dueDate}
                onChange={(dateKey) => {
                  setDueDate(dateKey);
                  if (dateKey && !dueTime) setDueTime("00:00:00");
                }}
                hasError={datetimeValidation.dueDateError}
                theme="green"
              />
              <TimeInput
                className={`modal-input modal-datetime-time${datetimeValidation.dueTimeError ? " invalid" : ""}`}
                value={dueTime}
                onChange={setDueTime}
              />
            </div>
            {datetimeValidation.message ? (
              <span className="modal-field-hint">{datetimeValidation.message}</span>
            ) : null}
          </div>

          <div className="modal-field-row">
            <div className="modal-field modal-field-half">
              <label className="modal-field-label" htmlFor="md-priority">{t("common.priority")}</label>
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
              <label className="modal-field-label" htmlFor="md-tag">{t("common.tags")}</label>
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

          <div className="modal-section-label">{t("common.attachments")}</div>
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
            <span>{attachmentBusy ? t("common.processing") : t("common.dropFilesHere")}</span>
            <label className="attachment-upload-button" htmlFor="todo-attachment-input">
              {t("common.selectFile")}
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
          {attachmentBusy ? <div className="attachment-progress-bar" aria-label={t("common.attachmentProcessing")} /> : null}

          <div className="attachment-list">
            {attachments.map((attachment) => {
              const url = attachmentUrls[attachment.id];
              const orphaned = attachment.is_orphaned;
              const loadError = attachmentErrors[attachment.id];
              return (
                <div
                  className={`attachment-row${orphaned ? " orphaned" : ""}${loadError ? " failed" : ""}`}
                  key={attachment.id}
                >
                  <button
                    type="button"
                    className="attachment-thumb"
                    disabled={orphaned}
                    onClick={() => {
                      if (attachment.preview_kind === "none" || !url) {
                        openAttachment(attachment);
                      } else {
                        setPreview(attachment);
                      }
                    }}
                    aria-label={attachment.filename}
                  >
                    {orphaned || loadError ? (
                      <AttachmentMissingIcon />
                    ) : attachment.preview_kind === "image" && url ? (
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
                    disabled={orphaned || downloadingId === attachment.id}
                  >
                    <span className="attachment-filename">{attachment.filename}</span>
                    <span className="attachment-size">
                      {orphaned
                        ? t("common.fileMissing")
                        : downloadingId === attachment.id
                          ? t("common.downloading")
                          : formatSize(attachment.plain_size_bytes)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="attachment-remove"
                    disabled={attachmentBusy || downloadingId !== null}
                    onClick={() => removeAttachment(attachment)}
                    aria-label={`${t("common.delete")} ${attachment.filename}`}
                  >
                    <svg viewBox="0 0 1024 1024" width="14" height="14" fill="currentColor">
                      <path d="M909.5 242.1H147.6c-13.3 0-24.1-10.9-24.1-24.1v-8.4c0-13.3 10.9-24.1 24.1-24.1h761.9c13.3 0 24.1 10.9 24.1 24.1v8.4c0 13.2-10.8 24.1-24.1 24.1z" />
                      <path d="M701.8 870H351.9c-71 0-128.8-57.8-128.8-128.8V213.7h51.5v527.5c0 42.6 34.7 77.3 77.3 77.3h349.9c42.6 0 77.3-34.7 77.3-77.3V213.7h51.5v527.5c0 71-57.8 128.8-128.8 128.8zM647.7 186h-51.5c0-28.4-29.9-51.6-66.7-51.6-36.7 0-66.6 23.1-66.6 51.6h-51.5c0-56.9 53-103.1 118.1-103.1S647.7 129.1 647.7 186z" />
                      <path d="M384.2 708.5h-2.9c-13.4 0-24.3-10.9-24.3-24.3V373.8c0-13.4 10.9-24.3 24.3-24.3h2.9c13.4 0 24.3 10.9 24.3 24.3v310.4c0 13.3-10.9 24.3-24.3 24.3zM531 708.5h-2.9c-13.4 0-24.3-10.9-24.3-24.3V373.8c0-13.4 10.9-24.3 24.3-24.3h2.9c13.4 0 24.3 10.9 24.3 24.3v310.4c0 13.3-10.9 24.3-24.3 24.3zM677.8 708.5h-2.9c-13.4 0-24.3-10.9-24.3-24.3V373.8c0-13.4 10.9-24.3 24.3-24.3h2.9c13.4 0 24.3 10.9 24.3 24.3v310.4c0 13.3-11 24.3-24.3 24.3z" />
                      </svg>
                    </button>
                  {loadError ? <div className="attachment-error-text">{loadError}</div> : null}
                </div>
              );
            })}
          </div>

          <div className="modal-divider" />

          {/* Read-only fields */}
          <div className="modal-section-label">{t("common.readonlyInfo")}</div>

          <div className="modal-field">
            <span className="modal-field-label">{t("common.createdAt")}</span>
            <span className="modal-field-value">{fmtDatetime(todo.created_at)}</span>
          </div>

          <div className="modal-field">
            <span className="modal-field-label">{t("common.updatedAt")}</span>
            <span className="modal-field-value">{fmtDatetime(todo.updated_at)}</span>
          </div>

          <div className="modal-field">
            <span className="modal-field-label">{t("common.completedStatus")}</span>
            <button
              type="button"
              className={`modal-toggle ${todo.completed ? "on" : ""}`}
              onClick={toggleCompleted}
            >
              <span className="modal-toggle-knob" />
              <span className="modal-toggle-label">
                {todo.completed ? t("common.completed") : t("common.notCompleted")}
              </span>
            </button>
          </div>

          {todo.completed_at ? (
            <div className="modal-field">
              <span className="modal-field-label">{t("common.completedAt")}</span>
              <span className="modal-field-value">{fmtDatetime(todo.completed_at)}</span>
            </div>
          ) : null}

          <div className="modal-divider" />

          <div className="modal-section-label">{t("common.history")}</div>
          <ChangelogPanel api={api} entityId={todo.id} kind="todo" />
        </div>

        {error ? <div className="modal-error">{error}</div> : null}

        <div className="modal-actions">
          <button
            type="button"
            className="modal-btn modal-btn-save"
            disabled={!dirty || saving || datetimeValidation.hasError}
            onClick={handleSave}
          >
            {saving ? t("common.saving") : t("common.save")}
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
            {deleting ? t("common.deleting") : t("common.delete")}
          </button>
        </div>
        {saving ? <div className="modal-save-progress" aria-label={t("common.saving")} /> : null}
      </div>
      {preview ? (
        <div className="attachment-preview-backdrop" onClick={() => setPreview(null)}>
          <div className="attachment-preview-panel" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="modal-close attachment-preview-close"
              onClick={() => setPreview(null)}
              aria-label={t("common.close")}
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
