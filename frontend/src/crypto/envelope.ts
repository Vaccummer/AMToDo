const ENVELOPE_VERSION = 1;
const ALGORITHM = "ECDH-P256-HKDF-SHA256+A256GCM";
const HKDF_INFO = new TextEncoder().encode("amtodo-encryption");
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function base64urlEncode(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(b64url: string): Uint8Array {
  let b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function splitTag(ciphertext: ArrayBuffer): { data: Uint8Array; tag: Uint8Array } {
  const full = new Uint8Array(ciphertext);
  const tag = full.slice(full.length - TAG_BYTES);
  const data = full.slice(0, full.length - TAG_BYTES);
  return { data, tag };
}

export async function importP256PublicKey(base64Key: string): Promise<CryptoKey> {
  const rawBytes = Uint8Array.from(atob(base64Key), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "spki",
    rawBytes,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
}

export interface SealedEnvelope {
  envelope: object;
  aesKey: CryptoKey;
  requestId: string;
}

export async function seal(
  payload: object,
  serverPublicKey: CryptoKey,
  keyId: string
): Promise<SealedEnvelope> {
  const ephemeralKey = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  const ekRaw = await crypto.subtle.exportKey("raw", ephemeralKey.publicKey);

  const ecdhShared = await crypto.subtle.deriveBits(
    { name: "ECDH", public: serverPublicKey },
    ephemeralKey.privateKey,
    256
  );

  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    ecdhShared,
    { name: "HKDF" },
    false,
    ["deriveKey"]
  );

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(),
      info: HKDF_INFO,
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));

  const now = Math.floor(Date.now() / 1000);
  const requestId = crypto.randomUUID().replace(/-/g, "");
  const inner = new TextEncoder().encode(
    JSON.stringify({ requestId, timestamp: now, payload })
  );

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 },
    aesKey,
    inner
  );

  const { data, tag } = splitTag(ciphertext);

  const envelope = {
    version: ENVELOPE_VERSION,
    keyId,
    alg: ALGORITHM,
    ek: base64urlEncode(new Uint8Array(ekRaw)),
    nonce: base64urlEncode(nonce),
    data: base64urlEncode(data),
    tag: base64urlEncode(tag),
  };

  return { envelope, aesKey, requestId };
}

export function isResponseEnvelope(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;
  return (
    typeof obj.nonce === "string" &&
    typeof obj.data === "string" &&
    typeof obj.tag === "string" &&
    obj.ek === undefined
  );
}

export async function openResponse(
  envelope: Record<string, unknown>,
  aesKey: CryptoKey
): Promise<object> {
  const nonce = base64urlDecode(envelope.nonce as string);
  const encData = base64urlDecode(envelope.data as string);
  const tag = base64urlDecode(envelope.tag as string);

  const ciphertext = new Uint8Array(encData.length + tag.length);
  ciphertext.set(encData);
  ciphertext.set(tag, encData.length);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce.buffer as ArrayBuffer, tagLength: 128 },
    aesKey,
    ciphertext.buffer as ArrayBuffer
  );

  return JSON.parse(new TextDecoder().decode(plaintext));
}
