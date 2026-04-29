from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path
from typing import Any

from campus_ingestion_core.curriculum_course_map_multimodal_probe_shared import (
    _COURSE_MAP_HINT_RE,
    CURRICULUM_COURSE_MAP_GOLD_MANIFEST_VERSION,
    CURRICULUM_COURSE_MAP_SAMPLE_MANIFEST_VERSION,
    CurriculumCourseMapGoldExpectation,
    CurriculumCourseMapGoldMapExpectation,
    CurriculumCourseMapInventoryEntry,
    CurriculumCourseMapSampleSelection,
    _coerce_bbox,
)


def build_curriculum_course_map_inventory(
    *,
    split_manifest_bytes: bytes,
    provider_response_bytes: bytes,
    layout_elements_bytes: bytes,
    source_pdf_key: str,
    provider_response_key: str,
    layout_elements_key: str,
    raw_asset_id: str,
    raw_version_id: str,
) -> tuple[CurriculumCourseMapInventoryEntry, ...]:
    document_ranges = _load_split_manifest_document_ranges(split_manifest_bytes)
    provider_page_heights = load_provider_page_heights(provider_response_bytes)
    layout_rows = _load_jsonl_bytes(layout_elements_bytes)
    provider_page_widths = _derive_layout_page_widths(layout_rows)
    inventory: list[CurriculumCourseMapInventoryEntry] = []
    active_course_map_headings_by_document: dict[str, str] = {}
    recent_course_map_caption_by_document: dict[str, tuple[int, str]] = {}
    pending_pre_heading_images_by_document: dict[str, list[dict[str, object]]] = {}
    for row in layout_rows:
        page_number = int(row.get("page_start") or 0)
        if page_number <= 0:
            if str(row.get("row_type") or "").strip() == "image":
                raise ValueError("course-map image row missing page_start")
            continue
        owner = _resolve_document_for_page(document_ranges=document_ranges, page_number=page_number)
        if owner is None:
            continue
        owner_document_id, owner_document_title = owner
        row_type = str(row.get("row_type") or "").strip()
        row_heading_text = _row_text(row)
        if row_type == "heading":
            if _is_curriculum_course_map_candidate(row_heading_text):
                for pending_image in _drain_pending_images_before_heading(
                    pending_pre_heading_images_by_document,
                    document_id=owner_document_id,
                    heading_row=row,
                    page_number=page_number,
                ):
                    inventory.append(
                        _build_inventory_entry(
                            row=pending_image,
                            owner_document_id=owner_document_id,
                            owner_document_title=owner_document_title,
                            parent_heading_hint=row_heading_text,
                            provider_page_heights=provider_page_heights,
                            provider_page_widths=provider_page_widths,
                            raw_asset_id=raw_asset_id,
                            raw_version_id=raw_version_id,
                            source_pdf_key=source_pdf_key,
                            provider_response_key=provider_response_key,
                            layout_elements_key=layout_elements_key,
                        )
                    )
                active_course_map_headings_by_document[owner_document_id] = row_heading_text
            elif _is_curriculum_section_boundary(row):
                active_course_map_headings_by_document.pop(owner_document_id, None)
                recent_course_map_caption_by_document.pop(owner_document_id, None)
                pending_pre_heading_images_by_document.pop(owner_document_id, None)
            continue
        if _is_curriculum_course_map_caption_hint(row):
            recent_course_map_caption_by_document[owner_document_id] = (
                page_number,
                row_heading_text,
            )
            continue
        if row_type != "image":
            continue
        parent_heading_hint = str(row.get("parent_heading_hint") or "").strip()
        if not _is_curriculum_course_map_candidate(parent_heading_hint):
            parent_heading_hint = active_course_map_headings_by_document.get(owner_document_id, "")
        recent_caption_page, recent_caption_hint = recent_course_map_caption_by_document.get(
            owner_document_id, (0, "")
        )
        if (
            not _is_curriculum_course_map_candidate(parent_heading_hint)
            and recent_caption_page == page_number
        ):
            parent_heading_hint = recent_caption_hint
        if not _is_curriculum_course_map_candidate(parent_heading_hint):
            pending_pre_heading_images_by_document.setdefault(owner_document_id, []).append(row)
            continue
        recent_course_map_caption_by_document.pop(owner_document_id, None)
        inventory.append(
            _build_inventory_entry(
                row=row,
                owner_document_id=owner_document_id,
                owner_document_title=owner_document_title,
                parent_heading_hint=parent_heading_hint,
                provider_page_heights=provider_page_heights,
                provider_page_widths=provider_page_widths,
                raw_asset_id=raw_asset_id,
                raw_version_id=raw_version_id,
                source_pdf_key=source_pdf_key,
                provider_response_key=provider_response_key,
                layout_elements_key=layout_elements_key,
            )
        )
    return tuple(sorted(inventory, key=lambda item: (item.page_number, item.row_id)))


def _build_inventory_entry(
    *,
    row: dict[str, object],
    owner_document_id: str,
    owner_document_title: str,
    parent_heading_hint: str,
    provider_page_heights: dict[int, float],
    provider_page_widths: dict[int, float],
    raw_asset_id: str,
    raw_version_id: str,
    source_pdf_key: str,
    provider_response_key: str,
    layout_elements_key: str,
) -> CurriculumCourseMapInventoryEntry:
    page_number = int(row.get("page_start") or 0)
    provider_page_height = float(provider_page_heights.get(page_number) or 0.0)
    if provider_page_height <= 0:
        raise ValueError(f"missing provider page height for page {page_number}")
    return CurriculumCourseMapInventoryEntry(
        document_id=owner_document_id,
        document_title=owner_document_title,
        page_number=page_number,
        row_id=str(row.get("row_id") or "").strip(),
        parent_heading_hint=parent_heading_hint,
        bbox_provider=_coerce_bbox(row.get("bbox")),
        provider_page_height=provider_page_height,
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        source_pdf_key=source_pdf_key,
        provider_response_key=provider_response_key,
        layout_elements_key=layout_elements_key,
        provider_page_width=provider_page_widths.get(page_number),
    )


def load_provider_page_heights(provider_response_bytes: bytes) -> dict[int, float]:
    heights: dict[int, float] = {}
    page_number = 0
    for line in provider_response_bytes.decode("utf-8").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        payload = json.loads(stripped)
        results = ((payload.get("result") or {}).get("layoutParsingResults")) or []
        data_info_pages = ((payload.get("result") or {}).get("dataInfo") or {}).get("pages") or []
        for page_index, item in enumerate(results):
            if not isinstance(item, dict):
                continue
            page_number += 1
            height = _extract_provider_page_height(
                item,
                data_info_page=data_info_pages[page_index]
                if page_index < len(data_info_pages)
                else None,
            )
            if height <= 0:
                raise ValueError(f"provider page {page_number} missing positive height")
            heights[page_number] = height
    if not heights:
        raise ValueError("provider-response payload does not contain any page heights")
    return heights


def _derive_layout_page_widths(
    layout_rows: tuple[dict[str, object], ...],
) -> dict[int, float]:
    widths: dict[int, float] = {}
    for row in layout_rows:
        page_number = int(row.get("page_start") or 0)
        if page_number <= 0:
            continue
        bbox = row.get("bbox")
        if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
            continue
        right = float(bbox[2])
        if right > 0:
            widths[page_number] = max(widths.get(page_number, 0.0), right)
    return widths


def _extract_provider_page_height(
    item: dict[str, object],
    *,
    data_info_page: object,
) -> float:
    pruned = item.get("prunedResult") or {}
    if isinstance(pruned, dict):
        height = float(pruned.get("height") or 0.0)
        if height > 0:
            return height

    page_info = item.get("pageInfo") or {}
    if isinstance(page_info, dict):
        height = float(page_info.get("height") or 0.0)
        if height > 0:
            return height

    if isinstance(data_info_page, dict):
        height = float(data_info_page.get("height") or 0.0)
        if height > 0:
            return height

    return 0.0


def load_curriculum_course_map_sample_manifest(
    path: Path,
) -> tuple[CurriculumCourseMapSampleSelection, ...]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if (
        str(payload.get("manifest_version") or "").strip()
        != CURRICULUM_COURSE_MAP_SAMPLE_MANIFEST_VERSION
    ):
        raise ValueError("unsupported curriculum course-map sample manifest version")
    selections = tuple(
        CurriculumCourseMapSampleSelection(
            sample_id=str(item.get("sample_id") or "").strip(),
            page_number=int(item.get("page_number") or 0),
            document_id=str(item.get("document_id") or "").strip(),
            document_title=str(item.get("document_title") or "").strip(),
        )
        for item in payload.get("entries") or ()
    )
    if not selections:
        raise ValueError("course-map sample manifest must contain at least one entry")
    return selections


def load_curriculum_course_map_gold_manifest(
    path: Path,
) -> tuple[CurriculumCourseMapGoldExpectation, ...]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if (
        str(payload.get("manifest_version") or "").strip()
        != CURRICULUM_COURSE_MAP_GOLD_MANIFEST_VERSION
    ):
        raise ValueError("unsupported curriculum course-map gold manifest version")
    expectations = tuple(
        CurriculumCourseMapGoldExpectation(
            page_number=int(item.get("page_number") or 0),
            document_id=str(item.get("document_id") or "").strip(),
            document_title=str(item.get("document_title") or "").strip(),
            expected_maps=tuple(
                CurriculumCourseMapGoldMapExpectation(
                    map_index=int(slot.get("map_index") or 0),
                    expected_title=(
                        str(slot["expected_title"]).strip()
                        if slot.get("expected_title") is not None
                        else None
                    ),
                    title_required=bool(slot.get("title_required", False)),
                    expected_node_labels=tuple(
                        str(value).strip() for value in slot.get("expected_node_labels") or ()
                    ),
                    expected_edges=tuple(
                        (str(edge[0]).strip(), str(edge[1]).strip())
                        for edge in slot.get("expected_edges") or ()
                    ),
                    min_node_recall=float(slot.get("min_node_recall") or 0.6),
                    min_edge_recall=float(slot.get("min_edge_recall") or 0.5),
                )
                for slot in item.get("expected_maps") or ()
            ),
            min_map_detection_recall=float(item.get("min_map_detection_recall") or 1.0),
            min_slot_pass_rate=float(item.get("min_slot_pass_rate") or 1.0),
        )
        for item in payload.get("entries") or ()
    )
    if not expectations:
        raise ValueError("course-map gold manifest must contain at least one entry")
    return expectations


def select_curriculum_course_map_samples(
    *,
    inventory: tuple[CurriculumCourseMapInventoryEntry, ...],
    sample_manifest: tuple[CurriculumCourseMapSampleSelection, ...],
) -> tuple[tuple[CurriculumCourseMapSampleSelection, CurriculumCourseMapInventoryEntry], ...]:
    inventory_by_page: dict[int, list[CurriculumCourseMapInventoryEntry]] = defaultdict(list)
    for entry in inventory:
        inventory_by_page[entry.page_number].append(entry)
    selected: list[
        tuple[CurriculumCourseMapSampleSelection, CurriculumCourseMapInventoryEntry]
    ] = []
    for selection in sample_manifest:
        candidates = inventory_by_page.get(selection.page_number) or []
        match = next(
            (
                candidate
                for candidate in candidates
                if candidate.document_id == selection.document_id
                and candidate.document_title == selection.document_title
            ),
            None,
        )
        if match is None:
            raise ValueError(
                f"sample page {selection.page_number} / {selection.document_id} not found in course-map inventory"
            )
        selected.append((selection, match))
    return tuple(selected)


def _load_split_manifest_document_ranges(
    split_manifest_bytes: bytes,
) -> tuple[tuple[str, str, int, int], ...]:
    payload = json.loads(split_manifest_bytes)
    documents = payload.get("documents") or ()
    ranges: list[tuple[str, str, int, int]] = []
    for item in documents:
        document_id = str(item.get("document_id") or "").strip()
        document_title = str(item.get("title") or "").strip()
        page_start = int(item.get("page_start") or 0)
        page_end = int(item.get("page_end") or 0)
        if not document_id or not document_title or page_start <= 0 or page_end < page_start:
            raise ValueError("split manifest contains invalid document range")
        ranges.append((document_id, document_title, page_start, page_end))
    if not ranges:
        raise ValueError("split manifest does not contain any documents")
    return tuple(ranges)


def _resolve_document_for_page(
    *,
    document_ranges: tuple[tuple[str, str, int, int], ...],
    page_number: int,
) -> tuple[str, str] | None:
    for document_id, document_title, page_start, page_end in document_ranges:
        if page_start <= page_number <= page_end:
            return document_id, document_title
    return None


def _is_curriculum_course_map_candidate(parent_heading_hint: str) -> bool:
    return bool(_COURSE_MAP_HINT_RE.search(parent_heading_hint.strip()))


def _is_curriculum_course_map_caption_hint(row: dict[str, object]) -> bool:
    row_type = str(row.get("row_type") or "").strip()
    block_role = str(row.get("block_role") or "").strip()
    if row_type not in {"table_caption", "paragraph"} and block_role not in {
        "figure_title",
        "figure_caption",
    }:
        return False
    return _is_curriculum_course_map_candidate(_row_text(row))


def _drain_pending_images_before_heading(
    pending_images_by_document: dict[str, list[dict[str, object]]],
    *,
    document_id: str,
    heading_row: dict[str, object],
    page_number: int,
) -> tuple[dict[str, object], ...]:
    pending_images = pending_images_by_document.pop(document_id, [])
    if not pending_images:
        return ()
    return tuple(
        image_row
        for image_row in pending_images
        if _is_pending_image_before_heading(
            image_row=image_row,
            heading_row=heading_row,
            page_number=page_number,
        )
    )


def _is_pending_image_before_heading(
    *,
    image_row: dict[str, object],
    heading_row: dict[str, object],
    page_number: int,
) -> bool:
    if int(image_row.get("page_start") or 0) != page_number:
        return False
    image_bbox = _coerce_optional_bbox(image_row.get("bbox"))
    heading_bbox = _coerce_optional_bbox(heading_row.get("bbox"))
    if image_bbox is None or heading_bbox is None:
        return False
    image_bottom = image_bbox[3]
    heading_top = heading_bbox[1]
    return image_bottom <= heading_top + 32


def _coerce_optional_bbox(value: Any) -> tuple[float, float, float, float] | None:
    try:
        return _coerce_bbox(value)
    except (TypeError, ValueError):
        return None


def _is_curriculum_section_boundary(row: dict[str, object]) -> bool:
    section_hint = str(row.get("section_hint") or "").strip()
    return section_hint in {"section", "chapter"}


def _row_text(row: dict[str, object]) -> str:
    for key in ("text_normalized", "clean_text", "text_raw", "parent_heading_hint"):
        value = str(row.get(key) or "").strip()
        if value:
            return value
    return ""


def _load_jsonl_bytes(payload: bytes) -> tuple[dict[str, object], ...]:
    rows: list[dict[str, object]] = []
    for line in payload.decode("utf-8").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        row = json.loads(stripped)
        if not isinstance(row, dict):
            raise ValueError("jsonl row must be a JSON object")
        rows.append(row)
    return tuple(rows)


__all__ = [
    "_derive_layout_page_widths",
    "_drain_pending_images_before_heading",
    "_is_curriculum_course_map_candidate",
    "_is_curriculum_course_map_caption_hint",
    "_load_jsonl_bytes",
    "_load_split_manifest_document_ranges",
    "_resolve_document_for_page",
    "build_curriculum_course_map_inventory",
    "load_curriculum_course_map_gold_manifest",
    "load_curriculum_course_map_sample_manifest",
    "load_provider_page_heights",
    "select_curriculum_course_map_samples",
]
