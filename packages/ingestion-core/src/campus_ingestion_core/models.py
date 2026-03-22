from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts import ALLOWED_CORPORA


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
    raw_source_uri: str
    content_hash: str
    source_filename: str
    object_key: str
    ingestion_timestamp: str
    import_source: str

    def __post_init__(self) -> None:
        if self.corpus not in ALLOWED_CORPORA:
            raise ValueError(f"unsupported corpus: {self.corpus}")
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
class DocumentRegistryRecord:
    document_id: str
    version_id: str
    source_uri: str
    content_hash: str
    corpus: str
    acl_groups: tuple[str, ...] = field(default_factory=tuple)
    campus_scope: str | None = None
    status: str = "active"
    ingestion_timestamp: str = ""
    parser_version: str = ""
    embedding_model: str = ""
    raw_asset: RawAssetRef | None = None
    structured_object_key: str | None = None
    provider_result_object_key: str | None = None
    processed_object_keys: tuple[str, ...] = field(default_factory=tuple)
    import_source: str = ""

    def __post_init__(self) -> None:
        if self.corpus not in ALLOWED_CORPORA:
            raise ValueError(f"unsupported corpus: {self.corpus}")
        if not self.document_id:
            raise ValueError("document_id is required")
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
        if not self.import_source:
            raise ValueError("import_source is required")
