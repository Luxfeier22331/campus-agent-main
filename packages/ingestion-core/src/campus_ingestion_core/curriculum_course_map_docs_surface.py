from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath

from campus_ingestion_core.artifacts import DOCUMENT_UNITS_FILENAME
from campus_ingestion_core.curriculum_course_map_docs_ids import (
    resolve_edge_id,
    resolve_node_id,
    resolve_stage_id,
    resolve_unique_node_id_for_label,
)
from campus_ingestion_core.curriculum_course_map_docs_surface_models import (
    CURRICULUM_COURSE_MAP_DOCS_SURFACE_SCHEMA_VERSION,
    CurriculumCourseMapDocsBlock,
    CurriculumCourseMapDocsImageObject,
    CurriculumCourseMapDocsSurface,
    CurriculumCourseMapDocsSurfaceArtifact,
    CurriculumCourseMapDocsSurfaceMaterializationReport,
    ObjectStoreAdmin,
    PublishedCourseMapEdge,
    PublishedCourseMapNode,
    _PublishedCourseMapPayload,
)
from campus_ingestion_core.curriculum_course_map_docs_surface_runtime import (
    _build_inventory_sample_id,
    _build_object_store_from_env,
    _normalize_document_ids,
    _resolve_curriculum_plan_document_units_keys,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe import (
    DEFAULT_CURRICULUM_RAW_ASSET_ID,
    DEFAULT_CURRICULUM_RAW_VERSION_ID,
    DEFAULT_MAX_INFLIGHT_PAGES,
    DEFAULT_MAX_REQUEST_ATTEMPTS,
    DEFAULT_PROMPT_RUNTIME_TRANSPORT,
    DEFAULT_SPLIT_MANIFEST_PATH,
    CourseMapFinding,
    CurriculumCourseMapPageProbe,
    CurriculumCourseMapRenderedSample,
    DetectedCourseMapRegion,
    _build_rendered_region,
    _normalize_prompt_runtime_transport,
    _run_curriculum_course_map_probe_runs_async,
    build_curriculum_course_map_inventory,
    default_curriculum_layout_elements_key,
    default_curriculum_provider_response_key,
    default_curriculum_source_pdf_key,
    render_curriculum_course_map_sample,
)
from campus_ingestion_core.readable_text_normalization import normalize_readable_text

CURRICULUM_COURSE_MAP_DOCS_SURFACE_FILENAME = "course-maps.json"
CURRICULUM_COURSE_MAP_DOCS_IMAGE_DIRECTORY = "course-maps"
CURRICULUM_COURSE_MAP_DOCS_SURFACE_DIRECTORY = "docs-surfaces"


def build_curriculum_course_map_docs_surface_object_key(document_units_key: str) -> str:
    path = PurePosixPath(document_units_key)
    if path.name != DOCUMENT_UNITS_FILENAME:
        raise ValueError("document_units_key must point to document-units.jsonl")
    return str(
        path.parent
        / CURRICULUM_COURSE_MAP_DOCS_SURFACE_DIRECTORY
        / CURRICULUM_COURSE_MAP_DOCS_SURFACE_FILENAME
    )


def build_curriculum_course_map_docs_image_object_key(
    *,
    surface_object_key: str,
    block_id: str,
) -> str:
    path = PurePosixPath(surface_object_key)
    if path.name != CURRICULUM_COURSE_MAP_DOCS_SURFACE_FILENAME:
        raise ValueError("surface_object_key must point to course-maps.json")
    return str(path.parent / CURRICULUM_COURSE_MAP_DOCS_IMAGE_DIRECTORY / f"{block_id}.png")


def load_curriculum_course_map_docs_surface(payload: bytes) -> CurriculumCourseMapDocsSurface:
    raw = json.loads(payload.decode("utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("course-map docs surface payload must be a JSON object")
    return CurriculumCourseMapDocsSurface(
        schema_version=str(raw.get("schemaVersion") or "").strip(),
        generated_at=str(raw.get("generatedAt") or "").strip(),
        document_id=str(raw.get("documentId") or "").strip(),
        document_title=str(raw.get("documentTitle") or "").strip(),
        raw_asset_id=str(raw.get("rawAssetId") or "").strip(),
        raw_version_id=str(raw.get("rawVersionId") or "").strip(),
        blocks=tuple(_coerce_docs_block(item) for item in raw.get("blocks") or ()),
    )


def serialize_curriculum_course_map_docs_surface(
    surface: CurriculumCourseMapDocsSurface,
) -> bytes:
    payload = {
        "schemaVersion": surface.schema_version,
        "generatedAt": surface.generated_at,
        "documentId": surface.document_id,
        "documentTitle": surface.document_title,
        "rawAssetId": surface.raw_asset_id,
        "rawVersionId": surface.raw_version_id,
        "blocks": [
            {
                "blockId": block.block_id,
                "pageNumber": block.page_number,
                "rowId": block.row_id,
                "mapIndex": block.map_index,
                "title": block.title,
                "status": block.status,
                "titleConfidence": block.title_confidence,
                "parentHeadingHint": block.parent_heading_hint,
                "displayStageLabels": list(block.display_stage_labels),
                "nodes": [asdict(node) for node in block.nodes],
                "edges": [asdict(edge) for edge in block.edges],
                "extractionNotes": list(block.extraction_notes),
                "imageObjectKey": block.image_object_key,
                "regionBBoxProvider": list(block.region_bbox_provider),
            }
            for block in surface.blocks
        ],
    }
    return (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def build_curriculum_course_map_docs_surface_artifact(
    *,
    document_id: str,
    document_title: str,
    raw_asset_id: str,
    raw_version_id: str,
    page_probes: Sequence[CurriculumCourseMapPageProbe],
    rendered_samples: Mapping[str, CurriculumCourseMapRenderedSample],
    surface_object_key: str,
    generated_at: str | None = None,
) -> CurriculumCourseMapDocsSurfaceArtifact:
    blocks: list[CurriculumCourseMapDocsBlock] = []
    image_objects: list[CurriculumCourseMapDocsImageObject] = []
    ordered_probes = sorted(page_probes, key=lambda item: (item.page_number, item.sample_id))
    for page_probe in ordered_probes:
        rendered_sample = rendered_samples.get(page_probe.sample_id)
        if rendered_sample is None:
            raise ValueError(f"missing rendered sample for {page_probe.sample_id}")
        for block, image_object in _build_page_probe_blocks(
            page_probe=page_probe,
            rendered_sample=rendered_sample,
            surface_object_key=surface_object_key,
        ):
            blocks.append(block)
            image_objects.append(image_object)
    surface = CurriculumCourseMapDocsSurface(
        schema_version=CURRICULUM_COURSE_MAP_DOCS_SURFACE_SCHEMA_VERSION,
        generated_at=generated_at or datetime.now(UTC).isoformat(),
        document_id=document_id,
        document_title=document_title,
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        blocks=tuple(
            sorted(blocks, key=lambda item: (item.page_number, item.row_id, item.map_index))
        ),
    )
    return CurriculumCourseMapDocsSurfaceArtifact(
        surface=surface,
        image_objects=tuple(
            sorted(
                image_objects,
                key=lambda item: next(
                    block.block_id for block in surface.blocks if block.image_object_key == item.key
                ),
            )
        ),
    )


def materialize_curriculum_course_map_docs_surface(
    *,
    source: Mapping[str, str],
    source_bucket: str,
    derived_bucket: str,
    object_store: ObjectStoreAdmin | None = None,
    split_manifest_path: Path = DEFAULT_SPLIT_MANIFEST_PATH,
    source_pdf_key: str = default_curriculum_source_pdf_key(),
    provider_response_key: str = default_curriculum_provider_response_key(),
    layout_elements_key: str = default_curriculum_layout_elements_key(),
    pdf_bytes: bytes | None = None,
    provider_response_bytes: bytes | None = None,
    layout_elements_bytes: bytes | None = None,
    source_document_ids: Sequence[str] | None = None,
    prompt_transport: str | None = None,
    max_inflight_pages: int = DEFAULT_MAX_INFLIGHT_PAGES,
    max_request_attempts: int = DEFAULT_MAX_REQUEST_ATTEMPTS,
    output_dir: Path | None = None,
    resume: bool = False,
) -> CurriculumCourseMapDocsSurfaceMaterializationReport:
    if max_inflight_pages <= 0:
        raise ValueError("max_inflight_pages must be greater than zero")
    if max_request_attempts <= 0:
        raise ValueError("max_request_attempts must be greater than zero")
    if resume and output_dir is None:
        raise ValueError("output_dir is required when resume is enabled")
    runtime_object_store = object_store or _build_object_store_from_env(source)
    if pdf_bytes is None:
        pdf_bytes = runtime_object_store.get_bytes(bucket=source_bucket, key=source_pdf_key)
    if provider_response_bytes is None:
        provider_response_bytes = runtime_object_store.get_bytes(
            bucket=source_bucket,
            key=provider_response_key,
        )
    if layout_elements_bytes is None:
        layout_elements_bytes = runtime_object_store.get_bytes(
            bucket=source_bucket,
            key=layout_elements_key,
        )
    inventory = build_curriculum_course_map_inventory(
        split_manifest_bytes=Path(split_manifest_path).read_bytes(),
        provider_response_bytes=provider_response_bytes,
        layout_elements_bytes=layout_elements_bytes,
        source_pdf_key=source_pdf_key,
        provider_response_key=provider_response_key,
        layout_elements_key=layout_elements_key,
        raw_asset_id=DEFAULT_CURRICULUM_RAW_ASSET_ID,
        raw_version_id=DEFAULT_CURRICULUM_RAW_VERSION_ID,
    )
    document_units_keys = _resolve_curriculum_plan_document_units_keys(
        object_store=runtime_object_store,
        bucket=derived_bucket,
    )
    requested_document_ids = _normalize_document_ids(source_document_ids)
    document_ids_to_process = (
        requested_document_ids if requested_document_ids else tuple(sorted(document_units_keys))
    )
    missing_document_ids = [
        document_id
        for document_id in document_ids_to_process
        if document_id not in document_units_keys
    ]
    if missing_document_ids:
        raise ValueError(
            "missing curriculum_plan document-units key for: " + ", ".join(missing_document_ids)
        )
    selected_inventory = tuple(
        entry for entry in inventory if entry.document_id in set(document_ids_to_process)
    )
    rendered_samples = {
        sample.sample_id: sample
        for sample in (
            render_curriculum_course_map_sample(
                pdf_bytes=pdf_bytes,
                entry=entry,
                sample_id=_build_inventory_sample_id(entry),
                output_dir=(Path(output_dir) / "renders") if output_dir is not None else None,
            )
            for entry in selected_inventory
        )
    }
    probe_run = asyncio.run(
        _run_curriculum_course_map_probe_runs_async(
            source=dict(source),
            rendered_samples=tuple(rendered_samples.values()),
            output_dir=Path(output_dir) if output_dir is not None else None,
            prompt_runs=1,
            prompt_transport=_normalize_prompt_runtime_transport(
                prompt_transport
                or source.get("PROMPT_RUNTIME_TRANSPORT")
                or DEFAULT_PROMPT_RUNTIME_TRANSPORT
            ),
            max_inflight_pages=max_inflight_pages,
            max_request_attempts=max_request_attempts,
            resume=resume,
        )
    )[0]
    probes_by_document: dict[str, list[CurriculumCourseMapPageProbe]] = {}
    for page in probe_run.pages:
        probes_by_document.setdefault(page.document_id, []).append(page)

    materialized_document_ids: list[str] = []
    purged_document_ids: list[str] = []
    for document_id in document_ids_to_process:
        document_units_key = document_units_keys[document_id]
        surface_object_key = build_curriculum_course_map_docs_surface_object_key(document_units_key)
        _purge_course_map_docs_surface_assets(
            object_store=runtime_object_store,
            bucket=derived_bucket,
            surface_object_key=surface_object_key,
        )
        purged_document_ids.append(document_id)
        page_probes = probes_by_document.get(document_id) or []
        if not page_probes:
            continue
        artifact = build_curriculum_course_map_docs_surface_artifact(
            document_id=document_id,
            document_title=page_probes[0].document_title,
            raw_asset_id=DEFAULT_CURRICULUM_RAW_ASSET_ID,
            raw_version_id=DEFAULT_CURRICULUM_RAW_VERSION_ID,
            page_probes=page_probes,
            rendered_samples=rendered_samples,
            surface_object_key=surface_object_key,
        )
        runtime_object_store.put_bytes(
            bucket=derived_bucket,
            key=surface_object_key,
            data=serialize_curriculum_course_map_docs_surface(artifact.surface),
            content_type="application/json",
        )
        for image_object in artifact.image_objects:
            runtime_object_store.put_bytes(
                bucket=derived_bucket,
                key=image_object.key,
                data=image_object.image_bytes,
                content_type="image/png",
            )
        materialized_document_ids.append(document_id)

    return CurriculumCourseMapDocsSurfaceMaterializationReport(
        source_document_count=len(document_ids_to_process),
        materialized_document_count=len(materialized_document_ids),
        source_bucket=source_bucket,
        derived_bucket=derived_bucket,
        raw_asset_id=DEFAULT_CURRICULUM_RAW_ASSET_ID,
        raw_version_id=DEFAULT_CURRICULUM_RAW_VERSION_ID,
        source_pdf_key=source_pdf_key,
        provider_response_key=provider_response_key,
        layout_elements_key=layout_elements_key,
        materialized_document_ids=tuple(materialized_document_ids),
        purged_document_ids=tuple(purged_document_ids),
    )


def _build_page_probe_blocks(
    *,
    page_probe: CurriculumCourseMapPageProbe,
    rendered_sample: CurriculumCourseMapRenderedSample,
    surface_object_key: str,
) -> tuple[tuple[CurriculumCourseMapDocsBlock, CurriculumCourseMapDocsImageObject], ...]:
    findings_by_index = {finding.map_index: finding for finding in page_probe.course_maps}
    blocks: list[tuple[CurriculumCourseMapDocsBlock, CurriculumCourseMapDocsImageObject]] = []
    global_notes = list(page_probe.global_manual_review_notes)
    for detected_region in page_probe.detected_maps:
        finding = findings_by_index.get(detected_region.map_index)
        rendered_region = _build_rendered_region(
            rendered_sample=rendered_sample,
            detected_region=detected_region,
            output_dir=None,
        )
        block_id = _build_docs_block_id(
            page_number=page_probe.page_number,
            row_id=rendered_sample.row_id,
            map_index=detected_region.map_index,
        )
        image_object_key = build_curriculum_course_map_docs_image_object_key(
            surface_object_key=surface_object_key,
            block_id=block_id,
        )
        extraction_notes = _build_extraction_notes(
            detected_region=detected_region,
            finding=finding,
            global_notes=global_notes,
        )
        published_payload = _build_published_course_map_payload(finding=finding)
        extraction_notes = tuple(dict.fromkeys([*extraction_notes, *published_payload.notes]))
        status = _resolve_block_status(
            detected_region=detected_region,
            finding=finding,
            extraction_notes=extraction_notes,
            has_stage_buckets=published_payload.has_stage_buckets,
        )
        blocks.append(
            (
                CurriculumCourseMapDocsBlock(
                    block_id=block_id,
                    page_number=page_probe.page_number,
                    row_id=rendered_sample.row_id,
                    map_index=detected_region.map_index,
                    title=_resolve_block_title(
                        detected_region=detected_region,
                        finding=finding,
                        page_number=page_probe.page_number,
                        parent_heading_hint=page_probe.parent_heading_hint,
                    ),
                    status=status,
                    title_confidence=detected_region.title_confidence,
                    parent_heading_hint=page_probe.parent_heading_hint,
                    display_stage_labels=_resolve_stage_labels(finding=finding),
                    nodes=published_payload.nodes,
                    edges=published_payload.edges,
                    extraction_notes=extraction_notes,
                    image_object_key=image_object_key,
                    region_bbox_provider=detected_region.region_bbox_provider,
                ),
                CurriculumCourseMapDocsImageObject(
                    key=image_object_key,
                    image_bytes=rendered_region.crop_png,
                ),
            )
        )
    return tuple(blocks)


def _build_published_course_map_payload(
    *, finding: CourseMapFinding | None
) -> _PublishedCourseMapPayload:
    if finding is None or not finding.nodes:
        return _PublishedCourseMapPayload(nodes=(), edges=(), notes=(), has_stage_buckets=False)
    notes: list[str] = []
    nodes: list[PublishedCourseMapNode] = []
    for index, node in enumerate(finding.nodes):
        node_label = normalize_readable_text(node.node_label.strip())
        stage_label = normalize_readable_text(node.stage_label.strip())
        category_label = normalize_readable_text(node.category_label.strip())
        stage_id = resolve_stage_id(stage_id=node.stage_id, stage_label=stage_label)
        node_id = resolve_node_id(
            node_id=node.node_id,
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
    for index, edge in enumerate(finding.edges):
        source_node_id = edge.source_node_id.strip()
        target_node_id = edge.target_node_id.strip()
        source_label = normalize_readable_text(edge.source_label.strip())
        target_label = normalize_readable_text(edge.target_label.strip())
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
                    edge_id=edge.edge_id,
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
    has_stage_buckets = any(node.stage_label.strip() for node in nodes)
    if not has_stage_buckets:
        notes.append("未识别到可用于阅读分组的阶段信息，当前仅发布原始区域图。")
    return _PublishedCourseMapPayload(
        nodes=tuple(nodes),
        edges=tuple(edges),
        notes=tuple(dict.fromkeys(notes)),
        has_stage_buckets=has_stage_buckets,
    )


def _purge_course_map_docs_surface_assets(
    *,
    object_store: ObjectStoreAdmin,
    bucket: str,
    surface_object_key: str,
) -> None:
    surface_path = PurePosixPath(surface_object_key)
    if surface_path.name != CURRICULUM_COURSE_MAP_DOCS_SURFACE_FILENAME:
        raise ValueError("surface_object_key must point to course-maps.json")
    object_store.delete_prefix(bucket=bucket, prefix=surface_object_key)
    object_store.delete_prefix(
        bucket=bucket,
        prefix=str(surface_path.parent / CURRICULUM_COURSE_MAP_DOCS_IMAGE_DIRECTORY) + "/",
    )


def _build_docs_block_id(*, page_number: int, row_id: str, map_index: int) -> str:
    safe_row_id = "".join(ch if ch.isalnum() else "-" for ch in row_id.strip()).strip("-")
    return f"page-{page_number:04d}-{safe_row_id or 'row'}-map-{map_index:02d}"


def _resolve_block_title(
    *,
    detected_region: DetectedCourseMapRegion,
    finding: CourseMapFinding | None,
    page_number: int,
    parent_heading_hint: str,
) -> str:
    for value in (
        finding.map_title if finding is not None else None,
        detected_region.map_title,
        parent_heading_hint,
    ):
        text = str(value or "").strip()
        if text:
            return normalize_readable_text(text)
    return normalize_readable_text(f"课程地图（第 {page_number} 页）")


def _resolve_stage_labels(*, finding: CourseMapFinding | None) -> tuple[str, ...]:
    if finding is None:
        return ()
    if finding.stage_labels:
        return tuple(
            dict.fromkeys(
                normalize_readable_text(label.strip())
                for label in finding.stage_labels
                if label.strip()
            )
        )
    return tuple(
        dict.fromkeys(
            normalize_readable_text(node.stage_label.strip())
            for node in finding.nodes
            if node.stage_label.strip()
        )
    )


def _build_extraction_notes(
    *,
    detected_region: DetectedCourseMapRegion,
    finding: CourseMapFinding | None,
    global_notes: Sequence[str],
) -> tuple[str, ...]:
    notes = [
        *(_normalize_review_note(note) for note in detected_region.manual_review_notes),
        *(
            _normalize_review_note(note)
            for note in (finding.manual_review_notes if finding is not None else ())
        ),
        *(_normalize_review_note(note) for note in global_notes),
    ]
    notes = [note for note in notes if note]
    if finding is None or not finding.nodes:
        notes.append("自动抽取未返回可发布的课程节点，当前仅保留原始区域图。")
    return tuple(dict.fromkeys(notes))


def _normalize_review_note(note: str) -> str:
    text = str(note or "").strip()
    if not text:
        return ""
    lowered = text.lower()
    if lowered.startswith("image ") and "course-map diagram" in lowered:
        return "当前裁切区域仅识别到 1 张完整课程地图，未拆分出更多独立子图。"
    if "detected map region" in lowered and "clearly visible title" in lowered:
        return "至少有一个检测到的课程地图区域标题不够清晰。"
    if _contains_cjk(text):
        return normalize_readable_text(text)
    return ""


def _contains_cjk(text: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


def _resolve_block_status(
    *,
    detected_region: DetectedCourseMapRegion,
    finding: CourseMapFinding | None,
    extraction_notes: Sequence[str],
    has_stage_buckets: bool,
) -> str:
    if finding is None or not finding.nodes:
        return "failed"
    if not has_stage_buckets:
        return "failed"
    if detected_region.title_confidence != "visible" or extraction_notes:
        return "partial"
    return "ready"


def _coerce_docs_block(payload: object) -> CurriculumCourseMapDocsBlock:
    if not isinstance(payload, dict):
        raise ValueError("course-map docs block must be a JSON object")
    return CurriculumCourseMapDocsBlock(
        block_id=str(payload.get("blockId") or "").strip(),
        page_number=int(payload.get("pageNumber") or 0),
        row_id=str(payload.get("rowId") or "").strip(),
        map_index=int(payload.get("mapIndex") or 0),
        title=str(payload.get("title") or "").strip(),
        status=str(payload.get("status") or "").strip(),
        title_confidence=str(payload.get("titleConfidence") or "").strip(),
        parent_heading_hint=str(payload.get("parentHeadingHint") or "").strip(),
        display_stage_labels=tuple(
            str(value).strip() for value in payload.get("displayStageLabels") or ()
        ),
        nodes=tuple(
            PublishedCourseMapNode(
                node_id=str(item.get("node_id") or item.get("nodeId") or "").strip(),
                node_label=str(item.get("node_label") or "").strip(),
                stage_id=str(item.get("stage_id") or item.get("stageId") or "").strip(),
                stage_label=str(item.get("stage_label") or "").strip(),
                category_label=str(item.get("category_label") or "").strip(),
            )
            for item in payload.get("nodes") or ()
            if isinstance(item, dict)
        ),
        edges=tuple(
            PublishedCourseMapEdge(
                edge_id=str(item.get("edge_id") or item.get("edgeId") or "").strip(),
                source_node_id=str(
                    item.get("source_node_id") or item.get("sourceNodeId") or ""
                ).strip(),
                source_label=str(item.get("source_label") or "").strip(),
                target_node_id=str(
                    item.get("target_node_id") or item.get("targetNodeId") or ""
                ).strip(),
                target_label=str(item.get("target_label") or "").strip(),
            )
            for item in payload.get("edges") or ()
            if isinstance(item, dict)
        ),
        extraction_notes=tuple(
            str(value).strip() for value in payload.get("extractionNotes") or ()
        ),
        image_object_key=str(payload.get("imageObjectKey") or "").strip(),
        region_bbox_provider=tuple(
            float(value) for value in payload.get("regionBBoxProvider") or ()
        ),
    )
