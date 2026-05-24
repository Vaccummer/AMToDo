import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AMToDoApi, ScheduleAttachmentMetadata, ScheduleItem, ScheduleUpdateRequest } from "../../api/client";
import type { UploadProgress } from "../../lib/chunked-upload";
import type { DownloadProgress } from "../../lib/chunked-download";
import { getAttachmentBlob } from "../../lib/attachmentCache";
import { getCachedAttachmentUri, getAttachmentUri, getNativeFilePath, getCacheFolderPath, isNative as isNativePlatform } from "../../lib/attachmentDiskCache";
import { FileOpener } from "@capacitor-community/file-opener";
import { getMimeType } from "../../lib/mime-types";
import { datetimeLocalFromEpoch, epochFromDatetimeLocal, formatTime } from "../../lib/time";
import { DatePicker } from "./DatePicker";
import { TimeInput } from "./TimeInput";
import { useConfirm } from "./ConfirmDialog";
import { ChangelogPanel } from "./ChangelogPanel";
import { useI18n } from "../../i18n";
import { MobileExtraFieldsEditor } from "./MobileExtraFieldsEditor";

const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "flac", "aac", "m4a", "wma"]);

function isPreviewable(a: ScheduleAttachmentMetadata): boolean {
  if (a.preview_kind === "image" || a.preview_kind === "video") return true;
  const ext = a.filename.split(".").pop()?.toLowerCase() || "";
  return AUDIO_EXTS.has(ext);
}

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

export function ScheduleDetailModal({ schedule: initial, api, onClose, onDelete, onUpdate }: Props) {
  const { t } = useI18n();
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
  const [extraFields, setExtraFields] = useState<Record<string, string>>(initial.extra_fields ?? {});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<ScheduleAttachmentMetadata[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<number, string>>({});
  const [attachmentLoading, setAttachmentLoading] = useState<Record<number, boolean>>({});
  const [attachmentErrors, setAttachmentErrors] = useState<Record<number, string>>({});
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [downloadProgressMap, setDownloadProgressMap] = useState<Record<number, DownloadProgress>>({});
  const [uploadProgress, setUploadProgress] = useState<Record<string, UploadProgress>>({});
  const [dragActive, setDragActive] = useState(false);
  const [preview, setPreview] = useState<ScheduleAttachmentMetadata | null>(null);
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 });
  const zoomRef = useRef({
    scale: 1, x: 0, y: 0,
    pinchStartDist: 0, pinchStartScale: 1,
    panStartX: 0, panStartY: 0, panStartTX: 0, panStartTY: 0,
    pointers: new Map<number, { x: number; y: number }>(),
    isPinching: false,
  });
  const downloadedRef = useRef<Set<number>>(new Set());
  const downloadingIds = useRef<Set<number>>(new Set());
  const downloadAbortMapRef = useRef<Map<number, AbortController>>(new Map());
  const batchAbortRef = useRef<AbortController | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const [attachmentsChanged, setAttachmentsChanged] = useState(false);
  const { ask, dialog: confirmDialog } = useConfirm();

  // Fetch full schedule on mount (the list item may lack some fields)
  // Only update the schedule reference — do NOT reset editable fields,
  // because the user may have already started editing before the fetch completes.
  useEffect(() => {
    api.getSchedule(schedule.id).then((r) => {
      setSchedule(r.schedule);
    }).catch(() => { /* keep initial data */ });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAttachments = useCallback(async () => {
    // Abort any previous batch load
    batchAbortRef.current?.abort();
    const controller = new AbortController();
    batchAbortRef.current = controller;

    const result = await api.listScheduleAttachments(schedule.id);
    if (controller.signal.aborted) return;
    setAttachments(result.attachments);
    setAttachmentErrors({});

    // Only load already-cached thumbnails; don't auto-download uncached files
    const newUrls: Record<number, string> = {};
    await Promise.all(
      result.attachments.map(async (attachment) => {
        if (attachment.preview_kind === "none") return;
        if (attachment.is_orphaned) return;
        try {
          const cachedUri = await getCachedAttachmentUri(attachment);
          if (cachedUri) {
            newUrls[attachment.id] = cachedUri;
          }
        } catch {
          // cache lookup failed — leave as uncached
        }
      })
    );
    if (controller.signal.aborted) return;
    setAttachmentUrls(newUrls);
  }, [api, schedule.id]);

  useEffect(() => {
    loadAttachments().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : t("common.attachmentLoadFailed"));
    });
  }, [loadAttachments]);

  useEffect(() => {
    return () => {
      // Cancel batch thumbnail loads
      batchAbortRef.current?.abort();
      // Cancel all per-download controllers
      downloadAbortMapRef.current.forEach((ctrl) => ctrl.abort());
      downloadAbortMapRef.current.clear();
      // Cancel active upload
      uploadAbortRef.current?.abort();
      // Revoke object URLs on web
      if (!isNativePlatform()) {
        Object.values(attachmentUrls).forEach((url) => URL.revokeObjectURL(url));
      }
    };
  }, [attachmentUrls]);

  const startKey = startDate && startTime ? `${startDate}T${startTime}` : "";
  const endKey = endDate && endTime ? `${endDate}T${endTime}` : "";

  function handleStartTimeChange(value: string) {
    setStartTime(value);
  }

  function handleEndTimeChange(value: string) {
    setEndTime(value);
  }

  // ── Attachment handlers ──

  async function uploadFiles(files: FileList | File[]) {
    const selected = Array.from(files);
    if (selected.length === 0) return;

    for (const file of selected) {
      if (file.size > api.maxAttachmentSize) {
        setError(t("common.fileTooLarge", { name: file.name, size: formatSize(file.size), limit: formatSize(api.maxAttachmentSize) }));
        return;
      }
    }

    setAttachmentBusy(true);
    setError(null);
    try {
      for (const file of selected) {
        const key = `${file.name}-${file.size}`;
        try {
          await api.uploadScheduleAttachment(schedule.id, file, (progress) => {
            setUploadProgress((prev) => ({ ...prev, [key]: progress }));
          });
        } finally {
          setUploadProgress((prev) => { const n = { ...prev }; delete n[key]; return n; });
        }
      }
      setAttachmentsChanged(true);
      await loadAttachments();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("common.attachmentUploadFailed"));
    } finally {
      setAttachmentBusy(false);
      setDragActive(false);
    }
  }

  async function openAttachment(attachment: ScheduleAttachmentMetadata) {
    if (attachment.is_orphaned) return;
    // Prevent duplicate downloads
    if (downloadingIds.current.has(attachment.id)) return;

    const useDisk = isNativePlatform();

    // Already downloaded — open without re-downloading
    if (downloadedRef.current.has(attachment.id)) {
      const existingUrl = attachmentUrls[attachment.id];
      if (existingUrl) {
        if (useDisk) {
          try {
            await openWithApp(attachment);
          } catch (err: unknown) {
            if (!(err instanceof DOMException && err.name === "AbortError")) {
              console.error("open failed", err);
            }
          }
        }
        return;
      }
    }

    // Create per-download AbortController
    const controller = new AbortController();
    downloadingIds.current.add(attachment.id);
    downloadAbortMapRef.current.set(attachment.id, controller);
    setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: undefined as unknown as DownloadProgress }));
    setError(null);
    try {
      let url: string;
      if (useDisk) {
        const dlUrl = await api.getScheduleAttachmentDownloadUrl(schedule.id, attachment.id);
        const { uri } = await getAttachmentUri(
          (onProgress) => api.downloadScheduleAttachment(schedule.id, attachment.id, onProgress),
          attachment,
          (progress) => setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: progress })),
          controller.signal,
          dlUrl,
        );
        url = uri;
      } else {
        const { blob } = await getAttachmentBlob(
          (onProgress) => api.downloadScheduleAttachment(schedule.id, attachment.id, onProgress),
          attachment,
          `${attachment.user_id}:schedule:${attachment.schedule_id}:${attachment.id}`,
          (progress) => setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: progress })),
          controller.signal,
        );
        url = URL.createObjectURL(blob);
      }
      downloadedRef.current.add(attachment.id);
      setAttachmentUrls((prev) => ({ ...prev, [attachment.id]: url }));

      if (useDisk) {
        try {
          await openWithApp(attachment);
        } catch (err: unknown) {
          if (!(err instanceof DOMException && err.name === "AbortError")) {
            console.error("open failed", err);
          }
        }
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = attachment.filename;
        link.click();
        URL.revokeObjectURL(url);
      }

      setAttachmentErrors((prev) => {
        const next = { ...prev };
        delete next[attachment.id];
        return next;
      });
    } catch (err: unknown) {
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        const message = err instanceof Error ? err.message : t("common.attachmentOpenFailed");
        setError(message);
        setAttachmentErrors((prev) => ({ ...prev, [attachment.id]: message }));
      }
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
  async function openAttachmentPreview(attachment: ScheduleAttachmentMetadata) {
    if (attachment.is_orphaned) return;
    if (downloadingIds.current.has(attachment.id)) return;

    // Already downloaded — open directly
    if (downloadedRef.current.has(attachment.id)) {
      const existingUrl = attachmentUrls[attachment.id];
      if (existingUrl) {
        if (isPreviewable(attachment)) {
          setPreview(attachment);
        } else {
          // System open via FileOpener
          try {
            await openWithApp(attachment);
          } catch (err: unknown) {
            if (!(err instanceof DOMException && err.name === "AbortError")) console.error("open failed", err);
          }
        }
        return;
      }
    }

    // Download then open
    const controller = new AbortController();
    downloadingIds.current.add(attachment.id);
    downloadAbortMapRef.current.set(attachment.id, controller);
    setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: undefined as unknown as DownloadProgress }));
    setError(null);
    try {
      let url: string;
      if (isNativePlatform()) {
        const dlUrl = await api.getScheduleAttachmentDownloadUrl(schedule.id, attachment.id);
        const { uri } = await getAttachmentUri(
          (onProgress) => api.downloadScheduleAttachment(schedule.id, attachment.id, onProgress),
          attachment,
          (progress) => setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: progress })),
          controller.signal,
          dlUrl,
        );
        url = uri;
      } else {
        const { blob } = await getAttachmentBlob(
          (onProgress) => api.downloadScheduleAttachment(schedule.id, attachment.id, onProgress),
          attachment,
          `${attachment.user_id}:schedule:${attachment.schedule_id}:${attachment.id}`,
          (progress) => setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: progress })),
          controller.signal,
        );
        url = URL.createObjectURL(blob);
      }
      downloadedRef.current.add(attachment.id);
      setAttachmentUrls((prev) => ({ ...prev, [attachment.id]: url }));

      if (isPreviewable(attachment)) {
        setPreview(attachment);
      } else {
        try {
          await openWithApp(attachment);
        } catch (err: unknown) {
          if (!(err instanceof DOMException && err.name === "AbortError")) console.error("open failed", err);
        }
      }

      setAttachmentErrors((prev) => { const next = { ...prev }; delete next[attachment.id]; return next; });
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : t("common.attachmentOpenFailed");
      setError(message);
      setAttachmentErrors((prev) => ({ ...prev, [attachment.id]: message }));
    } finally {
      downloadingIds.current.delete(attachment.id);
      downloadAbortMapRef.current.delete(attachment.id);
      setDownloadProgressMap((prev) => { const next = { ...prev }; delete next[attachment.id]; return next; });
    }
  }

  async function removeAttachment(attachment: ScheduleAttachmentMetadata) {
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
      await api.removeScheduleAttachment(schedule.id, attachment.id);
      setAttachmentsChanged(true);
      await loadAttachments();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("common.attachmentDeleteFailed"));
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function openWithApp(attachment: ScheduleAttachmentMetadata) {
    const nativePath = await getNativeFilePath(attachment);
    if (nativePath) {
      await FileOpener.open({
        filePath: nativePath,
        contentType: getMimeType(attachment.filename),
      });
    }
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
      attachmentsChanged ||
      title !== schedule.title ||
      description !== (schedule.description ?? "") ||
      (startKey ? epochFromDatetimeLocal(startKey) : null) !== schedule.start_at ||
      (endKey ? epochFromDatetimeLocal(endKey) : null) !== schedule.end_at ||
      location !== (schedule.location ?? "") ||
      category !== (schedule.category ?? "") ||
      JSON.stringify(extraFields) !== JSON.stringify(schedule.extra_fields ?? {})
    );
  }, [attachmentsChanged, title, description, startKey, endKey, location, category, schedule, extraFields]);

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
      const originalExtra = schedule.extra_fields ?? {};
      if (JSON.stringify(extraFields) !== JSON.stringify(originalExtra)) {
        fields.extra_fields = JSON.stringify(extraFields);
      }

      if (Object.keys(fields).length === 0) {
        onClose();
        return;
      }

      const result = await api.updateSchedule(schedule.id, fields);
      onUpdate(result.schedule);
      onClose();
    } catch (err: unknown) {
      // Re-query to get the latest server state on failure
      try {
        const fresh = await api.getSchedule(schedule.id);
        const s = fresh.schedule;
        setSchedule(s);
        setTitle(s.title);
        setDescription(s.description ?? "");
        setStartDate(splitDatetime(datetimeLocalFromEpoch(s.start_at)).date);
        setStartTime(splitDatetime(datetimeLocalFromEpoch(s.start_at)).time);
        setEndDate(splitDatetime(datetimeLocalFromEpoch(s.end_at)).date);
        setEndTime(splitDatetime(datetimeLocalFromEpoch(s.end_at)).time);
        setLocation(s.location ?? "");
        setCategory(s.category ?? "");
        setExtraFields(s.extra_fields ?? {});
        setAttachmentsChanged(false);
        onUpdate(fresh.schedule);
      } catch {
        // Can't reach server either, keep current state
      }
      setError(err instanceof Error ? err.message : t("common.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ──

  async function handleDelete() {
    const ok = await ask({
      title: t("schedule.deleteSchedule"),
      message: t("schedule.deleteScheduleConfirm"),
      confirmLabel: t("common.moveToTrash"),
      danger: true,
    });
    if (!ok) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteSchedule(schedule.id);
      onDelete(schedule.id);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("common.deleteFailed"));
      setDeleting(false);
    }
  }

  // ── Zoom handlers for lightbox ──

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

  // ── Render ──

  return (
    <div
      className="schedule-modal-backdrop"
      onClick={handleBackdrop}
      onKeyDown={handleKeyDown}
    >
      <div className="schedule-modal-card" role="dialog" aria-label={t("schedule.detail")}>
        {/* Header */}
        <div className="schedule-modal-header">
          <div className="schedule-modal-header-left">
            <span className="schedule-modal-dot" />
            <h2 className="schedule-modal-title">{t("schedule.detail")}<span className="schedule-modal-id-badge">#{schedule.id}</span></h2>
          </div>
          <button
            type="button"
            className="schedule-modal-close"
            onClick={onClose}
            aria-label={t("common.close")}
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
          <div className="schedule-modal-section-label">{t("common.editableFields")}</div>

          <div className="schedule-modal-field">
            <label className="schedule-modal-label" htmlFor="smd-title">
              {t("common.title")}
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
              {t("common.description")}
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
              {t("common.startTime")}
            </label>
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

          {/* End datetime */}
          <div className="schedule-modal-field">
            <label className="schedule-modal-label">
              {t("common.endTime")}
            </label>
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
                  {timeline.durMins} {t("common.minutes")}
                </span>
              ) : null}
            </div>
          ) : null}

          {/* Location & Category */}
          <div className="schedule-modal-field-row">
            <div className="schedule-modal-field">
              <label className="schedule-modal-label" htmlFor="smd-location">
                {t("common.location")}
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
                {t("common.category")}
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

          <div className="schedule-modal-section-label">{t("extraFields.title")}</div>
          <MobileExtraFieldsEditor fields={extraFields} onChange={setExtraFields} />

          {/* Divider */}
          <div className="schedule-modal-divider" />

          <div className="schedule-modal-section-label">{t("common.attachments")}</div>
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
            <span>{attachmentBusy ? t("common.attachmentProcessing") : t("common.dropFilesHere")}</span>
            <label className="attachment-upload-button" htmlFor="schedule-attachment-input">
              {t("common.selectFile")}
            </label>
            <input
              id="schedule-attachment-input"
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) uploadFiles(e.target.files);
                e.currentTarget.value = "";
              }}
            />
          </div>
          {attachmentBusy && Object.keys(uploadProgress).length > 0
            ? Object.entries(uploadProgress).map(([key, progress]) => progress && (
                <div key={key} className="attachment-progress-bar attachment-progress-bar--pct" aria-label={`${progress.percent}%`}>
                  <div className="attachment-progress-fill" style={{ width: `${progress.percent}%` }} />
                </div>
              ))
            : attachmentBusy ? <div className="attachment-progress-bar" aria-label={t("common.attachmentProcessing")} /> : null}

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
                    disabled={orphaned || downloadingIds.current.has(attachment.id)}
                    onClick={() => openAttachmentPreview(attachment)}
                    aria-label={t("common.openFile", { name: attachment.filename })}
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
                      } catch (err) {
                        // Fallback: open the specific file if folder open fails
                        try { await openAttachment(attachment); } catch { /* */ }
                      }
                    }}
                    disabled={orphaned || downloadingIds.current.has(attachment.id)}
                  >
                    <span className="attachment-filename">{attachment.filename}</span>
                    <span className="attachment-size">
                      {orphaned
                        ? t("common.fileMissing")
                        : downloadingIds.current.has(attachment.id)
                          ? (downloadProgressMap[attachment.id] ? `${downloadProgressMap[attachment.id].percent}%` : t("common.downloading"))
                          : formatSize(attachment.plain_size_bytes)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="attachment-remove"
                    disabled={attachmentBusy || downloadingIds.current.size > 0}
                    onClick={() => removeAttachment(attachment)}
                    aria-label={t("common.deleteFile", { name: attachment.filename })}
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

          {/* Divider */}
          <div className="schedule-modal-divider" />

          {/* Read-only fields */}
          <div className="schedule-modal-section-label">{t("common.readonlyInfo")}</div>

          <div className="schedule-modal-ro-field">
            <span className="schedule-modal-ro-label">{t("common.createdAt")}</span>
            <span className="schedule-modal-ro-value">{fmtDatetime(schedule.created_at)}</span>
          </div>

          <div className="schedule-modal-ro-field">
            <span className="schedule-modal-ro-label">{t("common.updatedAt")}</span>
            <span className="schedule-modal-ro-value">{fmtDatetime(schedule.updated_at)}</span>
          </div>

          <div className="schedule-modal-divider" />

          <div className="schedule-modal-section-label">{t("common.history")}</div>
          <ChangelogPanel api={api} entityId={schedule.id} kind="schedule" />
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
            {saving ? t("common.saving") : t("common.save")}
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
            {deleting ? t("common.deleting") : t("common.delete")}
          </button>
        </div>
        {saving ? <div className="modal-save-progress" aria-label={t("common.saving")} /> : null}
      </div>
      {preview ? (
        <div className="attachment-preview-backdrop" onClick={() => { setPreview(null); resetZoom(); }}>
          <div
            className="attachment-preview-panel"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDoubleClick={handleDoubleClick}
          >
            <button
              type="button"
              className="schedule-modal-close attachment-preview-close"
              onClick={() => { setPreview(null); resetZoom(); }}
              aria-label={t("common.close")}
            >
              ×
            </button>
            {preview.preview_kind === "image" ? (
              <img
                src={attachmentUrls[preview.id]}
                alt={preview.filename}
                style={{
                  transform: `scale(${zoom.scale}) translate(${zoom.x / zoom.scale}px, ${zoom.y / zoom.scale}px)`,
                  transition: zoomRef.current.isPinching ? 'none' : 'transform 0.15s ease-out',
                  touchAction: 'none',
                }}
              />
            ) : (
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
            )}
          </div>
        </div>
      ) : null}
      {confirmDialog}
    </div>
  );
}
