from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Protocol

from campus_ingestion_core.artifacts import (
    CANONICAL_MARKDOWN_FILENAME,
    DOCUMENT_UNITS_FILENAME,
    LAYOUT_ELEMENTS_FILENAME,
    PROVIDER_RESPONSE_FILENAME,
)
from campus_ingestion_core.object_store import build_document_artifact_key


class _DocumentImportArtifactProtocol(Protocol):
    source_label: str
    metadata: dict[str, object]
    import_source: str
    revision_track: str
    source_channel: str
    is_current: bool
    corpus: str
    collection: str
    visibility_scope: str | None
    status: str
    raw_source_uri: str | None
    raw_asset_id: str | None
    raw_version_id: str | None
    provider_response_object_key: str | None
    layout_elements_object_key: str | None
    additional_processed_object_keys: tuple[str, ...]
    title: str | None
    year: str | None
    provider_response_bytes: bytes | None
    layout_elements_bytes: bytes | None
    canonical_markdown_bytes: bytes | None


@dataclass(frozen=True, slots=True)
class ProcessedArtifactInput:
    object_key: str
    data: bytes
    content_type: str

    def __post_init__(self) -> None:
        if not self.object_key.strip():
            raise ValueError("object_key is required")
        if not self.content_type.strip():
            raise ValueError("content_type is required")


@dataclass(frozen=True, slots=True)
class ResolvedDocumentArtifactKeys:
    document_units_key: str
    provider_response_key: str | None = None
    layout_elements_key: str | None = None
    canonical_markdown_key: str | None = None


def serialize_document_import_stub(
    document: _DocumentImportArtifactProtocol,
) -> dict[str, object]:
    return {
        "source_label": document.source_label,
        "metadata": dict(document.metadata),
        "import_source": document.import_source,
        "revision_track": document.revision_track,
        "source_channel": document.source_channel,
        "is_current": document.is_current,
        "corpus": document.corpus,
        "collection": document.collection,
        "visibility_scope": document.visibility_scope,
        "status": document.status,
        "raw_source_uri": document.raw_source_uri,
        "raw_asset_id": document.raw_asset_id,
        "raw_version_id": document.raw_version_id,
        "provider_response_object_key": document.provider_response_object_key,
        "layout_elements_object_key": document.layout_elements_object_key,
        "additional_processed_object_keys": list(document.additional_processed_object_keys),
        "title": document.title,
        "year": document.year,
    }


def parse_document_import_stub(payload: Mapping[str, object]):
    from campus_ingestion_core.campusrag_ingestion_support import DocumentImportInput

    return DocumentImportInput(
        source_label=str(payload["source_label"]),
        document_units_bytes=b"",
        provider_response_bytes=None,
        canonical_markdown_bytes=None,
        metadata=dict(payload["metadata"]),
        import_source=str(payload["import_source"]),
        revision_track=str(payload["revision_track"]),
        source_channel=str(payload["source_channel"]),
        is_current=bool(payload.get("is_current", False)),
        corpus=str(payload["corpus"]),
        collection=str(payload["collection"]),
        visibility_scope=(
            None if payload.get("visibility_scope") is None else str(payload["visibility_scope"])
        ),
        status=str(payload.get("status") or "active"),
        raw_source_uri=(
            None if payload.get("raw_source_uri") is None else str(payload["raw_source_uri"])
        ),
        raw_asset_id=(
            None if payload.get("raw_asset_id") is None else str(payload["raw_asset_id"])
        ),
        raw_version_id=(
            None if payload.get("raw_version_id") is None else str(payload["raw_version_id"])
        ),
        provider_response_object_key=(
            None
            if payload.get("provider_response_object_key") is None
            else str(payload["provider_response_object_key"])
        ),
        layout_elements_object_key=(
            None
            if payload.get("layout_elements_object_key") is None
            else str(payload["layout_elements_object_key"])
        ),
        additional_processed_object_keys=tuple(
            str(item) for item in payload.get("additional_processed_object_keys") or ()
        ),
        additional_processed_artifacts=(),
        title=None if payload.get("title") is None else str(payload["title"]),
        year=None if payload.get("year") is None else str(payload["year"]),
    )


def build_document_processed_object_keys(
    *,
    document_units_key: str | None = None,
    provider_response_key: str | None = None,
    layout_elements_key: str | None = None,
    canonical_markdown_key: str | None = None,
    additional_keys: Iterable[str | None] = (),
) -> tuple[str, ...]:
    return tuple(
        dict.fromkeys(
            key
            for key in (
                provider_response_key,
                layout_elements_key,
                canonical_markdown_key,
                document_units_key,
                *additional_keys,
            )
            if key is not None
        )
    )


def resolve_document_artifact_keys(
    *,
    document: _DocumentImportArtifactProtocol,
    document_id: str,
    version_id: str,
    title: str | None,
    year: str | None,
    corpus: str | None = None,
    collection: str | None = None,
) -> ResolvedDocumentArtifactKeys:
    resolved_corpus = corpus or document.corpus
    resolved_collection = collection or document.collection
    provider_response_key = document.provider_response_object_key
    if document.provider_response_bytes is not None and provider_response_key is None:
        provider_response_key = build_document_artifact_key(
            corpus=resolved_corpus,
            collection=resolved_collection,
            document_id=document_id,
            revision_track=document.revision_track,
            version_id=version_id,
            filename=PROVIDER_RESPONSE_FILENAME,
            title=title,
            year=year,
        )
    layout_elements_key = document.layout_elements_object_key
    if document.layout_elements_bytes is not None and layout_elements_key is None:
        layout_elements_key = build_document_artifact_key(
            corpus=resolved_corpus,
            collection=resolved_collection,
            document_id=document_id,
            revision_track=document.revision_track,
            version_id=version_id,
            filename=LAYOUT_ELEMENTS_FILENAME,
            title=title,
            year=year,
        )
    canonical_markdown_key = None
    if document.canonical_markdown_bytes is not None:
        canonical_markdown_key = build_document_artifact_key(
            corpus=resolved_corpus,
            collection=resolved_collection,
            document_id=document_id,
            revision_track=document.revision_track,
            version_id=version_id,
            filename=CANONICAL_MARKDOWN_FILENAME,
            title=title,
            year=year,
        )
    document_units_key = build_document_artifact_key(
        corpus=resolved_corpus,
        collection=resolved_collection,
        document_id=document_id,
        revision_track=document.revision_track,
        version_id=version_id,
        filename=DOCUMENT_UNITS_FILENAME,
        title=title,
        year=year,
    )
    return ResolvedDocumentArtifactKeys(
        document_units_key=document_units_key,
        provider_response_key=provider_response_key,
        layout_elements_key=layout_elements_key,
        canonical_markdown_key=canonical_markdown_key,
    )
