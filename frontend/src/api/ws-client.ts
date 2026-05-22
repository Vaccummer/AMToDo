/**
 * UI WebSocket Client — pure WS transport for all CRUD + notifications.
 *
 * Protocol: /api/v1/ui/ws
 * Auth: P-256 envelope (access_token + session_key) during handshake.
 * Business messages: AES-256-GCM encrypted with session_key.
 */

import { FingerprintMismatchError, importP256PublicKey, verifyOrEnrollKey } from "../crypto/envelope";

// ── Types ──

export type WsConnectionStatus = "connecting" | "connected" | "disconnected" | "reconnecting";

export type WsNotificationPayload = {
  id: number;
  title: string;
  description: string | null;
  trigger_at: number;
  created_at?: number;
  updated_at?: number | null;
  mentions?: { target_type: string; target_id: number }[];
};

type PendingRequest = {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

// ── Constants ──

const REQUEST_TIMEOUT_MS = 30_000;
const CONNECT_TIMEOUT_MS = 10_000;

/** Sentinel close code for client-side fingerprint mismatch (not a real WS close code). */
const FINGERPRINT_MISMATCH_CODE = -1;

/** Sentinel close code for reconnect attempts exhausted (not a real WS close code). */
export const RECONNECT_EXHAUSTED_CODE = -2;

/** Default reconnect delays (ms) — progressive backoff from 1 s to 30 s, then stay at 30 s. */
const DEFAULT_RECONNECT_DELAYS = [1_000, 2_000, 3_000, 5_000, 8_000, 13_000, 21_000, 30_000];

// ── Helpers ──

function base64urlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str: string): Uint8Array {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function generateId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

// ── Crypto ──

async function importSessionKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw.buffer as ArrayBuffer, { name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function aesGcmEncrypt(key: CryptoKey, plaintext: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 },
    key,
    encoded
  );
  return base64urlEncode(concatBytes(nonce, new Uint8Array(ciphertext)));
}

async function aesGcmDecrypt(key: CryptoKey, data: string): Promise<string> {
  const raw = base64urlDecode(data);
  const nonce = raw.slice(0, 12);
  const ciphertext = raw.slice(12);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 },
    key,
    ciphertext
  );
  return new TextDecoder().decode(plaintext);
}

/** P-256 envelope encrypt for WS auth (same format as REST open_envelope_with_key). */
async function sealForWsAuth(
  payload: object,
  serverPublicKey: CryptoKey
): Promise<{ envelope: Record<string, string>; requestId: string }> {
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

  const hkdfKey = await crypto.subtle.importKey("raw", ecdhShared, { name: "HKDF" }, false, [
    "deriveKey",
  ]);

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(),
      info: new TextEncoder().encode("amtodo-encryption"),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const now = Math.floor(Date.now() / 1000);
  const requestId = crypto.randomUUID().replace(/-/g, "");
  const inner = new TextEncoder().encode(JSON.stringify({ requestId, timestamp: now, payload }));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 },
    aesKey,
    inner
  );

  const full = new Uint8Array(ciphertext);
  const encData = full.slice(0, full.length - 16);
  const tag = full.slice(full.length - 16);

  const envelope = {
    keyId: "server-key-v1",
    nonce: base64urlEncode(nonce),
    data: base64urlEncode(encData),
    tag: base64urlEncode(tag),
    requestId,
    timestamp: String(now),
    ek: base64urlEncode(new Uint8Array(ekRaw)),
  };

  return { envelope, requestId };
}

// ── Client ──

export class UiWsClient {
  private ws: WebSocket | null = null;
  private sessionKey: CryptoKey | null = null;
  private pending = new Map<string, PendingRequest>();
  private statusListeners: Array<(status: WsConnectionStatus) => void> = [];
  private notificationListeners: Array<(notification: WsNotificationPayload) => void> = [];
  private disconnectReasonListeners: Array<(code: number) => void> = [];
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private authRejectionCode: number | null = null;
  private status: WsConnectionStatus = "disconnected";
  private readonly reconnectDelays: number[];

  constructor(
    private readonly serverUrl: string,
    private readonly accessToken: string,
    reconnectIntervalMs?: number,
    private readonly knownFingerprint: string = "",
    private readonly onKeyEnrolled?: (fingerprint: string) => void,
    private readonly maxReconnectAttempts: number = 0
  ) {
    if (reconnectIntervalMs && reconnectIntervalMs > 0) {
      // Build progressive backoff from the user-configured base interval
      const base = reconnectIntervalMs;
      this.reconnectDelays = [
        base,
        base * 2,
        base * 3,
        base * 5,
        base * 8,
        base * 13,
        base * 21,
        base * 30,
      ];
    } else {
      this.reconnectDelays = DEFAULT_RECONNECT_DELAYS;
    }
  }

  // ── Public API ──

  get connectionStatus(): WsConnectionStatus {
    return this.status;
  }

  /** Connect and authenticate. Resolves when auth_ok is received. */
  async connect(): Promise<void> {
    this.intentionalClose = false;
    this.reconnectAttempt = 0;
    this.authRejectionCode = null;
    return this._connect();
  }

  /** Gracefully close the WebSocket. */
  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnect();
    if (this.ws) {
      try {
        this.ws.close(1000, "client disconnect");
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.rejectAllPending("WebSocket disconnected");
    this.setStatus("disconnected");
  }

  /** Send a request and wait for the response. */
  async send<T = unknown>(type: string, payload?: Record<string, unknown>): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionKey) {
      throw new Error("WebSocket not connected");
    }

    const id = generateId();
    const encryptedPayload = payload
      ? await aesGcmEncrypt(this.sessionKey, JSON.stringify(payload))
      : undefined;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request ${type} timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: resolve as (data: unknown) => void,
        reject,
        timer,
      });

      this.ws!.send(JSON.stringify({ id, type, payload: encryptedPayload }));
    });
  }

  onStatusChange(listener: (status: WsConnectionStatus) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  onNotification(listener: (notification: WsNotificationPayload) => void): () => void {
    this.notificationListeners.push(listener);
    return () => {
      this.notificationListeners = this.notificationListeners.filter((l) => l !== listener);
    };
  }

  /** Subscribe to terminal auth rejection close codes (4002-4006). */
  onDisconnectReason(listener: (code: number) => void): () => void {
    this.disconnectReasonListeners.push(listener);
    return () => {
      this.disconnectReasonListeners = this.disconnectReasonListeners.filter((l) => l !== listener);
    };
  }

  // ── Internal ──

  private setStatus(status: WsConnectionStatus): void {
    this.status = status;
    for (const listener of this.statusListeners) {
      try {
        listener(status);
      } catch {
        /* swallow */
      }
    }
  }

  private async _connect(): Promise<void> {
    this.clearReconnect();
    this.setStatus(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

    const wsUrl = this.serverUrl
      .replace(/^http/, "ws")
      .replace(/\/+$/, "") + "/api/v1/ui/ws";

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timedOut = false;
      let ws: WebSocket;

      try {
        ws = new WebSocket(wsUrl);
      } catch (e) {
        this.setStatus("disconnected");
        reject(e);
        return;
      }

      this.ws = ws;

      const connectTimer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        settled = true;
        clearTimeout(connectTimer);
        ws.close();
        this.ws = null;
        this.sessionKey = null;
        this.rejectAllPending("WebSocket connection timed out");
        this.setStatus("disconnected");
        this.scheduleReconnect();
        reject(new Error("WebSocket connection timed out"));
      }, CONNECT_TIMEOUT_MS);

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimer);
        fn();
      };

      ws.onopen = () => {
        // Wait for server_hello
      };

      ws.onmessage = async (event) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
        } catch {
          return;
        }

        // ── Auth handshake ──
        if (msg.type === "server_hello" && !settled) {
          try {
            const publicKeyB64 = msg.public_key as string;
            console.log("[AMToDo WS] server_hello received, key_len=%d", publicKeyB64.length);

            // TOFU: verify or enroll the server's public key fingerprint
            const verifiedFp = await verifyOrEnrollKey(publicKeyB64, this.knownFingerprint);
            if (!this.knownFingerprint && this.onKeyEnrolled) {
              this.onKeyEnrolled(verifiedFp);
            }

            const serverKey = await importP256PublicKey(publicKeyB64);

            const sessionKeyBytes = crypto.getRandomValues(new Uint8Array(32));
            this.sessionKey = await importSessionKey(sessionKeyBytes);

            console.log("[AMToDo WS] sending auth: token_len=%d, token_prefix=%s...",
              this.accessToken.length, this.accessToken.slice(0, 8));

            const { envelope } = await sealForWsAuth(
              {
                access_token: this.accessToken,
                session_key: base64urlEncode(sessionKeyBytes),
              },
              serverKey
            );

            ws.send(JSON.stringify({ type: "auth", envelope }));
            console.log("[AMToDo WS] auth sent, waiting for response...");
          } catch (e) {
            console.error("[AMToDo WS] auth handshake error:", e);
            if (e instanceof FingerprintMismatchError) {
              this.authRejectionCode = FINGERPRINT_MISMATCH_CODE;
            }
            ws.close();
            settle(() => reject(e instanceof Error ? e : new Error(String(e))));
          }
          return;
        }

        if (msg.type === "auth_ok") {
          console.log("[AMToDo WS] auth_ok received");
          this.reconnectAttempt = 0;
          this.setStatus("connected");
          settle(() => resolve());
          return;
        }

        if (msg.type === "auth_failed") {
          console.error("[AMToDo WS] auth_failed:", msg.error);
          this.authRejectionCode = 4005; // invalid token
          ws.close();
          settle(() => reject(new Error(`Auth failed: ${msg.error ?? "unknown"}`)));
          return;
        }

        // ── Heartbeat ──
        if (msg.type === "ping") {
          try {
            ws.send(JSON.stringify({ type: "pong" }));
          } catch {
            /* ignore */
          }
          return;
        }

        // ── Notification push ──
        if (msg.type === "notification") {
          try {
            if (this.sessionKey && typeof msg.data === "string") {
              const decrypted = await aesGcmDecrypt(this.sessionKey, msg.data);
              const notification = JSON.parse(decrypted) as WsNotificationPayload;
              for (const listener of this.notificationListeners) {
                try {
                  listener(notification);
                } catch {
                  /* swallow */
                }
              }
            }
          } catch (e) {
            console.error("[ws-client] Failed to decrypt notification:", e);
          }
          return;
        }

        // ── Response ──
        if (msg.type === "response" && typeof msg.id === "string") {
          const req = this.pending.get(msg.id);
          if (!req) return;
          this.pending.delete(msg.id);
          clearTimeout(req.timer);

          if (msg.ok === true) {
            let data = msg.data;
            if (this.sessionKey && typeof data === "string") {
              try {
                const decrypted = await aesGcmDecrypt(this.sessionKey, data);
                data = JSON.parse(decrypted);
              } catch {
                // data may be unencrypted (e.g. count-only responses)
              }
            }
            req.resolve(data);
          } else {
            req.reject(new Error(typeof msg.error === "string" ? msg.error : "Unknown error"));
          }
          return;
        }
      };

      ws.onclose = (event) => {
        console.log("[AMToDo WS] onclose: code=%d, reason=%s, settled=%s",
          event.code, event.reason, settled);

        // Timeout already handled cleanup and reconnection
        if (timedOut) return;

        this.ws = null;
        this.sessionKey = null;
        this.rejectAllPending("WebSocket closed");

        // Determine auth rejection: either client-side (fingerprint) or server-side (close code)
        const authCode = this.authRejectionCode
          ?? (event.code >= 4002 && event.code <= 4006 ? event.code : null);
        this.authRejectionCode = null;

        if (settled) {
          // Post-auth close
          if (authCode !== null) {
            // Terminal auth rejection — emit reason, don't reconnect
            this.emitDisconnectReason(authCode);
            this.setStatus("disconnected");
          } else if (!this.intentionalClose) {
            // Non-auth close — reconnect
            this.scheduleReconnect();
          } else {
            this.setStatus("disconnected");
          }
          return;
        }

        // Pre-auth close (e.g. ERR_CONNECTION_REFUSED fires onclose synchronously)
        if (authCode !== null) {
          this.emitDisconnectReason(authCode);
        }
        const code = event.code;
        const reason = event.reason || `Connection closed (code ${code})`;
        settle(() => reject(new Error(reason)));
        this.scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose will fire after onerror, handling cleanup there
      };
    });
  }

  private shouldReconnect(): boolean {
    if (this.maxReconnectAttempts === 0) return true; // 0 = infinite
    return this.reconnectAttempt < this.maxReconnectAttempts;
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect()) {
      this.emitDisconnectReason(RECONNECT_EXHAUSTED_CODE);
      this.setStatus("disconnected");
      return;
    }
    const delay = this.reconnectDelays[Math.min(this.reconnectAttempt, this.reconnectDelays.length - 1)];
    this.reconnectAttempt++;
    this.setStatus("reconnecting");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this._connect();
    }, delay);
  }

  private emitDisconnectReason(code: number): void {
    for (const listener of this.disconnectReasonListeners) {
      try {
        listener(code);
      } catch {
        /* swallow */
      }
    }
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error(reason));
    }
    this.pending.clear();
  }
}
