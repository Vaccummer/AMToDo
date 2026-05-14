"""Replay attack protection via requestId deduplication with time-based expiry."""

from __future__ import annotations

import threading
import time


class ReplayProtector:
    """Thread-safe requestId dedup with timestamp validation."""

    def __init__(self, tolerance_seconds: int = 300) -> None:
        self._tolerance = tolerance_seconds
        self._seen: dict[str, float] = {}
        self._lock = threading.Lock()

    def check_and_record(self, request_id: str, timestamp: int) -> None:
        """Raise ValueError if timestamp is out of tolerance or request_id was seen before.
        Otherwise record the request_id and return normally.
        """
        now = time.time()
        drift = abs(now - timestamp)
        if drift > self._tolerance:
            raise ValueError(
                f"request timestamp drift {drift:.0f}s exceeds tolerance "
                f"{self._tolerance}s"
            )

        with self._lock:
            if request_id in self._seen:
                raise ValueError(f"duplicate requestId: {request_id}")

            self._seen[request_id] = now + self._tolerance
            self._cleanup_locked(now)

    def _cleanup_locked(self, now: float) -> None:
        expired = [rid for rid, exp in self._seen.items() if exp < now]
        for rid in expired:
            del self._seen[rid]
