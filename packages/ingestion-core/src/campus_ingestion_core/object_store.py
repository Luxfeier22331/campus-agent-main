from __future__ import annotations

from dataclasses import dataclass
import re

from campus_contracts import ALLOWED_CORPORA

from campus_ingestion_core.settings import ObjectStoreSettings


DEFAULT_RAW_SOURCE_CHANNEL = "pdf"
DEFAULT_PROCESSED_SOURCE_CHANNEL = "pdf_ocr"
YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")
REDUNDANT_SOURCE_SUFFIXES = {
    "pdf",
    "doc",
    "docx",
    "html",
    "htm",
    "md",
    "markdown",
    "txt",
    "json",
    "csv",
    "zip",
}


def build_raw_asset_key(
    *,
    corpus: str,
    raw_asset_id: str,
    raw_version_id: str,
    filename: str,
    source_channel: str = DEFAULT_RAW_SOURCE_CHANNEL,
    year: str | None = None,
) -> str:
    _validate_corpus_and_filename(corpus=corpus, filename=filename)
    if not raw_asset_id:
        raise ValueError("raw_asset_id is required")
    if not raw_version_id:
        raise ValueError("raw_version_id is required")
    return "/".join(
        [
            _validate_path_segment(source_channel, field_name="source_channel"),
            _source_asset_slug(raw_asset_id),
            _normalize_year_label(year or infer_year_label(filename)),
            *_identity_segments(raw_version_id),
            filename,
        ]
    )


def build_processed_artifact_key(
    *,
    corpus: str,
    collection: str,
    document_id: str,
    revision_track: str,
    version_id: str,
    filename: str,
    title: str | None = None,
    year: str | None = None,
) -> str:
    _validate_corpus_and_filename(corpus=corpus, filename=filename)
    if not document_id:
        raise ValueError("document_id is required")
    if not revision_track:
        raise ValueError("revision_track is required")
    if not version_id:
        raise ValueError("version_id is required")
    return "/".join(
        [
            corpus,
            "documents",
            _validate_path_segment(collection, field_name="collection"),
            _document_directory_name(document_id=document_id, title=title),
            _validate_path_segment(revision_track, field_name="revision_track"),
            _normalize_year_label(year),
            filename,
        ]
    )


def build_processed_asset_artifact_key(
    *,
    corpus: str,
    raw_asset_id: str,
    raw_version_id: str,
    filename: str,
    source_channel: str = DEFAULT_PROCESSED_SOURCE_CHANNEL,
    year: str | None = None,
) -> str:
    _validate_corpus_and_filename(corpus=corpus, filename=filename)
    if not raw_asset_id:
        raise ValueError("raw_asset_id is required")
    if not raw_version_id:
        raise ValueError("raw_version_id is required")
    return "/".join(
        [
            corpus,
            "sources",
            _validate_path_segment(source_channel, field_name="source_channel"),
            _source_asset_slug(raw_asset_id),
            _normalize_year_label(year),
            *_identity_segments(raw_version_id),
            filename,
        ]
    )


def _validate_corpus_and_filename(*, corpus: str, filename: str) -> None:
    if corpus not in ALLOWED_CORPORA:
        raise ValueError(f"unsupported corpus: {corpus}")
    if not filename or "/" in filename.strip("/"):
        raise ValueError("filename must be a single path segment")


def _validate_path_segment(value: str, *, field_name: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    if "/" in normalized:
        raise ValueError(f"{field_name} must be a single path segment")
    return normalized


def _identity_segments(value: str) -> tuple[str, ...]:
    normalized = value.strip()
    if not normalized:
        raise ValueError("identity value is required")
    if "/" in normalized:
        raise ValueError("identity value must not contain slash")
    segments = tuple(part.strip() for part in normalized.split(":") if part.strip())
    if not segments:
        raise ValueError("identity value is required")
    return segments


def _raw_asset_segments(raw_asset_id: str) -> tuple[str, ...]:
    segments = _identity_segments(raw_asset_id)
    if len(segments) >= 2 and segments[0] == "asset":
        return segments[1:]
    return segments


def _source_asset_slug(raw_asset_id: str) -> str:
    segments = _raw_asset_segments(raw_asset_id)
    if not segments:
        raise ValueError("raw_asset_id is required")
    return _normalize_source_asset_slug(segments[-1])


def _normalize_source_asset_slug(value: str) -> str:
    slug = _slugify_path_label(value)
    parts = [part for part in slug.split("-") if part]
    if len(parts) >= 2 and parts[-1] in REDUNDANT_SOURCE_SUFFIXES:
        parts = parts[:-1]
    if len(parts) >= 2 and YEAR_RE.fullmatch(parts[-1]) is not None:
        parts = parts[:-1]
    slug = "-".join(parts)
    return slug or "asset"


def _document_directory_name(*, document_id: str, title: str | None) -> str:
    document_suffix = _document_id_suffix(document_id)
    title_slug = _slugify_path_label(title or document_suffix)
    docid8 = _document_id_short_label(document_suffix)
    return f"{title_slug}--{docid8}"


def _document_id_suffix(document_id: str) -> str:
    segments = _identity_segments(document_id)
    return segments[-1]


def _document_id_short_label(value: str) -> str:
    normalized = _slugify_path_label(value)
    if _looks_like_hash(normalized) and len(normalized) > 8:
        return normalized[:8]
    return normalized


def _normalize_year_label(value: str | None) -> str:
    if value is None:
        return "undated"
    normalized = value.strip()
    if not normalized:
        return "undated"
    match = YEAR_RE.search(normalized)
    if match is None:
        return "undated"
    return match.group(1)


def infer_year_label(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    match = YEAR_RE.search(normalized)
    if match is None:
        return None
    return match.group(1)


def _looks_like_hash(value: str) -> bool:
    return len(value) >= 8 and all(ch in "0123456789abcdef" for ch in value)


def _slugify_path_label(value: str) -> str:
    normalized = value.strip().lower()
    slug = "".join(ch if ch.isalnum() else "-" for ch in normalized).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "document"


@dataclass(frozen=True, slots=True)
class S3ObjectStoreClientFactory:
    settings: ObjectStoreSettings

    def client_config(self) -> dict[str, object]:
        return {
            "endpoint_url": self.settings.endpoint,
            "region_name": self.settings.region,
            "aws_access_key_id": self.settings.access_key,
            "aws_secret_access_key": self.settings.secret_key,
            "use_ssl": self.settings.secure,
        }

    def create(self):  # pragma: no cover - exercised only when boto3 is installed
        try:
            import boto3
        except ImportError as exc:  # pragma: no cover - dependent on environment
            raise RuntimeError(
                "boto3 is required to create the S3-compatible object store client"
            ) from exc
        return boto3.client("s3", **self.client_config())
