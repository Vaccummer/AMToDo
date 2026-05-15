"""Local attachment cache used by CLI and desktop UI helpers."""

from __future__ import annotations

import base64
import hashlib
import json
import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class AttachmentCache:
    """Cache decrypted attachments after metadata/version verification."""

    def __init__(self, root: Path) -> None:
        self._root = root / "cache" / "attachments"

    def get_or_download(
        self,
        metadata: dict[str, Any],
        download_cipher: Callable[[], bytes],
    ) -> dict[str, object]:
        """Return a cached plaintext path, downloading and decrypting when stale."""

        item_dir = self._item_dir(metadata)
        meta_path = item_dir / "metadata.json"
        cipher_path = item_dir / "cipher.bin"
        plain_path = item_dir / _safe_filename(str(metadata["filename"]))

        if self._matches(meta_path, metadata) and plain_path.is_file():
            return {"cache_hit": True, "path": str(plain_path)}

        item_dir.mkdir(parents=True, exist_ok=True)
        if self._matches(meta_path, metadata) and cipher_path.is_file():
            cipher = cipher_path.read_bytes()
        else:
            cipher = download_cipher()
            _validate_hash(cipher, str(metadata["cipher_sha256"]), "cipher_sha256")
            cipher_path.write_bytes(cipher)

        plain = _decrypt(cipher, metadata)
        _validate_hash(plain, str(metadata["plain_sha256"]), "plain_sha256")
        plain_path.write_bytes(plain)
        meta_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        return {"cache_hit": False, "path": str(plain_path)}

    def clear(self) -> None:
        """Remove all cached attachments."""

        if self._root.exists():
            shutil.rmtree(self._root)

    def _item_dir(self, metadata: dict[str, Any]) -> Path:
        owner_type = "schedule" if "schedule_id" in metadata else "todo"
        owner_id = metadata.get("schedule_id") or metadata.get("todo_id")
        return (
            self._root
            / str(metadata["user_id"])
            / owner_type
            / str(owner_id)
            / str(metadata["id"])
        )

    def _matches(self, meta_path: Path, metadata: dict[str, Any]) -> bool:
        if not meta_path.is_file():
            return False
        try:
            cached = json.loads(meta_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return False
        keys = (
            "updated_at",
            "plain_size_bytes",
            "plain_sha256",
            "cipher_size_bytes",
            "cipher_sha256",
            "file_key",
            "nonce",
        )
        return all(cached.get(key) == metadata.get(key) for key in keys)


def _decrypt(cipher: bytes, metadata: dict[str, Any]) -> bytes:
    key = base64.b64decode(str(metadata["file_key"]))
    nonce = base64.b64decode(str(metadata["nonce"]))
    return AESGCM(key).decrypt(nonce, cipher, None)


def _validate_hash(content: bytes, expected: str, name: str) -> None:
    actual = hashlib.sha256(content).hexdigest()
    if actual != expected:
        msg = f"attachment {name} mismatch"
        raise ValueError(msg)


def _safe_filename(filename: str) -> str:
    clean = Path(filename).name.strip()
    return clean or "attachment"
