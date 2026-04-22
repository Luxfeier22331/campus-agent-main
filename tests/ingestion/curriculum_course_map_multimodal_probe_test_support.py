from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

import httpx

from tests.ingestion._curriculum_course_map_probe_test_support import (
    load_curriculum_course_map_probe_module,
)

_probe_module = load_curriculum_course_map_probe_module()
CourseMapEdge = _probe_module.CourseMapEdge
CourseMapFinding = _probe_module.CourseMapFinding
CourseMapNode = _probe_module.CourseMapNode
CurriculumCourseMapGoldExpectation = _probe_module.CurriculumCourseMapGoldExpectation
CurriculumCourseMapGoldMapExpectation = _probe_module.CurriculumCourseMapGoldMapExpectation
CurriculumCourseMapInventoryEntry = _probe_module.CurriculumCourseMapInventoryEntry
CurriculumCourseMapPageProbe = _probe_module.CurriculumCourseMapPageProbe
CurriculumCourseMapProbeRun = _probe_module.CurriculumCourseMapProbeRun
CurriculumCourseMapRenderedSample = _probe_module.CurriculumCourseMapRenderedSample
DetectedCourseMapRegion = _probe_module.DetectedCourseMapRegion
_coerce_course_map_finding = _probe_module._coerce_course_map_finding
_coerce_detected_regions_payload = _probe_module._coerce_detected_regions_payload
_extract_chat_completions_output_parsed = _probe_module._extract_chat_completions_output_parsed
_extract_output_parsed = _probe_module._extract_output_parsed
_normalize_prompt_runtime_transport = _probe_module._normalize_prompt_runtime_transport
_request_course_map_detector_payload_async = (
    _probe_module._request_course_map_detector_payload_async
)
build_curriculum_course_map_admission_summary = (
    _probe_module.build_curriculum_course_map_admission_summary
)
build_curriculum_course_map_gold_report = _probe_module.build_curriculum_course_map_gold_report
build_curriculum_course_map_inventory = _probe_module.build_curriculum_course_map_inventory
build_curriculum_course_map_repeatability_report = (
    _probe_module.build_curriculum_course_map_repeatability_report
)
default_curriculum_provider_response_key = _probe_module.default_curriculum_provider_response_key
derive_provider_canvas = _probe_module.derive_provider_canvas
project_provider_bbox_to_pdf_rect = _probe_module.project_provider_bbox_to_pdf_rect
render_curriculum_course_map_sample = _probe_module.render_curriculum_course_map_sample
run_curriculum_course_map_multimodal_probe = (
    _probe_module.run_curriculum_course_map_multimodal_probe
)


def _provider_response_bytes(*, page_count: int, page_height: int = 1561) -> bytes:
    line = {
        "logId": "fixture-batch-001",
        "result": {
            "layoutParsingResults": [
                {
                    "prunedResult": {
                        "height": page_height,
                        "parsing_res_list": [],
                    },
                    "markdown": {"text": "", "images": {}},
                }
                for _ in range(page_count)
            ]
        },
    }
    return (json.dumps(line, ensure_ascii=False) + "\n").encode("utf-8")


def _split_manifest_bytes() -> bytes:
    payload = {
        "manifest_version": "curriculum_plan_split_manifest_v1",
        "documents": [
            {
                "document_id": "curriculum:国际经济与贸易本科人才培养方案",
                "title": "国际经济与贸易本科人才培养方案",
                "page_start": 278,
                "page_end": 288,
            },
            {
                "document_id": "curriculum:经济学拔尖人才创新班人才培养方案",
                "title": "经济学拔尖人才创新班人才培养方案",
                "page_start": 289,
                "page_end": 297,
            },
        ],
    }
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def _make_page_probe(
    *,
    sample_id: str,
    page_number: int,
    document_id: str,
    document_title: str,
    map_title: str | None,
    nodes: tuple[str, ...],
    edges: tuple[tuple[str, str], ...],
) -> CurriculumCourseMapPageProbe:
    return CurriculumCourseMapPageProbe(
        sample_id=sample_id,
        page_number=page_number,
        document_id=document_id,
        document_title=document_title,
        parent_heading_hint=map_title or "",
        detected_maps=(
            DetectedCourseMapRegion(
                map_index=1,
                map_title=map_title,
                title_confidence="visible" if map_title else "absent",
                region_bbox_normalized=(0.0, 0.0, 1.0, 1.0),
                region_bbox_pdf=(1.0, 2.0, 3.0, 4.0),
                region_bbox_provider=(10.0, 20.0, 30.0, 40.0),
                manual_review_notes=(),
            ),
        ),
        course_maps=(
            CourseMapFinding(
                map_index=1,
                map_title=map_title,
                stage_labels=("本科一年级", "本科二年级"),
                nodes=tuple(CourseMapNode(node_label=value) for value in nodes),
                edges=tuple(
                    CourseMapEdge(source_label=left, target_label=right) for left, right in edges
                ),
                manual_review_notes=(),
            ),
        ),
        manual_review_required=False,
        global_manual_review_notes=(),
    )


__all__ = [name for name in globals() if not name.startswith("__")]
