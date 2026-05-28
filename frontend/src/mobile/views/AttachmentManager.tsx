import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import type { AMToDoApi, AttachmentDownloadUrl, AttachmentMetadata, ScheduleAttachmentMetadata } from "../../api/client";
import { useConfirm } from "./ConfirmDialog";
import type { UploadProgress } from "../../lib/chunked-upload";
import type { DownloadProgress } from "../../lib/chunked-download";
import { getAttachmentBlob } from "../../lib/attachmentCache";
import { getAttachmentUri, getCachedAttachmentUri, isNative as isNativePlatform, getNativeFilePath, getCacheFolderPath, deleteCachedAttachment } from "../../lib/attachmentDiskCache";
import type { NativeAttachmentFile } from "../../lib/native-attachment";
import { isNativeAttachmentUploadAvailable, pickNativeAttachmentFiles } from "../../lib/native-attachment";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { FileOpener } from "@capacitor-community/file-opener";
import { getMimeType } from "../../lib/mime-types";
import { DirectoryPickerModal } from "./DirectoryPickerModal";

type AnyAttachment = AttachmentMetadata | ScheduleAttachmentMetadata;

export type AttachmentManagerProps = {
  ownerType: "todo" | "schedule";
  ownerId: number;
  api: AMToDoApi;
  uploadFile: (file: File, onProgress: (p: UploadProgress) => void, signal?: AbortSignal) => Promise<unknown>;
  uploadNativeFile?: (file: NativeAttachmentFile, onProgress: (p: UploadProgress) => void, signal?: AbortSignal) => Promise<unknown>;
  downloadFile: (attachmentId: number, onProgress: (p: DownloadProgress) => void, signal?: AbortSignal) => Promise<ArrayBuffer>;
  getDownloadUrl: (attachmentId: number) => Promise<AttachmentDownloadUrl>;
  removeFile: (attachmentId: number) => Promise<unknown>;
  renameFile: (attachmentId: number, filename: string) => Promise<{ attachment: AnyAttachment }>;
  listAttachments: () => Promise<{ attachments: AnyAttachment[] }>;
  onAttachmentsChanged?: (count: number) => void;
  /** CSS class prefix for modal context (default "modal") */
  modalClass?: string;
  /** Ref that parent can read to check if the directory picker is open */
  pickerOpenRef?: React.MutableRefObject<boolean>;
};

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

const VIDEO_EXTS = new Set(["mp4", "mov", "m4v", "webm", "mkv", "avi", "wmv", "flv", "3gp", "3g2", "mpeg", "mpg", "ogv"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "flac", "aac", "m4a", "wma", "opus", "webm", "m4b"]);
const TEXT_EXTS = new Set(["txt", "md", "json", "csv", "xml", "log", "py", "js", "ts", "tsx", "jsx", "html", "css", "yaml", "yml", "ini", "cfg", "sh", "bat", "rs", "go", "java", "c", "cpp", "h", "hpp", "sql", "toml", "env", "gitignore", "dockerfile", "makefile", "rb", "php", "swift", "kt", "lua", "r", "vue", "svelte", "astro", "conf", "config", "properties", "gradle", "cmake", "lock", "diff", "patch", "svg"]);

function isPreviewable(a: AnyAttachment): boolean {
  return effectivePreviewKind(a) !== "none";
}

function downloadUrlValue(info: AttachmentDownloadUrl): string {
  return typeof info === "string" ? info : info.url;
}

function withDownloadSize(attachment: AnyAttachment, info: AttachmentDownloadUrl): AnyAttachment {
  if (typeof info === "string" || !Number.isFinite(info.fileSize)) return attachment;
  return { ...attachment, plain_size_bytes: Math.max(info.fileSize ?? 0, 0) };
}

function effectivePreviewKind(a: AnyAttachment): string {
  if (a.preview_kind !== "none") return a.preview_kind;
  const mime = a.mime_type?.toLowerCase() || "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("text/")) return "text";
  const ext = a.filename.split(".").pop()?.toLowerCase() || "";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  if (TEXT_EXTS.has(ext)) return "text";
  return "none";
}

export function AttachmentManager({
  ownerType,
  ownerId,
  api,
  uploadFile,
  uploadNativeFile,
  downloadFile,
  getDownloadUrl,
  removeFile,
  renameFile,
  listAttachments,
  onAttachmentsChanged,
  modalClass = "modal",
  pickerOpenRef,
}: AttachmentManagerProps) {
  const { t } = useI18n();
  const { ask, dialog: confirmDialog } = useConfirm();

  const [attachments, setAttachments] = useState<AnyAttachment[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<number, string>>({});
  const [attachmentErrors, setAttachmentErrors] = useState<Record<number, string>>({});
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [downloadProgressMap, setDownloadProgressMap] = useState<Record<number, DownloadProgress>>({});
  const [uploadProgress, setUploadProgress] = useState<Record<string, UploadProgress>>({});
  const [preview, setPreview] = useState<AnyAttachment | null>(null);
  const [zoom, setZoom] = useState({ scale: 1, x: 0, y: 0 });
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [downloadedIds, setDownloadedIds] = useState<Set<number>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set());
  const [pickerAttachment, setPickerAttachment] = useState<AnyAttachment | null>(null);
  const [swipedAttachId, setSwipedAttachId] = useState<number | null>(null);
  const [textPreviewContent, setTextPreviewContent] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [captureDraft, setCaptureDraft] = useState<{ file: File; ext: string; defaultBase: string; name: string } | null>(null);

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
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const captureNameInputRef = useRef<HTMLInputElement>(null);
  const attachSwipeRef = useRef({ id: 0, startX: 0, startY: 0, moved: false, cancelled: false });
  const attachmentUrlsRef = useRef<Record<number, string>>({});

  const previewItems = useMemo(
    () => attachments.filter((a) => !a.is_orphaned && isPreviewable(a)),
    [attachments],
  );

  function getCacheKey(attachment: AnyAttachment): string {
    const oid = ownerType === "todo" ? (attachment as AttachmentMetadata).todo_id : (attachment as ScheduleAttachmentMetadata).schedule_id;
    return `${attachment.user_id}:${ownerType}:${oid}:${attachment.id}`;
  }

  function getCachePath(attachment: AnyAttachment): string {
    return `attachment-cache/${attachment.user_id}/attachment/${ownerType}/${attachment.id}`;
  }

  function markDownloaded(attachmentId: number) {
    downloadedRef.current.add(attachmentId);
    setDownloadedIds((prev) => {
      if (prev.has(attachmentId)) return prev;
      const next = new Set(prev);
      next.add(attachmentId);
      return next;
    });
  }

  function markNotDownloaded(attachmentId: number) {
    downloadedRef.current.delete(attachmentId);
    setDownloadedIds((prev) => {
      if (!prev.has(attachmentId)) return prev;
      const next = new Set(prev);
      next.delete(attachmentId);
      return next;
    });
  }

  function uploadProgressText(progress: UploadProgress): string {
    if (progress.phase === "processing") return t("common.uploadProcessing");
    return t("common.uploadingPercent", { percent: progress.percent });
  }

  function rememberAttachmentUrl(attachment: AnyAttachment, url: string) {
    if (!isPreviewable(attachment)) return;
    setAttachmentUrls((prev) => {
      const existing = prev[attachment.id];
      if (existing === url) return prev;
      if (existing && existing.startsWith("blob:")) URL.revokeObjectURL(existing);
      return { ...prev, [attachment.id]: url };
    });
  }

  async function openVideoPreview(attachment: AnyAttachment) {
    if (attachment.is_orphaned) return;
    if (downloadingIds.current.has(attachment.id)) return;
    const existingUrl = attachmentUrls[attachment.id];
    if (existingUrl) {
      setPreview(attachment);
      return;
    }
    const ac = new AbortController();
    downloadingIds.current.add(attachment.id);
    downloadAbortMapRef.current.set(attachment.id, ac);
    setDownloadProgressMap((prev) => ({
      ...prev,
      [attachment.id]: { loaded: 0, total: attachment.plain_size_bytes, percent: 0 },
    }));
    try {
      let url: string;
      if (isNativePlatform()) {
        const dlInfo = await getDownloadUrl(attachment.id);
        const downloadMeta = withDownloadSize(attachment, dlInfo);
        const result = await getAttachmentUri(
          (onProgress, abortSignal) => downloadFile(attachment.id, onProgress!, abortSignal!),
          downloadMeta,
          (progress) => setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: progress })),
          ac.signal,
          downloadUrlValue(dlInfo),
        );
        url = result.uri;
      } else {
        const { blob } = await getAttachmentBlob(
          (onProgress, abortSignal) => downloadFile(attachment.id, onProgress!, abortSignal!),
          attachment,
          getCacheKey(attachment),
          (progress) => setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: progress })),
          ac.signal,
        );
        const type = attachment.mime_type && attachment.mime_type !== "application/octet-stream" ? attachment.mime_type : getMimeType(attachment.filename);
        url = URL.createObjectURL(blob.type === type ? blob : blob.slice(0, blob.size, type));
      }
      if (ac.signal.aborted) return;
      markDownloaded(attachment.id);
      rememberAttachmentUrl(attachment, url);
      setPreview(attachment);
      setAttachmentErrors((prev) => { const next = { ...prev }; delete next[attachment.id]; return next; });
    } catch (err: unknown) {
      if (ac.signal.aborted) return;
      const message = err instanceof Error ? err.message : t("common.attachmentOpenFailed");
      setAttachmentErrors((prev) => ({ ...prev, [attachment.id]: message }));
    } finally {
      downloadingIds.current.delete(attachment.id);
      downloadAbortMapRef.current.delete(attachment.id);
      setDownloadProgressMap((prev) => { const next = { ...prev }; delete next[attachment.id]; return next; });
    }
  }

  function forgetAttachmentUrl(attachmentId: number) {
    setAttachmentUrls((prev) => {
      const existing = prev[attachmentId];
      if (existing?.startsWith("blob:")) URL.revokeObjectURL(existing);
      const next = { ...prev };
      delete next[attachmentId];
      return next;
    });
  }

  const loadAttachments = useCallback(async () => {
    batchAbortRef.current?.abort();
    const ac = new AbortController();
    batchAbortRef.current = ac;
    const result = await listAttachments();
    if (ac.signal.aborted) return result.attachments;
    setAttachments(result.attachments);
    setAttachmentErrors({});
    await Promise.all(
      result.attachments.map(async (attachment) => {
        if (ac.signal.aborted) return;
        if (attachment.is_orphaned) return;
        try {
          const cachedUri = await getCachedAttachmentUri(attachment);
          if (ac.signal.aborted) return;
          if (cachedUri) {
            markDownloaded(attachment.id);
            rememberAttachmentUrl(attachment, cachedUri);
          }
        } catch { /* Cache lookup failed */ }
      })
    );
    return result.attachments;
  }, [listAttachments]);

  useEffect(() => {
    loadAttachments().catch(() => {});
  }, [loadAttachments]);

  useEffect(() => {
    if (!captureDraft) return;
    requestAnimationFrame(() => {
      captureNameInputRef.current?.focus();
      captureNameInputRef.current?.select();
    });
  }, [captureDraft]);

  // Sync picker open state to parent ref
  useEffect(() => {
    if (pickerOpenRef) pickerOpenRef.current = pickerAttachment !== null;
  }, [pickerAttachment, pickerOpenRef]);

  useEffect(() => {
    attachmentUrlsRef.current = attachmentUrls;
  }, [attachmentUrls]);

  useEffect(() => {
    return () => {
      Object.values(attachmentUrlsRef.current).forEach((url) => {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      });
    };
  }, []);

  useEffect(() => {
    return () => {
      batchAbortRef.current?.abort();
      downloadAbortMapRef.current.forEach((ac) => ac.abort());
      uploadAbortRef.current?.abort();
    };
  }, []);

  // Load text content when preview changes to a text file
  useEffect(() => {
    if (!preview) return;
    const kind = effectivePreviewKind(preview);
    if (kind !== "text") return;
    let cancelled = false;
    (async () => {
      try {
        let text: string;
        if (isNativePlatform()) {
          const result = await Filesystem.readFile({
            path: getCachePath(preview),
            directory: Directory.Cache,
            encoding: Encoding.UTF8,
          });
          text = String(result.data);
        } else {
          const { blob } = await getAttachmentBlob(
            (onProgress, abortSignal) => downloadFile(preview.id, onProgress!, abortSignal),
            preview,
            getCacheKey(preview),
          );
          text = blob.size > 500 * 1024
            ? await blob.slice(0, 500 * 1024).text()
            : await blob.text();
          if (blob.size > 500 * 1024) {
            text += "\n\n... " + t("common.textPreviewTruncated");
          }
        }
        if (cancelled) return;
        if (!text.includes("\0")) {
          setTextPreviewContent(text);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [preview]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Upload ──

  async function uploadFiles(files: FileList | File[]) {
    const selected = Array.from(files);
    if (selected.length === 0) return;

    for (const file of selected) {
      if (file.size > api.maxAttachmentSize) {
        setUploadError(t("common.fileTooLarge", { name: file.name, size: formatSize(file.size), max: formatSize(api.maxAttachmentSize) }));
        return;
      }
    }

    const ac = new AbortController();
    uploadAbortRef.current = ac;
    setAttachmentBusy(true);
    setUploadError(null);
    try {
      for (const file of selected) {
        const key = `${file.name}-${file.size}`;
        setUploadProgress((prev) => ({ ...prev, [key]: { loaded: 0, total: file.size, percent: 0, phase: "uploading" } }));
        try {
          await uploadFile(file, (progress) => {
            setUploadProgress((prev) => ({ ...prev, [key]: progress }));
          }, ac.signal);
        } finally {
          setUploadProgress((prev) => { const n = { ...prev }; delete n[key]; return n; });
        }
      }
      // Refresh attachment list — failure here is non-fatal (upload already succeeded)
      try {
        const updatedAttachments = await loadAttachments();
        onAttachmentsChanged?.(updatedAttachments.length);
      } catch {
        // List refresh failed but upload succeeded; user can pull-to-refresh
      }
    } catch (err: unknown) {
      if (!ac.signal.aborted) {
        setUploadError(err instanceof Error ? err.message : t("common.attachmentUploadFailed"));
      }
    } finally {
      uploadAbortRef.current = null;
      setAttachmentBusy(false);
    }
  }

  async function uploadNativeFiles(files: NativeAttachmentFile[]) {
    if (!uploadNativeFile) return;
    const selected = Array.from(files);
    if (selected.length === 0) return;

    for (const file of selected) {
      if (file.size >= 0 && file.size > api.maxAttachmentSize) {
        setUploadError(t("common.fileTooLarge", { name: file.name, size: formatSize(file.size), max: formatSize(api.maxAttachmentSize) }));
        return;
      }
    }

    const ac = new AbortController();
    uploadAbortRef.current = ac;
    setAttachmentBusy(true);
    setUploadError(null);
    try {
      for (const file of selected) {
        const total = Math.max(file.size, 0);
        const key = `${file.name}-${file.size}`;
        setUploadProgress((prev) => ({ ...prev, [key]: { loaded: 0, total, percent: 0, phase: "uploading" } }));
        try {
          await uploadNativeFile(file, (progress) => {
            setUploadProgress((prev) => ({ ...prev, [key]: progress }));
          }, ac.signal);
        } finally {
          setUploadProgress((prev) => { const n = { ...prev }; delete n[key]; return n; });
        }
      }
      try {
        const updatedAttachments = await loadAttachments();
        onAttachmentsChanged?.(updatedAttachments.length);
      } catch {
        // List refresh failed but upload succeeded; user can pull-to-refresh
      }
    } catch (err: unknown) {
      if (!ac.signal.aborted) {
        setUploadError(err instanceof Error ? err.message : t("common.attachmentUploadFailed"));
      }
    } finally {
      uploadAbortRef.current = null;
      setAttachmentBusy(false);
    }
  }

  async function handleSelectFiles() {
    if (uploadNativeFile && isNativeAttachmentUploadAvailable()) {
      try {
        const files = await pickNativeAttachmentFiles({ accept: "*/*", multiple: true });
        await uploadNativeFiles(files);
      } catch (err: unknown) {
        setUploadError(err instanceof Error ? err.message : t("common.attachmentUploadFailed"));
      }
      return;
    }
    fileInputRef.current?.click();
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
    setCaptureDraft({ file, ext, defaultBase, name: defaultBase });
  }

  async function confirmCaptureUpload() {
    if (!captureDraft) return;
    const raw = captureDraft.name.trim() || captureDraft.defaultBase;
    const suffix = `.${captureDraft.ext}`;
    const base = raw.toLowerCase().endsWith(suffix.toLowerCase()) ? raw.slice(0, -suffix.length) : raw;
    const finalName = `${base}.${captureDraft.ext}`;
    const renamed = new File([captureDraft.file], finalName, { type: captureDraft.file.type });
    setCaptureDraft(null);
    await uploadFiles([renamed]);
  }

  function cancelCaptureUpload() {
    setCaptureDraft(null);
  }

  // ── Open / Download ──

  async function openWithApp(attachment: AnyAttachment) {
    const nativePath = await getNativeFilePath(attachment);
    if (nativePath) {
      await FileOpener.open({
        filePath: nativePath,
        contentType: getMimeType(attachment.filename),
      });
    }
  }

  async function openAttachment(attachment: AnyAttachment) {
    if (attachment.is_orphaned) return;
    if (downloadingIds.current.has(attachment.id)) return;

    const useDisk = isNativePlatform();

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

    const ac = new AbortController();
    downloadingIds.current.add(attachment.id);
    downloadAbortMapRef.current.set(attachment.id, ac);
    try {
      let url: string;
      if (useDisk) {
        const dlInfo = await getDownloadUrl(attachment.id);
        const downloadMeta = withDownloadSize(attachment, dlInfo);
        const { uri } = await getAttachmentUri(
          (onProgress, abortSignal) => downloadFile(attachment.id, onProgress!, abortSignal!),
          downloadMeta,
          (progress) => setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: progress })),
          ac.signal,
          downloadUrlValue(dlInfo),
        );
        url = uri;
      } else {
        const { blob } = await getAttachmentBlob(
          (onProgress, abortSignal) => downloadFile(attachment.id, onProgress!, abortSignal!),
          attachment,
          getCacheKey(attachment),
          (progress) => setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: progress })),
          ac.signal,
        );
        url = URL.createObjectURL(blob);
      }
      markDownloaded(attachment.id);
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
      setAttachmentErrors((prev) => ({ ...prev, [attachment.id]: message }));
    } finally {
      downloadingIds.current.delete(attachment.id);
      downloadAbortMapRef.current.delete(attachment.id);
      setDownloadProgressMap((prev) => { const next = { ...prev }; delete next[attachment.id]; return next; });
    }
  }

  async function openAttachmentPreview(attachment: AnyAttachment) {
    if (attachment.is_orphaned) return;
    if (downloadingIds.current.has(attachment.id)) return;

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

    const ac = new AbortController();
    downloadingIds.current.add(attachment.id);
    downloadAbortMapRef.current.set(attachment.id, ac);
    try {
      let url: string;
      if (isNativePlatform()) {
        const dlInfo = await getDownloadUrl(attachment.id);
        const downloadMeta = withDownloadSize(attachment, dlInfo);
        const { uri } = await getAttachmentUri(
          (onProgress, abortSignal) => downloadFile(attachment.id, onProgress!, abortSignal!),
          downloadMeta,
          (progress) => setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: progress })),
          ac.signal,
          downloadUrlValue(dlInfo),
        );
        url = uri;
      } else {
        const { blob } = await getAttachmentBlob(
          (onProgress, abortSignal) => downloadFile(attachment.id, onProgress!, abortSignal!),
          attachment,
          getCacheKey(attachment),
          (progress) => setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: progress })),
          ac.signal,
        );
        url = URL.createObjectURL(blob);
      }
      markDownloaded(attachment.id);
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
      setAttachmentErrors((prev) => ({ ...prev, [attachment.id]: message }));
    } finally {
      downloadingIds.current.delete(attachment.id);
      downloadAbortMapRef.current.delete(attachment.id);
      setDownloadProgressMap((prev) => { const next = { ...prev }; delete next[attachment.id]; return next; });
    }
  }

  // ── Remove / Clear cache ──

  async function removeAttachment(attachment: AnyAttachment) {
    const ok = await ask({
      title: t("common.deleteAttachment"),
      message: t("common.deleteAttachmentConfirm", { name: attachment.filename }),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    setAttachmentBusy(true);
    try {
      await removeFile(attachment.id);
      const updatedAttachments = await loadAttachments();
      onAttachmentsChanged?.(updatedAttachments.length);
    } catch {
      // error handled by parent
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function clearAttachmentCache(attachment: AnyAttachment) {
    try {
      await deleteCachedAttachment(attachment);
      markNotDownloaded(attachment.id);
      forgetAttachmentUrl(attachment.id);
      setSavedIds((prev) => { const next = new Set(prev); next.delete(attachment.id); return next; });
    } catch { /* ignore */ }
  }

  // ── Download for save / Save to file ──

  async function downloadForSave(attachment: AnyAttachment) {
    if (attachment.is_orphaned || downloadingIds.current.has(attachment.id)) return;
    if (downloadedRef.current.has(attachment.id)) return;

    setSwipedAttachId(null);
    const ac = new AbortController();
    downloadingIds.current.add(attachment.id);
    downloadAbortMapRef.current.set(attachment.id, ac);
    setDownloadProgressMap((prev) => ({
      ...prev,
      [attachment.id]: { loaded: 0, total: attachment.plain_size_bytes, percent: 0 },
    }));
    try {
      if (isNativePlatform()) {
        const dlInfo = await getDownloadUrl(attachment.id);
        const downloadMeta = withDownloadSize(attachment, dlInfo);
        const { uri } = await getAttachmentUri(
          (onProgress, abortSignal) => downloadFile(attachment.id, onProgress!, abortSignal!),
          downloadMeta,
          (progress) => setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: progress })),
          ac.signal,
          downloadUrlValue(dlInfo),
        );
        rememberAttachmentUrl(attachment, uri);
      } else {
        const { blob } = await getAttachmentBlob(
          (onProgress, abortSignal) => downloadFile(attachment.id, onProgress!, abortSignal!),
          attachment,
          getCacheKey(attachment),
          (progress) => setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: progress })),
          ac.signal,
        );
        rememberAttachmentUrl(attachment, URL.createObjectURL(blob));
      }
      markDownloaded(attachment.id);
    } catch (err: unknown) {
      if (ac.signal.aborted) return;
      const message = err instanceof Error ? err.message : t("common.attachmentOpenFailed");
      setAttachmentErrors((prev) => ({ ...prev, [attachment.id]: message }));
    } finally {
      downloadingIds.current.delete(attachment.id);
      downloadAbortMapRef.current.delete(attachment.id);
      setDownloadProgressMap((prev) => { const next = { ...prev }; delete next[attachment.id]; return next; });
    }
  }

  async function saveToFile(attachment: AnyAttachment) {
    if (!downloadedRef.current.has(attachment.id)) return;
    if (isNativePlatform()) {
      // Open directory picker modal
      setPickerAttachment(attachment);
    } else {
      try {
        const cached = await getAttachmentBlob(
          (onProgress, abortSignal) => downloadFile(attachment.id, onProgress!, abortSignal!),
          attachment,
          getCacheKey(attachment),
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
        setSavedIds((prev) => new Set(prev).add(attachment.id));
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (err instanceof Error && err.name === "AbortError") return;
      }
    }
  }

  // ── Rename ──

  async function handleRename(attachment: AnyAttachment, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === attachment.filename) {
      setRenamingId(null);
      return;
    }
    try {
      const result = await renameFile(attachment.id, trimmed);
      setAttachments((prev) => prev.map((a) => a.id === attachment.id ? { ...a, filename: result.attachment.filename } : a));
      setRenamingId(null);
    } catch { /* ignore */ }
  }

  // ── Preview ──

  async function handlePreview(attachment: AnyAttachment) {
    if (attachment.is_orphaned) return;
    const kind = effectivePreviewKind(attachment);
    if (kind === "video") {
      await openVideoPreview(attachment);
      return;
    }
    if (kind === "image" || kind === "video" || kind === "audio") {
      if (downloadedRef.current.has(attachment.id) && attachmentUrls[attachment.id]) {
        setPreview(attachment);
      } else {
        await openAttachmentPreview(attachment);
      }
    } else if (kind === "text") {
      if (downloadingIds.current.has(attachment.id)) return;
      if (!downloadedRef.current.has(attachment.id)) {
        const ac = new AbortController();
        downloadingIds.current.add(attachment.id);
        downloadAbortMapRef.current.set(attachment.id, ac);
        try {
          if (isNativePlatform()) {
            const dlInfo = await getDownloadUrl(attachment.id);
            const downloadMeta = withDownloadSize(attachment, dlInfo);
            await getAttachmentUri(
              (onProgress, abortSignal) => downloadFile(attachment.id, onProgress!, abortSignal!),
              downloadMeta,
              (progress) => setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: progress })),
              ac.signal,
              downloadUrlValue(dlInfo),
            );
          } else {
            await getAttachmentBlob(
              (onProgress, abortSignal) => downloadFile(attachment.id, onProgress!, abortSignal!),
              attachment,
              getCacheKey(attachment),
              (progress) => setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: progress })),
              ac.signal,
            );
          }
          markDownloaded(attachment.id);
          setAttachmentErrors((prev) => { const next = { ...prev }; delete next[attachment.id]; return next; });
        } catch (err: unknown) {
          if (ac.signal.aborted) return;
          const message = err instanceof Error ? err.message : t("common.attachmentOpenFailed");
          setAttachmentErrors((prev) => ({ ...prev, [attachment.id]: message }));
          return;
        } finally {
          downloadingIds.current.delete(attachment.id);
          downloadAbortMapRef.current.delete(attachment.id);
          setDownloadProgressMap((prev) => { const next = { ...prev }; delete next[attachment.id]; return next; });
        }
      }
      setTextPreviewContent(null);
      setPreview(attachment);
    }
  }

  // ── Zoom / Pan ──

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
    <>
      <div className={`${modalClass}-section-label`}>{t("common.attachments")}</div>

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
        <button type="button" className="attach-icon-btn" onClick={handleSelectFiles} aria-label={t("common.selectFile")}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <input ref={fileInputRef} type="file" multiple hidden onChange={(e) => { const input = e.target as HTMLInputElement; if (input.files && input.files.length > 0) uploadFiles(input.files); setTimeout(() => { input.value = ""; }, 100); }} />
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
            <span className={`attach-row-size ${progress.phase === "processing" ? "processing" : "uploading"}`}>
              {uploadProgressText(progress)}
            </span>
          </div>
        </div>
      ))}

      {/* Upload error */}
      {uploadError ? (
        <div className="attach-upload-error">
          <span>{uploadError}</span>
          <button type="button" className="attach-upload-error-dismiss" onClick={() => setUploadError(null)} aria-label={t("common.close")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      ) : null}

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
          const isDownloaded = downloadedIds.has(attachment.id);
          const isSaved = savedIds.has(attachment.id);
          const isSwiped = swipedAttachId === attachment.id;
          const isRenaming = renamingId === attachment.id;
          const hasClearCacheAction = isDownloaded;

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
              // tap — handled by click events
            }
          }

          return (
            <div
              className={`attach-swipe-wrapper${isSwiped ? " swiped" : ""}${hasClearCacheAction ? "" : " single-action"}`}
              key={attachment.id}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
            >
              {/* Swipe actions: clear cache + delete */}
              {!isDownloading && <div className="attach-swipe-action">
                {hasClearCacheAction && (
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
                {/* Thumbnail */}
                <button
                  type="button"
                  className="attach-row-thumb"
                  disabled={orphaned}
                  onClick={() => handlePreview(attachment)}
                  aria-label={attachment.filename}
                >
                  {orphaned || loadError ? (
                    <AttachmentMissingIcon />
                  ) : effectivePreviewKind(attachment) === "image" && url ? (
                    <img src={url} alt="" />
                  ) : effectivePreviewKind(attachment) === "video" && url ? (
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
                  {loadError ? <span className="attachment-error-text">{loadError}</span> : null}
                </div>

                {/* Primary action button — three states */}
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

            </div>
          );
        })}
        </div>
      </div>

      {/* Preview lightbox */}
      {preview ? (() => {
        const currentIdx = previewItems.findIndex((a) => a.id === preview.id);
        const kind = effectivePreviewKind(preview);
        const previewUrl = attachmentUrls[preview.id];
        const openPreviewItem = (item: AnyAttachment) => {
          resetZoom();
          setTextPreviewContent(null);
          void handlePreview(item);
        };
        const goPrev = currentIdx > 0 ? () => openPreviewItem(previewItems[currentIdx - 1]) : null;
        const goNext = currentIdx < previewItems.length - 1 ? () => openPreviewItem(previewItems[currentIdx + 1]) : null;
        return (
          <div className="attachment-preview-backdrop" onClick={() => { setPreview(null); setTextPreviewContent(null); }}>
            <div className="attachment-preview-panel" onClick={(e) => e.stopPropagation()} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp} onDoubleClick={handleDoubleClick}>
              {goPrev && (
                <button type="button" className="preview-nav preview-nav-prev" onClick={(e) => { e.stopPropagation(); goPrev(); }} aria-label={t("common.previous")}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                </button>
              )}
              <div className={`attachment-preview-media-frame attachment-preview-media-frame-${kind}`}>
                <button
                  type="button"
                  className={`${modalClass}-close attachment-preview-close`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => { setPreview(null); setTextPreviewContent(null); }}
                  aria-label={t("common.close")}
                >
                  ×
                </button>
                {kind === "image" && previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={preview.filename}
                    style={{
                      transform: `scale(${zoom.scale}) translate(${zoom.x / zoom.scale}px, ${zoom.y / zoom.scale}px)`,
                      transition: zoomRef.current.isPinching ? 'none' : 'transform 0.15s ease-out',
                      touchAction: 'none',
                    }}
                  />
                ) : kind === "video" && previewUrl ? (
                  <video
                    src={previewUrl}
                    controls
                    playsInline
                    preload="metadata"
                  />
                ) : kind === "audio" ? (
                  <div className="preview-audio-wrapper">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                    </svg>
                    <audio src={previewUrl} controls autoPlay style={{ width: "100%", marginTop: 16 }} />
                    <div className="preview-audio-name">{preview.filename}</div>
                  </div>
                ) : kind === "text" && textPreviewContent !== null ? (
                  <div className="preview-text-wrapper">
                    <div className="preview-text-name">{preview.filename}</div>
                    <pre className="preview-text">{textPreviewContent}</pre>
                  </div>
                ) : null}
              </div>
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
      {captureDraft ? (
        <div className="capture-name-backdrop" onClick={cancelCaptureUpload}>
          <div className="capture-name-card" role="dialog" aria-label={t("common.photoNamePrompt")} onClick={(e) => e.stopPropagation()}>
            <div className="capture-name-header">
              <div className="capture-name-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </div>
              <div>
                <div className="capture-name-title">{t("common.photoNamePrompt")}</div>
                <div className="capture-name-subtitle">.{captureDraft.ext}</div>
              </div>
            </div>
            <label className="capture-name-label" htmlFor="capture-name-input">{t("common.filename")}</label>
            <div className="capture-name-input-wrap">
              <input
                ref={captureNameInputRef}
                id="capture-name-input"
                className="capture-name-input"
                value={captureDraft.name}
                onChange={(e) => setCaptureDraft((prev) => prev ? { ...prev, name: e.target.value } : prev)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmCaptureUpload();
                  if (e.key === "Escape") cancelCaptureUpload();
                }}
              />
              <span className="capture-name-ext">.{captureDraft.ext}</span>
            </div>
            <div className="capture-name-actions">
              <button type="button" className="capture-name-btn capture-name-btn-primary" onClick={confirmCaptureUpload}>
                {t("common.confirm")}
              </button>
              <button type="button" className="capture-name-btn capture-name-btn-cancel" onClick={cancelCaptureUpload}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pickerAttachment && (
        <DirectoryPickerModal
          filename={pickerAttachment.filename}
          cacheRelPath={getCachePath(pickerAttachment)}
          onClose={() => setPickerAttachment(null)}
          onSaved={() => {
            setSavedIds((prev) => new Set(prev).add(pickerAttachment.id));
            setPickerAttachment(null);
          }}
        />
      )}
    </>
  );
}
