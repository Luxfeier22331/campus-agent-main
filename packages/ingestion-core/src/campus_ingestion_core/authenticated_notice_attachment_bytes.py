from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def has_collected_attachment_bytes(attachment_ref: Mapping[str, Any]) -> bool:
    object_key = _optional_text(attachment_ref.get("object_key"))
    content_sha256 = _optional_text(
        attachment_ref.get("content_sha256") or attachment_ref.get("sha256")
    )
    storage_provider = _optional_text(attachment_ref.get("storage_provider"))
    ingest_status = _optional_text(attachment_ref.get("ingest_status"))
    return (
        object_key is not None
        and content_sha256 is not None
        and storage_provider not in {None, "reference_only"}
        and ingest_status in {"downloaded", "uploaded"}
    )


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


__all__ = ["has_collected_attachment_bytes"]
