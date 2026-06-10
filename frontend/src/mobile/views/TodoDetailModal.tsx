import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import type { AMToDoApi, TodoItem } from "../../api/client";
import { datetimeLocalFromEpoch, epochFromDatetimeLocal, isOverdueTodo } from "../../lib/time";
import { DatePicker } from "./DatePicker";
import { TimeWheelPicker } from "./TimeWheelPicker";
import { useConfirm } from "./ConfirmDialog";
import { ChangelogPanel } from "./ChangelogPanel";
import { MobileExtraFieldsEditor } from "./MobileExtraFieldsEditor";
import { AttachmentManager } from "./AttachmentManager";

type Props = {
  todo: TodoItem;
  api: AMToDoApi;
  onClose: () => void;
  onDelete: (id: number) => void;
  onUpdate: (todo: TodoItem) => void;
  createMode?: boolean;
  onCreate?: (todo: TodoItem) => void;
  trashMode?: boolean;
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

export function TodoDetailModal({ todo: initial, api, onClose, onDelete, onUpdate, createMode, onCreate, trashMode }: Props) {
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
  const { ask, dialog: confirmDialog } = useConfirm();
  const { t } = useI18n();

  // fetch full todo on mount (the list item may omit fields like attachment_count)
  // Only update the todo reference object — do NOT reset editable fields,
  // because the user may have already started editing before the fetch completes.
  // Skip in create mode — there is no existing todo to fetch.
  useEffect(() => {
    if (createMode) return;
    api.getTodo(todo.id, trashMode).then((r) => {
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
  const pickerOpenRef = useRef(false);
  const suppressPickerHistoryPopRef = useRef(false);
  useEffect(() => {
    history.pushState({ modal: "todo-detail" }, "");
    const onPickerHistoryPop = () => {
      suppressPickerHistoryPopRef.current = true;
    };
    const onPopState = () => {
      if (suppressPickerHistoryPopRef.current) {
        suppressPickerHistoryPopRef.current = false;
        return;
      }
      // If the directory picker is open, close it instead of the detail modal
      if (pickerOpenRef.current) {
        return;
      }
      closedViaPopRef.current = true;
      onCloseRef.current();
    };
    window.addEventListener("dirpicker-history-pop", onPickerHistoryPop);
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("dirpicker-history-pop", onPickerHistoryPop);
      window.removeEventListener("popstate", onPopState);
      if (!closedViaPopRef.current) history.back();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => {
    if (createMode) return true;
    return (
      title !== todo.title ||
      description !== (todo.description ?? "") ||
      plannedAtKey !== (todo.planned_at ? datetimeLocalFromEpoch(todo.planned_at) : "") ||
      dueAtKey !== (todo.due_at ? datetimeLocalFromEpoch(todo.due_at) : "") ||
      Number(priority) !== todo.priority ||
      tag !== (todo.tag ?? "") ||
      JSON.stringify(extraFields) !== JSON.stringify(todo.extra_fields ?? {})
    );
  }, [title, description, plannedAtKey, dueAtKey, priority, tag, extraFields, todo, createMode]);

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
      if (createMode) {
        const plannedAt = plannedAtKey ? epochFromDatetimeLocal(plannedAtKey) : Math.floor(Date.now() / 1000);
        const result = await api.createTodo(title || t("todo.newTodo"), plannedAt, {
          due_at: dueAtKey ? epochFromDatetimeLocal(dueAtKey) : null,
          description: description || null,
          priority: Number(priority),
          tag: tag || null,
          extra_fields: Object.keys(extraFields).length > 0 ? JSON.stringify(extraFields) : null,
        });
        onCreate?.(result.todo);
        onClose();
        return;
      }

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

      const result = await api.updateTodo(todo.id, fields, trashMode);
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
          <h2 className="modal-title">{t("todo.detail")}<span className="modal-id-badge">No.{todo.id}</span></h2>
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

          {!trashMode && (
          <div className="modal-field">
            <label className="modal-field-label">{t("common.completedStatus")}</label>
            <button
              type="button"
              className={`modal-completion-toggle ${(() => {
                const overdue = isOverdueTodo(todo);
                const lateDone = Boolean(todo.completed && todo.due_at !== null && todo.completed_at !== null && todo.completed_at > todo.due_at);
                if (todo.completed && lateDone) return "late-done";
                if (todo.completed) return "done";
                if (overdue) return "overdue";
                return "pending";
              })()}`}
              onClick={toggleCompleted}
              aria-label={todo.completed ? t("common.completed") : t("common.notCompleted")}
            >
              <span className="modal-completion-track">
                <span className="modal-completion-knob" />
              </span>
            </button>
          </div>
          )}

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
              <TimeWheelPicker
                className="modal-datetime-time"
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
                  if (!dateKey) {
                    setDueTime("");
                  } else if (!dueTime) {
                    setDueTime("00:00:00");
                  }
                }}
                hasError={datetimeValidation.dueDateError}
                theme="green"
              />
              <TimeWheelPicker
                className="modal-datetime-time"
                value={dueTime}
                onChange={setDueTime}
                onClear={() => {
                  setDueDate("");
                  setDueTime("");
                }}
                clearLabel={t("common.clear")}
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

          {!createMode && !trashMode && (<>
          <div className="modal-divider" />
          <AttachmentManager
            ownerType="todo"
            ownerId={todo.id}
            api={api}
            uploadFile={(file, onProgress, signal) => api.uploadTodoAttachment(todo.id, file, onProgress, signal)}
            uploadNativeFile={(file, onProgress, signal) => api.uploadTodoNativeAttachment(todo.id, file, onProgress, signal)}
            downloadFile={(attachmentId, onProgress, signal) => api.downloadTodoAttachment(todo.id, attachmentId, onProgress, signal)}
            getDownloadUrl={(attachmentId) => api.getTodoAttachmentDownloadUrl(todo.id, attachmentId)}
            downloadChunk={(attachmentId, offset, length) => api.downloadTodoAttachmentChunk(todo.id, attachmentId, offset, length)}
            removeFile={(attachmentId) => api.removeTodoAttachment(todo.id, attachmentId)}
            renameFile={(attachmentId, filename) => api.renameTodoAttachment(todo.id, attachmentId, filename)}
            listAttachments={() => api.listTodoAttachments(todo.id)}
            onAttachmentsChanged={(count) => {
              const updatedTodo = { ...todo, attachment_count: count };
              setTodo(updatedTodo);
              onUpdate(updatedTodo);
            }}
            modalClass="modal"
            pickerOpenRef={pickerOpenRef}
          />

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
          </>)}
        </div>

        <div className="modal-actions">
          <button
            type="button"
            className="modal-btn modal-btn-save"
            disabled={!dirty || saving || datetimeValidation.hasError}
            onClick={handleSave}
          >
            {saving ? t("common.saving") : createMode ? t("common.create") : t("common.save")}
          </button>
          {!createMode && !trashMode && (
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
          )}
        </div>
        {saving ? <div className="modal-save-progress" aria-label={t("common.saving")} /> : null}
      </div>
      {confirmDialog}
    </div>
  );
}
