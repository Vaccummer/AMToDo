import type { AMToDoApi, AttachmentMetadata } from "../api/client";

type CacheRecord = {
  key: string;
  metadata: AttachmentMetadata;
  cipher: ArrayBuffer;
  plain: ArrayBuffer;
};

const DB_NAME = "amtodo-attachment-cache";
const STORE_NAME = "attachments";
const DB_VERSION = 1;

export async function getAttachmentBlob(
  api: AMToDoApi,
  metadata: AttachmentMetadata
): Promise<{ blob: Blob; cacheHit: boolean }> {
  const db = await openDb();
  const key = cacheKey(metadata);
  const cached = await getRecord(db, key);
  if (cached && metadataMatches(cached.metadata, metadata)) {
    return {
      blob: new Blob([cached.plain], { type: metadata.mime_type }),
      cacheHit: true
    };
  }

  const cipher = await api.downloadTodoAttachment(metadata.todo_id, metadata.id);
  await assertSha256(cipher, metadata.cipher_sha256);
  const plain = await decryptAttachment(cipher, metadata);
  await assertSha256(plain, metadata.plain_sha256);
  await putRecord(db, { key, metadata, cipher, plain });
  return {
    blob: new Blob([plain], { type: metadata.mime_type }),
    cacheHit: false
  };
}

export async function clearAttachmentCache(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).clear();
  await txDone(tx);
}

function cacheKey(metadata: AttachmentMetadata): string {
  return `${metadata.user_id}:${metadata.todo_id}:${metadata.id}`;
}

function metadataMatches(a: AttachmentMetadata, b: AttachmentMetadata): boolean {
  return (
    a.updated_at === b.updated_at &&
    a.plain_size_bytes === b.plain_size_bytes &&
    a.plain_sha256 === b.plain_sha256 &&
    a.cipher_size_bytes === b.cipher_size_bytes &&
    a.cipher_sha256 === b.cipher_sha256 &&
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
  metadata: AttachmentMetadata
): Promise<ArrayBuffer> {
  const keyBytes = base64ToBuffer(metadata.file_key);
  const nonce = base64ToBuffer(metadata.nonce);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "decrypt"
  ]);
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher);
}

async function assertSha256(content: ArrayBuffer, expected: string): Promise<void> {
  const digest = await crypto.subtle.digest("SHA-256", content);
  const actual = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  if (actual !== expected) {
    throw new Error("附件缓存校验失败");
  }
}

function base64ToBuffer(value: string): ArrayBuffer {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
