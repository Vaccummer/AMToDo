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

import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { unsafe } from "@noble/ciphers/aes.js";

const CHUNK_SIZE = 1024 * 1024; // 1MB

export interface FileKeyInfo {
  fileKey: string;   // base64 full 32-byte key
  hmacKey: string;   // base64 16-byte HMAC key
  nonce: string;     // base64 12-byte nonce
}

// ── Helpers ──

export function bufferToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length))));
  }
  return btoa(parts.join(""));
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

// ── Key decoding (shared by decryptBuffer and streamingDecrypt) ──

export function decodeKeys(fileKey: string, nonce: string) {
  const keyBytes = new Uint8Array(base64ToBuffer(fileKey));
  return {
    encKeyBytes: keyBytes.slice(0, 16),
    hmacKeyBytes: keyBytes.slice(16, 32),
    nonceBytes: new Uint8Array(base64ToBuffer(nonce)),
  };
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
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

/**
 * Create a ReadableStream that yields cipher chunks + 32-byte HMAC tag.
 * Reads the file in 1MB slices, encrypts incrementally with AES-CTR,
 * and signs incrementally with HMAC-SHA256. Constant memory ≈ 1 chunk.
 */
export function createEncryptStream(
  file: File,
  fileKey: string,
  nonce: string,
  onProgress?: (loaded: number, total: number) => void,
  abortSignal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const { encKeyBytes, hmacKeyBytes, nonceBytes } = decodeKeys(fileKey, nonce);
  const totalSize = file.size;
  let offset = 0;
  let done = false;

  // Mutable crypto state captured in pull closure
  const xk = unsafe.expandKeyLE(encKeyBytes);
  const counter = new Uint8Array(16);
  counter.set(nonceBytes, 0);
  const h = hmac.create(sha256, hmacKeyBytes);

  // Buffer plaintext bytes to ensure only 16-byte-aligned blocks go to ctr32.
  // ctr32 only advances its internal counter for full 16-byte blocks; partial
  // blocks would corrupt the keystream position for all subsequent data.
  let remainder = new Uint8Array(0);

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (done) return;
      if (abortSignal?.aborted) {
        controller.close();
        done = true;
        return;
      }

      if (offset >= totalSize) {
        // File fully read — encrypt any remaining partial block
        if (remainder.length > 0) {
          // Pad to 16 bytes, encrypt as a full block (advances counter), truncate output.
          // XOR with zero-padded tail is identity, so truncated output is correct.
          const padded = new Uint8Array(16);
          padded.set(remainder);
          const enc = unsafe.ctr32(xk, false, counter, padded);
          const cipherPart = enc.subarray(0, remainder.length);
          h.update(cipherPart);
          controller.enqueue(cipherPart);
          remainder = new Uint8Array(0);
        }
        controller.enqueue(h.digest());
        controller.close();
        done = true;
        return;
      }

      const end = Math.min(offset + CHUNK_SIZE, totalSize);
      const slice = file.slice(offset, end);
      const plain = new Uint8Array(await slice.arrayBuffer());
      offset = end;

      // Prepend any leftover bytes from previous iteration
      let buf: Uint8Array;
      if (remainder.length > 0) {
        buf = new Uint8Array(remainder.length + plain.length);
        buf.set(remainder);
        buf.set(plain, remainder.length);
        remainder = new Uint8Array(0);
      } else {
        buf = plain;
      }

      const fullBlocks = (buf.length >> 4) << 4; // floor to 16-byte boundary
      if (fullBlocks > 0) {
        const aligned = buf.subarray(0, fullBlocks);
        const cipherPart = unsafe.ctr32(xk, false, counter, aligned);
        h.update(cipherPart);
        controller.enqueue(cipherPart);
      }

      if (fullBlocks < buf.length) {
        remainder = new Uint8Array(buf.slice(fullBlocks));
      }

      onProgress?.(offset, totalSize);
    },
  });
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

  // Use views (zero-copy) instead of .slice() to avoid doubling memory for large files
  const cipherBytes = new Uint8Array(cipher, 0, cipher.byteLength - 32);
  const receivedTag = new Uint8Array(cipher, cipher.byteLength - 32, 32);

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
