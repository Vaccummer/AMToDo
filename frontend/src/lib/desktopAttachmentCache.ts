import type { AttachmentDownloadUrl, AttachmentMetadata, ScheduleAttachmentMetadata } from "../api/client";
import type { DownloadProgress } from "./chunked-download";

type CacheableMeta = AttachmentMetadata | ScheduleAttachmentMetadata;

const HTTP_CHUNK_SIZE = 1024 * 1024;

type CacheEntry = {
  root?: string;
  ownerType: "todo" | "schedule";
  ownerId: number;
  attachmentId: number;
  filename: string;
  size: number;
};

function ownerInfo(meta: CacheableMeta): { ownerType: "todo" | "schedule"; ownerId: number } {
  if ("todo_id" in meta) return { ownerType: "todo", ownerId: meta.todo_id };
  return { ownerType: "schedule", ownerId: meta.schedule_id };
}

function entryFor(meta: CacheableMeta, root?: string): CacheEntry {
  const owner = ownerInfo(meta);
  return {
    root,
    ...owner,
    attachmentId: meta.id,
    filename: meta.filename,
    size: meta.plain_size_bytes,
  };
}

function downloadUrlValue(info: AttachmentDownloadUrl): string {
  return typeof info === "string" ? info : info.url;
}

function downloadHeadersValue(info: AttachmentDownloadUrl): Record<string, string> {
  return typeof info === "string" ? {} : (info.headers ?? {});
}

function shellRequired() {
  const shell = window.amtodoShell;
  if (!shell?.getAttachmentCacheEntry || !shell.appendAttachmentCacheChunk || !shell.finalizeAttachmentCacheEntry) {
    throw new Error("Desktop attachment cache is not available");
  }
  return shell;
}

export async function getDefaultDesktopAttachmentRoot(): Promise<string> {
  const result = await window.amtodoShell?.getDefaultAttachmentDownloadRoot?.();
  return result?.ok ? result.path : "";
}

export async function selectDesktopAttachmentRoot(): Promise<string | null> {
  const result = await window.amtodoShell?.selectAttachmentDownloadRoot?.();
  if (!result?.ok || !result.path) return null;
  return result.path;
}

export async function getDesktopCachedAttachment(
  meta: CacheableMeta,
  root?: string,
): Promise<{ exists: boolean; filePath: string; folderPath: string; partialBytes: number }> {
  const shell = shellRequired();
  const result = await shell.getAttachmentCacheEntry!(entryFor(meta, root));
  if (!result.ok) throw new Error(result.error || "Failed to read attachment cache");
  return {
    exists: result.exists,
    filePath: result.filePath,
    folderPath: result.folderPath,
    partialBytes: result.partialBytes,
  };
}

export async function deleteDesktopCachedAttachment(meta: CacheableMeta, root?: string): Promise<void> {
  const result = await window.amtodoShell?.deleteAttachmentCacheEntry?.(entryFor(meta, root));
  if (!result?.ok) throw new Error(result?.error || "Failed to delete cached attachment");
}

export async function openDesktopAttachmentFolder(meta: CacheableMeta, root?: string): Promise<void> {
  const result = await window.amtodoShell?.openAttachmentCacheFolder?.(entryFor(meta, root));
  if (!result?.ok) throw new Error(result?.error || "Failed to open attachment folder");
}

export async function clearDesktopAttachmentDownloadCache(root?: string): Promise<void> {
  const result = await window.amtodoShell?.clearAttachmentDownloadCache?.(root);
  if (!result?.ok) throw new Error(result?.error || "Failed to clear desktop attachment cache");
}

export async function getDesktopAttachmentDownloadCacheSize(root?: string): Promise<{ count: number; bytes: number }> {
  const result = await window.amtodoShell?.getAttachmentDownloadCacheSize?.(root);
  if (!result?.ok) return { count: 0, bytes: 0 };
  return { count: result.count, bytes: result.bytes };
}

export async function readDesktopAttachmentTextPreview(
  meta: CacheableMeta,
  root?: string,
  maxBytes = 500 * 1024,
): Promise<{ text: string; truncated: boolean }> {
  const result = await window.amtodoShell?.readAttachmentTextPreview?.(entryFor(meta, root), maxBytes);
  if (!result?.ok) throw new Error(result?.error || "Failed to read text preview");
  return { text: result.text ?? "", truncated: Boolean(result.truncated) };
}

export async function downloadDesktopAttachmentToCache(
  meta: CacheableMeta,
  downloadInfo: AttachmentDownloadUrl,
  root: string | undefined,
  onProgress?: (progress: DownloadProgress) => void,
  abortSignal?: AbortSignal,
): Promise<{ filePath: string; folderPath: string; cacheHit: boolean }> {
  const shell = shellRequired();
  const entry = entryFor(meta, root);
  const cached = await getDesktopCachedAttachment(meta, root);
  if (cached.exists) {
    onProgress?.({ loaded: meta.plain_size_bytes, total: meta.plain_size_bytes, percent: 100 });
    return { filePath: cached.filePath, folderPath: cached.folderPath, cacheHit: true };
  }

  const url = downloadUrlValue(downloadInfo);
  const headers = downloadHeadersValue(downloadInfo);
  let loaded = Math.max(0, cached.partialBytes || 0);
  let total = Math.max(meta.plain_size_bytes || 0, loaded);

  while (loaded < total || total === 0) {
    if (abortSignal?.aborted) throw new Error("Download aborted");
    const end = total > 0
      ? Math.min(total - 1, loaded + HTTP_CHUNK_SIZE - 1)
      : loaded + HTTP_CHUNK_SIZE - 1;
    const response = await fetch(url, {
      headers: {
        ...headers,
        Range: `bytes=${loaded}-${end}`,
      },
      signal: abortSignal,
    });
    if (response.status !== 206 && !(loaded === 0 && response.ok)) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const contentRange = response.headers.get("Content-Range");
    const rangeTotal = contentRange?.match(/\/(\d+)$/)?.[1];
    if (rangeTotal) total = Number(rangeTotal);
    if (!total) total = Number(response.headers.get("Content-Length") || meta.plain_size_bytes || 0);

    const chunk = new Uint8Array(await response.arrayBuffer());
    if (chunk.byteLength === 0) break;
    const append = await shell.appendAttachmentCacheChunk!({ ...entry, offset: loaded }, chunk);
    if (!append.ok) throw new Error(append.error || "Failed to write attachment chunk");
    loaded += chunk.byteLength;
    onProgress?.({
      loaded,
      total,
      percent: total ? Math.min(100, Math.round((loaded / total) * 100)) : 0,
    });
    if (response.status !== 206) break;
  }

  if (abortSignal?.aborted) throw new Error("Download aborted");
  const finalized = await shell.finalizeAttachmentCacheEntry!(entry);
  if (!finalized.ok || !finalized.filePath || !finalized.folderPath) {
    throw new Error(finalized.error || "Failed to finalize attachment download");
  }
  onProgress?.({ loaded, total: total || loaded, percent: 100 });
  return { filePath: finalized.filePath, folderPath: finalized.folderPath, cacheHit: false };
}
