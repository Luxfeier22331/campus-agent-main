from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

CURRICULUM_COURSE_MAP_DOCS_SURFACE_SCHEMA_VERSION = "curriculum_course_map_docs_surface_v2"


class ObjectStoreByteReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class ObjectStoreAdmin(ObjectStoreByteReader, Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...

    def delete_prefix(
        self, *, bucket: str, prefix: str, exclude_keys: tuple[str, ...] = ()
    ) -> None: ...

    def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]: ...


@dataclass(frozen=True, slots=True)
class PublishedCourseMapNode:
    node_id: str
    node_label: str
    stage_id: str = ""
    stage_label: str = ""
    category_label: str = ""

    def __post_init__(self) -> None:
        if not self.node_id.strip():
            raise ValueError("node_id is required")
        if not self.node_label.strip():
            raise ValueError("node_label is required")


@dataclass(frozen=True, slots=True)
class PublishedCourseMapEdge:
    edge_id: str
    source_node_id: str
    source_label: str
    target_node_id: str
    target_label: str

    def __post_init__(self) -> None:
        if not self.edge_id.strip():
            raise ValueError("edge_id is required")
        if not self.source_node_id.strip():
            raise ValueError("source_node_id is required")
        if not self.target_node_id.strip():
            raise ValueError("target_node_id is required")
        if not self.source_label.strip():
            raise ValueError("source_label is required")
        if not self.target_label.strip():
            raise ValueError("target_label is required")


@dataclass(frozen=True, slots=True)
class CurriculumCourseMapDocsBlock:
    block_id: str
    page_number: int
    row_id: str
    map_index: int
    title: str
    status: str
    title_confidence: str
    parent_heading_hint: str
    display_stage_labels: tuple[str, ...]
    nodes: tuple[PublishedCourseMapNode, ...]
    edges: tuple[PublishedCourseMapEdge, ...]
    extraction_notes: tuple[str, ...]
    image_object_key: str
    region_bbox_provider: tuple[float, float, float, float]

    def __post_init__(self) -> None:
        if not self.block_id.strip():
            raise ValueError("block_id is required")
        if self.page_number <= 0:
            raise ValueError("page_number must be greater than zero")
        if self.map_index <= 0:
            raise ValueError("map_index must be greater than zero")
        if not self.title.strip():
            raise ValueError("title is required")
        if self.status not in {"ready", "partial", "failed"}:
            raise ValueError("unsupported status")
        if self.title_confidence not in {"visible", "partial", "absent"}:
            raise ValueError("unsupported title_confidence")
        if len(self.region_bbox_provider) != 4:
            raise ValueError("region_bbox_provider must contain four values")
        if not self.image_object_key.strip():
            raise ValueError("image_object_key is required")


@dataclass(frozen=True, slots=True)
class CurriculumCourseMapDocsSurface:
    schema_version: str
    generated_at: str
    document_id: str
    document_title: str
    raw_asset_id: str
    raw_version_id: str
    blocks: tuple[CurriculumCourseMapDocsBlock, ...]

    def __post_init__(self) -> None:
        if self.schema_version != CURRICULUM_COURSE_MAP_DOCS_SURFACE_SCHEMA_VERSION:
            raise ValueError("unsupported curriculum course-map docs surface version")
        if not self.generated_at.strip():
            raise ValueError("generated_at is required")
        if not self.document_id.strip():
            raise ValueError("document_id is required")
        if not self.document_title.strip():
            raise ValueError("document_title is required")
        if not self.raw_asset_id.strip():
            raise ValueError("raw_asset_id is required")
        if not self.raw_version_id.strip():
            raise ValueError("raw_version_id is required")


@dataclass(frozen=True, slots=True)
class CurriculumCourseMapDocsImageObject:
    key: str
    image_bytes: bytes

    def __post_init__(self) -> None:
        if not self.key.strip():
            raise ValueError("key is required")
        if not self.image_bytes:
            raise ValueError("image_bytes is required")


@dataclass(frozen=True, slots=True)
class _PublishedCourseMapPayload:
    nodes: tuple[PublishedCourseMapNode, ...]
    edges: tuple[PublishedCourseMapEdge, ...]
    notes: tuple[str, ...]
    has_stage_buckets: bool


@dataclass(frozen=True, slots=True)
class CurriculumCourseMapDocsSurfaceArtifact:
    surface: CurriculumCourseMapDocsSurface
    image_objects: tuple[CurriculumCourseMapDocsImageObject, ...]


@dataclass(frozen=True, slots=True)
class CurriculumCourseMapDocsSurfaceMaterializationReport:
    source_document_count: int
    materialized_document_count: int
    source_bucket: str
    derived_bucket: str
    raw_asset_id: str
    raw_version_id: str
    source_pdf_key: str
    provider_response_key: str
    layout_elements_key: str
    materialized_document_ids: tuple[str, ...]
    purged_document_ids: tuple[str, ...]
