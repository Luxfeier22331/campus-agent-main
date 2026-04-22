from __future__ import annotations

import json
import re

from campus_ingestion_core.curriculum_course_map_multimodal_probe_render import (
    _project_normalized_crop_bbox_to_sample_bboxes,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_shared import (
    CourseMapEdge,
    CourseMapFinding,
    CourseMapNode,
    CurriculumCourseMapPageProbe,
    CurriculumCourseMapRenderedSample,
    DetectedCourseMapRegion,
    _coerce_bbox,
    _coerce_normalized_bbox,
    _normalize_label,
)


def _loads_json_object_loose(text: str) -> object:
    stripped = text.strip()
    last_error: json.JSONDecodeError | None = None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError as exc:
        last_error = exc
    fence_match = re.search(r"```(?:json)?\s*(\{[\s\S]*\})\s*```", stripped)
    if fence_match is not None:
        return json.loads(fence_match.group(1))
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end > start:
        return json.loads(stripped[start : end + 1])
    if last_error is not None:
        raise last_error
    raise ValueError("expected JSON object text")


def _extract_output_parsed(payload: dict[str, object]) -> object:
    for output_item in payload.get("output", []):
        if not isinstance(output_item, dict):
            continue
        for content_item in output_item.get("content", []):
            if not isinstance(content_item, dict):
                continue
            if content_item.get("parsed") is not None:
                return content_item["parsed"]
            text = content_item.get("text")
            if isinstance(text, str) and text.strip():
                return _loads_json_object_loose(text)
    raise ValueError("curriculum course-map probe response missing parsed output")


def _extract_chat_completions_output_parsed(payload: dict[str, object]) -> object:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("curriculum course-map chat completion missing choices")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise ValueError("curriculum course-map chat completion missing assistant message")
    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return _loads_json_object_loose(content)
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str) and item.strip():
                parts.append(item)
                continue
            if not isinstance(item, dict):
                continue
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                parts.append(text)
        if parts:
            return _loads_json_object_loose("\n".join(parts))
    raise ValueError("curriculum course-map chat completion missing parsed output")


def _extract_detected_maps_payload(payload: dict[str, object]) -> tuple[object, ...]:
    candidates = (
        payload.get("detected_maps"),
        payload.get("map_regions"),
        payload.get("regions"),
        payload.get("maps"),
    )
    for candidate in candidates:
        if isinstance(candidate, list):
            return tuple(candidate)
    return ()


def _normalize_course_map_finding_payload(payload: dict[str, object]) -> dict[str, object]:
    normalized_nodes: list[dict[str, str]] = []
    for node in payload.get("nodes") or payload.get("courses") or ():
        if not isinstance(node, dict):
            normalized_nodes.append({})
            continue
        normalized_nodes.append(
            {
                "node_label": _first_non_empty_string(
                    node.get("node_label"),
                    node.get("label"),
                    node.get("name"),
                    node.get("course_name"),
                    node.get("text"),
                    node.get("id"),
                ),
                "stage_label": _first_non_empty_string(
                    node.get("stage_label"),
                    node.get("stage"),
                    node.get("year_group"),
                    node.get("semester_stage"),
                ),
                "category_label": _first_non_empty_string(
                    node.get("category_label"),
                    node.get("category"),
                    node.get("type"),
                    node.get("group"),
                ),
            }
        )

    normalized_edges: list[dict[str, str]] = []
    for edge in payload.get("edges") or payload.get("links") or payload.get("connections") or ():
        if not isinstance(edge, dict):
            normalized_edges.append({})
            continue
        normalized_edges.append(
            {
                "source_label": _first_non_empty_string(
                    edge.get("source_label"),
                    edge.get("source"),
                    edge.get("from"),
                    edge.get("prerequisite"),
                ),
                "target_label": _first_non_empty_string(
                    edge.get("target_label"),
                    edge.get("target"),
                    edge.get("to"),
                    edge.get("next"),
                ),
            }
        )

    stage_labels = payload.get("stage_labels") or payload.get("stages") or ()
    if not isinstance(stage_labels, (list, tuple)):
        stage_labels = ()
    derived_stage_labels = [
        node["stage_label"] for node in normalized_nodes if node.get("stage_label")
    ]
    return {
        "map_index": payload.get("map_index") or 0,
        "map_title": payload.get("map_title"),
        "stage_labels": tuple(
            dict.fromkeys(
                [
                    *[str(value).strip() for value in stage_labels if str(value).strip()],
                    *derived_stage_labels,
                ]
            )
        ),
        "nodes": tuple(normalized_nodes),
        "edges": tuple(normalized_edges),
        "manual_review_notes": _normalize_string_sequence(
            payload.get("manual_review_notes") or payload.get("notes")
        ),
    }


def _first_non_empty_string(*values: object) -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def _normalize_string_sequence(values: object) -> tuple[str, ...]:
    if values is None:
        return ()
    if isinstance(values, str):
        return (values.strip(),) if values.strip() else ()
    if isinstance(values, (list, tuple)):
        return tuple(str(value).strip() for value in values if str(value).strip())
    text = str(values).strip()
    return (text,) if text else ()


def _coerce_detected_course_map_region(payload: object) -> DetectedCourseMapRegion:
    if not isinstance(payload, dict):
        raise ValueError("detected course-map region payload must be a JSON object")
    return DetectedCourseMapRegion(
        map_index=int(payload.get("map_index") or 0),
        map_title=(
            str(payload["map_title"]).strip()
            if payload.get("map_title") not in {None, ""}
            else None
        ),
        title_confidence=str(payload.get("title_confidence") or "absent").strip().lower(),  # type: ignore[arg-type]
        region_bbox_normalized=_coerce_bbox(payload.get("region_bbox_normalized")),
        region_bbox_pdf=_coerce_bbox(payload.get("region_bbox_pdf")),
        region_bbox_provider=_coerce_bbox(payload.get("region_bbox_provider")),
        manual_review_notes=_normalize_string_sequence(payload.get("manual_review_notes")),
    )


def _coerce_course_map_finding(payload: object) -> CourseMapFinding:
    if not isinstance(payload, dict):
        raise ValueError("course-map finding payload must be a JSON object")
    payload = _normalize_course_map_finding_payload(payload)
    manual_review_notes = [
        str(value).strip()
        for value in payload.get("manual_review_notes") or ()
        if str(value).strip()
    ]
    nodes: list[CourseMapNode] = []
    for node in payload.get("nodes") or ():
        if not isinstance(node, dict):
            manual_review_notes.append("extractor returned a non-object node and it was dropped")
            continue
        node_label = str(node.get("node_label") or "").strip()
        if not node_label:
            manual_review_notes.append("extractor returned an empty node_label and it was dropped")
            continue
        nodes.append(
            CourseMapNode(
                node_label=node_label,
                stage_label=str(node.get("stage_label") or "").strip(),
                category_label=str(node.get("category_label") or "").strip(),
            )
        )
    edges: list[CourseMapEdge] = []
    for edge in payload.get("edges") or ():
        if not isinstance(edge, dict):
            manual_review_notes.append("extractor returned a non-object edge and it was dropped")
            continue
        source_label = str(edge.get("source_label") or "").strip()
        target_label = str(edge.get("target_label") or "").strip()
        if not source_label or not target_label:
            manual_review_notes.append(
                "extractor returned an empty edge endpoint and it was dropped"
            )
            continue
        edges.append(CourseMapEdge(source_label=source_label, target_label=target_label))
    return CourseMapFinding(
        map_index=int(payload.get("map_index") or 0),
        map_title=(
            str(payload["map_title"]).strip()
            if payload.get("map_title") not in {None, ""}
            else None
        ),
        stage_labels=tuple(str(value).strip() for value in payload.get("stage_labels") or ()),
        nodes=tuple(nodes),
        edges=tuple(edges),
        manual_review_notes=tuple(dict.fromkeys(manual_review_notes)),
    )


def _coerce_detected_regions_payload(
    *,
    rendered_sample: CurriculumCourseMapRenderedSample,
    payload: object,
) -> tuple[DetectedCourseMapRegion, ...]:
    if not isinstance(payload, dict):
        raise ValueError("detected regions payload must be a JSON object")
    detected_maps = _extract_detected_maps_payload(payload)
    regions = [
        _coerce_detected_region_from_raw(
            rendered_sample=rendered_sample, raw_region=item, position=index + 1
        )
        for index, item in enumerate(detected_maps)
    ]
    normalized = _sort_detected_regions(regions)
    if normalized:
        return tuple(normalized)
    return (_default_detected_region(rendered_sample=rendered_sample),)


def _coerce_detected_region_from_raw(
    *,
    rendered_sample: CurriculumCourseMapRenderedSample,
    raw_region: object,
    position: int,
) -> DetectedCourseMapRegion:
    if not isinstance(raw_region, dict):
        raise ValueError("detected region must be a JSON object")
    normalized_bbox = _coerce_normalized_bbox(
        raw_region.get("region_bbox_normalized")
        or raw_region.get("bbox")
        or raw_region.get("region_bbox")
        or raw_region.get("normalized_bbox")
    )
    pdf_bbox, provider_bbox = _project_normalized_crop_bbox_to_sample_bboxes(
        normalized_bbox=normalized_bbox,
        rendered_sample=rendered_sample,
    )
    map_title = (
        str(raw_region["map_title"]).strip()
        if raw_region.get("map_title") not in {None, ""}
        else None
    )
    if map_title is None:
        alias_title = _first_non_empty_string(raw_region.get("title"), raw_region.get("name"))
        map_title = alias_title or None
    title_confidence = str(raw_region.get("title_confidence") or "absent").strip().lower()
    if map_title is None and title_confidence == "visible":
        title_confidence = "partial"
    if title_confidence not in {"visible", "partial", "absent"}:
        title_confidence = "partial" if map_title else "absent"
    return DetectedCourseMapRegion(
        map_index=position,
        map_title=map_title,
        title_confidence=title_confidence,  # type: ignore[arg-type]
        region_bbox_normalized=normalized_bbox,
        region_bbox_pdf=pdf_bbox,
        region_bbox_provider=provider_bbox,
        manual_review_notes=_normalize_string_sequence(raw_region.get("manual_review_notes")),
    )


def _sort_detected_regions(regions: list[DetectedCourseMapRegion]) -> list[DetectedCourseMapRegion]:
    sorted_regions = sorted(
        regions,
        key=lambda item: (
            round(item.region_bbox_normalized[1], 4),
            round(item.region_bbox_normalized[0], 4),
        ),
    )
    normalized: list[DetectedCourseMapRegion] = []
    for index, region in enumerate(sorted_regions, start=1):
        normalized.append(
            DetectedCourseMapRegion(
                map_index=index,
                map_title=region.map_title,
                title_confidence=region.title_confidence,
                region_bbox_normalized=region.region_bbox_normalized,
                region_bbox_pdf=region.region_bbox_pdf,
                region_bbox_provider=region.region_bbox_provider,
                manual_review_notes=region.manual_review_notes,
            )
        )
    return normalized


def _default_detected_region(
    *,
    rendered_sample: CurriculumCourseMapRenderedSample,
) -> DetectedCourseMapRegion:
    return DetectedCourseMapRegion(
        map_index=1,
        map_title=None,
        title_confidence="absent",
        region_bbox_normalized=(0.0, 0.0, 1.0, 1.0),
        region_bbox_pdf=rendered_sample.pdf_bbox,
        region_bbox_provider=rendered_sample.provider_bbox,
        manual_review_notes=(
            "detector did not return any bounded map regions; fell back to the full crop",
        ),
    )


def _build_page_probe_from_detected_and_extracted(
    *,
    rendered_sample: CurriculumCourseMapRenderedSample,
    detected_maps: tuple[DetectedCourseMapRegion, ...],
    extracted_maps: tuple[CourseMapFinding, ...],
) -> CurriculumCourseMapPageProbe:
    global_notes: list[str] = []
    manual_review_required = False
    if any(region.title_confidence != "visible" for region in detected_maps):
        global_notes.append(
            "at least one detected map region does not have a clearly visible title"
        )
        manual_review_required = True
    for region in detected_maps:
        if region.manual_review_notes:
            manual_review_required = True
            global_notes.extend(region.manual_review_notes)
    for finding in extracted_maps:
        if finding.manual_review_notes:
            manual_review_required = True
            global_notes.extend(finding.manual_review_notes)
    if not extracted_maps:
        manual_review_required = True
        global_notes.append("no map content was extracted from detected regions")
    return CurriculumCourseMapPageProbe(
        sample_id=rendered_sample.sample_id,
        page_number=rendered_sample.page_number,
        document_id=rendered_sample.document_id,
        document_title=rendered_sample.document_title,
        parent_heading_hint=rendered_sample.parent_heading_hint,
        detected_maps=detected_maps,
        course_maps=extracted_maps,
        manual_review_required=manual_review_required,
        global_manual_review_notes=tuple(
            dict.fromkeys(note for note in global_notes if note.strip())
        ),
    )


__all__ = [
    "_build_page_probe_from_detected_and_extracted",
    "_coerce_course_map_finding",
    "_coerce_detected_course_map_region",
    "_coerce_detected_region_from_raw",
    "_coerce_detected_regions_payload",
    "_default_detected_region",
    "_extract_chat_completions_output_parsed",
    "_extract_detected_maps_payload",
    "_extract_output_parsed",
    "_first_non_empty_string",
    "_loads_json_object_loose",
    "_normalize_course_map_finding_payload",
    "_normalize_string_sequence",
    "_sort_detected_regions",
    "_normalize_label",
]
