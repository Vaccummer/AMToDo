/**
 * Disk-based attachment cache using @capacitor/filesystem.
 *
 * Directory layout:
 *   attachment-cache/{user_id}/attachment/todo/{todo_id}/{attachment_id}
 *   attachment-cache/{user_id}/attachment/schedule/{schedule_id}/{attachment_id}
 *
 * Flow:
 * 1. Check disk cache → if exists, return file URI
 * 2. Download file bytes via downloadFn (returns ArrayBuffer)
 * 3. Write content to Filesystem cache directory (base64)
 * 4. Return WebView-compatible file URI
 */

import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";

import { Filesystem as Fs } from "@capacitor/filesystem";
import write_blob from "capacitor-blob-writer";
import type { AttachmentMetadata, ScheduleAttachmentMetadata } from "../api/client";
import type { AttachmentDownloadChunkResponse } from "../api/client";
import type { DownloadProgress } from "./chunked-download";
import { downloadNativeAttachmentWithProgress, isNativeAttachmentDownloadAvailable } from "./native-attachment";

type CacheableMeta = AttachmentMetadata | ScheduleAttachmentMetadata;

const CACHE_DIR = "attachment-cache";
// In-memory metadata index for fast cache invalidation
const metaIndex = new Map<string, { updated_at: number; plain_size_bytes: number }>();

const WS_CHUNK_SIZE = 256 * 1024;
type DownloadChunkFn = (offset: number, length: number) => Promise<AttachmentDownloadChunkResponse>;

/** e.g. "3/attachment/todo/12/42.mp4" */
export function getAttachmentCachePath(meta: CacheableMeta): string {
  const ownerType = "todo_id" in meta ? "todo" : "schedule";
  const ownerId = "todo_id" in meta ? (meta as AttachmentMetadata).todo_id : (meta as ScheduleAttachmentMetadata).schedule_id;
  return `${meta.user_id}/attachment/${ownerType}/${ownerId}/${meta.id}${extensionFor(meta.filename)}`;
}

function legacyCachePathsFor(meta: CacheableMeta): string[] {
  const ownerType = "todo_id" in meta ? "todo" : "schedule";
  return [
    `${meta.user_id}/attachment/${ownerType}/${meta.id}${extensionFor(meta.filename)}`,
    `${meta.user_id}/attachment/${ownerType}/${meta.id}`,
  ];
}

function cacheFilePath(path: string): string {
  return `${CACHE_DIR}/${path}`;
}

function partialCacheFilePath(path: string): string {
  return `${cacheFilePath(path)}.part`;
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

/** Ensure the full directory tree exists for a cache path like "3/attachment/todo/12/42" */
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
    try { await Filesystem.deleteFile({ path: cacheFilePath(path), directory: Directory.Cache }); } catch { /* */ }
    try { await Filesystem.deleteFile({ path: partialCacheFilePath(path), directory: Directory.Cache }); } catch { /* */ }
    metaIndex.delete(path);
    return null;
  }

  // Verify file exists on disk (also handles cold start when metaIndex is empty)
  try {
    await Filesystem.stat({ path: cacheFilePath(path), directory: Directory.Cache });
  } catch {
    metaIndex.delete(path);
    return null;
  }

  // File exists on disk — repopulate metaIndex if missing (app was restarted)
  if (!cached) {
    metaIndex.set(path, { updated_at: meta.updated_at, plain_size_bytes: meta.plain_size_bytes });
  }

  const uri = await Filesystem.getUri({ path: cacheFilePath(path), directory: Directory.Cache });
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

  const uri = await Filesystem.getUri({ path: cacheFilePath(path), directory: Directory.Cache });
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

  const outPath = cacheFilePath(cachePath);
  const partPath = partialCacheFilePath(cachePath);
  await ensureParentDir(cachePath);
  try { await Filesystem.deleteFile({ path: outPath, directory: Directory.Cache }); } catch { /* no existing complete file */ }
  try { await Filesystem.deleteFile({ path: partPath, directory: Directory.Cache }); } catch { /* no existing partial */ }

  try {
    const expected = Math.max(meta.plain_size_bytes || 0, 0);
    if (expected === 0) {
      await Filesystem.writeFile({ path: partPath, data: "", directory: Directory.Cache, recursive: true });
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
        await Filesystem.writeFile({ path: partPath, data, directory: Directory.Cache, recursive: true });
      } else {
        await Filesystem.appendFile({ path: partPath, data, directory: Directory.Cache });
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

    const stat = await Filesystem.stat({ path: partPath, directory: Directory.Cache });
    if (total > 0 && stat.size < total) {
      throw new Error(`Download incomplete: received ${stat.size} of ${total} bytes`);
    }
    onProgress?.({
      loaded: stat.size,
      total: total || stat.size,
      percent: 100,
    });

    try { await Filesystem.deleteFile({ path: outPath, directory: Directory.Cache }); } catch { /* no existing complete file */ }
    await Filesystem.rename({ from: partPath, to: outPath, directory: Directory.Cache, toDirectory: Directory.Cache });
    metaIndex.set(cachePath, { updated_at: meta.updated_at, plain_size_bytes: meta.plain_size_bytes });
    const resultUri = await Filesystem.getUri({ path: outPath, directory: Directory.Cache });
    return Capacitor.convertFileSrc(resultUri.uri);
  } catch (err) {
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
  downloadHeaders?: Record<string, string>,
): Promise<{ uri: string; cacheHit: boolean }> {
  const path = getAttachmentCachePath(metadata);

  const cachedUri = await getCachedUri(path, metadata);
  if (cachedUri) {
    onProgress?.({ loaded: metadata.plain_size_bytes, total: metadata.plain_size_bytes, percent: 100 });
    return { uri: cachedUri, cacheHit: true };
  }
  await deleteLegacyCachedAttachment(metadata);

  // Android path: native Foreground Service downloads over HTTPS Range to app cache.
  // This survives WebView backgrounding and keeps JS memory constant.
  if (isNative() && downloadUrl && isNativeAttachmentDownloadAvailable()) {
    const result = await downloadNativeAttachmentWithProgress(
      downloadUrl,
      `${CACHE_DIR}/${path}`,
      metadata.filename,
      metadata.plain_size_bytes,
      onProgress,
      abortSignal,
      downloadHeaders,
    );
    metaIndex.set(path, { updated_at: metadata.updated_at, plain_size_bytes: metadata.plain_size_bytes });
    onProgress?.({ loaded: metadata.plain_size_bytes, total: metadata.plain_size_bytes, percent: 100 });
    return { uri: Capacitor.convertFileSrc(result.uri), cacheHit: false };
  }

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

export async function hasCachedAttachmentOrPartial(metadata: CacheableMeta): Promise<boolean> {
  if (!isNative()) return false;
  const paths = [getAttachmentCachePath(metadata), ...legacyCachePathsFor(metadata)];
  for (const path of paths) {
    try {
      await Filesystem.stat({ path: cacheFilePath(path), directory: Directory.Cache });
      return true;
    } catch { /* try partial */ }
    try {
      await Filesystem.stat({ path: partialCacheFilePath(path), directory: Directory.Cache });
      return true;
    } catch { /* try next path */ }
  }
  return false;
}

/**
 * Delete a specific cached attachment from disk.
 */
export async function deleteCachedAttachment(metadata: CacheableMeta): Promise<void> {
  if (!isNative()) return;
  const path = getAttachmentCachePath(metadata);
  try { await Filesystem.deleteFile({ path: cacheFilePath(path), directory: Directory.Cache }); } catch { /* */ }
  try { await Filesystem.deleteFile({ path: partialCacheFilePath(path), directory: Directory.Cache }); } catch { /* */ }
  metaIndex.delete(path);
  await deleteLegacyCachedAttachment(metadata);
}

async function deleteLegacyCachedAttachment(metadata: CacheableMeta): Promise<void> {
  for (const legacyPath of legacyCachePathsFor(metadata)) {
    try { await Filesystem.deleteFile({ path: cacheFilePath(legacyPath), directory: Directory.Cache }); } catch { /* */ }
    try { await Filesystem.deleteFile({ path: partialCacheFilePath(legacyPath), directory: Directory.Cache }); } catch { /* */ }
    metaIndex.delete(legacyPath);
  }
}

/**
 * Get the native file:// path for a cached attachment (for FileOpener).
 * Returns null if file is not cached.
 */
export async function getNativeFilePath(metadata: CacheableMeta): Promise<string | null> {
  if (!isNative()) return null;
  const path = getAttachmentCachePath(metadata);
  try {
    await Filesystem.stat({ path: cacheFilePath(path), directory: Directory.Cache });
  } catch {
    return null;
  }
  const uri = await Filesystem.getUri({ path: cacheFilePath(path), directory: Directory.Cache });
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
 * Cache uploaded file bytes into the native disk cache so it can be previewed
 * without re-downloading.  For native attachments with a local file URI,
 * prefer {@link cacheNativeFileFromLocalUri} to avoid re-reading into memory.
 */
export async function cacheUploadedContent(
  content: ArrayBuffer,
  meta: CacheableMeta,
): Promise<void> {
  if (!isNative()) return;
  const path = getAttachmentCachePath(meta);
  try { await Filesystem.deleteFile({ path: cacheFilePath(path), directory: Directory.Cache }); } catch { /* */ }
  try { await Filesystem.deleteFile({ path: partialCacheFilePath(path), directory: Directory.Cache }); } catch { /* */ }
  await writeContent(content, meta, path);
}

/**
 * Copy a locally-accessible file (picked from the native file system) directly
 * into the attachment disk cache, avoiding an extra read into JS memory.
 */
export async function cacheNativeFileFromLocalUri(
  sourceUri: string,
  meta: CacheableMeta,
): Promise<void> {
  if (!isNative()) return;
  const cachePath = getAttachmentCachePath(meta);
  const dest = cacheFilePath(cachePath);
  await ensureParentDir(cachePath);
  try { await Filesystem.deleteFile({ path: dest, directory: Directory.Cache }); } catch { /* */ }
  try { await Filesystem.deleteFile({ path: partialCacheFilePath(cachePath), directory: Directory.Cache }); } catch { /* */ }
  try {
    const stat = await Fs.stat({ path: sourceUri });
    if (stat.type !== "file") throw new Error("not a file");
    const data = await Fs.readFile({ path: sourceUri });
    await Filesystem.writeFile({
      path: dest,
      data: data.data as string,
      directory: Directory.Cache,
      recursive: true,
    });
  } catch {
    const converted = Capacitor.convertFileSrc(sourceUri);
    const blob = await fetch(converted).then((r) => r.blob());
    const content = await blob.arrayBuffer();
    await writeContent(content, meta, cachePath);
  }
  metaIndex.set(cachePath, { updated_at: meta.updated_at, plain_size_bytes: meta.plain_size_bytes });
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
