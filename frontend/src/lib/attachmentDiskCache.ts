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
import type { AttachmentDownloadChunkResponse } from "../api/client";
import type { DownloadProgress } from "./chunked-download";

type CacheableMeta = AttachmentMetadata | ScheduleAttachmentMetadata;

const CACHE_DIR = "attachment-cache";
// In-memory metadata index for fast cache invalidation
const metaIndex = new Map<string, { updated_at: number; plain_size_bytes: number }>();

const WS_CHUNK_SIZE = 256 * 1024;
type DownloadChunkFn = (offset: number, length: number) => Promise<AttachmentDownloadChunkResponse>;

/** e.g. "3/attachment/todo/42.mp4" */
export function getAttachmentCachePath(meta: CacheableMeta): string {
  const ownerType = "todo_id" in meta ? "todo" : "schedule";
  const ownerId = "todo_id" in meta ? (meta as AttachmentMetadata).todo_id : (meta as ScheduleAttachmentMetadata).schedule_id;
  return `${meta.user_id}/attachment/${ownerType}/${meta.id}${extensionFor(meta.filename)}`;
}

function legacyCachePathFor(meta: CacheableMeta): string {
  const ownerType = "todo_id" in meta ? "todo" : "schedule";
  return `${meta.user_id}/attachment/${ownerType}/${meta.id}`;
}

function extensionFor(filename: string): string {
  const name = filename.split(/[\\/]/).pop() || "";
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  const ext = name.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return ext.length > 16 ? "" : ext;
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

async function nativeDownloadToDisk(
  downloadChunk: DownloadChunkFn,
  meta: CacheableMeta,
  cachePath: string,
  onProgress?: (progress: DownloadProgress) => void,
  abortSignal?: AbortSignal,
): Promise<string> {
  if (abortSignal?.aborted) throw new Error("Download aborted");

  const outPath = `${CACHE_DIR}/${cachePath}`;
  await ensureParentDir(cachePath);
  try { await Filesystem.deleteFile({ path: outPath, directory: Directory.Cache }); } catch { /* no existing partial */ }

  try {
    const expected = Math.max(meta.plain_size_bytes || 0, 0);
    if (expected === 0) {
      await Filesystem.writeFile({ path: outPath, data: "", directory: Directory.Cache, recursive: true });
    }

    let loaded = 0;
    let total = expected;
    let done = total === 0;
    while (!done) {
      if (abortSignal?.aborted) throw new Error("Download aborted");
      const chunk = await downloadChunk(loaded, WS_CHUNK_SIZE);
      if (!chunk.ok) throw new Error("WebSocket chunk download failed");
      if (chunk.offset !== loaded) throw new Error("Download chunk offset mismatch");
      total = Math.max(chunk.file_size || 0, total);

      const data = chunk.data;
      const chunkSize = chunk.bytes_read || base64ByteLength(data);
      if (chunkSize === 0) throw new Error("Download incomplete: empty range response");
      if (loaded === 0) {
        await Filesystem.writeFile({ path: outPath, data, directory: Directory.Cache, recursive: true });
      } else {
        await Filesystem.appendFile({ path: outPath, data, directory: Directory.Cache });
      }
      loaded = chunk.next_offset || (loaded + chunkSize);
      done = chunk.done;
      onProgress?.({
        loaded,
        total,
        percent: total ? Math.min(100, Math.round((loaded / total) * 100)) : 100,
      });
    }
    if (abortSignal?.aborted) throw new Error("Download aborted");

    const stat = await Filesystem.stat({ path: outPath, directory: Directory.Cache });
    if (total > 0 && stat.size < total) {
      try { await Filesystem.deleteFile({ path: outPath, directory: Directory.Cache }); } catch { /* */ }
      throw new Error(`Download incomplete: received ${stat.size} of ${total} bytes`);
    }
    onProgress?.({
      loaded: stat.size,
      total: total || stat.size,
      percent: 100,
    });

    metaIndex.set(cachePath, { updated_at: meta.updated_at, plain_size_bytes: meta.plain_size_bytes });
    const resultUri = await Filesystem.getUri({ path: outPath, directory: Directory.Cache });
    return Capacitor.convertFileSrc(resultUri.uri);
  } catch (err) {
    try { await Filesystem.deleteFile({ path: outPath, directory: Directory.Cache }); } catch { /* */ }
    throw err;
  }
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
  downloadChunk?: DownloadChunkFn,
): Promise<{ uri: string; cacheHit: boolean }> {
  const path = getAttachmentCachePath(metadata);

  const cachedUri = await getCachedUri(path, metadata);
  if (cachedUri) {
    onProgress?.({ loaded: metadata.plain_size_bytes, total: metadata.plain_size_bytes, percent: 100 });
    return { uri: cachedUri, cacheHit: true };
  }
  try {
    await Filesystem.deleteFile({ path: `${CACHE_DIR}/${legacyCachePathFor(metadata)}`, directory: Directory.Cache });
  } catch { /* discard old extensionless cache files */ }

  // Native path: authenticated WebSocket chunk download to cache (constant JS memory)
  if (isNative() && downloadChunk) {
    const attempt = () => nativeDownloadToDisk(downloadChunk, metadata, path, onProgress, abortSignal);
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
  return getCachedUri(getAttachmentCachePath(metadata), metadata);
}

/**
 * Delete a specific cached attachment from disk.
 */
export async function deleteCachedAttachment(metadata: CacheableMeta): Promise<void> {
  if (!isNative()) return;
  const path = getAttachmentCachePath(metadata);
  try { await Filesystem.deleteFile({ path: `${CACHE_DIR}/${path}`, directory: Directory.Cache }); } catch { /* */ }
  metaIndex.delete(path);
  try { await Filesystem.deleteFile({ path: `${CACHE_DIR}/${legacyCachePathFor(metadata)}`, directory: Directory.Cache }); } catch { /* */ }
  metaIndex.delete(legacyCachePathFor(metadata));
}

/**
 * Get the native file:// path for a cached attachment (for FileOpener).
 * Returns null if file is not cached.
 */
export async function getNativeFilePath(metadata: CacheableMeta): Promise<string | null> {
  if (!isNative()) return null;
  const path = getAttachmentCachePath(metadata);
  try {
    await Filesystem.stat({ path: `${CACHE_DIR}/${path}`, directory: Directory.Cache });
  } catch {
    return null;
  }
  const uri = await Filesystem.getUri({ path: `${CACHE_DIR}/${path}`, directory: Directory.Cache });
  return uri.uri;
}

function base64ByteLength(data: string): number {
  const trimmed = data.replace(/\s/g, "");
  if (!trimmed) return 0;
  const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0;
  return Math.floor((trimmed.length * 3) / 4) - padding;
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
