/**
 * Unified Connection Status Manager
 *
 * Single source of truth for all connection state: HTTP health, WebSocket status,
 * and WS close codes. Replaces the previous three independent status systems.
 */

import { type WsConnectionStatus } from "./ws-client";
import { notifyNetworkStatus } from "./client";

// ── Types ──

export type UnifiedStatus =
  | "checking"          // initial bootstrap, nothing known yet
  | "online"            // HTTP OK + WS connected
  | "reconnecting"      // HTTP OK + WS retrying
  | "offline"           // HTTP unreachable
  | "fingerprint"       // client-side TOFU check: stored fingerprint != server key
  | "key-mismatch"      // server-side: decryption failed (close 4003)
  | "token-error"       // server-side: invalid token (close 4005)
  | "replay-detected"   // server-side: replay attack (close 4006)
  | "idle";             // user manually disconnected (ws_enabled OFF)

export interface ConnectionStatusSnapshot {
  status: UnifiedStatus;
  errorMessage: string | null;
  serverVersion: string | null;
  serverName: string | null;
  wsConnected: boolean;
}

// ── Manager ──

export class ConnectionStatusManager {
  private _status: UnifiedStatus = "checking";
  private _errorMessage: string | null = null;
  private _serverVersion: string | null = null;
  private _serverName: string | null = null;
  private _wsConnected = false;
  private _httpOk = false;
  private _reconnectExhausted = false;
  private _listeners: Array<(snap: ConnectionStatusSnapshot) => void> = [];

  getSnapshot(): ConnectionStatusSnapshot {
    return {
      status: this._status,
      errorMessage: this._errorMessage,
      serverVersion: this._serverVersion,
      serverName: this._serverName,
      wsConnected: this._wsConnected,
    };
  }

  onChange(listener: (snap: ConnectionStatusSnapshot) => void): () => void {
    this._listeners.push(listener);
    return () => {
      this._listeners = this._listeners.filter((l) => l !== listener);
    };
  }

  /** HTTP health check succeeded. */
  reportHealthOk(version: string, name?: string): void {
    this._httpOk = true;
    this._reconnectExhausted = false;
    this._serverVersion = version;
    this._serverName = name ?? null;
    this._errorMessage = null;
    // Don't override WS status — WS may already be connected or still connecting
    if (this._status === "checking" || this._status === "offline") {
      this._status = this._wsConnected ? "online" : "reconnecting";
    }
    this._emit();
  }

  /** HTTP health check failed. */
  reportHealthError(kind: "network" | "token", message: string): void {
    this._httpOk = false;
    if (this._reconnectExhausted) return;
    this._errorMessage = message;
    this._status = kind === "token" ? "token-error" : "offline";
    this._emit();
  }

  /** Client-side TOFU fingerprint mismatch. */
  reportFingerprintMismatch(message: string): void {
    this._errorMessage = message;
    this._status = "fingerprint";
    this._emit();
  }

  /** User manually disconnected (ws_enabled OFF). */
  reportIdle(): void {
    this._status = "idle";
    this._wsConnected = false;
    this._errorMessage = null;
    this._emit();
  }

  /** API call from a view failed (TypeError → network, other → auth). */
  reportApiError(kind: "network" | "token", message: string): void {
    if (this._reconnectExhausted) return;
    this._errorMessage = message;
    this._status = kind === "token" ? "token-error" : "offline";
    this._emit();
  }

  /** API call from a view succeeded — clear degraded status. */
  reportApiOk(): void {
    if (this._status === "offline" || this._status === "token-error") {
      this._status = this._wsConnected ? "online" : "reconnecting";
      this._errorMessage = null;
      this._emit();
    }
  }

  /** Reconnect attempts exhausted — stop retrying. */
  reportReconnectExhausted(): void {
    console.log("[ConnMgr] reportReconnectExhausted, prev status=", this._status);
    this._wsConnected = false;
    this._reconnectExhausted = true;
    this._errorMessage = "ws.reconnectFailed";
    this._status = "offline";
    this._emit();
  }

  /**
   * WebSocket status changed.
   * Resolves unified status from WS state + close code.
   */
  reportWsStatus(wsStatus: WsConnectionStatus, closeCode?: number): void {
    this._wsConnected = wsStatus === "connected";

    if (wsStatus === "connected") {
      this._reconnectExhausted = false;
      this._status = "online";
      this._errorMessage = null;
      this._emit();
      return;
    }

    // Once reconnect is exhausted, ignore further status changes until a successful reconnect
    if (this._reconnectExhausted) return;

    if (wsStatus === "connecting" || wsStatus === "reconnecting") {
      this._status = "reconnecting";
      this._emit();
      return;
    }

    // wsStatus === "disconnected" — check close code for reason
    if (closeCode !== undefined && closeCode >= 4002 && closeCode <= 4006) {
      if (closeCode === 4003) {
        this._status = "key-mismatch";
        this._errorMessage = WS_CLOSE_REASONS[4003];
      } else if (closeCode === 4005) {
        this._status = "token-error";
        this._errorMessage = WS_CLOSE_REASONS[4005];
      } else if (closeCode === 4006) {
        this._status = "replay-detected";
        this._errorMessage = WS_CLOSE_REASONS[4006];
      } else {
        // 4002 (timeout) or 4004 (missing fields) — treat as degraded
        this._status = "reconnecting";
        this._errorMessage = WS_CLOSE_REASONS[closeCode] ?? null;
      }
      this._emit();
      return;
    }

    // Non-auth disconnect — WS will auto-reconnect, show as reconnecting
    if (this._httpOk) {
      this._status = "reconnecting";
    } else {
      this._status = "offline";
    }
    this._emit();
  }

  // ── Internal ──

  private _emit(): void {
    const snap = this.getSnapshot();
    for (const listener of this._listeners) {
      try {
        listener(snap);
      } catch {
        /* swallow */
      }
    }
    // Bridge to legacy CustomEvent so existing views keep working
    this._bridgeNetworkEvent(snap);
  }

  private _bridgeNetworkEvent(snap: ConnectionStatusSnapshot): void {
    switch (snap.status) {
      case "online":
        notifyNetworkStatus(true);
        break;
      case "offline":
      case "token-error":
      case "key-mismatch":
      case "fingerprint":
      case "replay-detected":
      case "idle":
        notifyNetworkStatus(false, snap.errorMessage ?? undefined);
        break;
      // "checking", "reconnecting" — don't fire event, keep previous state
    }
  }
}

// ── Constants ──

export const WS_CLOSE_REASONS: Record<number, string> = {
  4002: "ws.connectionTimeout",
  4003: "ws.keyMismatch",
  4004: "ws.missingFields",
  4005: "ws.invalidToken",
  4006: "ws.replayDetected",
};

// ── React Hook ──

import { useEffect, useState } from "react";

export function useConnectionStatus(
  manager: ConnectionStatusManager
): ConnectionStatusSnapshot {
  const [snapshot, setSnapshot] = useState<ConnectionStatusSnapshot>(
    manager.getSnapshot()
  );
  useEffect(() => manager.onChange(setSnapshot), [manager]);
  return snapshot;
}
