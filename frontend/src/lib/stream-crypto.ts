/**
 * AES-128-CTR + HMAC-SHA256 encryption/decryption for attachment streaming.
 *
 * Key derivation from a single 32-byte file_key:
 *   enc_key  = file_key[0..16]   (AES-128-CTR key)
 *   hmac_key = file_key[16..32]  (HMAC-SHA256 key)
 *   nonce    = 12 bytes random   (CTR nonce, unique per file)
 *
 * Web Crypto AES-CTR counter block: [nonce_12 | counter_4]
 *   - First 12 bytes: the nonce (IV)
 *   - Last 4 bytes: big-endian block counter (length: 32)
 */

const CHUNK_SIZE = 1024 * 1024; // 1MB

export interface FileKeyInfo {
  fileKey: string;   // base64 full 32-byte key
  hmacKey: string;   // base64 16-byte HMAC key
  nonce: string;     // base64 12-byte nonce
}

// ── Helpers ──

export function bufferToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBuffer(b64: string): ArrayBuffer {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export function concat(parts: Uint8Array[]): ArrayBuffer {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out.buffer;
}

// ── Key generation ──

export function generateFileKeys(): FileKeyInfo {
  const fileKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonceBytes = crypto.getRandomValues(new Uint8Array(12));
  return {
    fileKey: bufferToBase64(fileKeyBytes),
    hmacKey: bufferToBase64(fileKeyBytes.slice(16, 32)),
    nonce: bufferToBase64(nonceBytes),
  };
}

// ── Encryption ──

export async function encryptFile(
  file: File,
  fileKey: string,
  nonce: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ cipher: ArrayBuffer; plainSize: number }> {
  const keyBytes = base64ToBuffer(fileKey);
  const encKeyBytes = new Uint8Array(keyBytes).slice(0, 16);
  const hmacKeyBytes = new Uint8Array(keyBytes).slice(16, 32);
  const nonceRaw = new Uint8Array(base64ToBuffer(nonce));

  const cryptoKey = await crypto.subtle.importKey(
    "raw", encKeyBytes, { name: "AES-CTR" }, false, ["encrypt"],
  );

  const plainBuffer = await file.arrayBuffer();
  const totalSize = plainBuffer.byteLength;
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let counter = 0;

  while (offset < totalSize) {
    const end = Math.min(offset + CHUNK_SIZE, totalSize);
    const chunk = new Uint8Array(plainBuffer.slice(offset, end));

    // 16-byte CTR block: [nonce_12 | counter_4]
    const ctrNonce = new Uint8Array(16);
    ctrNonce.set(nonceRaw);
    const view = new DataView(ctrNonce.buffer, 12, 4);
    view.setUint32(0, counter);

    const cipherChunk = await crypto.subtle.encrypt(
      { name: "AES-CTR", counter: ctrNonce, length: 32 },
      cryptoKey, chunk,
    );
    chunks.push(new Uint8Array(cipherChunk));
    counter += Math.ceil(chunk.byteLength / 16);
    offset = end;
    onProgress?.(offset, totalSize);
  }

  const cipherBytes = new Uint8Array(concat(chunks));
  const hmacKey = await crypto.subtle.importKey(
    "raw", hmacKeyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const tag = await crypto.subtle.sign("HMAC", hmacKey, cipherBytes);

  const result = new Uint8Array(cipherBytes.byteLength + 32);
  result.set(cipherBytes);
  result.set(new Uint8Array(tag), cipherBytes.byteLength);

  return { cipher: result.buffer, plainSize: totalSize };
}

// ── Decryption ──

export async function decryptBuffer(
  cipher: ArrayBuffer,
  fileKey: string,
  nonce: string,
): Promise<ArrayBuffer> {
  const keyBytes = base64ToBuffer(fileKey);
  const encKeyBytes = new Uint8Array(keyBytes).slice(0, 16);
  const hmacKeyBytes = new Uint8Array(keyBytes).slice(16, 32);
  const nonceRaw = new Uint8Array(base64ToBuffer(nonce));

  // 16-byte CTR block: [nonce_12 | counter_4]  (counter starts at 0)
  const nonceBytes = new Uint8Array(16);
  nonceBytes.set(nonceRaw);

  if (cipher.byteLength < 33) {
    throw new Error(`Cipher too short: ${cipher.byteLength} bytes (minimum 33)`);
  }

  const cipherBytes = cipher.slice(0, cipher.byteLength - 32);
  const receivedTag = cipher.slice(cipher.byteLength - 32);

  const hmacKey = await crypto.subtle.importKey(
    "raw", hmacKeyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
  );
  const valid = await crypto.subtle.verify("HMAC", hmacKey, receivedTag, cipherBytes);
  if (!valid) throw new Error("HMAC verification failed");

  const cryptoKey = await crypto.subtle.importKey(
    "raw", encKeyBytes, { name: "AES-CTR" }, false, ["decrypt"],
  );
  return crypto.subtle.decrypt(
    { name: "AES-CTR", counter: nonceBytes, length: 32 },
    cryptoKey, cipherBytes,
  );
}
