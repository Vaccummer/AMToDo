"""Per-IP sliding window rate limiter for public endpoints."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import TYPE_CHECKING

from fastapi.responses import JSONResponse

from serialization import error_to_dict
from exceptions import ValidationError

if TYPE_CHECKING:
    from starlette.types import ASGIApp, Receive, Scope, Send


class RateLimiter:
    """Sliding window rate limiter keyed by client IP.

    Stale IPs (no requests for ``3 * window_seconds``) are cleaned up inline
    during ``is_allowed`` calls so the records dict never grows unboundedly.
    """

    _STALE_MULTIPLIER = 3  # evict IPs silent for this many windows

    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        # ip -> deque of request timestamps
        self._records: dict[str, deque[float]] = defaultdict(deque)
        self._last_access: dict[str, float] = {}
        self._last_gc: float = time.monotonic()

    def is_allowed(self, ip: str) -> bool:
        """Check and record a request. Return True if allowed, False if over limit."""
        now = time.monotonic()
        cutoff = now - self.window_seconds
        timestamps = self._records[ip]

        # Prune expired entries for this IP (deque popleft is O(1))
        while timestamps and timestamps[0] <= cutoff:
            timestamps.popleft()

        if len(timestamps) >= self.max_requests:
            return False

        timestamps.append(now)
        self._last_access[ip] = now

        # Periodic GC: evict IPs that have been silent too long
        if len(self._records) > 100 and now - self._last_gc > self.window_seconds:
            self._gc_stale_ips(now)

        return True

    def _gc_stale_ips(self, now: float) -> None:
        """Remove entries for IPs that haven't been seen recently."""
        self._last_gc = now
        stale_cutoff = now - self.window_seconds * self._STALE_MULTIPLIER
        stale_ips = [
            ip for ip, last in self._last_access.items()
            if last < stale_cutoff
        ]
        for ip in stale_ips:
            del self._records[ip]
            del self._last_access[ip]


class RateLimitMiddleware:
    """ASGI middleware that rate-limits requests to configured public paths."""

    def __init__(
        self,
        app: ASGIApp,
        limiter: RateLimiter,
        public_paths: frozenset[str],
    ) -> None:
        self.app = app
        self.limiter = limiter
        self.public_paths = public_paths

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path: str = scope.get("path", "").rstrip("/")
        if path not in self.public_paths:
            await self.app(scope, receive, send)
            return

        ip = _get_client_ip(scope)
        if not self.limiter.is_allowed(ip):
            response = JSONResponse(
                status_code=429,
                content=error_to_dict(ValidationError, "rate limit exceeded"),
            )
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)


def _get_client_ip(scope: Scope) -> str:
    """Extract client IP from ASGI scope.

    Only trusts the direct client address. X-Forwarded-For is NOT used
    because it can be trivially spoofed by any HTTP client. If you run
    behind a reverse proxy that sets X-Real-IP, update this function to
    read from that header after verifying the proxy strips untrusted
    forwarding headers.
    """
    state = scope.get("state") or {}
    forwarded_ip = state.get("client_ip")
    if isinstance(forwarded_ip, str) and forwarded_ip:
        return forwarded_ip

    client = scope.get("client")
    if client:
        return client[0]
    return "unknown"
