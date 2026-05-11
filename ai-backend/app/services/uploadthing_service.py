from __future__ import annotations

import asyncio
import io
from typing import Any
import cloudinary
import cloudinary.uploader
import cloudinary.api
import httpx

from app.core.config import settings


class UploadThingService:
    """Cloudinary file storage service."""

    def __init__(self) -> None:
        # Initialize cloudinary here to ensure it uses the latest env vars
        # Settings will be evaluated when imported
        if settings.CLOUDINARY_CLOUD_NAME and settings.CLOUDINARY_API_KEY and settings.CLOUDINARY_API_SECRET:
            cloudinary.config(
                cloud_name=settings.CLOUDINARY_CLOUD_NAME,
                api_key=settings.CLOUDINARY_API_KEY,
                api_secret=settings.CLOUDINARY_API_SECRET,
                secure=True,
            )

    @property
    def is_configured(self) -> bool:
        return bool(
            settings.CLOUDINARY_CLOUD_NAME
            and settings.CLOUDINARY_API_KEY
            and settings.CLOUDINARY_API_SECRET
        )

    async def list_files(self) -> list[dict[str, Any]]:
        """List files utilizing the rate-limited Admin API."""
        if not self.is_configured:
            return []

        def _scan() -> list[dict[str, Any]]:
            try:
                # Max results limit; you could implement pagination if needed.
                res = cloudinary.api.resources(resource_type="raw", max_results=500)
                out = []
                for item in res.get("resources", []):
                    out.append(
                        {
                            "key": item["public_id"],
                            "size": item["bytes"],
                            "modified_at": item["created_at"],
                            "url": item["secure_url"],
                        }
                    )
                return out
            except Exception as e:
                import logging
                logging.getLogger(__name__).warning("Cloudinary list API error: %s", e)
                return []

        return await asyncio.to_thread(_scan)

    async def delete_file(self, key: str) -> dict[str, Any]:
        """Delete file utilizing the Upload API destroy method."""
        if not self.is_configured:
            return {"deleted": False, "key": key, "reason": "not_configured"}

        def _delete() -> dict[str, Any]:
            try:
                res = cloudinary.uploader.destroy(key, resource_type="raw")
                return {
                    "deleted": res.get("result") == "ok",
                    "key": key,
                    "reason": res.get("result"),
                }
            except Exception as e:
                return {"deleted": False, "key": key, "reason": str(e)}

        return await asyncio.to_thread(_delete)

    async def upload_file(self, key: str, content: str | bytes) -> dict[str, Any]:
        """Upload file correctly scoped by key (e.g. user_id/thread_id/filename)."""
        if not self.is_configured:
            raise RuntimeError("Cloudinary is not configured.")

        # Cloudinary's uploader expects a path, URL, or file-like object. Passing
        # raw bytes directly can be interpreted as a path-like value.
        data = content.encode("utf-8") if isinstance(content, str) else content

        def _write() -> dict[str, Any]:
            res = cloudinary.uploader.upload(
                io.BytesIO(data),
                resource_type="raw",
                public_id=key,
                overwrite=True,
            )
            secure_url = res.get("secure_url") or res.get("url") or ""
            return {
                "key": res.get("public_id") or key,
                "size": res.get("bytes"),
                "url": secure_url,
                # Backwards-compatible alias for callers that previously read
                # the URL from "path".
                "path": secure_url,
            }

        return await asyncio.to_thread(_write)

    async def download_file(self, key: str) -> dict[str, Any]:
        """Download a file by passing its secure url."""
        if not self.is_configured:
            return {"found": False, "key": key, "content": None, "reason": "not_configured"}

        def _read() -> dict[str, Any]:
            try:
                # Use Admin API to get the secure url
                res = cloudinary.api.resource(key, resource_type="raw")
                url = res.get("secure_url")
                if not url:
                    return {"found": False, "key": key, "content": None}

                with httpx.Client() as client:
                    resp = client.get(url)
                    resp.raise_for_status()
                    file_content = resp.content

                return {
                    "found": True,
                    "key": key,
                    "content": file_content,
                    "size": len(file_content),
                }
            except Exception as e:
                return {"found": False, "key": key, "content": None, "error": str(e)}

        return await asyncio.to_thread(_read)
