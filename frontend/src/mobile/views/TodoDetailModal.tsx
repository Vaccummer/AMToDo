import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import type { AMToDoApi, AttachmentMetadata, TodoItem } from "../../api/client";
import type { UploadProgress } from "../../lib/chunked-upload";
import type { DownloadProgress } from "../../lib/chunked-download";
import { getAttachmentBlob } from "../../lib/attachmentCache";
import { getAttachmentUri, getCachedAttachmentUri, isNative as isNativePlatform, getNativeFilePath, getCacheFolderPath, deleteCachedAttachment } from "../../lib/attachmentDiskCache";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { FileOpener } from "@capacitor-community/file-opener";
import { getMimeType } from "../../lib/mime-types";
import { datetimeLocalFromEpoch, epochFromDatetimeLocal, isOverdueTodo } from "../../lib/time";
import { DatePicker } from "./DatePicker";
import { TimeWheelPicker } from "./TimeWheelPicker";
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
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachmentsChanged, setAttachmentsChanged] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [swipedAttachId, setSwipedAttachId] = useState<number | null>(null);
  const attachSwipeRef = useRef({ id: 0, startX: 0, startY: 0, moved: false, cancelled: false });
  const [textPreviewContent, setTextPreviewContent] = useState<string | null>(null);
  const { ask, dialog: confirmDialog } = useConfirm();
  const { t } = useI18n();

  const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "flac", "aac", "m4a", "wma", "opus", "webm", "m4b"]);
  const TEXT_EXTS = new Set(["txt", "md", "json", "csv", "xml", "log", "py", "js", "ts", "tsx", "jsx", "html", "css", "yaml", "yml", "ini", "cfg", "sh", "bat", "rs", "go", "java", "c", "cpp", "h", "hpp", "sql", "toml", "env", "gitignore", "dockerfile", "makefile", "rb", "php", "swift", "kt", "lua", "r", "vue", "svelte", "astro", "conf", "config", "properties", "gradle", "cmake", "lock", "diff", "patch", "svg"]);
  function isPreviewable(a: AttachmentMetadata): boolean {
    if (a.preview_kind === "image" || a.preview_kind === "video") return true;
    const ext = a.filename.split(".").pop()?.toLowerCase() || "";
    if (AUDIO_EXTS.has(ext)) return true;
    if (TEXT_EXTS.has(ext)) return true;
    return false;
  }
  function effectivePreviewKind(a: AttachmentMetadata): string {
    if (a.preview_kind !== "none") return a.preview_kind;
    const ext = a.filename.split(".").pop()?.toLowerCase() || "";
    if (AUDIO_EXTS.has(ext)) return "audio";
    if (TEXT_EXTS.has(ext)) return "text";
    return "none";
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
    // Check cache for all attachments — mark cached ones as downloaded
    await Promise.all(
      result.attachments.map(async (attachment) => {
        if (ac.signal.aborted) return;
        if (attachment.is_orphaned) return;
        try {
          const cachedUri = await getCachedAttachmentUri(attachment);
          if (ac.signal.aborted) return;
          if (cachedUri) {
            downloadedRef.current.add(attachment.id);
            if (attachment.preview_kind !== "none") {
              setAttachmentUrls((prev) => ({ ...prev, [attachment.id]: cachedUri }));
            }
          }
        } catch {
          // Cache lookup failed — leave as not downloaded
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

  // Load text content when preview changes to a text file (e.g. via goPrev/goNext)
  useEffect(() => {
    if (!preview) return;
    const kind = effectivePreviewKind(preview);
    if (kind !== "text") return;
    let cancelled = false;
    (async () => {
      try {
        const { blob } = await getAttachmentBlob(
          (onProgress, abortSignal) => api.downloadTodoAttachment(todo.id, preview.id, onProgress, abortSignal),
          preview,
          `${preview.user_id}:todo:${preview.todo_id}:${preview.id}`,
        );
        if (cancelled) return;
        if (blob.size > 500 * 1024) {
          const text = await blob.slice(0, 500 * 1024).text();
          setTextPreviewContent(text + "\n\n... " + t("common.textPreviewTruncated"));
        } else {
          const text = await blob.text();
          if (!text.includes("\0")) {
            setTextPreviewContent(text);
          }
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [preview]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const ext = file.name.split(".").pop() || (file.type.startsWith("video/") ? "mp4" : "jpg");
    const isVideo = file.type.startsWith("video/");
    const defaultBase = isVideo ? `video_${Date.now()}` : `photo_${Date.now()}`;
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

  async function clearAttachmentCache(attachment: AttachmentMetadata) {
    try {
      await deleteCachedAttachment(attachment);
      downloadedRef.current.delete(attachment.id);
      setAttachmentUrls((prev) => { const next = { ...prev }; delete next[attachment.id]; return next; });
      setSavedIds((prev) => { const next = new Set(prev); next.delete(attachment.id); return next; });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("common.operationFailed"));
    }
  }

  async function downloadForSave(attachment: AttachmentMetadata) {
    if (attachment.is_orphaned || downloadingIds.current.has(attachment.id)) return;
    if (downloadedRef.current.has(attachment.id)) return;

    const ac = new AbortController();
    downloadingIds.current.add(attachment.id);
    downloadAbortMapRef.current.set(attachment.id, ac);
    setError(null);
    try {
      if (isNativePlatform()) {
        const dlUrl = await api.getTodoAttachmentDownloadUrl(todo.id, attachment.id);
        await getAttachmentUri(
          (onProgress, abortSignal) => api.downloadTodoAttachment(todo.id, attachment.id, onProgress, abortSignal),
          attachment,
          (progress) => setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: progress })),
          ac.signal,
          dlUrl,
        );
      } else {
        await getAttachmentBlob(
          (onProgress, abortSignal) => api.downloadTodoAttachment(todo.id, attachment.id, onProgress, abortSignal),
          attachment,
          `${attachment.user_id}:todo:${attachment.todo_id}:${attachment.id}`,
          (progress) => setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: progress })),
          ac.signal,
        );
      }
      downloadedRef.current.add(attachment.id);
    } catch (err: unknown) {
      if (ac.signal.aborted) return;
      setError(err instanceof Error ? err.message : t("common.attachmentOpenFailed"));
    } finally {
      downloadingIds.current.delete(attachment.id);
      downloadAbortMapRef.current.delete(attachment.id);
      setDownloadProgressMap((prev) => { const next = { ...prev }; delete next[attachment.id]; return next; });
    }
  }

  async function saveToFile(attachment: AttachmentMetadata) {
    if (!downloadedRef.current.has(attachment.id)) return;
    try {
      if (isNativePlatform()) {
        // Copy from cache to Documents directory using Filesystem.copy()
        const cacheRelPath = `attachment-cache/${attachment.user_id}/attachment/todo/${attachment.id}`;
        await Filesystem.copy({
          from: cacheRelPath,
          to: attachment.filename,
          toDirectory: Directory.Documents,
          directory: Directory.Cache,
        });
      } else {
        const cached = await getAttachmentBlob(
          (onProgress, abortSignal) => api.downloadTodoAttachment(todo.id, attachment.id, onProgress, abortSignal),
          attachment,
          `${attachment.user_id}:todo:${attachment.todo_id}:${attachment.id}`,
        );
        if ("showSaveFilePicker" in window) {
          const handle = await (window as any).showSaveFilePicker({
            suggestedName: attachment.filename,
            types: [{ description: attachment.filename, accept: { [attachment.mime_type]: [] } }],
          });
          const writable = await handle.createWritable();
          await writable.write(cached.blob);
          await writable.close();
        } else {
          const url = URL.createObjectURL(cached.blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = attachment.filename;
          a.click();
          URL.revokeObjectURL(url);
        }
      }
      setSavedIds((prev) => new Set(prev).add(attachment.id));
      setError(null);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : t("common.saveFailed"));
    }
  }

  async function handleRename(attachment: AttachmentMetadata, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === attachment.filename) {
      setRenamingId(null);
      return;
    }
    try {
      const result = await api.renameTodoAttachment(todo.id, attachment.id, trimmed);
      setAttachments((prev) => prev.map((a) => a.id === attachment.id ? { ...a, filename: result.attachment.filename } : a));
      setRenamingId(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("common.saveFailed"));
    }
  }

  async function handlePreview(attachment: AttachmentMetadata) {
    if (attachment.is_orphaned) return;
    const kind = effectivePreviewKind(attachment);
    if (kind === "image" || kind === "video" || kind === "audio") {
      if (downloadedRef.current.has(attachment.id) && attachmentUrls[attachment.id]) {
        setPreview(attachment);
      } else {
        await openAttachmentPreview(attachment);
      }
    } else if (kind === "text") {
      if (downloadingIds.current.has(attachment.id)) return;
      // Mark as downloaded so the useEffect can load from cache
      if (!downloadedRef.current.has(attachment.id)) {
        const ac = new AbortController();
        downloadingIds.current.add(attachment.id);
        downloadAbortMapRef.current.set(attachment.id, ac);
        try {
          await getAttachmentBlob(
            (onProgress, abortSignal) => api.downloadTodoAttachment(todo.id, attachment.id, onProgress, abortSignal),
            attachment,
            `${attachment.user_id}:todo:${attachment.todo_id}:${attachment.id}`,
            (progress) => setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: progress })),
            ac.signal,
          );
          downloadedRef.current.add(attachment.id);
        } catch (err: unknown) {
          if (ac.signal.aborted) return;
          setError(err instanceof Error ? err.message : t("common.previewNotSupported"));
          return;
        } finally {
          downloadingIds.current.delete(attachment.id);
          downloadAbortMapRef.current.delete(attachment.id);
          setDownloadProgressMap((prev) => { const next = { ...prev }; delete next[attachment.id]; return next; });
        }
      }
      setTextPreviewContent(null);
      setPreview(attachment);
    } else {
      setError(t("common.previewNotSupported"));
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
                  if (dateKey && !dueTime) setDueTime("00:00:00");
                }}
                hasError={datetimeValidation.dueDateError}
                theme="green"
              />
              <TimeWheelPicker
                className="modal-datetime-time"
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

          {/* Action bar: camera + video + file picker */}
          <div className="attach-action-bar">
            <button type="button" className="attach-icon-btn" onClick={() => cameraInputRef.current?.click()} aria-label={t("common.takePhoto")}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </button>
            <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden onChange={handleCameraCapture} />
            <div className="attach-divider-v" />
            <button type="button" className="attach-icon-btn" onClick={() => videoInputRef.current?.click()} aria-label={t("common.takeVideo")}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </button>
            <input ref={videoInputRef} type="file" accept="video/*" capture="environment" hidden onChange={handleCameraCapture} />
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
                <span className="attach-row-size uploading">{progress.phase === "encrypting" ? t("common.encryptingPercent", { percent: progress.percent }) : t("common.uploadingPercent", { percent: progress.percent })}</span>
              </div>
            </div>
          ))}

          {/* Attachment list */}
          <div className="attachment-list">
            <div className="attachment-list-scroll">
            {attachments.map((attachment) => {
              const url = attachmentUrls[attachment.id];
              const orphaned = attachment.is_orphaned;
              const loadError = attachmentErrors[attachment.id];
              const isDownloading = downloadingIds.current.has(attachment.id);
              const dlProgress = downloadProgressMap[attachment.id];
              const ext = attachment.filename.split(".").pop()?.toUpperCase().slice(0, 4) || "FILE";
              const isDownloaded = downloadedRef.current.has(attachment.id);
              const isSaved = savedIds.has(attachment.id);
              const isSwiped = swipedAttachId === attachment.id;
              const isRenaming = renamingId === attachment.id;

              // Touch handlers for left-swipe
              function onTouchStart(e: React.TouchEvent) {
                const touch = e.touches[0];
                attachSwipeRef.current = { id: attachment.id, startX: touch.clientX, startY: touch.clientY, moved: false, cancelled: false };
              }
              function onTouchMove(e: React.TouchEvent) {
                const ref = attachSwipeRef.current;
                if (ref.id !== attachment.id || ref.cancelled) return;
                const touch = e.touches[0];
                const dx = touch.clientX - ref.startX;
                const dy = touch.clientY - ref.startY;
                if (!ref.moved && Math.abs(dy) > Math.abs(dx)) {
                  ref.cancelled = true;
                  return;
                }
                ref.moved = true;
                if (dx < -30) {
                  setSwipedAttachId(attachment.id);
                } else if (dx > 30 && isSwiped) {
                  setSwipedAttachId(null);
                }
              }
              function onTouchEnd() {
                const ref = attachSwipeRef.current;
                if (ref.id === attachment.id && !ref.moved && !ref.cancelled) {
                  // It was a tap, not a swipe — handled by click events
                }
              }

              return (
                <div
                  className={`attach-swipe-wrapper${isSwiped ? " swiped" : ""}`}
                  key={attachment.id}
                  onTouchStart={onTouchStart}
                  onTouchMove={onTouchMove}
                  onTouchEnd={onTouchEnd}
                >
                  {/* Swipe actions: clear cache + delete, only visible on left swipe */}
                  {!isDownloading && <div className="attach-swipe-action">
                    {isDownloaded && (
                      <button
                        type="button"
                        className="attach-swipe-clear-cache"
                        disabled={attachmentBusy}
                        onClick={() => { setSwipedAttachId(null); clearAttachmentCache(attachment); }}
                        aria-label={t("settings.clearCache")}
                      >
                        <svg viewBox="0 0 1024 1024" width="18" height="18" fill="currentColor">
                          <path d="M899.1 869.6l-53-305.6H864c14.4 0 26-11.6 26-26V346c0-14.4-11.6-26-26-26H618V138c0-14.4-11.6-26-26-26H432c-14.4 0-26 11.6-26 26v182H160c-14.4 0-26 11.6-26 26v192c0 14.4 11.6 26 26 26h17.9l-53 305.6c-0.3 1.5-0.4 3-0.4 4.4 0 14.4 11.6 26 26 26h723c1.5 0 3-0.1 4.4-0.4 14.2-2.4 23.7-15.9 21.2-30zM204 390h272V182h72v208h272v104H204V390z m468 440V674c0-4.4-3.6-8-8-8h-48c-4.4 0-8 3.6-8 8v156H416V674c0-4.4-3.6-8-8-8h-48c-4.4 0-8 3.6-8 8v156H202.8l45.1-260H776l45.1 260H672z" />
                        </svg>
                      </button>
                    )}
                    <button
                      type="button"
                      className="attach-swipe-delete"
                      disabled={attachmentBusy}
                      onClick={() => { setSwipedAttachId(null); removeAttachment(attachment); }}
                      aria-label={`${t("common.delete")} ${attachment.filename}`}
                    >
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                        <path d="M10 11v6" /><path d="M14 11v6" />
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                      </svg>
                    </button>
                  </div>}

                  <div className={`attach-row${orphaned ? " orphaned" : ""}${loadError ? " failed" : ""}${isDownloading ? " downloading" : ""}`}>
                    {/* Thumbnail — left icon: preview on click */}
                    <button
                      type="button"
                      className="attach-row-thumb"
                      disabled={orphaned}
                      onClick={() => handlePreview(attachment)}
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
                      ) : effectivePreviewKind(attachment) === "text" ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                          <polyline points="10 9 9 9 8 9" />
                        </svg>
                      ) : (
                        <span className="attach-row-ext">{ext}</span>
                      )}
                    </button>

                    {/* Filename + size */}
                    <div className="attach-row-info">
                      {isRenaming ? (
                        <input
                          className="attach-filename-input"
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={() => handleRename(attachment, renameValue)}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setRenameValue(attachment.filename); setRenamingId(null); } }}
                          autoFocus
                        />
                      ) : (
                        <button
                          type="button"
                          className="attach-row-name-btn"
                          onClick={() => { setRenamingId(attachment.id); setRenameValue(attachment.filename); }}
                          disabled={orphaned}
                        >
                          {attachment.filename}
                        </button>
                      )}
                      <span className={`attach-row-size${isDownloading ? " downloading" : ""}`}>
                        {orphaned
                          ? t("common.fileMissing")
                          : isDownloading
                            ? (dlProgress ? t("common.downloadingPercent", { percent: dlProgress.percent }) : t("common.downloading"))
                            : formatSize(attachment.plain_size_bytes)}
                      </span>
                    </div>

                    {/* Primary action button — always visible, three states:
                        1. Not cached → download ↓
                        2. Downloading → cancel ✕
                        3. Cached → save 💾 / saved ✓ */}
                    {isDownloading ? (
                      <button type="button" className="attach-action-btn cancel" onClick={() => cancelDownload(attachment.id)} aria-label={t("common.cancelDownload")}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    ) : isSaved ? (
                      <button type="button" className="attach-action-btn saved" disabled aria-label={t("common.saved")}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </button>
                    ) : isDownloaded ? (
                      <button type="button" className="attach-action-btn save" onClick={() => saveToFile(attachment)} aria-label={t("common.saveFile")}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                          <polyline points="17 21 17 13 7 13 7 21" />
                          <polyline points="7 3 7 8 15 8" />
                        </svg>
                      </button>
                    ) : (
                      <button type="button" className="attach-action-btn download" disabled={orphaned} onClick={() => downloadForSave(attachment)} aria-label={t("common.downloading")}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {loadError ? <div className="attachment-error-text">{loadError}</div> : null}
                </div>
              );
            })}
            </div>
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
        const goPrev = currentIdx > 0 ? () => { resetZoom(); setTextPreviewContent(null); setPreview(previewItems[currentIdx - 1]); } : null;
        const goNext = currentIdx < previewItems.length - 1 ? () => { resetZoom(); setTextPreviewContent(null); setPreview(previewItems[currentIdx + 1]); } : null;
        return (
          <div className="attachment-preview-backdrop" onClick={() => { setPreview(null); setTextPreviewContent(null); }}>
            <div className="attachment-preview-panel" onClick={(e) => e.stopPropagation()} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onDoubleClick={handleDoubleClick}>
              <button
                type="button"
                className="modal-close attachment-preview-close"
                onClick={() => { setPreview(null); setTextPreviewContent(null); }}
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
              ) : kind === "text" && textPreviewContent !== null ? (
                <div className="preview-text-wrapper">
                  <div className="preview-text-name">{preview.filename}</div>
                  <pre className="preview-text">{textPreviewContent}</pre>
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
