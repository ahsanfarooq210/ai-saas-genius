"""Cloudinary-backed artifact persistence for Mermaid and Markdown assets."""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

import cloudinary
import cloudinary.api
import cloudinary.uploader
import httpx

from app.core.config import Settings, settings


@dataclass(frozen=True)
class StoredArtifact:
    storage_key: str
    url: str


class ArtifactStore:
    def __init__(self) -> None:
        self._configured = False
        self._folder = settings.CLOUDINARY_ARTIFACT_FOLDER

    def configure_from_settings(self, config: Settings = settings) -> None:
        missing = [
            name
            for name, value in (
                ("CLOUDINARY_CLOUD_NAME", config.CLOUDINARY_CLOUD_NAME),
                ("CLOUDINARY_API_KEY", config.CLOUDINARY_API_KEY),
                ("CLOUDINARY_API_SECRET", config.CLOUDINARY_API_SECRET),
            )
            if not value
        ]
        if missing:
            raise RuntimeError(
                "Cloudinary artifact storage is not configured. Missing: "
                + ", ".join(missing)
            )

        cloudinary.config(
            cloud_name=config.CLOUDINARY_CLOUD_NAME,
            api_key=config.CLOUDINARY_API_KEY,
            api_secret=config.CLOUDINARY_API_SECRET,
            secure=True,
        )
        self._folder = config.CLOUDINARY_ARTIFACT_FOLDER.strip("/") or "swarm-artifacts"
        self._configured = True

    def upload_diagram(
        self,
        *,
        thread_id: str,
        revision_number: int,
        iteration: int,
        diagram_type: str,
        content: str,
    ) -> StoredArtifact:
        storage_key = (
            f"{self._folder}/{thread_id}/revisions/{revision_number}/diagrams/"
            f"iter{iteration}_{diagram_type}.mmd"
        )
        return self._upload_text(storage_key=storage_key, content=content)

    def upload_doc(
        self,
        *,
        thread_id: str,
        revision_number: int,
        doc_filename: str,
        content: str,
    ) -> StoredArtifact:
        storage_key = (
            f"{self._folder}/{thread_id}/revisions/{revision_number}/docs/"
            f"{doc_filename}"
        )
        return self._upload_text(storage_key=storage_key, content=content)

    def read_text(self, storage_key: str) -> str:
        self._require_configured()
        resource = cloudinary.api.resource(storage_key, resource_type="raw")
        url = resource.get("secure_url") or resource.get("url")
        if not url:
            raise RuntimeError(f"Cloudinary resource is missing a delivery URL: {storage_key}")

        response = httpx.get(url, timeout=30.0)
        response.raise_for_status()
        return response.text

    def _upload_text(self, *, storage_key: str, content: str) -> StoredArtifact:
        self._require_configured()
        file_obj = BytesIO(content.encode("utf-8"))
        file_obj.name = storage_key.rsplit("/", 1)[-1]
        result = cloudinary.uploader.upload(
            file=file_obj,
            public_id=storage_key,
            resource_type="raw",
            overwrite=True,
            invalidate=True,
        )
        url = result.get("secure_url") or result.get("url")
        if not url:
            raise RuntimeError(f"Cloudinary upload did not return a delivery URL: {storage_key}")
        return StoredArtifact(storage_key=storage_key, url=url)

    def _require_configured(self) -> None:
        if not self._configured:
            raise RuntimeError(
                "Artifact store is not configured. Call configure_from_settings() at startup."
            )


artifact_store = ArtifactStore()
