from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import PurePosixPath

from campus_ingestion_core.curriculum_course_map_docs_surface import (
    CURRICULUM_COURSE_MAP_DOCS_IMAGE_DIRECTORY,
    load_curriculum_course_map_docs_surface,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.object_store import build_reader_asset_artifact_key
from campus_ingestion_core.process_loading import (
    load_default_structured_units,
    normalize_section_path,
)
from campus_ingestion_core.process_shared import StructuredUnit

_SCHEMA_VERSION = "canonical_document_reader_v1"
_CORE_READER_ASSET_FILENAMES = (
    "reader.json",
    "outline.json",
    "meta.json",
    "asset-manifest.json",
)
_SUPPLEMENT_FILENAME_CONTENT_TYPES = {
    "course-maps.json": "application/json",
}


@dataclass(frozen=True, slots=True)
class DocumentReaderAssetPackage:
    assets: dict[str, bytes]


def build_document_reader_asset_package(
    *,
    record: DocumentRegistryRecord,
    canonical_markdown_bytes: bytes,
    document_units_bytes: bytes,
    course_maps_bytes: bytes | None = None,
    course_map_image_objects: dict[str, bytes] | None = None,
) -> DocumentReaderAssetPackage:
    units = tuple(load_default_structured_units(record, document_units_bytes))
    title = _resolve_document_title(
        record=record,
        canonical_markdown_bytes=canonical_markdown_bytes,
        units=units,
    )
    document_slug = _resolve_document_slug(record=record, title=title)
    version_slug = _resolve_version_slug(record)
    canonical_url = _build_canonical_url(
        corpus=record.corpus,
        collection=record.collection,
        document_slug=document_slug,
    )

    sections = _build_reader_sections(units)
    outline_nodes = _build_outline_nodes(units)
    supplements: list[dict[str, str]] = []
    assets: dict[str, bytes] = {}

    if course_maps_bytes is not None:
        supplements.append({"kind": "course_maps", "path": "course-maps.json"})
        course_map_assets = _build_course_map_assets(
            course_maps_bytes=course_maps_bytes,
            course_map_image_objects=course_map_image_objects,
            record=record,
        )
        assets.update(course_map_assets)

    assets["reader.json"] = _json_bytes(
        {
            "schemaVersion": _SCHEMA_VERSION,
            "document": {
                "collection": record.collection,
                "corpus": record.corpus,
                "docId": record.document_id,
                "documentSlug": document_slug,
                "title": title,
                "versionId": record.version_id,
                "versionSlug": version_slug,
                "visibility": _resolve_visibility(record),
            },
            "sections": sections,
            "supplements": supplements,
        }
    )
    assets["outline.json"] = _json_bytes(
        {
            "schemaVersion": _SCHEMA_VERSION,
            "docId": record.document_id,
            "nodes": outline_nodes,
        }
    )
    assets["meta.json"] = _json_bytes(
        {
            "schemaVersion": _SCHEMA_VERSION,
            "canonicalUrl": canonical_url,
            "collection": record.collection,
            "corpus": record.corpus,
            "docId": record.document_id,
            "documentSlug": document_slug,
            "resolvedVersion": {
                "effectiveFrom": record.effective_date,
                "isCurrent": record.is_current,
                "label": "现行版" if record.is_current else "历史版本",
                "versionId": record.version_id,
                "versionSlug": version_slug,
            },
            "title": title,
            "updatedAt": record.ingestion_timestamp,
            "visibility": _resolve_visibility(record),
        }
    )
    assets["asset-manifest.json"] = _json_bytes(
        _build_asset_manifest(
            assets=assets,
            canonical_url=canonical_url,
            record=record,
        )
    )

    return DocumentReaderAssetPackage(assets=assets)


def build_document_reader_publish_entry(
    *,
    record: DocumentRegistryRecord,
    title: str,
    published_asset_names: tuple[str, ...] = _CORE_READER_ASSET_FILENAMES,
) -> dict[str, object]:
    document_slug = _resolve_document_slug(record=record, title=title)
    version_slug = _resolve_version_slug(record)
    delivery_mode = (
        "public_static_asset" if _resolve_visibility(record) == "public" else "gated_asset"
    )
    static_root = "_docs" if delivery_mode == "public_static_asset" else "_gated-docs"
    target_prefix = (
        f"{static_root}/{record.corpus}/{record.collection}/{document_slug}/{version_slug}"
    )
    source_objects: dict[str, str] = {}
    target_objects: dict[str, str] = {}

    for asset_name in published_asset_names:
        source_key, target_key = _resolve_publish_object_labels(asset_name)
        source_objects[source_key] = _build_reader_asset_key(
            record=record,
            asset_name=asset_name,
            title=title,
        )
        target_objects[target_key] = f"{target_prefix}/{asset_name}"

    return {
        "canonicalUrl": _build_canonical_url(
            corpus=record.corpus,
            collection=record.collection,
            document_slug=document_slug,
        ),
        "collection": record.collection,
        "corpus": record.corpus,
        "deliveryMode": delivery_mode,
        "docId": record.document_id,
        "documentSlug": document_slug,
        "sourceObjects": source_objects,
        "targetObjects": target_objects,
        "title": title,
        "updatedAt": record.ingestion_timestamp,
        "versionId": record.version_id,
        "versionSlug": version_slug,
    }


def build_public_docs_sync_manifest(
    *,
    entries: list[dict[str, object]],
    generated_at: str,
) -> dict[str, object]:
    return {
        "entries": [
            entry
            for entry in entries
            if str(entry.get("deliveryMode") or "").strip()
            in ("public_static_asset", "gated_asset")
        ],
        "generatedAt": generated_at,
        "surface": "public_docs",
    }


def _build_reader_sections(units: tuple[StructuredUnit, ...]) -> list[dict[str, object]]:
    sections_by_key: dict[tuple[str, ...], dict[str, object]] = {}
    ordered_keys: list[tuple[str, ...]] = []
    for unit in units:
        section_path = normalize_section_path(unit.anchor) or ("文档正文",)
        section = sections_by_key.get(section_path)
        if section is None:
            section = {
                "anchor": _anchor_for_path(section_path),
                "blocks": [],
                "order": len(ordered_keys) + 1,
                "title": section_path[-1],
            }
            sections_by_key[section_path] = section
            ordered_keys.append(section_path)
        section["blocks"].append(
            {
                "inlineLabels": _build_inline_labels(unit),
                "kind": _resolve_block_kind(unit),
                "rootUnitId": unit.root_unit_id,
                "text": unit.text.strip(),
            }
        )

    return [sections_by_key[key] for key in ordered_keys]


def _build_outline_nodes(units: tuple[StructuredUnit, ...]) -> list[dict[str, object]]:
    nodes: list[dict[str, object]] = []
    seen_paths: set[tuple[str, ...]] = set()
    order = 1
    for unit in units:
        section_path = normalize_section_path(unit.anchor)
        for depth in range(1, len(section_path) + 1):
            current_path = section_path[:depth]
            if current_path in seen_paths:
                continue
            seen_paths.add(current_path)
            nodes.append(
                {
                    "anchor": _anchor_for_path(current_path),
                    "depth": depth,
                    "order": order,
                    "parentAnchor": _anchor_for_path(current_path[:-1]) if depth > 1 else None,
                    "title": current_path[-1],
                }
            )
            order += 1
    return nodes


def _build_asset_manifest(
    *,
    assets: dict[str, bytes],
    canonical_url: str,
    record: DocumentRegistryRecord,
) -> dict[str, object]:
    files: dict[str, dict[str, object]] = {}
    for filename, payload in assets.items():
        files[filename] = {
            "contentType": _content_type_for_filename(filename),
            "sha256": hashlib.sha256(payload).hexdigest(),
            "sizeBytes": len(payload),
        }
    return {
        "schemaVersion": _SCHEMA_VERSION,
        "docId": record.document_id,
        "files": files,
        "readerTarget": {
            "anchor": None,
            "canonicalUrl": canonical_url,
            "docId": record.document_id,
            "highlightRootUnitIds": [],
            "versionId": record.version_id,
        },
        "supplementFiles": [name for name in assets if name not in _CORE_READER_ASSET_FILENAMES],
        "versionId": record.version_id,
    }


def _build_course_map_assets(
    *,
    course_maps_bytes: bytes,
    course_map_image_objects: dict[str, bytes] | None,
    record: DocumentRegistryRecord,
) -> dict[str, bytes]:
    surface = load_curriculum_course_map_docs_surface(course_maps_bytes)
    image_objects = course_map_image_objects or {}
    browser_blocks: list[dict[str, object]] = []
    assets: dict[str, bytes] = {}

    for block in surface.blocks:
        image_name = PurePosixPath(block.image_object_key).name
        image_path = f"{CURRICULUM_COURSE_MAP_DOCS_IMAGE_DIRECTORY}/{image_name}"
        image_bytes = image_objects.get(block.image_object_key)
        if image_bytes is None:
            raise ValueError(f"missing course-map image bytes for {block.image_object_key}")
        assets[image_path] = image_bytes
        browser_blocks.append(
            {
                "blockId": block.block_id,
                "displayStageLabels": list(block.display_stage_labels),
                "edges": [
                    {
                        "edgeId": edge.edge_id,
                        "sourceNodeId": edge.source_node_id,
                        "sourceLabel": edge.source_label,
                        "targetNodeId": edge.target_node_id,
                        "targetLabel": edge.target_label,
                    }
                    for edge in block.edges
                ],
                "extractionNotes": list(block.extraction_notes),
                "imagePath": image_path,
                "mapIndex": block.map_index,
                "nodes": [
                    {
                        "categoryLabel": node.category_label,
                        "nodeId": node.node_id,
                        "nodeLabel": node.node_label,
                        "stageId": node.stage_id,
                        "stageLabel": node.stage_label,
                    }
                    for node in block.nodes
                ],
                "pageNumber": block.page_number,
                "parentHeadingHint": block.parent_heading_hint,
                "regionBBoxProvider": list(block.region_bbox_provider),
                "rowId": block.row_id,
                "status": block.status,
                "title": block.title,
                "titleConfidence": block.title_confidence,
            }
        )

    assets["course-maps.json"] = _json_bytes(
        {
            "blocks": browser_blocks,
            "docId": record.document_id,
            "schemaVersion": "curriculum_course_maps_reader_v1",
            "versionId": record.version_id,
        }
    )
    return assets


def _resolve_document_title(
    *,
    record: DocumentRegistryRecord,
    canonical_markdown_bytes: bytes,
    units: tuple[StructuredUnit, ...],
) -> str:
    markdown = canonical_markdown_bytes.decode("utf-8")
    for line in markdown.splitlines():
        normalized = line.strip()
        if normalized.startswith("# "):
            return normalized[2:].strip()
    for unit in units:
        title = str(unit.metadata.get("title") or "").strip()
        if title:
            return title
        if unit.text.strip():
            return unit.text.strip()
    return _resolve_document_slug(record=record, title=record.document_id)


def _resolve_document_slug(*, record: DocumentRegistryRecord, title: str) -> str:
    object_key = record.document_units_object_key or record.canonical_markdown_object_key or ""
    if object_key:
        path = PurePosixPath(object_key)
        directory_name = path.parent.parent.parent.name
        if "--" in directory_name:
            candidate = directory_name.split("--", 1)[0].strip()
            if candidate:
                return candidate
    return _slugify_label(title) or _slugify_label(record.document_id) or "document"


def _resolve_version_slug(record: DocumentRegistryRecord) -> str:
    year = _resolve_published_year(record)
    suffix = "current" if record.is_current else _slugify_label(record.revision_track)
    return f"{year}-{suffix}"


def _resolve_published_year(record: DocumentRegistryRecord) -> str:
    object_key = record.document_units_object_key or record.canonical_markdown_object_key or ""
    if object_key:
        candidate = PurePosixPath(object_key).parent.name.strip()
        if re.fullmatch(r"(?:19|20)\d{2}|undated", candidate):
            return candidate
    for value in (record.effective_date, record.published_date, record.ingestion_timestamp):
        normalized = str(value or "").strip()
        match = re.search(r"(?:19|20)\d{2}", normalized)
        if match:
            return match.group(0)
    return "undated"


def _resolve_visibility(record: DocumentRegistryRecord) -> str:
    if record.visibility_level.strip():
        return record.visibility_level.strip()
    return "restricted" if record.entitlement_groups else "public"


def _build_canonical_url(*, corpus: str, collection: str, document_slug: str) -> str:
    return f"/docs/{corpus}/{collection}/{document_slug}"


def _build_reader_asset_key(
    *,
    record: DocumentRegistryRecord,
    asset_name: str,
    title: str,
) -> str:
    if asset_name not in _CORE_READER_ASSET_FILENAMES:
        normalized_asset_name = _validate_reader_asset_name(asset_name)
        target = PurePosixPath(
            build_reader_asset_artifact_key(
                corpus=record.corpus,
                collection=record.collection,
                document_id=record.document_id,
                revision_track=record.revision_track,
                version_id=record.version_id,
                asset_name="reader.json",
                title=title,
                year=_resolve_published_year(record),
            )
        )
        return str(target.parent / normalized_asset_name)
    return build_reader_asset_artifact_key(
        corpus=record.corpus,
        collection=record.collection,
        document_id=record.document_id,
        revision_track=record.revision_track,
        version_id=record.version_id,
        asset_name=asset_name,
        title=title,
        year=_resolve_published_year(record),
    )


def _resolve_publish_object_labels(asset_name: str) -> tuple[str, str]:
    core_labels = {
        "asset-manifest.json": ("manifest", "asset-manifest"),
        "meta.json": ("meta", "meta"),
        "outline.json": ("outline", "outline"),
        "reader.json": ("reader", "reader"),
    }
    if asset_name in core_labels:
        return core_labels[asset_name]
    normalized = _validate_reader_asset_name(asset_name)
    return (f"supplement.{normalized}", normalized)


def _validate_reader_asset_name(asset_name: str) -> str:
    normalized = asset_name.strip().strip("/")
    if not normalized:
        raise ValueError("asset_name is required")
    path = PurePosixPath(normalized)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError("asset_name must stay within reader-assets")
    return str(path)


def _anchor_for_path(path: tuple[str, ...]) -> str:
    if not path:
        return "document"
    return "/".join(_slugify_or_hash(part) for part in path)


def _slugify_or_hash(value: str) -> str:
    slug = _slugify_label(value)
    if slug:
        return slug
    digest = hashlib.sha1(value.strip().encode("utf-8")).hexdigest()[:10]
    return f"section-{digest}"


def _slugify_label(value: str) -> str:
    normalized = value.strip().lower()
    if not normalized:
        return ""
    slug = re.sub(r"[^a-z0-9]+", "-", normalized).strip("-")
    return re.sub(r"-{2,}", "-", slug)


def _resolve_block_kind(unit: StructuredUnit) -> str:
    unit_type = unit.unit_type.strip().lower()
    if "heading" in unit_type:
        return "heading"
    if "table" in unit_type:
        return "table"
    if "list" in unit_type:
        return "list"
    return "paragraph"


def _build_inline_labels(unit: StructuredUnit) -> list[str]:
    labels: list[str] = []
    heading_level = unit.metadata.get("heading_level")
    if isinstance(heading_level, int) and heading_level > 0:
        labels.append(f"h{heading_level}")
    page_start = unit.anchor.get("page_start")
    page_end = unit.anchor.get("page_end")
    if isinstance(page_start, int) and isinstance(page_end, int):
        labels.append(f"p{page_start}" if page_start == page_end else f"p{page_start}-{page_end}")
    return labels


def _content_type_for_filename(filename: str) -> str:
    if filename.endswith(".png"):
        return "image/png"
    return _SUPPLEMENT_FILENAME_CONTENT_TYPES.get(filename, "application/json")


def _json_bytes(payload: object) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


__all__ = [
    "DocumentReaderAssetPackage",
    "build_document_reader_asset_package",
    "build_document_reader_publish_entry",
    "build_public_docs_sync_manifest",
]
