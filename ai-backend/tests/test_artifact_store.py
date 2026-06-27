"""Cloudinary artifact storage helpers."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.agent.storage.file_store import ArtifactStore
from app.core.config import Settings


def _settings() -> Settings:
    return Settings(
        DATABASE_URL="sqlite:///./app.db",
        CLOUDINARY_CLOUD_NAME="demo",
        CLOUDINARY_API_KEY="key",
        CLOUDINARY_API_SECRET="secret",
        CLOUDINARY_ARTIFACT_FOLDER="swarm-artifacts",
    )


@patch("app.agent.storage.file_store.cloudinary.uploader.upload")
@patch("app.agent.storage.file_store.cloudinary.config")
def test_upload_diagram_returns_deterministic_storage_key_and_url(
    mock_config: MagicMock,
    mock_upload: MagicMock,
) -> None:
    mock_upload.return_value = {"secure_url": "https://cdn.example/thread-1/overview.mmd"}
    store = ArtifactStore()
    store.configure_from_settings(_settings())

    artifact = store.upload_diagram(
        thread_id="thread-1",
        iteration=2,
        diagram_type="overview",
        content="flowchart TD\n  A[a]",
    )

    assert artifact.storage_key == "swarm-artifacts/thread-1/diagrams/iter2_overview.mmd"
    assert artifact.url == "https://cdn.example/thread-1/overview.mmd"
    assert mock_config.called


@patch("app.agent.storage.file_store.cloudinary.uploader.upload")
@patch("app.agent.storage.file_store.cloudinary.config")
def test_upload_doc_returns_deterministic_storage_key_and_url(
    mock_config: MagicMock,
    mock_upload: MagicMock,
) -> None:
    mock_upload.return_value = {"secure_url": "https://cdn.example/thread-1/overview.md"}
    store = ArtifactStore()
    store.configure_from_settings(_settings())

    artifact = store.upload_doc(
        thread_id="thread-1",
        doc_filename="overview.md",
        content="# Overview",
    )

    assert artifact.storage_key == "swarm-artifacts/thread-1/docs/overview.md"
    assert artifact.url == "https://cdn.example/thread-1/overview.md"


@patch("app.agent.storage.file_store.httpx.get")
@patch("app.agent.storage.file_store.cloudinary.api.resource")
@patch("app.agent.storage.file_store.cloudinary.config")
def test_read_text_fetches_cloudinary_raw_asset(
    mock_config: MagicMock,
    mock_resource: MagicMock,
    mock_get: MagicMock,
) -> None:
    mock_resource.return_value = {"secure_url": "https://cdn.example/thread-1/overview.md"}
    mock_response = MagicMock()
    mock_response.text = "# Overview"
    mock_response.raise_for_status.return_value = None
    mock_get.return_value = mock_response
    store = ArtifactStore()
    store.configure_from_settings(_settings())

    text = store.read_text("swarm-artifacts/thread-1/docs/overview.md")

    assert text == "# Overview"
    mock_get.assert_called_once_with(
        "https://cdn.example/thread-1/overview.md",
        timeout=30.0,
    )


@patch("app.agent.storage.file_store.cloudinary.uploader.upload")
@patch("app.agent.storage.file_store.cloudinary.config")
def test_upload_failure_surfaces_cloudinary_error(
    mock_config: MagicMock,
    mock_upload: MagicMock,
) -> None:
    mock_upload.side_effect = httpx.HTTPError("upload failed")
    store = ArtifactStore()
    store.configure_from_settings(_settings())

    with pytest.raises(httpx.HTTPError, match="upload failed"):
        store.upload_doc(
            thread_id="thread-1",
            doc_filename="overview.md",
            content="# Overview",
        )
