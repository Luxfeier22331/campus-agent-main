from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from campus_ingestion_core.models import RawAssetRef
from campus_ingestion_core.object_store import build_raw_asset_key


class _DocumentRawAssetProtocol(Protocol):
    raw_asset_id: str | None
    raw_version_id: str | None


@dataclass(frozen=True, slots=True)
class ResolvedRawAsset:
    raw_asset_id: str
    raw_version_id: str
    source_filename: str
    path: Path
    raw_source_uri: str
    content_hash: str
    object_key: str


def resolved_raw_asset(
    *,
    raw_path: Path | None,
    raw_source_uri: str | None,
    corpus: str,
    raw_asset_id_override: str | None = None,
) -> ResolvedRawAsset | None:
    if raw_path is None:
        return None
    raw_hash = hashlib.sha256(raw_path.read_bytes()).hexdigest()
    raw_asset_id = raw_asset_id_override or build_raw_asset_id(raw_path.name)
    source_filename = raw_path.name
    raw_version_id = f"sha256:{raw_hash}"
    resolved_source_uri = raw_source_uri or f"file://{raw_path.resolve()}"
    return ResolvedRawAsset(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        source_filename=source_filename,
        path=raw_path,
        raw_source_uri=resolved_source_uri,
        content_hash=raw_hash,
        object_key=build_raw_asset_key(
            corpus=corpus,
            raw_asset_id=raw_asset_id,
            raw_version_id=raw_version_id,
            filename=source_filename,
        ),
    )


def derive_source_uri(metadata: dict[str, object]) -> str:
    source_url = metadata.get("source_url")
    if isinstance(source_url, str) and source_url:
        return source_url
    for candidate in (metadata.get("source_md"), metadata.get("source_id")):
        relative = extract_canonical_relative_path(candidate)
        if relative is not None:
            return f"campus-agent://canonical/{relative}"
    return f"campus-agent://import/{metadata['document_id']}/{metadata['version_id']}"


def resolve_registry_raw_asset_ref(
    *,
    raw_asset: ResolvedRawAsset | None,
    document: _DocumentRawAssetProtocol,
    metadata: dict[str, object],
) -> RawAssetRef | None:
    if raw_asset is not None:
        return RawAssetRef(
            raw_asset_id=raw_asset.raw_asset_id,
            raw_version_id=raw_asset.raw_version_id,
            page_start=metadata.get("raw_page_start"),
            page_end=metadata.get("raw_page_end"),
        )
    if document.raw_asset_id and document.raw_version_id:
        return RawAssetRef(
            raw_asset_id=document.raw_asset_id,
            raw_version_id=document.raw_version_id,
            page_start=metadata.get("raw_page_start"),
            page_end=metadata.get("raw_page_end"),
        )
    return None


def derive_document_title(*, metadata: dict[str, object], document_id: str) -> str:
    for key in ("title", "document_title"):
        title = _normalize_optional_text(metadata.get(key))
        if title is not None:
            return title
    return document_id.split(":")[-1]


def derive_document_year(*, metadata: dict[str, object]) -> str | None:
    for key in (
        "published_date",
        "effective_date",
        "year",
        "source_pdf",
        "source_doc",
        "source_label",
    ):
        year = _extract_year_label(metadata.get(key))
        if year is not None:
            return year
    return None


def resolve_raw_path(raw_root: Path, source_pdf: str) -> Path | None:
    for candidate_name in raw_filename_candidates(source_pdf):
        candidate = raw_root / candidate_name
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def raw_filename_candidates(source_pdf: str) -> tuple[str, ...]:
    exact = source_pdf.strip()
    candidates = [exact]
    return tuple(dict.fromkeys(name for name in candidates if name))


def build_raw_asset_id(filename: str) -> str:
    return f"asset:{slugify_label(filename)}"


def slugify_label(value: str) -> str:
    normalized = value.strip().lower()
    slug = "".join(ch if ch.isalnum() else "-" for ch in normalized).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "asset"


def extract_canonical_relative_path(value: object) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    normalized = value.replace("\\", "/")
    marker = "rag-data/canonical/"
    if marker not in normalized:
        return None
    return normalized.split(marker, 1)[1].lstrip("/")


def _extract_year_label(value: object) -> str | None:
    text = _normalize_optional_text(value)
    if text is None:
        return None
    match = re.search(r"(?<!\d)((?:19|20)\d{2})(?!\d)", text)
    if match is None:
        return None
    return match.group(1)


def _normalize_optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None
