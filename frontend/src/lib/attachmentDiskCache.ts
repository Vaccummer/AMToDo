/**
 * Disk-based attachment cache using @capacitor/filesystem.
 *
 * Directory layout:
 *   attachment-cache/{user_id}/attachment/todo/{attachment_id}
 *   attachment-cache/{user_id}/attachment/schedule/{attachment_id}
 *
 * Flow:
 * 1. Check disk cache → if exists, return file URI
 * 2. Download file bytes via downloadFn (returns ArrayBuffer)
 * 3. Write content to Filesystem cache directory (base64)
 * 4. Return WebView-compatible file URI
 */

import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";

import write_blob from "capacitor-blob-writer";
import type { AttachmentMetadata, ScheduleAttachmentMetadata } from "../api/client";
import type { DownloadProgress } from "./chunked-download";

type CacheableMeta = AttachmentMetadata | ScheduleAttachmentMetadata;

const CACHE_DIR = "attachment-cache";
// In-memory metadata index for fast cache invalidation
const metaIndex = new Map<string, { updated_at: number; plain_size_bytes: number }>();

/** e.g. "3/attachment/todo/42" */
function cachePathFor(meta: CacheableMeta): string {
  const ownerType = "todo_id" in meta ? "todo" : "schedule";
  const ownerId = "todo_id" in meta ? (meta as AttachmentMetadata).todo_id : (meta as ScheduleAttachmentMetadata).schedule_id;
  return `${meta.user_id}/attachment/${ownerType}/${meta.id}`;
}

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/** Ensure the full directory tree exists for a cache path like "3/attachment/todo/42" */
async function ensureParentDir(filePath: string): Promise<void> {
  // filePath looks like "3/attachment/todo/42" — we need "3/attachment/todo" to exist
  const parts = filePath.split("/");
  parts.pop(); // remove the filename (attachment id)
  let current = CACHE_DIR;
  for (const part of parts) {
    current = `${current}/${part}`;
    try {
      await Filesystem.stat({ path: current, directory: Directory.Cache });
    } catch {
      await Filesystem.mkdir({ path: current, directory: Directory.Cache, recursive: true });
    }
  }
}

// ── Cache lookup ──

async function getCachedUri(path: string, meta: CacheableMeta): Promise<string | null> {
  const cached = metaIndex.get(path);

  // Invalidate if metadata changed (file re-uploaded)
  if (cached && (cached.updated_at !== meta.updated_at || cached.plain_size_bytes !== meta.plain_size_bytes)) {
    try { await Filesystem.deleteFile({ path: `${CACHE_DIR}/${path}`, directory: Directory.Cache }); } catch { /* */ }
    metaIndex.delete(path);
    return null;
  }

  // Verify file exists on disk (also handles cold start when metaIndex is empty)
  try {
    await Filesystem.stat({ path: `${CACHE_DIR}/${path}`, directory: Directory.Cache });
  } catch {
    metaIndex.delete(path);
    return null;
  }

  // File exists on disk — repopulate metaIndex if missing (app was restarted)
  if (!cached) {
    metaIndex.set(path, { updated_at: meta.updated_at, plain_size_bytes: meta.plain_size_bytes });
  }

  const uri = await Filesystem.getUri({ path: `${CACHE_DIR}/${path}`, directory: Directory.Cache });
  return Capacitor.convertFileSrc(uri.uri);
}

// ── Write to disk ──

async function writeContent(
  content: ArrayBuffer,
  meta: CacheableMeta,
  path: string,
): Promise<string> {
  await ensureParentDir(path);

  if (isNative()) {
    // Write via Blob — incremental 384KB chunks, no full-file base64 in memory
    await write_blob({
      path: `${CACHE_DIR}/${path}`,
      directory: Directory.Cache,
      blob: new Blob([content], { type: meta.mime_type }),
      recursive: true,
    });
  } else {
    // Web fallback: base64 encode and write
    const b64 = bufferToBase64(content);
    await Filesystem.writeFile({
      path: `${CACHE_DIR}/${path}`,
      data: b64,
      directory: Directory.Cache,
    });
  }

  metaIndex.set(path, { updated_at: meta.updated_at, plain_size_bytes: meta.plain_size_bytes });

  const uri = await Filesystem.getUri({ path: `${CACHE_DIR}/${path}`, directory: Directory.Cache });
  return Capacitor.convertFileSrc(uri.uri);
}

/**
 * Stream-download from network and append bytes to disk incrementally.
 * Peak JS memory ≈ single chunk size (~64KB), not the full file.
 */
async function streamingDownloadToDisk(
  url: string,
  meta: CacheableMeta,
  cachePath: string,
  onProgress?: (progress: DownloadProgress) => void,
  abortSignal?: AbortSignal,
): Promise<string> {
  const response = await fetch(url, { signal: abortSignal });
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  if (!response.body) throw new Error("ReadableStream not supported");

  const contentLength = Number(response.headers.get("Content-Length") || 0);
  const reader = response.body.getReader();

  // Prepare output file
  await ensureParentDir(cachePath);
  const outPath = `${CACHE_DIR}/${cachePath}`;

  let bytesRead = 0;

  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      await Filesystem.appendFile({ path: outPath, data: bufferToBase64(chunk), directory: Directory.Cache });
      bytesRead += chunk.length;
      onProgress?.({
        loaded: bytesRead,
        total: contentLength,
        percent: contentLength ? Math.round((bytesRead / contentLength) * 100) : 0,
      });
    }
  } finally {
    reader.releaseLock();
  }

  // Validate download completeness
  if (contentLength > 0 && bytesRead < contentLength) {
    try { await Filesystem.deleteFile({ path: outPath, directory: Directory.Cache }); } catch { /* */ }
    throw new Error(`Download incomplete: received ${bytesRead} of ${contentLength} bytes`);
  }

  metaIndex.set(cachePath, { updated_at: meta.updated_at, plain_size_bytes: meta.plain_size_bytes });
  const resultUri = await Filesystem.getUri({ path: outPath, directory: Directory.Cache });
  return Capacitor.convertFileSrc(resultUri.uri);
}

// ── Public API ──

/**
 * Get a WebView-compatible file URI for an attachment.
 * On native: single-pass streaming download → write to cache (constant memory).
 * On web: uses downloadFn fallback (full file in memory).
 */
export async function getAttachmentUri(
  downloadFn: (onProgress?: (progress: DownloadProgress) => void, abortSignal?: AbortSignal) => Promise<ArrayBuffer>,
  metadata: CacheableMeta,
  onProgress?: (progress: DownloadProgress) => void,
  abortSignal?: AbortSignal,
  downloadUrl?: string,
): Promise<{ uri: string; cacheHit: boolean }> {
  const path = cachePathFor(metadata);

  const cachedUri = await getCachedUri(path, metadata);
  if (cachedUri) {
    onProgress?.({ loaded: metadata.plain_size_bytes, total: metadata.plain_size_bytes, percent: 100 });
    return { uri: cachedUri, cacheHit: true };
  }

  // Native path: single-pass streaming download (constant memory)
  if (isNative() && downloadUrl) {
    const attempt = () => streamingDownloadToDisk(downloadUrl, metadata, path, onProgress, abortSignal);
    try {
      const uri = await attempt();
      return { uri, cacheHit: false };
    } catch (err) {
      if (err instanceof Error && err.message.includes("incomplete")) {
        const uri = await attempt();
        return { uri, cacheHit: false };
      }
      throw err;
    }
  }


  // Web fallback: downloadFn returns ArrayBuffer in memory
  let content: ArrayBuffer;
  try {
    content = await downloadFn(onProgress, abortSignal);
  } catch (err) {
    if (err instanceof Error && err.message.includes("incomplete")) {
      content = await downloadFn(onProgress, abortSignal);
    } else {
      throw err;
    }
  }

  const uri = await writeContent(content, metadata, path);
  return { uri, cacheHit: false };
}

function bufferToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const chunk = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunk) {
    parts.push(String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length))));
  }
  return btoa(parts.join(""));
}

/**
 * Get cached URI without downloading. Returns null if not in cache.
 */
export async function getCachedAttachmentUri(metadata: CacheableMeta): Promise<string | null> {
  if (!isNative()) return null;
  return getCachedUri(cachePathFor(metadata), metadata);
}

/**
 * Delete a specific cached attachment from disk.
 */
export async function deleteCachedAttachment(metadata: CacheableMeta): Promise<void> {
  if (!isNative()) return;
  const path = cachePathFor(metadata);
  try { await Filesystem.deleteFile({ path: `${CACHE_DIR}/${path}`, directory: Directory.Cache }); } catch { /* */ }
  metaIndex.delete(path);
}

/**
 * Get the native file:// path for a cached attachment (for FileOpener).
 * Returns null if file is not cached.
 */
export async function getNativeFilePath(metadata: CacheableMeta): Promise<string | null> {
  if (!isNative()) return null;
  const path = cachePathFor(metadata);
  try {
    await Filesystem.stat({ path: `${CACHE_DIR}/${path}`, directory: Directory.Cache });
  } catch {
    return null;
  }
  const uri = await Filesystem.getUri({ path: `${CACHE_DIR}/${path}`, directory: Directory.Cache });
  return uri.uri;
}

/**
 * Get the native file:// path of the attachment cache folder.
 */
export async function getCacheFolderPath(): Promise<string> {
  const uri = await Filesystem.getUri({ path: CACHE_DIR, directory: Directory.Cache });
  return uri.uri;
}

/**
 * Clear all cached attachments from disk.
 */
export async function clearDiskCache(): Promise<void> {
  if (!isNative()) return;
  try { await Filesystem.rmdir({ path: CACHE_DIR, directory: Directory.Cache, recursive: true }); } catch { /* */ }
  metaIndex.clear();
}

/**
 * Get total size of cached files on disk (traverses nested directories).
 */
export async function getDiskCacheSize(): Promise<{ count: number; bytes: number }> {
  if (!isNative()) return { count: 0, bytes: 0 };

  async function walk(dirPath: string): Promise<{ count: number; bytes: number }> {
    let count = 0;
    let bytes = 0;
    try {
      const listing = await Filesystem.readdir({ path: dirPath, directory: Directory.Cache });
      for (const entry of listing.files) {
        const fullPath = `${dirPath}/${entry.name}`;
        try {
          const stat = await Filesystem.stat({ path: fullPath, directory: Directory.Cache });
          if (stat.type === "directory") {
            const sub = await walk(fullPath);
            count += sub.count;
            bytes += sub.bytes;
          } else {
            count += 1;
            bytes += stat.size;
          }
        } catch { /* skip */ }
      }
    } catch { /* dir doesn't exist */ }
    return { count, bytes };
  }

  return walk(CACHE_DIR);
}
