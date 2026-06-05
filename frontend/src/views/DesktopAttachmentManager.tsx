import { useCallback, useEffect, useRef, useState } from "react";
import type { AMToDoApi, AttachmentDownloadUrl, AttachmentMetadata, ScheduleAttachmentMetadata } from "../api/client";
import type { UploadProgress } from "../lib/chunked-upload";
import type { DownloadProgress } from "../lib/chunked-download";
import { getFileIconSvg } from "../lib/file-icon-map";
import {
  deleteDesktopCachedAttachment,
  downloadDesktopAttachmentToCache,
  getDesktopCachedAttachment,
  openDesktopAttachmentFolder,
  readDesktopAttachmentTextPreview,
} from "../lib/desktopAttachmentCache";
import { useI18n } from "../i18n";
import { useConfirm } from "./ConfirmDialog";

type AnyAttachment = AttachmentMetadata | ScheduleAttachmentMetadata;

type Props = {
  ownerType: "todo" | "schedule";
  ownerId: number;
  api: AMToDoApi;
  downloadRoot?: string;
  uploadFile: (file: File, onProgress: (p: UploadProgress) => void, signal?: AbortSignal) => Promise<unknown>;
  getDownloadUrl: (attachmentId: number) => Promise<AttachmentDownloadUrl>;
  removeFile: (attachmentId: number) => Promise<unknown>;
  listAttachments: () => Promise<{ attachments: AnyAttachment[] }>;
  onAttachmentsChanged?: (count: number) => void;
  modalClass?: string;
};

const VIDEO_EXTS = new Set(["mp4", "mov", "m4v", "webm", "mkv", "avi", "wmv", "flv", "3gp", "mpeg", "mpg", "ogv"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "flac", "aac", "m4a", "wma", "opus"]);
const TEXT_EXTS = new Set(["txt", "md", "json", "csv", "xml", "log", "py", "js", "ts", "tsx", "jsx", "html", "css", "yaml", "yml", "ini", "cfg", "sh", "bat", "rs", "go", "java", "c", "cpp", "h", "hpp", "sql", "toml", "env"]);

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function effectivePreviewKind(a: AnyAttachment): "image" | "video" | "audio" | "text" | "none" {
  if (a.preview_kind === "image" || a.preview_kind === "video") return a.preview_kind;
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

function filePathToUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const prefixed = normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`;
  return encodeURI(prefixed);
}

function AttachmentMissingIcon() {
  return (
    <svg className="attachment-missing-icon" viewBox="0 0 1024 1024" aria-hidden="true">
      <path d="M128 597.333333l170.666667 106.666667 128-149.333333 128 170.666666 85.333333-106.666666 128 21.333333-128-128-85.333333 106.666667-128-213.333334-149.333334 160L128 426.666667V127.658667C128 104.746667 147.072 85.333333 170.581333 85.333333H597.333333v256a42.666667 42.666667 0 0 0 42.666667 42.666667h256v511.701333A42.666667 42.666667 0 0 1 853.632 938.666667H170.368A42.368 42.368 0 0 1 128 896.341333V597.333333z m768-298.666666h-213.333333V85.461333L896 298.666667z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ContinueDownloadIcon() {
  return (
    <svg viewBox="0 0 1024 1024" fill="currentColor" aria-hidden="true">
      <path d="M757.333333 447.125333L363.093333 167.872a83.413333 83.413333 0 0 0-131.626666 68.096v558.464a83.413333 83.413333 0 0 0 131.626666 68.074667L757.333333 583.274667a83.413333 83.413333 0 0 0 0-136.149334z m-38.506666 74.965334a11.925333 11.925333 0 0 1-2.837334 2.837333l-394.218666 279.253333a11.925333 11.925333 0 0 1-18.794667-9.749333V235.968a11.925333 11.925333 0 0 1 18.794667-9.728l394.24 279.253333a11.925333 11.925333 0 0 1 3.904 14.72l-1.066667 1.877334z" />
    </svg>
  );
}

export function DesktopAttachmentManager({
  ownerType,
  ownerId,
  api,
  downloadRoot,
  uploadFile,
  getDownloadUrl,
  removeFile,
  listAttachments,
  onAttachmentsChanged,
  modalClass = "modal",
}: Props) {
  const { t } = useI18n();
  const { ask, dialog: confirmDialog } = useConfirm();
  const [attachments, setAttachments] = useState<AnyAttachment[]>([]);
  const [attachmentUrls, setAttachmentUrls] = useState<Record<number, string>>({});
  const [attachmentErrors, setAttachmentErrors] = useState<Record<number, string>>({});
  const [downloadedIds, setDownloadedIds] = useState<Set<number>>(new Set());
  const [cacheActionIds, setCacheActionIds] = useState<Set<number>>(new Set());
  const [partialCacheIds, setPartialCacheIds] = useState<Set<number>>(new Set());
  const [downloadProgressMap, setDownloadProgressMap] = useState<Record<number, DownloadProgress>>({});
  const [uploadProgress, setUploadProgress] = useState<Record<string, UploadProgress>>({});
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AnyAttachment | null>(null);
  const [textPreviewContent, setTextPreviewContent] = useState<string | null>(null);
  const downloadedRef = useRef<Set<number>>(new Set());
  const downloadingIds = useRef<Set<number>>(new Set());
  const downloadAbortMapRef = useRef<Map<number, AbortController>>(new Map());
  const uploadAbortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAttachments = useCallback(async () => {
    const result = await listAttachments();
    setAttachments(result.attachments);
    setAttachmentErrors({});
    for (const attachment of result.attachments) {
      if (attachment.is_orphaned) continue;
      try {
        const cached = await getDesktopCachedAttachment(attachment, downloadRoot);
        if (cached.exists) {
          markDownloaded(attachment.id);
          markPartialCacheUnavailable(attachment.id);
          setAttachmentUrls((prev) => ({ ...prev, [attachment.id]: filePathToUrl(cached.filePath) }));
        } else if (cached.partialBytes > 0) {
          markPartialCacheAvailable(attachment.id);
          markCacheActionAvailable(attachment.id);
        } else {
          markPartialCacheUnavailable(attachment.id);
          markCacheActionUnavailable(attachment.id);
        }
      } catch {
        markPartialCacheUnavailable(attachment.id);
        markCacheActionUnavailable(attachment.id);
      }
    }
    return result.attachments;
  }, [listAttachments, downloadRoot]);

  useEffect(() => {
    loadAttachments().catch(() => {});
  }, [loadAttachments]);

  useEffect(() => {
    if (!preview || effectivePreviewKind(preview) !== "text") {
      setTextPreviewContent(null);
      return;
    }

    let cancelled = false;
    setTextPreviewContent("");
    readDesktopAttachmentTextPreview(preview, downloadRoot)
      .then((result) => {
        if (cancelled) return;
        const suffix = result.truncated ? `\n\n... ${t("common.textPreviewTruncated")}` : "";
        setTextPreviewContent(result.text + suffix);
      })
      .catch(() => {
        if (!cancelled) setTextPreviewContent(t("common.attachmentOpenFailed"));
      });

    return () => {
      cancelled = true;
    };
  }, [preview, downloadRoot, t]);

  function markDownloaded(attachmentId: number) {
    downloadedRef.current.add(attachmentId);
    setDownloadedIds((prev) => prev.has(attachmentId) ? prev : new Set(prev).add(attachmentId));
    markPartialCacheUnavailable(attachmentId);
    markCacheActionAvailable(attachmentId);
  }

  function markNotDownloaded(attachmentId: number) {
    downloadedRef.current.delete(attachmentId);
    setDownloadedIds((prev) => {
      const next = new Set(prev);
      next.delete(attachmentId);
      return next;
    });
  }

  function markCacheActionAvailable(attachmentId: number) {
    setCacheActionIds((prev) => prev.has(attachmentId) ? prev : new Set(prev).add(attachmentId));
  }

  function markCacheActionUnavailable(attachmentId: number) {
    setCacheActionIds((prev) => {
      const next = new Set(prev);
      next.delete(attachmentId);
      return next;
    });
  }

  function markPartialCacheAvailable(attachmentId: number) {
    setPartialCacheIds((prev) => prev.has(attachmentId) ? prev : new Set(prev).add(attachmentId));
  }

  function markPartialCacheUnavailable(attachmentId: number) {
    setPartialCacheIds((prev) => {
      const next = new Set(prev);
      next.delete(attachmentId);
      return next;
    });
  }

  async function refreshCacheState(attachment: AnyAttachment) {
    try {
      const cached = await getDesktopCachedAttachment(attachment, downloadRoot);
      if (cached.exists) {
        markDownloaded(attachment.id);
        setAttachmentUrls((prev) => ({ ...prev, [attachment.id]: filePathToUrl(cached.filePath) }));
      } else if (cached.partialBytes > 0) {
        markNotDownloaded(attachment.id);
        markPartialCacheAvailable(attachment.id);
        markCacheActionAvailable(attachment.id);
      } else {
        markNotDownloaded(attachment.id);
        markPartialCacheUnavailable(attachment.id);
        markCacheActionUnavailable(attachment.id);
      }
    } catch {
      markPartialCacheUnavailable(attachment.id);
    }
  }

  function cancelUpload() {
    uploadAbortRef.current?.abort();
  }

  function cancelDownload(attachmentId: number) {
    downloadAbortMapRef.current.get(attachmentId)?.abort();
  }

  function closePreview() {
    setPreview(null);
    setTextPreviewContent(null);
  }

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
        const key = `${file.name}::${file.size}::${Date.now()}`;
        setUploadProgress((prev) => ({ ...prev, [key]: { loaded: 0, total: file.size, percent: 0, phase: "uploading" } }));
        try {
          await uploadFile(file, (progress) => {
            setUploadProgress((prev) => ({ ...prev, [key]: progress }));
          }, ac.signal);
        } finally {
          setUploadProgress((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
        }
      }
      const updated = await loadAttachments();
      onAttachmentsChanged?.(updated.length);
    } catch (err: unknown) {
      if (!ac.signal.aborted) setUploadError(err instanceof Error ? err.message : t("common.attachmentUploadFailed"));
    } finally {
      uploadAbortRef.current = null;
      setAttachmentBusy(false);
      setDragActive(false);
    }
  }

  async function downloadAttachment(attachment: AnyAttachment, openPreview = false) {
    if (attachment.is_orphaned || downloadingIds.current.has(attachment.id)) return;
    const ac = new AbortController();
    downloadingIds.current.add(attachment.id);
    downloadAbortMapRef.current.set(attachment.id, ac);
    setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: { loaded: 0, total: attachment.plain_size_bytes, percent: 0 } }));
    try {
      const info = await getDownloadUrl(attachment.id);
      const result = await downloadDesktopAttachmentToCache(
        attachment,
        info,
        downloadRoot,
        (progress) => setDownloadProgressMap((prev) => ({ ...prev, [attachment.id]: progress })),
        ac.signal,
      );
      if (ac.signal.aborted) return;
      markDownloaded(attachment.id);
      setAttachmentUrls((prev) => ({ ...prev, [attachment.id]: filePathToUrl(result.filePath) }));
      setAttachmentErrors((prev) => {
        const next = { ...prev };
        delete next[attachment.id];
        return next;
      });
      if (openPreview && effectivePreviewKind(attachment) !== "none") setPreview(attachment);
    } catch (err: unknown) {
      if (!ac.signal.aborted) {
        const message = err instanceof Error ? err.message : t("common.attachmentOpenFailed");
        setAttachmentErrors((prev) => ({ ...prev, [attachment.id]: message }));
        try {
          const cached = await getDesktopCachedAttachment(attachment, downloadRoot);
          if (cached.partialBytes > 0) {
            markPartialCacheAvailable(attachment.id);
            markCacheActionAvailable(attachment.id);
          } else {
            markPartialCacheUnavailable(attachment.id);
          }
        } catch { /* ignore */ }
      }
    } finally {
      downloadingIds.current.delete(attachment.id);
      downloadAbortMapRef.current.delete(attachment.id);
      setDownloadProgressMap((prev) => {
        const next = { ...prev };
        delete next[attachment.id];
        return next;
      });
      if (!downloadedRef.current.has(attachment.id)) await refreshCacheState(attachment);
    }
  }

  async function clearAttachmentCache(attachment: AnyAttachment) {
    try {
      await deleteDesktopCachedAttachment(attachment, downloadRoot);
      markNotDownloaded(attachment.id);
      markPartialCacheUnavailable(attachment.id);
      markCacheActionUnavailable(attachment.id);
      setAttachmentUrls((prev) => {
        const next = { ...prev };
        delete next[attachment.id];
        return next;
      });
    } catch { /* ignore */ }
  }

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
      await clearAttachmentCache(attachment);
      const updated = await loadAttachments();
      onAttachmentsChanged?.(updated.length);
    } finally {
      setAttachmentBusy(false);
    }
  }

  async function openFolder(attachment: AnyAttachment) {
    await openDesktopAttachmentFolder(attachment, downloadRoot).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : t("common.operationFailed");
      setAttachmentErrors((prev) => ({ ...prev, [attachment.id]: message }));
    });
  }

  return (
    <>
      <div className={`${modalClass}-section-label`}>{t("common.attachments")}</div>
      <div
        className={`attachment-dropzone${dragActive ? " active" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          void uploadFiles(e.dataTransfer.files);
        }}
      >
        <span>{attachmentBusy ? t("common.processing") : t("common.dropFilesHere")}</span>
        <button type="button" className="attachment-upload-button" onClick={() => fileInputRef.current?.click()}>
          {t("common.selectFile")}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void uploadFiles(e.target.files);
            e.currentTarget.value = "";
          }}
        />
      </div>

      {Object.entries(uploadProgress).map(([key, progress]) => (
        <div key={key} className="attach-row uploading">
          <div className="ring-progress">
            <svg viewBox="0 0 36 36">
              <circle className="ring-bg" cx="18" cy="18" r="15.9" />
              <circle className="ring-fill upload" cx="18" cy="18" r="15.9" strokeDasharray={`${progress.percent} ${100 - progress.percent}`} strokeDashoffset="25" />
            </svg>
            <button type="button" className="ring-cancel" onClick={cancelUpload} aria-label={t("common.cancelUpload")}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div className="attach-row-info">
            <span className="attach-row-name" title={key.split("::")[0]}>{key.split("::")[0]}</span>
            <span className="attach-row-size uploading">{t("common.uploadingPercent", { percent: progress.percent })}</span>
          </div>
        </div>
      ))}

      {uploadError ? <div className="modal-error">{uploadError}</div> : null}

      <div className="attachment-list">
        {attachments.map((attachment) => {
          const kind = effectivePreviewKind(attachment);
          const url = attachmentUrls[attachment.id];
          const orphaned = attachment.is_orphaned;
          const isDownloading = downloadingIds.current.has(attachment.id);
          const dlProgress = downloadProgressMap[attachment.id];
          const isDownloaded = downloadedIds.has(attachment.id);
          const hasCacheAction = cacheActionIds.has(attachment.id);
          const hasPartialCache = partialCacheIds.has(attachment.id);
          const ext = attachment.filename.split(".").pop()?.toUpperCase().slice(0, 4) || "FILE";
          const fileIconSvg = getFileIconSvg(attachment.filename);
          const loadError = attachmentErrors[attachment.id];

          return (
            <div className={`attachment-row desktop-attachment-row${orphaned ? " orphaned" : ""}${loadError ? " failed" : ""}`} key={attachment.id}>
              <button
                type="button"
                className="attachment-thumb"
                disabled={orphaned}
                onClick={() => {
                  if (isDownloaded && (url || kind === "text") && kind !== "none") setPreview(attachment);
                  else void downloadAttachment(attachment, true);
                }}
                aria-label={attachment.filename}
              >
                {orphaned || loadError ? (
                  <AttachmentMissingIcon />
                ) : (kind === "image" || kind === "video") && url ? (
                  kind === "image" ? <img src={url} alt="" /> : <video src={url} muted />
                ) : fileIconSvg ? (
                  <span className="attach-file-icon" aria-hidden="true" dangerouslySetInnerHTML={{ __html: fileIconSvg }} />
                ) : (
                  <span>{ext}</span>
                )}
              </button>

              <button
                type="button"
                className="attachment-name"
                disabled={orphaned || isDownloading}
                onClick={() => {
                  if (isDownloaded && (url || kind === "text") && kind !== "none") setPreview(attachment);
                  else void downloadAttachment(attachment, true);
                }}
              >
                <span className="attachment-filename">{attachment.filename}</span>
                <span className="attachment-size">
                  {orphaned
                    ? t("common.fileMissing")
                    : isDownloading
                      ? (dlProgress ? t("common.downloadingPercent", { percent: dlProgress.percent }) : t("common.downloading"))
                      : isDownloaded ? t("common.downloadComplete") : formatSize(attachment.plain_size_bytes)}
                </span>
              </button>

              <div className="desktop-attachment-actions">
                {isDownloading ? (
                  <button type="button" className="attach-action-btn cancel" onClick={() => cancelDownload(attachment.id)} aria-label={t("common.cancelDownload")}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                ) : !isDownloaded ? (
                  <button type="button" className={`attach-action-btn download${hasPartialCache ? " resume" : ""}`} disabled={orphaned} onClick={() => downloadAttachment(attachment)} aria-label={hasPartialCache ? t("common.continueDownload") : t("common.downloading")}>
                    {hasPartialCache ? <ContinueDownloadIcon /> : <DownloadIcon />}
                  </button>
                ) : null}
                {hasCacheAction ? (
                  <button type="button" className="attach-action-btn cache" onClick={() => clearAttachmentCache(attachment)} aria-label={t("settings.clearCache")}>
                    <svg viewBox="0 0 1024 1024" fill="currentColor">
                      <path d="M921.173333 905.728l-56.021333-330.922667h18.901333a27.733333 27.733333 0 0 0 27.52-28.16V338.773333a27.733333 27.733333 0 0 0-27.52-28.16h-260.010666V113.493333A27.733333 27.733333 0 0 0 596.565333 85.333333h-169.130666a27.733333 27.733333 0 0 0-27.477334 28.16v197.12H139.904a27.733333 27.733333 0 0 0-27.477333 28.16v207.872c0 15.616 12.288 28.16 27.477333 28.16h18.944L102.826667 905.728a27.733333 27.733333 0 0 0 27.050666 32.938667h764.245334a27.989333 27.989333 0 0 0 27.050666-32.938667zM186.453333 386.389333h287.488v-225.28h76.117334v225.28h287.488v112.64H186.453333v-112.64z m494.677334 476.458667v-168.917333a8.576 8.576 0 0 0-8.448-8.661334h-50.773334a8.576 8.576 0 0 0-8.448 8.661334v168.96H410.538667v-168.96a8.576 8.576 0 0 0-8.490667-8.661334H351.317333a8.576 8.576 0 0 0-8.448 8.661334v168.96H185.173333l47.658667-281.6H791.04l47.701333 281.6h-157.610666z" />
                    </svg>
                  </button>
                ) : null}
                <button type="button" className="attach-action-btn folder" onClick={() => openFolder(attachment)} aria-label={t("common.openCacheFolder")}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
                <button type="button" className="attachment-remove" disabled={attachmentBusy || isDownloading} onClick={() => removeAttachment(attachment)} aria-label={`${t("common.delete")} ${attachment.filename}`}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
              </div>
              {loadError ? <div className="attachment-error-text">{loadError}</div> : null}
            </div>
          );
        })}
      </div>

      {preview ? (() => {
        const url = attachmentUrls[preview.id];
        const kind = effectivePreviewKind(preview);
        return (
          <div className="attachment-preview-backdrop" onClick={closePreview}>
            <button
              type="button"
              className="attachment-preview-close"
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                closePreview();
              }}
              aria-label={t("common.close")}
            >
              ×
            </button>
            <div className="attachment-preview-panel" onClick={(e) => e.stopPropagation()}>
              {kind === "image" && url ? <img src={url} alt={preview.filename} /> : null}
              {kind === "video" && url ? <video src={url} controls autoPlay /> : null}
              {kind === "audio" && url ? <audio src={url} controls autoPlay /> : null}
              {kind === "text" ? (
                <div className="preview-text-wrapper">
                  <div className="preview-text-name">{preview.filename}</div>
                  <pre className="preview-text">{textPreviewContent ?? ""}</pre>
                </div>
              ) : null}
            </div>
          </div>
        );
      })() : null}
      {confirmDialog}
    </>
  );
}
