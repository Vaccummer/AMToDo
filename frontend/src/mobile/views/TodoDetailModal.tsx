import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import type { AMToDoApi, AttachmentMetadata, TodoItem } from "../../api/client";
import type { UploadProgress } from "../../lib/chunked-upload";
import type { DownloadProgress } from "../../lib/chunked-download";
import { getAttachmentBlob } from "../../lib/attachmentCache";
import { getAttachmentUri, getCachedAttachmentUri, isNative as isNativePlatform, getNativeFilePath, getCacheFolderPath } from "../../lib/attachmentDiskCache";
import { FileOpener } from "@capacitor-community/file-opener";
import { getMimeType } from "../../lib/mime-types";
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
  createMode?: boolean;
  onCreate?: (todo: TodoItem) => void;
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

export function TodoDetailModal({ todo: initial, api, onClose, onDelete, onUpdate, createMode, onCreate }: Props) {
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
  const [attachmentErrors, setAttachmentErrors] = useState<Record<number, string>>({});
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [downloadProgressMap, setDownloadProgressMap] = useState<Record<number, DownloadProgress>>({});
  const downloadingIds = useRef<Set<number>>(new Set());
  const downloadAbortMapRef = useRef<Map<number, AbortController>>(new Map());
  const [uploadProgress, setUploadProgress] = useState<Record<string, UploadProgress>>({});
  const [preview, setPreview] = useState<AttachmentMetadata | null>(null);
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 });
  const zoomRef = useRef({
    scale: 1, x: 0, y: 0,
    pinchStartDist: 0, pinchStartScale: 1,
    panStartX: 0, panStartY: 0, panStartTX: 0, panStartTY: 0,
    pointers: new Map<number, { x: number; y: number }>(),
    isPinching: false,
  });
  const downloadedRef = useRef<Set<number>>(new Set());
  const uploadAbortRef = useRef<AbortController | null>(null);
  const batchAbortRef = useRef<AbortController | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachmentsChanged, setAttachmentsChanged] = useState(false);
  const { ask, dialog: confirmDialog } = useConfirm();
  const { t } = useI18n();

  const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "flac", "aac", "m4a", "wma", "opus", "webm", "m4b"]);
  function isPreviewable(a: AttachmentMetadata): boolean {
    if (a.preview_kind === "image" || a.preview_kind === "video") return true;
    const ext = a.filename.split(".").pop()?.toLowerCase() || "";
    return AUDIO_EXTS.has(ext);
  }
  function effectivePreviewKind(a: AttachmentMetadata): string {
    if (a.preview_kind !== "none") return a.preview_kind;
    const ext = a.filename.split(".").pop()?.toLowerCase() || "";
    return AUDIO_EXTS.has(ext) ? "audio" : "none";
  }

  const previewItems = useMemo(
    () => attachments.filter((a) => !a.is_orphaned && isPreviewable(a)),
    [attachments],
  );

  // fetch full todo on mount (the list item may omit fields like attachment_count)
  // Only update the todo reference object — do NOT reset editable fields,
  // because the user may have already started editing before the fetch completes.
  // Skip in create mode — there is no existing todo to fetch.
  useEffect(() => {
    if (createMode) return;
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
    batchAbortRef.current?.abort();
    const ac = new AbortController();
    batchAbortRef.current = ac;
    const result = await api.listTodoAttachments(todo.id);
    if (ac.signal.aborted) return result.attachments;
    setAttachments(result.attachments);
    setAttachmentErrors({});
    // Only serve already-cached files; do not download uncached ones
    await Promise.all(
      result.attachments.map(async (attachment) => {
        if (ac.signal.aborted) return;
        if (attachment.preview_kind === "none") return;
        if (attachment.is_orphaned) return;
        try {
          const cachedUri = await getCachedAttachmentUri(attachment);
          if (ac.signal.aborted) return;
          if (cachedUri) {
            setAttachmentUrls((prev) => ({ ...prev, [attachment.id]: cachedUri }));
          }
        } catch {
          // Cache lookup failed — leave url undefined, user can click to download
        }
      })
    );
    return result.attachments;
  }, [api, todo.id]);

  useEffect(() => {
    if (createMode) return;
    loadAttachments().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : t("common.attachmentLoadFailed"));
    });
  }, [loadAttachments]);

  useEffect(() => {
    return () => {
      // On native, file URIs are persistent disk paths — no revocation needed
      if (!isNativePlatform()) {
        Object.values(attachmentUrls).forEach((url) => URL.revokeObjectURL(url));
      }
    };
  }, [attachmentUrls]);

  // Cancel all in-progress operations on unmount
  useEffect(() => {
    return () => {
      batchAbortRef.current?.abort();
      downloadAbortMapRef.current.forEach((ac) => ac.abort());
      uploadAbortRef.current?.abort();
    };
  }, []);

  const dirty = useMemo(() => {
    if (createMode) return true;
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
  }, [attachmentsChanged, title, description, plannedAtKey, dueAtKey, priority, tag, extraFields, todo, createMode]);

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

  function cancelDownload(attachmentId: number) {
    downloadAbortMapRef.current.get(attachmentId)?.abort();
  }

  async function handleCameraCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.currentTarget.value = "";
    const ext = file.name.split(".").pop() || "jpg";
    const defaultBase = `photo_${Date.now()}`;
    const name = prompt(t("common.photoNamePrompt"), defaultBase);
    if (name === null) return;
    const base = name.trim() || defaultBase;
    const finalName = `${base}.${ext}`;
    const renamed = new File([file], finalName, { type: file.type });
    await uploadFiles([renamed]);
  }

  /** Open a file with the system app chooser (Android intent) */
  async function openWithApp(attachment: AttachmentMetadata) {
    const nativePath = await getNativeFilePath(attachment);
    if (nativePath) {
      await FileOpener.open({
        filePath: nativePath,
        contentType: getMimeType(attachment.filename),
      });
    }
  }

  async function openAttachment(attachment: AttachmentMetadata) {
    if (attachment.is_orphaned) return;
    // Prevent duplicate downloads
    if (downloadingIds.current.has(attachment.id)) return;

    const useDisk = isNativePlatform();

    // Already downloaded — preview or share without re-downloading
    if (downloadedRef.current.has(attachment.id)) {
      const existingUrl = attachmentUrls[attachment.id];
      if (existingUrl) {
        if (isPreviewable(attachment)) {
          setPreview(attachment);
        } else {
          try { await openWithApp(attachment); } catch { /* user cancelled */ }
        }
        return;
      }
    }

    // Download
    const ac = new AbortController();
    downloadingIds.current.add(attachment.id);
    downloadAbortMapRef.current.set(attachment.id, ac);
    setError(null);
    try {
      let url: string;
      if (useDisk) {
        const dlUrl = await api.getTodoAttachmentDownloadUrl(todo.id, attachment.id);
        const { uri } = await getAttachmentUri(
          (onProgress, abortSignal) => api.downloadTodoAttachment(todo.id, attachment.id, onProgress, abortSignal),
          attachment,
          (progress) => setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: progress })),
          ac.signal,
          dlUrl,
        );
        url = uri;
      } else {
        const { blob } = await getAttachmentBlob(
          (onProgress, abortSignal) => api.downloadTodoAttachment(todo.id, attachment.id, onProgress, abortSignal),
          attachment,
          `${attachment.user_id}:todo:${attachment.todo_id}:${attachment.id}`,
          (progress) => setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: progress })),
          ac.signal,
        );
        url = URL.createObjectURL(blob);
      }
      downloadedRef.current.add(attachment.id);
      setAttachmentUrls((prev) => ({ ...prev, [attachment.id]: url }));

      if (isPreviewable(attachment)) {
        setPreview(attachment);
      } else {
        await openWithApp(attachment);
      }

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
      downloadingIds.current.delete(attachment.id);
      downloadAbortMapRef.current.delete(attachment.id);
      setDownloadProgressMap((prev) => {
        const next = { ...prev };
        delete next[attachment.id];
        return next;
      });
    }
  }

  // Left icon click: always try in-app preview; fall back to system open for non-previewable
  async function openAttachmentPreview(attachment: AttachmentMetadata) {
    if (attachment.is_orphaned) return;
    if (downloadingIds.current.has(attachment.id)) return;

    // Already downloaded — open directly
    if (downloadedRef.current.has(attachment.id)) {
      const existingUrl = attachmentUrls[attachment.id];
      if (existingUrl) {
        if (isPreviewable(attachment)) {
          setPreview(attachment);
        } else {
          try { await openWithApp(attachment); } catch { /* */ }
        }
        return;
      }
    }

    // Download then open
    const ac = new AbortController();
    downloadingIds.current.add(attachment.id);
    downloadAbortMapRef.current.set(attachment.id, ac);
    setError(null);
    try {
      let url: string;
      if (isNativePlatform()) {
        const dlUrl = await api.getTodoAttachmentDownloadUrl(todo.id, attachment.id);
        const { uri } = await getAttachmentUri(
          (onProgress, abortSignal) => api.downloadTodoAttachment(todo.id, attachment.id, onProgress, abortSignal),
          attachment,
          (progress) => setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: progress })),
          ac.signal,
          dlUrl,
        );
        url = uri;
      } else {
        const { blob } = await getAttachmentBlob(
          (onProgress, abortSignal) => api.downloadTodoAttachment(todo.id, attachment.id, onProgress, abortSignal),
          attachment,
          `${attachment.user_id}:todo:${attachment.todo_id}:${attachment.id}`,
          (progress) => setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: progress })),
          ac.signal,
        );
        url = URL.createObjectURL(blob);
      }
      downloadedRef.current.add(attachment.id);
      setAttachmentUrls((prev) => ({ ...prev, [attachment.id]: url }));
      if (isPreviewable(attachment)) {
        setPreview(attachment);
      } else {
        await openWithApp(attachment);
      }
      setAttachmentErrors((prev) => { const next = { ...prev }; delete next[attachment.id]; return next; });
    } catch (err: unknown) {
      if (ac.signal.aborted) return;
      const message = err instanceof Error ? err.message : t("common.attachmentOpenFailed");
      setError(message);
      setAttachmentErrors((prev) => ({ ...prev, [attachment.id]: message }));
    } finally {
      downloadingIds.current.delete(attachment.id);
      downloadAbortMapRef.current.delete(attachment.id);
      setDownloadProgressMap((prev) => { const next = { ...prev }; delete next[attachment.id]; return next; });
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

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    const z = zoomRef.current;
    z.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (z.pointers.size === 2) {
      const pts = [...z.pointers.values()];
      z.pinchStartDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      z.pinchStartScale = z.scale;
      z.isPinching = true;
    } else if (z.pointers.size === 1 && z.scale > 1) {
      z.panStartX = e.clientX;
      z.panStartY = e.clientY;
      z.panStartTX = z.x;
      z.panStartTY = z.y;
    }
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const z = zoomRef.current;
    z.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (z.isPinching && z.pointers.size === 2) {
      const pts = [...z.pointers.values()];
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const newScale = Math.max(1, Math.min(5, z.pinchStartScale * (dist / z.pinchStartDist)));
      z.scale = newScale;
      setZoom({ scale: newScale, x: z.x, y: z.y });
    } else if (z.pointers.size === 1 && z.scale > 1 && !z.isPinching) {
      const dx = e.clientX - z.panStartX;
      const dy = e.clientY - z.panStartY;
      z.x = z.panStartTX + dx;
      z.y = z.panStartTY + dy;
      setZoom({ scale: z.scale, x: z.x, y: z.y });
    }
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const z = zoomRef.current;
    z.pointers.delete(e.pointerId);
    if (z.pointers.size < 2) z.isPinching = false;
    if (z.pointers.size === 0 && z.scale < 1.05) {
      z.scale = 1; z.x = 0; z.y = 0;
      setZoom({ scale: 1, x: 0, y: 0 });
    }
  }, []);

  const handleDoubleClick = useCallback(() => {
    const z = zoomRef.current;
    if (z.scale > 1) {
      z.scale = 1; z.x = 0; z.y = 0;
      setZoom({ scale: 1, x: 0, y: 0 });
    } else {
      z.scale = 2; z.x = 0; z.y = 0;
      setZoom({ scale: 2, x: 0, y: 0 });
    }
  }, []);

  const resetZoom = useCallback(() => {
    zoomRef.current.scale = 1;
    zoomRef.current.x = 0;
    zoomRef.current.y = 0;
    setZoom({ scale: 1, x: 0, y: 0 });
  }, []);

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

          {!createMode && (<>
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
              const isDownloading = downloadingIds.current.has(attachment.id);
              const dlProgress = downloadProgressMap[attachment.id];
              const ext = attachment.filename.split(".").pop()?.toUpperCase().slice(0, 4) || "FILE";

              return (
                <div
                  className={`attach-row${orphaned ? " orphaned" : ""}${loadError ? " failed" : ""}${isDownloading ? " downloading" : ""}`}
                  key={attachment.id}
                >
                  {/* Thumbnail — left icon: always try in-app preview */}
                  <button
                    type="button"
                    className="attach-row-thumb"
                    disabled={orphaned || isDownloading}
                    onClick={() => openAttachmentPreview(attachment)}
                    aria-label={attachment.filename}
                  >
                    {orphaned || loadError ? (
                      <AttachmentMissingIcon />
                    ) : attachment.preview_kind === "image" && url ? (
                      <img src={url} alt="" />
                    ) : attachment.preview_kind === "video" && url ? (
                      <video src={url} muted />
                    ) : effectivePreviewKind(attachment) === "audio" ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                      </svg>
                    ) : (
                      <span className="attach-row-ext">{ext}</span>
                    )}
                  </button>

                  {/* Info — right side: open cache folder on click */}
                  <button
                    type="button"
                    className="attach-row-info"
                    onClick={async () => {
                      const ok = await ask({
                        title: t("common.openCacheFolder"),
                        message: t("common.openCacheFolderConfirm"),
                        confirmLabel: t("common.openCacheFolder"),
                      });
                      if (!ok) return;
                      try {
                        const dirPath = await getCacheFolderPath();
                        await FileOpener.open({ filePath: dirPath, contentType: "resource/folder" });
                      } catch {
                        // Fallback: open the specific file if folder open fails
                        try { await openAttachment(attachment); } catch { /* */ }
                      }
                    }}
                    disabled={orphaned || isDownloading}
                  >
                    <span className="attach-row-name">{attachment.filename}</span>
                    <span className={`attach-row-size${isDownloading ? " downloading" : ""}`}>
                      {orphaned
                        ? t("common.fileMissing")
                        : isDownloading
                          ? (dlProgress ? t("common.downloadingPercent", { percent: dlProgress.percent }) : t("common.downloading"))
                          : formatSize(attachment.plain_size_bytes)}
                    </span>
                  </button>

                  {/* Download ring progress or delete button */}
                  {isDownloading ? (
                    <div className="ring-progress">
                      <svg viewBox="0 0 36 36">
                        <circle className="ring-bg" cx="18" cy="18" r="15.9" />
                        <circle className="ring-fill download" cx="18" cy="18" r="15.9"
                          strokeDasharray={`${dlProgress?.percent ?? 0} ${100 - (dlProgress?.percent ?? 0)}`}
                          strokeDashoffset="25" />
                      </svg>
                      <button type="button" className="ring-cancel" onClick={() => cancelDownload(attachment.id)} aria-label={t("common.cancelDownload")}>
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
          {!createMode && (
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
      {preview ? (() => {
        const currentIdx = previewItems.findIndex((a) => a.id === preview.id);
        const kind = effectivePreviewKind(preview);
        const goPrev = currentIdx > 0 ? () => { resetZoom(); setPreview(previewItems[currentIdx - 1]); } : null;
        const goNext = currentIdx < previewItems.length - 1 ? () => { resetZoom(); setPreview(previewItems[currentIdx + 1]); } : null;
        return (
          <div className="attachment-preview-backdrop" onClick={() => setPreview(null)}>
            <div className="attachment-preview-panel" onClick={(e) => e.stopPropagation()} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onDoubleClick={handleDoubleClick}>
              <button
                type="button"
                className="modal-close attachment-preview-close"
                onClick={() => setPreview(null)}
                aria-label={t("common.close")}
              >
                ×
              </button>
              {goPrev && (
                <button type="button" className="preview-nav preview-nav-prev" onClick={(e) => { e.stopPropagation(); goPrev(); }} aria-label={t("common.previous")}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
              )}
              {kind === "image" ? (
                <img
                  src={attachmentUrls[preview.id]}
                  alt={preview.filename}
                  style={{
                    transform: `scale(${zoom.scale}) translate(${zoom.x / zoom.scale}px, ${zoom.y / zoom.scale}px)`,
                    transition: zoomRef.current.isPinching ? 'none' : 'transform 0.15s ease-out',
                    touchAction: 'none',
                  }}
                />
              ) : kind === "video" ? (
                <video
                  src={attachmentUrls[preview.id]}
                  controls
                  autoPlay
                  style={{
                    transform: `scale(${zoom.scale}) translate(${zoom.x / zoom.scale}px, ${zoom.y / zoom.scale}px)`,
                    transition: zoomRef.current.isPinching ? 'none' : 'transform 0.15s ease-out',
                    touchAction: 'none',
                  }}
                />
              ) : kind === "audio" ? (
                <div className="preview-audio-wrapper">
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                  </svg>
                  <audio src={attachmentUrls[preview.id]} controls autoPlay style={{ width: "100%", marginTop: 16 }} />
                  <div className="preview-audio-name">{preview.filename}</div>
                </div>
              ) : null}
              {goNext && (
                <button type="button" className="preview-nav preview-nav-next" onClick={(e) => { e.stopPropagation(); goNext(); }} aria-label={t("common.next")}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                </button>
              )}
              {previewItems.length > 1 && (
                <div className="preview-counter">{currentIdx + 1} / {previewItems.length}</div>
              )}
            </div>
          </div>
        );
      })() : null}
      {confirmDialog}
    </div>
  );
}
