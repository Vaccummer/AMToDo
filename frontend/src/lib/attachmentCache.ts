import type { AttachmentMetadata, ScheduleAttachmentMetadata } from "../api/client";
import type { DownloadProgress } from "./chunked-download";
import { decryptBuffer } from "./stream-crypto";

type CacheableMeta = AttachmentMetadata | ScheduleAttachmentMetadata;

type CacheRecord = {
  key: string;
  metadata: CacheableMeta;
  plain: ArrayBuffer;
};

const DB_NAME = "amtodo-attachment-cache";
const STORE_NAME = "attachments";
const DB_VERSION = 1;

export async function getAttachmentBlob(
  downloadFn: (onProgress?: (progress: DownloadProgress) => void, abortSignal?: AbortSignal) => Promise<ArrayBuffer>,
  metadata: CacheableMeta,
  cacheKey: string,
  onProgress?: (progress: DownloadProgress) => void,
  abortSignal?: AbortSignal,
): Promise<{ blob: Blob; cacheHit: boolean }> {
  const db = await openDb();
  const cached = await getRecord(db, cacheKey);
  if (cached && metadataMatches(cached.metadata, metadata)) {
    onProgress?.({ loaded: metadata.plain_size_bytes, total: metadata.plain_size_bytes, percent: 100 });
    return {
      blob: new Blob([cached.plain], { type: metadata.mime_type }),
      cacheHit: true
    };
  }

  let cipher: ArrayBuffer;
  let plain: ArrayBuffer;
  try {
    cipher = await downloadFn(onProgress, abortSignal);
    plain = await decryptBuffer(cipher, metadata.file_key, metadata.nonce);
  } catch (err) {
    // Retry once on truncation or HMAC errors (likely transient mobile network issue)
    if (err instanceof Error && (err.message.includes("incomplete") || err.message.includes("HMAC"))) {
      cipher = await downloadFn(onProgress, abortSignal);
      plain = await decryptBuffer(cipher, metadata.file_key, metadata.nonce);
    } else {
      throw err;
    }
  }
  await putRecord(db, { key: cacheKey, metadata, plain });
  return {
    blob: new Blob([plain], { type: metadata.mime_type }),
    cacheHit: false
  };
}

export async function getCacheSize(): Promise<{ count: number; bytes: number }> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const cursorReq = store.openCursor();
    let count = 0;
    let bytes = 0;
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        const record = cursor.value as CacheRecord;
        bytes += record.plain.byteLength;
        count += 1;
        cursor.continue();
      } else {
        resolve({ count, bytes });
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

export async function clearAttachmentCache(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).clear();
  await txDone(tx);
}

function metadataMatches(a: CacheableMeta, b: CacheableMeta): boolean {
  return (
    a.updated_at === b.updated_at &&
    a.plain_size_bytes === b.plain_size_bytes &&
    a.file_key === b.file_key &&
    a.nonce === b.nonce
  );
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getRecord(db: IDBDatabase, key: string): Promise<CacheRecord | null> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve((request.result as CacheRecord | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function putRecord(db: IDBDatabase, record: CacheRecord): Promise<void> {
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).put(record);
  await txDone(tx);
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

