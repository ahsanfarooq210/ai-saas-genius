from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.config import settings


class UploadThingService:
    """Local file storage (same surface as before; no UploadThing SDK)."""

    def __init__(self, storage_dir: str | Path | None = None) -> None:
        base = storage_dir if storage_dir is not None else settings.UPLOAD_STORAGE_DIR
        self._root = Path(base).resolve()

    @property
    def is_configured(self) -> bool:
        try:
            self._root.mkdir(parents=True, exist_ok=True)
            return os.access(self._root, os.W_OK)
        except OSError:
            return False

    def _safe_key(self, key: str) -> str:
        name = Path(key).name
        if not name or name in {".", ".."}:
            msg = "Invalid file key"
            raise ValueError(msg)
        return name

    def _path_for(self, key: str) -> Path:
        return self._root / self._safe_key(key)

    async def _ensure_root(self) -> None:
        await asyncio.to_thread(self._root.mkdir, parents=True, exist_ok=True)

    async def list_files(self) -> list[dict[str, Any]]:
        await self._ensure_root()

        def _scan() -> list[dict[str, Any]]:
            out: list[dict[str, Any]] = []
            if not self._root.is_dir():
                return out
            for p in self._root.iterdir():
                if not p.is_file():
                    continue
                st = p.stat()
                out.append(
                    {
                        "key": p.name,
                        "size": st.st_size,
                        "modified_at": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(),
                    }
                )
            return sorted(out, key=lambda x: x["key"])

        return await asyncio.to_thread(_scan)

    async def delete_file(self, key: str) -> dict[str, Any]:
        path = self._path_for(key)

        def _unlink() -> dict[str, Any]:
            if not path.is_file():
                return {"deleted": False, "key": self._safe_key(key), "reason": "not_found"}
            path.unlink()
            return {"deleted": True, "key": self._safe_key(key)}

        return await asyncio.to_thread(_unlink)

    async def upload_file(self, key: str, content: str | bytes) -> dict[str, Any]:
        await self._ensure_root()
        path = self._path_for(key)
        data = content.encode("utf-8") if isinstance(content, str) else content

        def _write() -> dict[str, Any]:
            path.write_bytes(data)
            return {
                "key": self._safe_key(key),
                "size": len(data),
                "path": str(path),
            }

        return await asyncio.to_thread(_write)

    async def download_file(self, key: str) -> dict[str, Any]:
        path = self._path_for(key)

        def _read() -> dict[str, Any]:
            if not path.is_file():
                return {"found": False, "key": self._safe_key(key), "content": None}
            raw = path.read_bytes()
            return {
                "found": True,
                "key": self._safe_key(key),
                "content": raw,
                "size": len(raw),
            }

        return await asyncio.to_thread(_read)
