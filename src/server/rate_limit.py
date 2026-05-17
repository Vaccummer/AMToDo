"""Per-IP sliding window rate limiter for public endpoints."""

from __future__ import annotations

import time
from collections import defaultdict
from typing import TYPE_CHECKING

from fastapi.responses import JSONResponse

from serialization import error_to_dict
from exceptions import ValidationError

if TYPE_CHECKING:
    from starlette.types import ASGIApp, Receive, Scope, Send


class RateLimiter:
    """Sliding window rate limiter keyed by client IP."""

    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        # ip -> list of request timestamps
        self._records: dict[str, list[float]] = defaultdict(list)

    def is_allowed(self, ip: str) -> bool:
        """Check and record a request. Return True if allowed, False if over limit."""
        now = time.monotonic()
        cutoff = now - self.window_seconds
        timestamps = self._records[ip]

        # Prune expired entries
        while timestamps and timestamps[0] <= cutoff:
            timestamps.pop(0)

        if len(timestamps) >= self.max_requests:
            return False

        timestamps.append(now)
        return True

    def prune(self) -> None:
        """Remove all expired entries from every IP (call periodically)."""
        cutoff = time.monotonic() - self.window_seconds
        empty_ips: list[str] = []
        for ip, timestamps in self._records.items():
            while timestamps and timestamps[0] <= cutoff:
                timestamps.pop(0)
            if not timestamps:
                empty_ips.append(ip)
        for ip in empty_ips:
            del self._records[ip]


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
    """Extract client IP from ASGI scope, respecting X-Forwarded-For."""
    # Prefer X-Forwarded-For (first entry = original client)
    for key, value in scope.get("headers", []):
        if key == b"x-forwarded-for":
            forwarded = value.decode("utf-8", errors="replace")
            return forwarded.split(",")[0].strip()

    # Fall back to direct client address
    client = scope.get("client")
    if client:
        return client[0]

    return "unknown"
