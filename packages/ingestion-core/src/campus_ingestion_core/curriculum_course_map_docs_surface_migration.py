from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Protocol

from campus_ingestion_core.curriculum_course_map_docs_ids import (
    resolve_edge_id,
    resolve_node_id,
    resolve_stage_id,
    resolve_unique_node_id_for_label,
)
from campus_ingestion_core.curriculum_course_map_docs_surface import (
    build_curriculum_course_map_docs_image_object_key,
    build_curriculum_course_map_docs_surface_object_key,
    load_curriculum_course_map_docs_surface,
    serialize_curriculum_course_map_docs_surface,
)
from campus_ingestion_core.curriculum_course_map_docs_surface_models import (
    CURRICULUM_COURSE_MAP_DOCS_SURFACE_SCHEMA_VERSION,
    CurriculumCourseMapDocsBlock,
    CurriculumCourseMapDocsSurface,
    PublishedCourseMapEdge,
    PublishedCourseMapNode,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe import (
    DEFAULT_CURRICULUM_RAW_ASSET_ID,
    DEFAULT_CURRICULUM_RAW_VERSION_ID,
)
from campus_ingestion_core.readable_text_normalization import normalize_readable_text

_LEGACY_READER_SURFACE_SUFFIX = "/reader-assets/course-maps.json"
_SUPPORTED_LEGACY_SCHEMAS = frozenset(
    {
        "curriculum_course_map_docs_surface_v1",
        "curriculum_course_maps_reader_v1",
        CURRICULUM_COURSE_MAP_DOCS_SURFACE_SCHEMA_VERSION,
    }
)


class CurriculumCourseMapSurfaceMigrationObjectStore(Protocol):
    def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]: ...

    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class CurriculumCourseMapSurfaceMigrationReport:
    legacy_surface_count: int
    migrated_surface_count: int
    migrated_image_count: int
    target_surface_keys: tuple[str, ...]


def migrate_legacy_curriculum_course_map_docs_surfaces(
    *,
    bucket: str,
    generated_at: str,
    object_store: CurriculumCourseMapSurfaceMigrationObjectStore,
    legacy_surface_keys: Sequence[str] | None = None,
    prefix: str = "curriculum/documents/curriculum_plan/",
) -> CurriculumCourseMapSurfaceMigrationReport:
    selected_keys = tuple(
        legacy_surface_keys or _discover_legacy_surface_keys(object_store, bucket, prefix)
    )
    target_surface_keys: list[str] = []
    migrated_image_count = 0
    for legacy_surface_key in selected_keys:
        migration = _migrate_one_surface(
            bucket=bucket,
            generated_at=generated_at,
            legacy_surface_key=legacy_surface_key,
            object_store=object_store,
        )
        target_surface_keys.append(migration.target_surface_key)
        migrated_image_count += migration.image_count
    return CurriculumCourseMapSurfaceMigrationReport(
        legacy_surface_count=len(selected_keys),
        migrated_surface_count=len(target_surface_keys),
        migrated_image_count=migrated_image_count,
        target_surface_keys=tuple(target_surface_keys),
    )


@dataclass(frozen=True, slots=True)
class _SurfaceMigration:
    target_surface_key: str
    image_count: int


def _discover_legacy_surface_keys(
    object_store: CurriculumCourseMapSurfaceMigrationObjectStore,
    bucket: str,
    prefix: str,
) -> tuple[str, ...]:
    return tuple(
        sorted(
            key
            for key in object_store.list_keys(bucket=bucket, prefix=prefix)
            if key.endswith(_LEGACY_READER_SURFACE_SUFFIX)
        )
    )


def _migrate_one_surface(
    *,
    bucket: str,
    generated_at: str,
    legacy_surface_key: str,
    object_store: CurriculumCourseMapSurfaceMigrationObjectStore,
) -> _SurfaceMigration:
    document_units_key = _document_units_key_from_legacy_surface_key(legacy_surface_key)
    target_surface_key = build_curriculum_course_map_docs_surface_object_key(document_units_key)
    legacy_payload = json.loads(
        object_store.get_bytes(bucket=bucket, key=legacy_surface_key).decode("utf-8")
    )
    if not isinstance(legacy_payload, dict):
        raise ValueError(f"legacy course-map surface must be a JSON object: {legacy_surface_key}")
    schema_version = str(legacy_payload.get("schemaVersion") or "").strip()
    if schema_version not in _SUPPORTED_LEGACY_SCHEMAS:
        raise ValueError(f"unsupported legacy course-map surface schema: {schema_version}")
    blocks: list[CurriculumCourseMapDocsBlock] = []
    image_count = 0
    for block_payload in legacy_payload.get("blocks") or ():
        block, source_image_key = _coerce_legacy_block(
            block_payload=block_payload,
            legacy_surface_key=legacy_surface_key,
            target_surface_key=target_surface_key,
        )
        image_bytes = object_store.get_bytes(bucket=bucket, key=source_image_key)
        object_store.put_bytes(
            bucket=bucket,
            key=block.image_object_key,
            data=image_bytes,
            content_type="image/png",
        )
        image_count += 1
        blocks.append(block)
    surface = CurriculumCourseMapDocsSurface(
        schema_version=CURRICULUM_COURSE_MAP_DOCS_SURFACE_SCHEMA_VERSION,
        generated_at=generated_at,
        document_id=_coerce_document_id(legacy_payload, legacy_surface_key),
        document_title=_coerce_document_title(legacy_payload, legacy_surface_key),
        raw_asset_id=str(
            legacy_payload.get("rawAssetId") or DEFAULT_CURRICULUM_RAW_ASSET_ID
        ).strip(),
        raw_version_id=str(
            legacy_payload.get("rawVersionId") or DEFAULT_CURRICULUM_RAW_VERSION_ID
        ).strip(),
        blocks=tuple(blocks),
    )
    surface_bytes = serialize_curriculum_course_map_docs_surface(surface)
    load_curriculum_course_map_docs_surface(surface_bytes)
    object_store.put_bytes(
        bucket=bucket,
        key=target_surface_key,
        data=surface_bytes,
        content_type="application/json",
    )
    return _SurfaceMigration(target_surface_key=target_surface_key, image_count=image_count)


def _document_units_key_from_legacy_surface_key(legacy_surface_key: str) -> str:
    if not legacy_surface_key.endswith(_LEGACY_READER_SURFACE_SUFFIX):
        raise ValueError(f"legacy surface key must end with {_LEGACY_READER_SURFACE_SUFFIX}")
    return f"{legacy_surface_key.removesuffix(_LEGACY_READER_SURFACE_SUFFIX)}/document-units.jsonl"


def _coerce_legacy_block(
    *,
    block_payload: object,
    legacy_surface_key: str,
    target_surface_key: str,
) -> tuple[CurriculumCourseMapDocsBlock, str]:
    if not isinstance(block_payload, dict):
        raise ValueError(f"course-map block must be a JSON object: {legacy_surface_key}")
    block_id = str(block_payload.get("blockId") or "").strip()
    if not block_id:
        raise ValueError(f"blockId is required: {legacy_surface_key}")
    source_image_key = _resolve_legacy_image_key(
        block_payload=block_payload,
        legacy_surface_key=legacy_surface_key,
    )
    target_image_key = build_curriculum_course_map_docs_image_object_key(
        surface_object_key=target_surface_key,
        block_id=block_id,
    )
    nodes, edges, notes = _coerce_published_payload(block_payload)
    extraction_notes = tuple(
        dict.fromkeys(
            [
                *(str(value).strip() for value in block_payload.get("extractionNotes") or ()),
                *notes,
            ]
        )
    )
    return (
        CurriculumCourseMapDocsBlock(
            block_id=block_id,
            page_number=int(block_payload.get("pageNumber") or 0),
            row_id=str(block_payload.get("rowId") or "").strip(),
            map_index=int(block_payload.get("mapIndex") or 0),
            title=normalize_readable_text(str(block_payload.get("title") or "").strip()),
            status=str(block_payload.get("status") or "").strip(),
            title_confidence=str(block_payload.get("titleConfidence") or "").strip(),
            parent_heading_hint=normalize_readable_text(
                str(block_payload.get("parentHeadingHint") or "").strip()
            ),
            display_stage_labels=tuple(
                normalize_readable_text(str(value).strip())
                for value in block_payload.get("displayStageLabels") or ()
                if str(value).strip()
            ),
            nodes=nodes,
            edges=edges,
            extraction_notes=extraction_notes,
            image_object_key=target_image_key,
            region_bbox_provider=tuple(
                float(value) for value in block_payload.get("regionBBoxProvider") or ()
            ),
        ),
        source_image_key,
    )


def _coerce_published_payload(
    block_payload: dict[str, object],
) -> tuple[tuple[PublishedCourseMapNode, ...], tuple[PublishedCourseMapEdge, ...], tuple[str, ...]]:
    notes: list[str] = []
    nodes: list[PublishedCourseMapNode] = []
    for index, raw_node in enumerate(block_payload.get("nodes") or ()):
        if not isinstance(raw_node, dict):
            continue
        node_label = normalize_readable_text(
            str(raw_node.get("node_label") or raw_node.get("nodeLabel") or "").strip()
        )
        stage_label = normalize_readable_text(
            str(raw_node.get("stage_label") or raw_node.get("stageLabel") or "").strip()
        )
        category_label = normalize_readable_text(
            str(raw_node.get("category_label") or raw_node.get("categoryLabel") or "").strip()
        )
        stage_id = resolve_stage_id(
            stage_id=str(raw_node.get("stage_id") or raw_node.get("stageId") or "").strip(),
            stage_label=stage_label,
        )
        node_id = resolve_node_id(
            node_id=str(raw_node.get("node_id") or raw_node.get("nodeId") or "").strip(),
            stage_id=stage_id,
            stage_label=stage_label,
            node_label=node_label,
            occurrence_index=index,
        )
        nodes.append(
            PublishedCourseMapNode(
                node_id=node_id,
                node_label=node_label,
                stage_id=stage_id,
                stage_label=stage_label,
                category_label=category_label,
            )
        )
    node_by_id = {node.node_id: node for node in nodes}
    node_ids_by_label: dict[str, list[str]] = {}
    for node in nodes:
        node_ids_by_label.setdefault(node.node_label, []).append(node.node_id)
    edges: list[PublishedCourseMapEdge] = []
    for index, raw_edge in enumerate(block_payload.get("edges") or ()):
        if not isinstance(raw_edge, dict):
            continue
        source_label = normalize_readable_text(
            str(raw_edge.get("source_label") or raw_edge.get("sourceLabel") or "").strip()
        )
        target_label = normalize_readable_text(
            str(raw_edge.get("target_label") or raw_edge.get("targetLabel") or "").strip()
        )
        source_node_id = str(
            raw_edge.get("source_node_id") or raw_edge.get("sourceNodeId") or ""
        ).strip()
        target_node_id = str(
            raw_edge.get("target_node_id") or raw_edge.get("targetNodeId") or ""
        ).strip()
        if not source_node_id:
            source_node_id = resolve_unique_node_id_for_label(
                label=source_label,
                node_ids_by_label=node_ids_by_label,
                notes=notes,
                endpoint_name="source",
            )
        if not target_node_id:
            target_node_id = resolve_unique_node_id_for_label(
                label=target_label,
                node_ids_by_label=node_ids_by_label,
                notes=notes,
                endpoint_name="target",
            )
        source_node = node_by_id.get(source_node_id)
        target_node = node_by_id.get(target_node_id)
        if source_node is None or target_node is None:
            notes.append("存在无法定位到唯一课程节点的关系，已从结构化关系中移除。")
            continue
        edges.append(
            PublishedCourseMapEdge(
                edge_id=resolve_edge_id(
                    edge_id=str(raw_edge.get("edge_id") or raw_edge.get("edgeId") or "").strip(),
                    source_node_id=source_node_id,
                    target_node_id=target_node_id,
                    occurrence_index=index,
                ),
                source_node_id=source_node_id,
                source_label=source_label or source_node.node_label,
                target_node_id=target_node_id,
                target_label=target_label or target_node.node_label,
            )
        )
    return tuple(nodes), tuple(edges), tuple(dict.fromkeys(notes))


def _resolve_legacy_image_key(*, block_payload: dict[str, object], legacy_surface_key: str) -> str:
    reference = str(
        block_payload.get("imageObjectKey") or block_payload.get("imagePath") or ""
    ).strip()
    if not reference:
        raise ValueError(
            f"course-map block is missing imageObjectKey/imagePath: {legacy_surface_key}"
        )
    if reference.startswith(("curriculum/", "regulations/")):
        return reference
    normalized_reference = reference.strip("/")
    if ".." in PurePosixPath(normalized_reference).parts:
        raise ValueError(f"course-map image path escapes reader-assets directory: {reference}")
    return str(PurePosixPath(legacy_surface_key).parent / normalized_reference)


def _coerce_document_id(payload: dict[str, object], legacy_surface_key: str) -> str:
    document_id = str(payload.get("documentId") or payload.get("docId") or "").strip()
    if document_id:
        return document_id
    return f"curriculum:{_document_slug_from_legacy_key(legacy_surface_key)}"


def _coerce_document_title(payload: dict[str, object], legacy_surface_key: str) -> str:
    title = str(payload.get("documentTitle") or "").strip()
    if title:
        return normalize_readable_text(title)
    return normalize_readable_text(_document_slug_from_legacy_key(legacy_surface_key))


def _document_slug_from_legacy_key(legacy_surface_key: str) -> str:
    parts = PurePosixPath(legacy_surface_key).parts
    if len(parts) < 6:
        raise ValueError(f"legacy surface key is not under a document prefix: {legacy_surface_key}")
    document_segment = parts[3]
    return document_segment.split("--", 1)[0].strip() or document_segment


__all__ = (
    "CurriculumCourseMapSurfaceMigrationObjectStore",
    "CurriculumCourseMapSurfaceMigrationReport",
    "migrate_legacy_curriculum_course_map_docs_surfaces",
)
