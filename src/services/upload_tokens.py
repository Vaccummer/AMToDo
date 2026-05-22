"""Token-based upload/download negotiation for streaming attachment transfer."""

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
    file_key: str             # base64
    hmac_key: str             # base64
    nonce: str                # base64
    plain_size: int           # declared by client
    created_at: float
    temp_path: Path


@dataclass
class DownloadToken:
    token: str
    owner_type: str           # "todo" | "schedule"
    owner_id: int
    user_id: int
    attachment_id: int
    created_at: float


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
        file_key: str,
        hmac_key: str,
        nonce: str,
        plain_size: int,
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
            file_key=file_key,
            hmac_key=hmac_key,
            nonce=nonce,
            plain_size=plain_size,
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


class DownloadTokenStore:
    """In-memory download token store with TTL-based cleanup."""

    def __init__(self, ttl_seconds: int = 60):
        self._tokens: dict[str, DownloadToken] = {}
        self._ttl = ttl_seconds

    def create(
        self,
        owner_type: str,
        owner_id: int,
        user_id: int,
        attachment_id: int,
    ) -> str:
        self._evict_expired()
        token = secrets.token_urlsafe(32)
        self._tokens[token] = DownloadToken(
            token=token,
            owner_type=owner_type,
            owner_id=owner_id,
            user_id=user_id,
            attachment_id=attachment_id,
            created_at=time.time(),
        )
        return token

    def get(self, token: str) -> DownloadToken | None:
        self._evict_expired()
        return self._tokens.get(token)

    def _evict_expired(self):
        now = time.time()
        expired = [t for t, v in self._tokens.items() if now - v.created_at > self._ttl]
        for t in expired:
            self._tokens.pop(t)
