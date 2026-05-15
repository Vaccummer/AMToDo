import type { AttachmentMetadata, ScheduleAttachmentMetadata } from "../api/client";

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
  downloadFn: () => Promise<ArrayBuffer>,
  metadata: CacheableMeta,
  cacheKey: string,
): Promise<{ blob: Blob; cacheHit: boolean }> {
  const db = await openDb();
  const cached = await getRecord(db, cacheKey);
  if (cached && metadataMatches(cached.metadata, metadata)) {
    return {
      blob: new Blob([cached.plain], { type: metadata.mime_type }),
      cacheHit: true
    };
  }

  const cipher = await downloadFn();
  const plain = await decryptAttachment(cipher, metadata);
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

async function decryptAttachment(
  cipher: ArrayBuffer,
  metadata: CacheableMeta
): Promise<ArrayBuffer> {
  const keyBytes = base64ToBuffer(metadata.file_key);
  const nonce = base64ToBuffer(metadata.nonce);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "decrypt"
  ]);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher);
}

function base64ToBuffer(value: string): ArrayBuffer {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
