from __future__ import annotations

from base64 import b64encode

from campus_ingestion_core.curriculum_course_map_multimodal_probe_shared import (
    CourseMapMultimodalTransport,
    CurriculumCourseMapRenderedRegion,
    CurriculumCourseMapRenderedSample,
)


def _build_course_map_detector_content(
    *,
    rendered_sample: CurriculumCourseMapRenderedSample,
) -> list[dict[str, object]]:
    return [
        {
            "type": "text",
            "text": (
                f"Document title: {rendered_sample.document_title}\n"
                f"Page number: {rendered_sample.page_number}\n"
                f"Parent heading hint: {rendered_sample.parent_heading_hint or '<none>'}\n"
                "Image 1 is the full PDF page.\n"
                "Image 2 is the bounded course-map crop.\n"
                "If Image 2 already shows one complete course map, return one detected_maps item "
                "with region_bbox_normalized [0, 0, 1, 1].\n"
                "Detect how many distinct course-map diagrams are visible inside Image 2. "
                "Return ordered map regions from top-to-bottom, then left-to-right. "
                "Region bbox values must be normalized floats between 0 and 1 relative to Image 2."
            ),
        },
        {
            "type": "image_url",
            "image_url": {"url": _png_data_url(rendered_sample.full_page_png), "detail": "high"},
        },
        {
            "type": "image_url",
            "image_url": {"url": _png_data_url(rendered_sample.crop_png), "detail": "high"},
        },
    ]


def _build_course_map_region_content(
    *,
    rendered_sample: CurriculumCourseMapRenderedSample,
    rendered_region: CurriculumCourseMapRenderedRegion,
) -> list[dict[str, object]]:
    content: list[dict[str, object]] = [
        {
            "type": "text",
            "text": (
                f"Document title: {rendered_sample.document_title}\n"
                f"Page number: {rendered_sample.page_number}\n"
                f"Parent heading hint: {rendered_sample.parent_heading_hint or '<none>'}\n"
                f"Map index: {rendered_region.detected_region.map_index}\n"
                f"Detector title: {rendered_region.detected_region.map_title or '<none>'}\n"
                f"Detector title confidence: {rendered_region.detected_region.title_confidence}\n"
                "Image 1 is the full PDF page.\n"
                "Image 2 is the bounded region crop for one map.\n"
                "Images 3+ are tiles of Image 2.\n"
                "Use the visible Chinese course names as node_label values. "
                "Every node must have a stable node_id that is unique inside this map, "
                "for example n01, n02, n03 in visual reading order. "
                "If the same node_label appears in multiple stages or positions, keep them as separate nodes "
                "with different node_id values.\n"
                "If stage labels are visible, keep them in stage_labels and node.stage_label; "
                "otherwise use an empty string. Every node should also include stage_id; use a stable value "
                "such as s01, s02 for visible stages, or stage_unknown when no stage is visible.\n"
                "If category labels are unclear, use an empty string.\n"
                "Edges must reference source_node_id and target_node_id, not only repeated labels. "
                "If an arrow endpoint cannot be matched to exactly one visible node_id, do not output that edge; "
                "add a short Chinese manual_review_notes item instead.\n"
                "Only output the visible course-map structure for this single region. "
                "If a title is not clearly visible inside this region, return map_title as null."
            ),
        },
        {
            "type": "image_url",
            "image_url": {"url": _png_data_url(rendered_sample.full_page_png), "detail": "high"},
        },
        {
            "type": "image_url",
            "image_url": {"url": _png_data_url(rendered_region.crop_png), "detail": "high"},
        },
    ]
    for tile in rendered_region.tile_pngs:
        content.append(
            {"type": "image_url", "image_url": {"url": _png_data_url(tile), "detail": "high"}}
        )
    return content


def _png_data_url(payload: bytes) -> str:
    return f"data:image/png;base64,{b64encode(payload).decode('ascii')}"


def _normalize_course_map_multimodal_transport(
    raw_transport: str,
) -> CourseMapMultimodalTransport:
    normalized = raw_transport.strip().lower()
    if normalized in {"", "responses"}:
        return "responses"
    if normalized in {"chat_completions", "chat-completions", "chat/completions"}:
        return "chat_completions"
    raise ValueError(
        "CURRICULUM_COURSE_MAP_MULTIMODAL_TRANSPORT must be one of responses or chat_completions"
    )


def _curriculum_course_map_detector_schema() -> dict[str, object]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["detected_maps"],
        "properties": {
            "detected_maps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "map_title",
                        "title_confidence",
                        "region_bbox_normalized",
                        "manual_review_notes",
                    ],
                    "properties": {
                        "map_title": {"type": ["string", "null"]},
                        "title_confidence": {
                            "type": "string",
                            "enum": ["visible", "partial", "absent"],
                        },
                        "region_bbox_normalized": {
                            "type": "array",
                            "minItems": 4,
                            "maxItems": 4,
                            "items": {"type": "number"},
                        },
                        "manual_review_notes": {"type": "array", "items": {"type": "string"}},
                    },
                },
            },
        },
    }


def _curriculum_course_map_region_schema() -> dict[str, object]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["map_title", "stage_labels", "nodes", "edges", "manual_review_notes"],
        "properties": {
            "map_title": {"type": ["string", "null"]},
            "stage_labels": {"type": "array", "items": {"type": "string"}},
            "nodes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "node_id",
                        "node_label",
                        "stage_id",
                        "stage_label",
                        "category_label",
                    ],
                    "properties": {
                        "node_id": {"type": "string"},
                        "node_label": {"type": "string"},
                        "stage_id": {"type": "string"},
                        "stage_label": {"type": "string"},
                        "category_label": {"type": "string"},
                    },
                },
            },
            "edges": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "edge_id",
                        "source_node_id",
                        "source_label",
                        "target_node_id",
                        "target_label",
                    ],
                    "properties": {
                        "edge_id": {"type": "string"},
                        "source_node_id": {"type": "string"},
                        "source_label": {"type": "string"},
                        "target_node_id": {"type": "string"},
                        "target_label": {"type": "string"},
                    },
                },
            },
            "manual_review_notes": {"type": "array", "items": {"type": "string"}},
        },
    }
