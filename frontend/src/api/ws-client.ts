/**
 * UI WebSocket Client — pure WS transport for all CRUD + notifications.
 *
 * Protocol: /api/v1/ws
 * Auth: Sec-WebSocket-Protocol: amtodo.v1, bearer.<access_token>
 * Business messages: plain JSON over HTTPS/WSS.
 */

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

const REQUEST_TIMEOUT_MS = 5_000;
const CONNECT_TIMEOUT_MS = 5_000;

export const RECONNECT_EXHAUSTED_CODE = -2;

const DEFAULT_RECONNECT_DELAYS = [1_000, 2_000, 3_000, 5_000, 8_000, 13_000, 21_000, 30_000];

function generateId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export class UiWsClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private statusListeners: Array<(status: WsConnectionStatus) => void> = [];
  private notificationListeners: Array<(notification: WsNotificationPayload) => void> = [];
  private disconnectReasonListeners: Array<(code: number) => void> = [];
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private status: WsConnectionStatus = "disconnected";
  private readonly reconnectDelays: number[];

  constructor(
    private readonly serverUrl: string,
    private readonly accessToken: string,
    reconnectIntervalMs?: number,
    private readonly maxReconnectAttempts: number = 0
  ) {
    if (reconnectIntervalMs && reconnectIntervalMs > 0) {
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

  get connectionStatus(): WsConnectionStatus {
    return this.status;
  }

  async connect(): Promise<void> {
    this.intentionalClose = false;
    this.reconnectAttempt = 0;
    return this._connect();
  }

  waitForConnected(timeoutMs: number): Promise<boolean> {
    if (this.status === "connected") return Promise.resolve(true);
    if (this.status === "disconnected") return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const cleanup = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          const idx = this.statusListeners.indexOf(listener);
          if (idx !== -1) this.statusListeners.splice(idx, 1);
        }
      };
      const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
      const listener = (status: WsConnectionStatus) => {
        if (settled) return;
        if (status === "connected") { cleanup(); resolve(true); }
        else if (status === "disconnected") { cleanup(); resolve(false); }
      };
      this.statusListeners.push(listener);
    });
  }

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

  async send<T = unknown>(type: string, payload?: Record<string, unknown>): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    const id = generateId();

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

      this.ws!.send(JSON.stringify({ id, type, payload }));
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

  onDisconnectReason(listener: (code: number) => void): () => void {
    this.disconnectReasonListeners.push(listener);
    return () => {
      this.disconnectReasonListeners = this.disconnectReasonListeners.filter((l) => l !== listener);
    };
  }

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
      .replace(/\/+$/, "") + "/api/v1/ws";

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timedOut = false;
      let ws: WebSocket;

      try {
        ws = new WebSocket(wsUrl, ["amtodo.v1", `bearer.${this.accessToken}`]);
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
        this.reconnectAttempt = 0;
        this.setStatus("connected");
        settle(() => resolve());
      };

      ws.onmessage = (event) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
        } catch {
          return;
        }

        if (msg.type === "ping") {
          try {
            ws.send(JSON.stringify({ type: "pong" }));
          } catch {
            /* ignore */
          }
          return;
        }

        if (msg.type === "notification") {
          if (msg.data && typeof msg.data === "object") {
            const notification = msg.data as WsNotificationPayload;
            for (const listener of this.notificationListeners) {
              try {
                listener(notification);
              } catch {
                /* swallow */
              }
            }
          }
          return;
        }

        if (msg.type === "response" && typeof msg.id === "string") {
          const req = this.pending.get(msg.id);
          if (!req) return;
          this.pending.delete(msg.id);
          clearTimeout(req.timer);

          if (msg.ok === true) {
            req.resolve(msg.data);
          } else {
            req.reject(new Error(typeof msg.error === "string" ? msg.error : "Unknown error"));
          }
        }
      };

      ws.onclose = (event) => {
        if (timedOut) return;

        this.ws = null;
        this.rejectAllPending("WebSocket closed");

        const authCode = event.code >= 4002 && event.code <= 4006 ? event.code : null;
        if (authCode !== null) {
          this.emitDisconnectReason(authCode);
        }

        if (settled) {
          if (authCode !== null) {
            this.setStatus("disconnected");
          } else if (!this.intentionalClose) {
            this.scheduleReconnect();
          } else {
            this.setStatus("disconnected");
          }
          return;
        }

        const reason = event.reason || `Connection closed (code ${event.code})`;
        settle(() => reject(new Error(reason)));
        if (authCode === null) {
          this.scheduleReconnect();
        }
      };

      ws.onerror = () => {
        // onclose handles cleanup.
      };
    });
  }

  private shouldReconnect(): boolean {
    if (this.maxReconnectAttempts === 0) return true;
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
    for (const [, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error(reason));
    }
    this.pending.clear();
  }
}
