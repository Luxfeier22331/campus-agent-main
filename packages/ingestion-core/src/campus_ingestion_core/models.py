from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts import (
    ALLOWED_REVISION_TRACKS,
    ALLOWED_SOURCE_CHANNELS,
    DEFAULT_POLICY_PROJECTION_VERSION,
)
from campus_ingestion_core.scope_catalog import assert_known_scope


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
    content_type: str | None = None
    file_extension: str = ""
    byte_size: int | None = None
    page_count: int | None = None
    image_width: int | None = None
    image_height: int | None = None
    asset_kind: str = ""
    asset_subkind: str = ""
    classification_confidence: float | None = None

    def __post_init__(self) -> None:
        assert_known_scope(self.corpus, self.collection)
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
        if self.content_type is not None and not self.content_type.strip():
            raise ValueError("content_type must be a non-empty string when provided")
        if self.byte_size is not None and self.byte_size < 0:
            raise ValueError("byte_size must be greater than or equal to zero")
        if self.page_count is not None and self.page_count <= 0:
            raise ValueError("page_count must be greater than zero")
        if self.image_width is not None and self.image_width <= 0:
            raise ValueError("image_width must be greater than zero")
        if self.image_height is not None and self.image_height <= 0:
            raise ValueError("image_height must be greater than zero")
        if self.classification_confidence is not None and not 0.0 <= self.classification_confidence <= 1.0:
            raise ValueError("classification_confidence must be between 0.0 and 1.0")

        normalized_content_type = self.content_type.strip() if self.content_type is not None else None
        normalized_extension = self.file_extension.strip().lower()
        if normalized_extension and not normalized_extension.startswith("."):
            normalized_extension = f".{normalized_extension}"
        normalized_asset_kind = self.asset_kind.strip()
        normalized_asset_subkind = self.asset_subkind.strip()

        if normalized_content_type != self.content_type:
            object.__setattr__(self, "content_type", normalized_content_type)
        if normalized_extension != self.file_extension:
            object.__setattr__(self, "file_extension", normalized_extension)
        if normalized_asset_kind != self.asset_kind:
            object.__setattr__(self, "asset_kind", normalized_asset_kind)
        if normalized_asset_subkind != self.asset_subkind:
            object.__setattr__(self, "asset_subkind", normalized_asset_subkind)


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
    entitlement_groups: tuple[str, ...] = field(default_factory=tuple)
    visibility_scope: str | None = None
    visibility_level: str = ""
    policy_projection_version: str = DEFAULT_POLICY_PROJECTION_VERSION
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
    layout_elements_object_key: str | None = None
    canonical_markdown_object_key: str | None = None
    processed_object_keys: tuple[str, ...] = field(default_factory=tuple)
    import_source: str = ""

    def __post_init__(self) -> None:
        assert_known_scope(self.corpus, self.collection)
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

        entitlement_groups = self.entitlement_groups or self.acl_groups
        acl_groups = self.acl_groups or self.entitlement_groups
        visibility_scope = self.visibility_scope or self.campus_scope
        campus_scope = self.campus_scope or self.visibility_scope
        visibility_level = self.visibility_level.strip() or (
            "restricted" if entitlement_groups else "public"
        )
        policy_projection_version = (
            self.policy_projection_version.strip() or DEFAULT_POLICY_PROJECTION_VERSION
        )

        if entitlement_groups != self.entitlement_groups:
            object.__setattr__(self, "entitlement_groups", entitlement_groups)
        if acl_groups != self.acl_groups:
            object.__setattr__(self, "acl_groups", acl_groups)
        if visibility_scope != self.visibility_scope:
            object.__setattr__(self, "visibility_scope", visibility_scope)
        if campus_scope != self.campus_scope:
            object.__setattr__(self, "campus_scope", campus_scope)
        if visibility_level != self.visibility_level:
            object.__setattr__(self, "visibility_level", visibility_level)
        if policy_projection_version != self.policy_projection_version:
            object.__setattr__(self, "policy_projection_version", policy_projection_version)
