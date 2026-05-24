/**
 * Disk-based attachment cache using @capacitor/filesystem.
 *
 * Directory layout:
 *   attachment-cache/{user_id}/attachment/todo/{attachment_id}
 *   attachment-cache/{user_id}/attachment/schedule/{attachment_id}
 *
 * Flow:
 * 1. Check disk cache → if exists, return file URI
 * 2. Download cipher via downloadFn (returns ArrayBuffer)
 * 3. Decrypt with AES-128-CTR + HMAC-SHA256
 * 4. Write plaintext to Filesystem cache directory (base64)
 * 5. Return WebView-compatible file URI
 */

import { Filesystem, Directory } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";

import write_blob from "capacitor-blob-writer";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { unsafe } from "@noble/ciphers/aes.js";
import type { AttachmentMetadata, ScheduleAttachmentMetadata } from "../api/client";
import type { DownloadProgress } from "./chunked-download";
import { decryptBuffer, bufferToBase64, decodeKeys, timingSafeEqual } from "./stream-crypto";

type CacheableMeta = AttachmentMetadata | ScheduleAttachmentMetadata;

const CACHE_DIR = "attachment-cache";
const STREAM_BUF_SIZE = 1024 * 1024 + 16; // 1MB + 16 bytes for alignment buffer

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

// ── Decrypt + write to disk ──

async function decryptAndWrite(
  cipher: ArrayBuffer,
  meta: CacheableMeta,
  path: string,
): Promise<string> {
  const plain = await decryptBuffer(cipher, meta.file_key, meta.nonce);
  cipher = null as unknown as ArrayBuffer; // free cipher for GC

  await ensureParentDir(path);

  if (isNative()) {
    // Write via Blob — incremental 384KB chunks, no full-file base64 in memory
    await write_blob({
      path: `${CACHE_DIR}/${path}`,
      directory: Directory.Cache,
      blob: new Blob([plain]),
      recursive: true,
    });
  } else {
    // Web fallback: base64 encode and write
    const b64 = bufferToBase64(plain);
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
 * Stream-download from network and decrypt in one pass.
 * Reads response body chunks, feeds cipher bytes to HMAC + AES-CTR,
 * and appends decrypted plaintext to disk incrementally.
 * Peak JS memory ≈ single chunk size (~64KB), not the full file.
 */
async function streamingDownloadAndDecrypt(
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
  if (!contentLength) throw new Error("Content-Length required for streaming decrypt");
  if (contentLength < 33) throw new Error(`Cipher too short: ${contentLength} bytes`);

  const cipherLen = contentLength - 32; // last 32 bytes = HMAC tag
  const reader = response.body.getReader();

  // Prepare crypto state
  const { encKeyBytes, hmacKeyBytes, nonceBytes } = decodeKeys(meta.file_key, meta.nonce);
  const xk = unsafe.expandKeyLE(encKeyBytes);
  const counter = new Uint8Array(16);
  counter.set(nonceBytes, 0); // first 12 bytes = nonce, last 4 = block counter (starts at 0)
  const h = hmac.create(sha256, hmacKeyBytes);

  // Prepare output file
  await ensureParentDir(cachePath);
  const outPath = `${CACHE_DIR}/${cachePath}`;

  let bytesRead = 0;
  const tagParts: Uint8Array[] = [];

  // Buffer cipher bytes to ensure only 16-byte-aligned blocks go to ctr32.
  // ctr32 only advances its internal counter for full 16-byte blocks; partial
  // blocks would corrupt the keystream position for all subsequent data.
  let cipherBufPos = 0;
  const cipherBuf = new Uint8Array(STREAM_BUF_SIZE);

  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;

      const chunkStart = bytesRead;
      const chunkEnd = bytesRead + chunk.length;

      if (chunkStart >= cipherLen) {
        // Entire chunk is HMAC tag bytes
        tagParts.push(chunk);
      } else {
        // Append cipher bytes (or the cipher portion) to buffer
        const take = Math.min(chunk.length, cipherLen - chunkStart);
        const cipherPart = take === chunk.length ? chunk : chunk.subarray(0, take);
        cipherBuf.set(cipherPart, cipherBufPos);
        cipherBufPos += cipherPart.length;

        // Process complete 16-byte blocks
        const fullBlocks = (cipherBufPos >> 4) << 4;
        if (fullBlocks > 0) {
          const aligned = cipherBuf.subarray(0, fullBlocks);
          h.update(aligned);
          const plain = unsafe.ctr32(xk, false, counter, aligned);
          await Filesystem.appendFile({ path: outPath, data: bufferToBase64(plain), directory: Directory.Cache });
          // Shift remainder to front
          if (fullBlocks < cipherBufPos) {
            cipherBuf.copyWithin(0, fullBlocks, cipherBufPos);
          }
          cipherBufPos -= fullBlocks;
        }

        // Collect tag bytes if this chunk crosses the boundary
        if (chunkEnd > cipherLen) {
          tagParts.push(chunk.subarray(take));
        }
      }

      bytesRead = chunkEnd;
      onProgress?.({
        loaded: Math.min(bytesRead, cipherLen),
        total: contentLength,
        percent: Math.round((Math.min(bytesRead, cipherLen) / contentLength) * 100),
      });
    }
  } finally {
    reader.releaseLock();
  }

  // Process any remaining cipher bytes (< 16, the final partial block)
  if (cipherBufPos > 0) {
    const remainder = cipherBuf.subarray(0, cipherBufPos);
    h.update(remainder);
    // Pad to 16 bytes, decrypt as a full block (advances counter), truncate output.
    // XOR with zero-padded tail is identity, so truncated output is correct.
    const padded = new Uint8Array(16);
    padded.set(remainder);
    const plain = unsafe.ctr32(xk, false, counter, padded);
    await Filesystem.appendFile({ path: outPath, data: bufferToBase64(plain.subarray(0, cipherBufPos)), directory: Directory.Cache });
  }

  // Validate download completeness
  if (bytesRead < contentLength) {
    try { await Filesystem.deleteFile({ path: outPath, directory: Directory.Cache }); } catch { /* */ }
    throw new Error(`Download incomplete: received ${bytesRead} of ${contentLength} bytes`);
  }

  // Assemble and verify HMAC tag
  const receivedTag = new Uint8Array(32);
  let tagOff = 0;
  for (const part of tagParts) {
    receivedTag.set(part, tagOff);
    tagOff += part.length;
  }

  const computedTag = h.digest();
  if (!timingSafeEqual(computedTag, receivedTag)) {
    try { await Filesystem.deleteFile({ path: outPath, directory: Directory.Cache }); } catch { /* */ }
    throw new Error("HMAC verification failed");
  }

  metaIndex.set(cachePath, { updated_at: meta.updated_at, plain_size_bytes: meta.plain_size_bytes });
  const resultUri = await Filesystem.getUri({ path: outPath, directory: Directory.Cache });
  return Capacitor.convertFileSrc(resultUri.uri);
}

// ── Public API ──

/**
 * Get a WebView-compatible file URI for an attachment.
 * On native: single-pass streaming download → decrypt → write to cache (constant memory).
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

  // Native path: single-pass streaming download + decrypt (constant memory)
  if (isNative() && downloadUrl) {
    const attempt = () => streamingDownloadAndDecrypt(downloadUrl, metadata, path, onProgress, abortSignal);
    try {
      const uri = await attempt();
      return { uri, cacheHit: false };
    } catch (err) {
      if (err instanceof Error && (err.message.includes("incomplete") || err.message.includes("HMAC"))) {
        // Retry once on transient failures
        const uri = await attempt();
        return { uri, cacheHit: false };
      }
      throw err;
    }
  }


  // Web fallback: downloadFn returns ArrayBuffer in memory
  let cipher: ArrayBuffer;
  try {
    cipher = await downloadFn(onProgress, abortSignal);
  } catch (err) {
    if (err instanceof Error && (err.message.includes("incomplete") || err.message.includes("HMAC"))) {
      cipher = await downloadFn(onProgress, abortSignal);
    } else {
      throw err;
    }
  }

  try {
    const uri = await decryptAndWrite(cipher, metadata, path);
    return { uri, cacheHit: false };
  } catch (err) {
    if (err instanceof Error && err.message.includes("HMAC")) {
      cipher = await downloadFn(onProgress, abortSignal);
      const uri = await decryptAndWrite(cipher, metadata, path);
      return { uri, cacheHit: false };
    }
    throw err;
  }
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
