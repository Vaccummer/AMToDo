"""Token-based upload negotiation for streaming attachment transfer."""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass
class UploadToken:
    token: str
    owner_type: str           # "todo" | "schedule"
    owner_id: int
    user_id: int
    filename: str
    mime_type: str | None
    plain_size: int
    plain_sha256: str | None
    created_at: float
    temp_path: Path


class UploadTokenStore:
    """In-memory store with TTL-based cleanup."""

    def __init__(self, temp_root: Path, ttl_seconds: int = 300):
        self._tokens: dict[str, UploadToken] = {}
        self._temp_root = temp_root
        self._ttl = ttl_seconds

    def create(
        self,
        owner_type: str,
        owner_id: int,
        user_id: int,
        filename: str,
        mime_type: str | None,
        plain_size: int,
        plain_sha256: str | None = None,
    ) -> str:
        self._evict_expired()
        token = secrets.token_urlsafe(32)
        temp_path = self._temp_root / f"{token}.tmp"
        self._tokens[token] = UploadToken(
            token=token,
            owner_type=owner_type,
            owner_id=owner_id,
            user_id=user_id,
            filename=filename,
            mime_type=mime_type,
            plain_size=plain_size,
            plain_sha256=plain_sha256,
            created_at=time.time(),
            temp_path=temp_path,
        )
        return token

    def get(self, token: str) -> UploadToken | None:
        self._evict_expired()
        return self._tokens.get(token)

    def pop(self, token: str) -> UploadToken | None:
        """Remove token and return it (caller decides on temp file)."""
        return self._tokens.pop(token, None)

    def finalize(self, token: str) -> UploadToken | None:
        """Remove token from store without deleting temp file."""
        self._evict_expired()
        return self._tokens.pop(token, None)

    def _evict_expired(self):
        now = time.time()
        expired = [t for t, v in self._tokens.items() if now - v.created_at > self._ttl]
        for t in expired:
            v = self._tokens.pop(t)
            v.temp_path.unlink(missing_ok=True)
