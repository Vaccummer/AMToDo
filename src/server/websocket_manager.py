"""WebSocket connection management and session-key encryption for real-time
notification push.

Provides three cooperating classes:

* ``SessionKeyManager`` — per-user symmetric-key lifecycle (create, encrypt, verify, revoke).
* ``WebSocketManager`` — multi-connection registry with broadcast push and dead-connection cleanup.
* ``NotificationResultCache`` — short-lived result cache so users with multiple connections
  do not trigger duplicate database queries within the same watcher cycle.
"""

from __future__ import annotations

import hashlib
import logging
import os
import time
from typing import TYPE_CHECKING

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

if TYPE_CHECKING:
    from fastapi import WebSocket


logger = logging.getLogger("amtodo")


# ---------------------------------------------------------------------------
# SessionKeyManager
# ---------------------------------------------------------------------------

class SessionKeyManager:
    """Per-user AES-256-GCM session keys, held in memory only.

    Keys are created via ``create(user_id)``, verified with ``verify()``,
    and revoked with ``revoke()``.  A reverse hash→user_id index supports
    WebSocket authentication from ``key_hash`` alone.
    """

    def __init__(self, ttl_seconds: int = 3600) -> None:
        # user_id → (key_bytes, expires_at_unix)
        self._keys: dict[int, tuple[bytes, float]] = {}
        # hex(key_hash) → user_id
        self._hash_to_user: dict[str, int] = {}
        self._ttl = ttl_seconds

    # -- public API --------------------------------------------------------

    def create(self, user_id: int) -> tuple[bytes, float]:
        """Generate a fresh AES-256 key for *user_id*.

        Previous key (if any) is silently replaced.
        Returns ``(key_bytes, expires_at_unix)``.
        """
        key = os.urandom(32)  # AES-256
        expires_at = time.time() + self._ttl

        # Remove old reverse index entry if one exists
        old_entry = self._keys.get(user_id)
        if old_entry is not None:
            old_hash = _key_hash(old_entry[0])
            self._hash_to_user.pop(old_hash, None)

        self._keys[user_id] = (key, expires_at)
        self._hash_to_user[_key_hash(key)] = user_id
        return key, expires_at

    def get(self, user_id: int) -> bytes | None:
        """Return the current key for *user_id*, or ``None`` if expired/missing."""
        entry = self._keys.get(user_id)
        if entry is None:
            return None
        key, expires_at = entry
        if time.time() >= expires_at:
            self.revoke(user_id)
            return None
        return key

    def lookup_by_hash(self, key_hash: str) -> int | None:
        """Resolve a key_hash (from a WebSocket auth message) to a user_id.

        Returns ``None`` when the hash is unknown or the underlying key
        has expired.
        """
        user_id = self._hash_to_user.get(key_hash)
        if user_id is None:
            return None
        # Double-check the key is still valid
        if self.get(user_id) is None:
            return None
        return user_id

    def verify(self, user_id: int, key_hash: str) -> bool:
        """Return ``True`` if *key_hash* matches the user's current key."""
        key = self.get(user_id)
        if key is None:
            return False
        return _key_hash(key) == key_hash

    def encrypt(self, user_id: int, plaintext: bytes) -> bytes:
        """Encrypt *plaintext* with the user's current key.

        Returns ``nonce(12B) || ciphertext(including 16B tag)``.
        Raises ``ValueError`` when no active key exists for the user.
        """
        key = self.get(user_id)
        if key is None:
            raise ValueError(f"no active session key for user {user_id}")
        nonce = os.urandom(12)
        ct = AESGCM(key).encrypt(nonce, plaintext, None)
        return nonce + ct

    def revoke(self, user_id: int) -> None:
        """Delete the user's key and its reverse index entry."""
        entry = self._keys.pop(user_id, None)
        if entry is not None:
            old_hash = _key_hash(entry[0])
            self._hash_to_user.pop(old_hash, None)

    def key_hash(self, user_id: int) -> str | None:
        """Return the SHA-256 hex digest of the user's current key."""
        key = self.get(user_id)
        if key is None:
            return None
        return _key_hash(key)


def _key_hash(key: bytes) -> str:
    return hashlib.sha256(key).hexdigest()


# ---------------------------------------------------------------------------
# WebSocketManager
# ---------------------------------------------------------------------------

class WebSocketManager:
    """Registry of active WebSocket connections, keyed by user_id and conn_id.

    A single user may hold **multiple** concurrent connections (multiple
    devices or windows).  ``push_to_user`` broadcasts to every active
    connection for that user.
    """

    def __init__(self) -> None:
        # user_id → {conn_id: WebSocket}
        self._connections: dict[int, dict[str, WebSocket]] = {}
        self._counter = 0

    def _next_id(self) -> str:
        self._counter += 1
        return f"conn_{self._counter}"

    # -- public API --------------------------------------------------------

    async def connect(self, websocket: WebSocket, user_id: int) -> str:
        """Register an already-accepted *websocket*.

        The caller is responsible for calling ``await websocket.accept()``
        before calling this method.
        Returns an opaque ``conn_id`` for per-connection lifecycle operations.
        """
        conn_id = self._next_id()
        if user_id not in self._connections:
            self._connections[user_id] = {}
        self._connections[user_id][conn_id] = websocket
        logger.info("WebSocket connected: user_id=%d conn_id=%s", user_id, conn_id)
        return conn_id

    def disconnect(self, user_id: int, conn_id: str) -> None:
        """Remove a single connection.  Cleans the user slot when empty."""
        user_conns = self._connections.get(user_id)
        if user_conns is None:
            return
        user_conns.pop(conn_id, None)
        if not user_conns:
            del self._connections[user_id]
        logger.info("WebSocket disconnected: user_id=%d conn_id=%s", user_id, conn_id)

    async def disconnect_all(self, user_id: int) -> None:
        """Close every connection for *user_id* (e.g. session expiry)."""
        user_conns = self._connections.pop(user_id, {})
        for conn_id, ws in user_conns.items():
            try:
                await ws.close(code=4001, reason="session expired")
            except Exception:
                pass
        if user_conns:
            logger.info("All connections closed for user_id=%d (%d conns)",
                        user_id, len(user_conns))

    async def push_to_user(self, user_id: int, data: dict) -> int:
        """Broadcast *data* (JSON-serialised) to every active connection of *user_id*.

        Dead connections are cleaned up inline.  Returns the number of
        connections that received the message.
        """
        user_conns = self._connections.get(user_id, {})
        if not user_conns:
            return 0

        import json

        payload = json.dumps(data)
        dead: list[str] = []
        pushed = 0

        for conn_id, ws in user_conns.items():
            try:
                await ws.send_text(payload)
                pushed += 1
            except Exception:
                dead.append(conn_id)

        for conn_id in dead:
            self.disconnect(user_id, conn_id)

        return pushed

    def connection_count(self, user_id: int) -> int:
        """Number of active connections for *user_id*."""
        return len(self._connections.get(user_id, {}))

    @property
    def active_users(self) -> list[int]:
        """User IDs that currently have at least one open connection."""
        return list(self._connections.keys())


# ---------------------------------------------------------------------------
# NotificationResultCache
# ---------------------------------------------------------------------------

class NotificationResultCache:
    """Short-lived in-memory cache for ``list_triggered`` results.

    When a user has multiple WebSocket connections the watcher may check the
    same user_id multiple times within a cycle.  This cache avoids redundant
    database round-trips by holding results for a TTL slightly shorter than
    the watcher interval.
    """

    def __init__(self, ttl_seconds: float) -> None:
        # user_id → (cache_time, results)
        self._cache: dict[int, tuple[float, list[object]]] = {}
        self._ttl = ttl_seconds

    def get(self, user_id: int) -> list[object] | None:
        """Cached results, or ``None`` when missing or expired."""
        entry = self._cache.get(user_id)
        if entry is None:
            return None
        cached_at, results = entry
        if time.time() - cached_at > self._ttl:
            del self._cache[user_id]
            return None
        return results

    def set(self, user_id: int, results: list[object]) -> None:
        """Store *results* for *user_id*."""
        self._cache[user_id] = (time.time(), results)

    def evict(self, user_id: int) -> None:
        """Remove cached results for *user_id*."""
        self._cache.pop(user_id, None)
