from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts import (
    ALLOWED_CORPORA,
    ALLOWED_REVISION_TRACKS,
    ALLOWED_SOURCE_CHANNELS,
)


@dataclass(frozen=True, slots=True)
class RawAssetRef:
    raw_asset_id: str
    raw_version_id: str
    page_start: int | None = None
    page_end: int | None = None

    def __post_init__(self) -> None:
        if not self.raw_asset_id:
            raise ValueError("raw_asset_id is required")
        if not self.raw_version_id:
            raise ValueError("raw_version_id is required")
        if self.page_start is not None and self.page_start <= 0:
            raise ValueError("page_start must be greater than zero")
        if self.page_end is not None and self.page_end <= 0:
            raise ValueError("page_end must be greater than zero")
        if (
            self.page_start is not None
            and self.page_end is not None
            and self.page_end < self.page_start
        ):
            raise ValueError("page_end must be greater than or equal to page_start")


@dataclass(frozen=True, slots=True)
class RawAssetRecord:
    raw_asset_id: str
    raw_version_id: str
    corpus: str
    collection: str
    raw_source_uri: str
    content_hash: str
    source_filename: str
    object_key: str
    ingestion_timestamp: str
    import_source: str

    def __post_init__(self) -> None:
        if self.corpus not in ALLOWED_CORPORA:
            raise ValueError(f"unsupported corpus: {self.corpus}")
        if not self.collection:
            raise ValueError("collection is required")
        if not self.raw_asset_id:
            raise ValueError("raw_asset_id is required")
        if not self.raw_version_id:
            raise ValueError("raw_version_id is required")
        if not self.raw_source_uri:
            raise ValueError("raw_source_uri is required")
        if not self.content_hash:
            raise ValueError("content_hash is required")
        if not self.source_filename:
            raise ValueError("source_filename is required")
        if not self.object_key:
            raise ValueError("object_key is required")
        if not self.ingestion_timestamp:
            raise ValueError("ingestion_timestamp is required")
        if not self.import_source:
            raise ValueError("import_source is required")


@dataclass(frozen=True, slots=True)
class SourceObservation:
    source_channel: str
    source_uri: str
    raw_asset: RawAssetRef | None = None
    is_primary: bool = False
    import_source: str = ""

    def __post_init__(self) -> None:
        if self.source_channel not in ALLOWED_SOURCE_CHANNELS:
            raise ValueError(f"unsupported source channel: {self.source_channel}")
        if not self.source_uri:
            raise ValueError("source_uri is required")


@dataclass(frozen=True, slots=True)
class DocumentRegistryRecord:
    document_id: str
    revision_track: str
    version_id: str
    source_uri: str
    content_hash: str
    corpus: str
    collection: str
    cleaning_policy_version: str = ""
    acl_groups: tuple[str, ...] = field(default_factory=tuple)
    campus_scope: str | None = None
    status: str = "active"
    ingestion_timestamp: str = ""
    parser_version: str = ""
    embedding_model: str = ""
    source_channel: str = ""
    is_current: bool = False
    effective_date: str | None = None
    published_date: str | None = None
    supersedes_version_id: str | None = None
    provenance_status: str = ""
    raw_asset: RawAssetRef | None = None
    source_observations: tuple[SourceObservation, ...] = field(default_factory=tuple)
    document_units_object_key: str | None = None
    provider_response_object_key: str | None = None
    canonical_markdown_object_key: str | None = None
    processed_object_keys: tuple[str, ...] = field(default_factory=tuple)
    import_source: str = ""

    def __post_init__(self) -> None:
        if self.corpus not in ALLOWED_CORPORA:
            raise ValueError(f"unsupported corpus: {self.corpus}")
        if not self.collection:
            raise ValueError("collection is required")
        if not self.document_id:
            raise ValueError("document_id is required")
        if self.revision_track not in ALLOWED_REVISION_TRACKS:
            raise ValueError(f"unsupported revision track: {self.revision_track}")
        if not self.version_id:
            raise ValueError("version_id is required")
        if not self.source_uri:
            raise ValueError("source_uri is required")
        if not self.content_hash:
            raise ValueError("content_hash is required")
        if not self.status:
            raise ValueError("status is required")
        if not self.ingestion_timestamp:
            raise ValueError("ingestion_timestamp is required")
        if not self.parser_version:
            raise ValueError("parser_version is required")
        if self.source_channel not in ALLOWED_SOURCE_CHANNELS:
            raise ValueError(f"unsupported source channel: {self.source_channel}")
        if not self.import_source:
            raise ValueError("import_source is required")
        if sum(1 for observation in self.source_observations if observation.is_primary) > 1:
            raise ValueError("source_observations must not contain more than one primary observation")
