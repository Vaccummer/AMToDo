"""Local attachment cache used by CLI and desktop UI helpers."""

from __future__ import annotations

import hashlib
import json
import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Any


class AttachmentCache:
    """Cache downloaded attachments after metadata/version verification."""

    def __init__(self, root: Path) -> None:
        self._root = root / "cache" / "attachments"

    def get_or_download(
        self,
        metadata: dict[str, Any],
        download_content: Callable[[], bytes],
    ) -> dict[str, object]:
        """Return a cached local path, downloading when stale."""

        item_dir = self._item_dir(metadata)
        meta_path = item_dir / "metadata.json"
        content_path = item_dir / "content.bin"
        plain_path = item_dir / _safe_filename(str(metadata["filename"]))

        if self._matches(meta_path, metadata) and plain_path.is_file():
            return {"cache_hit": True, "path": str(plain_path)}

        item_dir.mkdir(parents=True, exist_ok=True)
        if self._matches(meta_path, metadata) and content_path.is_file():
            plain = content_path.read_bytes()
        else:
            plain = download_content()
            _validate_hash(plain, str(metadata["plain_sha256"]), "plain_sha256")
            content_path.write_bytes(plain)

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
        )
        return all(cached.get(key) == metadata.get(key) for key in keys)


def _validate_hash(content: bytes, expected: str, name: str) -> None:
    actual = hashlib.sha256(content).hexdigest()
    if actual != expected:
        msg = f"attachment {name} mismatch"
        raise ValueError(msg)


def _safe_filename(filename: str) -> str:
    clean = Path(filename).name.strip()
    return clean or "attachment"
