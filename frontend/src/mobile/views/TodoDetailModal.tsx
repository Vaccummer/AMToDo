import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import type { AMToDoApi, AttachmentMetadata, TodoItem } from "../../api/client";
import type { UploadProgress } from "../../lib/chunked-upload";
import type { DownloadProgress } from "../../lib/chunked-download";
import { getAttachmentBlob } from "../../lib/attachmentCache";
import { datetimeLocalFromEpoch, epochFromDatetimeLocal } from "../../lib/time";
import { DatePicker } from "./DatePicker";
import { TimeInput } from "./TimeInput";
import { useConfirm } from "./ConfirmDialog";
import { ChangelogPanel } from "./ChangelogPanel";
import { MobileExtraFieldsEditor } from "./MobileExtraFieldsEditor";

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
  const [extraFields, setExtraFields] = useState<Record<string, string>>(initial.extra_fields ?? {});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AttachmentMetadata[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<number, string>>({});
  const [attachmentLoading, setAttachmentLoading] = useState<Record<number, boolean>>({});
  const [attachmentErrors, setAttachmentErrors] = useState<Record<number, string>>({});
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<string, UploadProgress>>({});
  const [preview, setPreview] = useState<AttachmentMetadata | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachmentsChanged, setAttachmentsChanged] = useState(false);
  const { ask, dialog: confirmDialog } = useConfirm();
  const { t } = useI18n();

  // fetch full todo on mount (the list item may omit fields like attachment_count)
  // Only update the todo reference object — do NOT reset editable fields,
  // because the user may have already started editing before the fetch completes.
  useEffect(() => {
    api.getTodo(todo.id).then((r) => {
      const fullTodo = {
        ...r.todo,
        attachment_count: r.todo.attachment_count ?? initial.attachment_count
      };
      setTodo(fullTodo);
    }).catch(() => { /* use initial data */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // System gesture navigation: push history entry so Android back gesture closes the modal
  const closedViaPopRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    history.pushState({ modal: "todo-detail" }, "");
    const onPopState = () => {
      closedViaPopRef.current = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      if (!closedViaPopRef.current) history.back();
    };
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
            (onProgress) => api.downloadTodoAttachment(todo.id, attachment.id, onProgress),
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
      tag !== (todo.tag ?? "") ||
      JSON.stringify(extraFields) !== JSON.stringify(todo.extra_fields ?? {})
    );
  }, [attachmentsChanged, title, description, plannedAtKey, dueAtKey, priority, tag, extraFields, todo]);

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

      const originalExtra = todo.extra_fields ?? {};
      if (JSON.stringify(extraFields) !== JSON.stringify(originalExtra)) {
        fields.extra_fields = JSON.stringify(extraFields);
      }

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

    for (const file of selected) {
      if (file.size > api.maxAttachmentSize) {
        setError(t("common.fileTooLarge", { name: file.name, size: formatSize(file.size), max: formatSize(api.maxAttachmentSize) }));
        return;
      }
    }

    const ac = new AbortController();
    uploadAbortRef.current = ac;
    setAttachmentBusy(true);
    setError(null);
    try {
      for (const file of selected) {
        const key = `${file.name}-${file.size}`;
        try {
          await api.uploadTodoAttachment(todo.id, file, (progress) => {
            setUploadProgress((prev) => ({ ...prev, [key]: progress }));
          }, ac.signal);
        } finally {
          setUploadProgress((prev) => { const n = { ...prev }; delete n[key]; return n; });
        }
      }
      setAttachmentsChanged(true);
      const updatedAttachments = await loadAttachments();
      const updatedTodo = { ...todo, attachment_count: updatedAttachments.length };
      setTodo(updatedTodo);
      onUpdate(updatedTodo);
    } catch (err: unknown) {
      if (ac.signal.aborted) return;
      setError(err instanceof Error ? err.message : t("common.attachmentUploadFailed"));
    } finally {
      uploadAbortRef.current = null;
      setAttachmentBusy(false);
    }
  }

  function cancelUpload() {
    uploadAbortRef.current?.abort();
  }

  function cancelDownload() {
    downloadAbortRef.current?.abort();
  }

  async function handleCameraCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.currentTarget.value = "";
    const ext = file.name.split(".").pop() || "jpg";
    const defaultName = `photo_${Date.now()}.${ext}`;
    const name = prompt(t("common.enterFileName"), defaultName);
    if (name === null) return;
    const renamed = new File([file], name || defaultName, { type: file.type });
    await uploadFiles([renamed]);
  }

  async function openAttachment(attachment: AttachmentMetadata) {
    if (attachment.is_orphaned) return;
    const ac = new AbortController();
    downloadAbortRef.current = ac;
    setDownloadingId(attachment.id);
    setDownloadProgress(null);
    setError(null);
    try {
      const { blob } = await getAttachmentBlob(
        (onProgress, abortSignal) => api.downloadTodoAttachment(todo.id, attachment.id, onProgress, abortSignal),
        attachment,
        `${attachment.user_id}:todo:${attachment.todo_id}:${attachment.id}`,
        (progress) => setDownloadProgress(progress),
        ac.signal,
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
      if (ac.signal.aborted) return;
      const message = err instanceof Error ? err.message : t("common.attachmentOpenFailed");
      setError(message);
      setAttachmentErrors((prev) => ({ ...prev, [attachment.id]: message }));
    } finally {
      downloadAbortRef.current = null;
      setDownloadingId(null);
      setDownloadProgress(null);
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
          {error ? <div className="modal-error">{error}</div> : null}
          {/* Editable fields */}
          <div className="modal-section-label">{t("common.editableFields")}</div>

          <div className="modal-field">
            <label className="modal-field-label">{t("common.completedStatus")}</label>
            <button
              type="button"
              className={`modal-completion-toggle ${todo.completed ? "completed" : "pending"}`}
              onClick={toggleCompleted}
              aria-label={todo.completed ? t("common.completed") : t("common.notCompleted")}
            >
              {todo.completed ? (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="3" width="18" height="18" rx="5" fill="currentColor" />
                  <polyline points="8 12 11 15 16 9" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <rect x="3.5" y="3.5" width="17" height="17" rx="5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
                </svg>
              )}
            </button>
          </div>

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

          <div className="modal-divider" />
          <div className="modal-section-label">{t("extraFields.title")}</div>
          <MobileExtraFieldsEditor fields={extraFields} onChange={setExtraFields} />

          {/* Divider */}
          <div className="modal-divider" />

          <div className="modal-section-label">{t("common.attachments")}</div>

          {/* Action bar: camera + file picker */}
          <div className="attach-action-bar">
            <button type="button" className="attach-icon-btn" onClick={() => cameraInputRef.current?.click()} aria-label={t("common.takePhoto")}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </button>
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={handleCameraCapture} />
            <div className="attach-divider-v" />
            <button type="button" className="attach-icon-btn" onClick={() => fileInputRef.current?.click()} aria-label={t("common.selectFile")}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.currentTarget.value = ""; }} />
            <span className="attach-count">{t("common.attachmentCount", { count: attachments.length })}</span>
          </div>

          {/* Upload progress rows */}
          {Object.entries(uploadProgress).map(([key, progress]) => progress && (
            <div key={key} className="attach-row uploading">
              <div className="ring-progress">
                <svg viewBox="0 0 36 36">
                  <circle className="ring-bg" cx="18" cy="18" r="15.9" />
                  <circle className="ring-fill upload" cx="18" cy="18" r="15.9"
                    strokeDasharray={`${progress.percent} ${100 - progress.percent}`}
                    strokeDashoffset="25" />
                </svg>
                <button type="button" className="ring-cancel" onClick={cancelUpload} aria-label={t("common.cancelUpload")}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="attach-row-info">
                <span className="attach-row-name">{key.split("-")[0]}</span>
                <span className="attach-row-size uploading">{t("common.uploadingPercent", { percent: progress.percent })}</span>
              </div>
            </div>
          ))}

          {/* Attachment list */}
          <div className="attachment-list">
            {attachments.map((attachment) => {
              const url = attachmentUrls[attachment.id];
              const orphaned = attachment.is_orphaned;
              const loadError = attachmentErrors[attachment.id];
              const isDownloading = downloadingId === attachment.id;
              const ext = attachment.filename.split(".").pop()?.toUpperCase().slice(0, 4) || "FILE";

              return (
                <div
                  className={`attach-row${orphaned ? " orphaned" : ""}${loadError ? " failed" : ""}${isDownloading ? " downloading" : ""}`}
                  key={attachment.id}
                >
                  {/* Thumbnail */}
                  <button
                    type="button"
                    className="attach-row-thumb"
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
                      <span className="attach-row-ext">{ext}</span>
                    )}
                  </button>

                  {/* Info */}
                  <button
                    type="button"
                    className="attach-row-info"
                    onClick={() => openAttachment(attachment)}
                    disabled={orphaned || isDownloading}
                  >
                    <span className="attach-row-name">{attachment.filename}</span>
                    <span className={`attach-row-size${isDownloading ? " downloading" : ""}`}>
                      {orphaned
                        ? t("common.fileMissing")
                        : isDownloading
                          ? (downloadProgress ? t("common.downloadingPercent", { percent: downloadProgress.percent }) : t("common.downloading"))
                          : formatSize(attachment.plain_size_bytes)}
                    </span>
                  </button>

                  {/* Download ring progress or delete button */}
                  {isDownloading ? (
                    <div className="ring-progress">
                      <svg viewBox="0 0 36 36">
                        <circle className="ring-bg" cx="18" cy="18" r="15.9" />
                        <circle className="ring-fill download" cx="18" cy="18" r="15.9"
                          strokeDasharray={`${downloadProgress?.percent ?? 0} ${100 - (downloadProgress?.percent ?? 0)}`}
                          strokeDashoffset="25" />
                      </svg>
                      <button type="button" className="ring-cancel" onClick={cancelDownload} aria-label={t("common.cancelDownload")}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="attach-del-btn"
                      disabled={attachmentBusy}
                      onClick={() => removeAttachment(attachment)}
                      aria-label={`${t("common.delete")} ${attachment.filename}`}
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6" /><path d="M14 11v6" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                    </button>
                  )}

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
