"""WebSocket connection management for real-time notification push."""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import WebSocket


logger = logging.getLogger("amtodo")


class WebSocketManager:
    """Registry of active WebSocket connections, keyed by user_id and conn_id.

    A single user may hold **multiple** concurrent connections (multiple
    devices or windows).
    """

    def __init__(self) -> None:
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

    def get_connection_entries(self, user_id: int) -> list[tuple[str, WebSocket]]:
        """Return ``(conn_id, websocket)`` pairs for *user_id*."""
        user_conns = self._connections.get(user_id, {})
        return list(user_conns.items())

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
        for _conn_id, ws in user_conns.items():
            try:
                await ws.close(code=4001, reason="session expired")
            except Exception:
                pass
        if user_conns:
            logger.info("All connections closed for user_id=%d (%d conns)",
                        user_id, len(user_conns))

    async def close_all(self, *, code: int = 1001, reason: str = "server shutting down") -> None:
        """Close every active connection across all users."""
        all_conns = self._connections
        self._connections = {}
        closed = 0
        for user_conns in all_conns.values():
            for ws in user_conns.values():
                try:
                    await ws.close(code=code, reason=reason)
                    closed += 1
                except Exception:
                    pass
        if closed:
            logger.info("All WebSocket connections closed (%d conns)", closed)

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
