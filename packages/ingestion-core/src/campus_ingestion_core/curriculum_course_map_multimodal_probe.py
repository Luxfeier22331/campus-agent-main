from __future__ import annotations

import asyncio
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core import curriculum_course_map_multimodal_probe_runtime as _runtime
from campus_ingestion_core.curriculum_course_map_multimodal_probe_coercion import (
    _build_page_probe_from_detected_and_extracted,
    _coerce_course_map_finding,
    _coerce_detected_course_map_region,
    _coerce_detected_regions_payload,
    _extract_chat_completions_output_parsed,
    _extract_output_parsed,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_inventory import (
    build_curriculum_course_map_inventory,
    load_curriculum_course_map_gold_manifest,
    load_curriculum_course_map_sample_manifest,
    load_provider_page_heights,
    select_curriculum_course_map_samples,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_render import (
    _build_rendered_region,
    derive_provider_canvas,
    project_provider_bbox_to_pdf_rect,
    render_curriculum_course_map_sample,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_reporting import (
    build_curriculum_course_map_admission_summary,
    build_curriculum_course_map_gold_report,
    build_curriculum_course_map_repeatability_report,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_runtime import (
    _build_course_map_detector_content,
    _build_course_map_region_content,
    _normalize_prompt_runtime_transport,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_runtime import (
    _build_responses_multimodal_input as _build_responses_multimodal_input,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_runtime import (
    _detect_curriculum_course_map_regions_async as _runtime_detect_curriculum_course_map_regions_async,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_runtime import (
    _extract_curriculum_course_map_region_async as _runtime_extract_curriculum_course_map_region_async,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_runtime import (
    _post_probe_json_async as _runtime_post_probe_json_async,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_runtime import (
    _probe_curriculum_course_map_page_async as _runtime_probe_curriculum_course_map_page_async,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_runtime import (
    _request_course_map_detector_payload_async as _runtime_request_course_map_detector_payload_async,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_runtime import (
    _request_course_map_region_payload_async as _runtime_request_course_map_region_payload_async,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_runtime import (
    _request_structured_multimodal_payload_async as _runtime_request_structured_multimodal_payload_async,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_runtime import (
    _run_curriculum_course_map_probe_run_async as _runtime_run_curriculum_course_map_probe_run_async,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_runtime import (
    _run_curriculum_course_map_probe_runs_async as _runtime_run_curriculum_course_map_probe_runs_async,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_runtime import (
    _to_responses_multimodal_content as _to_responses_multimodal_content,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_runtime_support import (
    _build_probe_config,
    _validate_resume_probe_config,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_runtime_support import (
    _is_retryable_probe_exception as _is_retryable_probe_exception,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_shared import (
    CURRICULUM_COURSE_MAP_GOLD_MANIFEST_VERSION,
    CURRICULUM_COURSE_MAP_PROBE_SCHEMA_VERSION,
    CURRICULUM_COURSE_MAP_SAMPLE_MANIFEST_VERSION,
    DEFAULT_CURRICULUM_RAW_ASSET_ID,
    DEFAULT_CURRICULUM_RAW_VERSION_ID,
    DEFAULT_GOLD_MANIFEST_PATH,
    DEFAULT_MAX_INFLIGHT_PAGES,
    DEFAULT_MAX_REQUEST_ATTEMPTS,
    DEFAULT_PROMPT_RUNS,
    DEFAULT_PROMPT_RUNTIME_TRANSPORT,
    DEFAULT_REPEATABILITY_THRESHOLD,
    DEFAULT_SAMPLE_MANIFEST_PATH,
    DEFAULT_SPLIT_MANIFEST_PATH,
    CourseMapEdge,
    CourseMapFinding,
    CourseMapNode,
    CurriculumCourseMapAdmissionSummary,
    CurriculumCourseMapGoldExpectation,
    CurriculumCourseMapGoldMapExpectation,
    CurriculumCourseMapGoldPageScore,
    CurriculumCourseMapGoldReport,
    CurriculumCourseMapInventoryEntry,
    CurriculumCourseMapPageProbe,
    CurriculumCourseMapProbeReport,
    CurriculumCourseMapProbeRun,
    CurriculumCourseMapRenderedRegion,
    CurriculumCourseMapRenderedSample,
    CurriculumCourseMapRepeatabilityPageScore,
    CurriculumCourseMapRepeatabilityReport,
    CurriculumCourseMapSampleSelection,
    DetectedCourseMapRegion,
    ObjectStoreByteReader,
    _write_json,
    default_curriculum_layout_elements_key,
    default_curriculum_provider_response_key,
    default_curriculum_source_pdf_key,
)


def _sync_runtime_overrides() -> None:
    _runtime._probe_curriculum_course_map_page_async = _probe_curriculum_course_map_page_async
    _runtime._detect_curriculum_course_map_regions_async = (
        _detect_curriculum_course_map_regions_async
    )
    _runtime._extract_curriculum_course_map_region_async = (
        _extract_curriculum_course_map_region_async
    )
    _runtime._request_course_map_detector_payload_async = _request_course_map_detector_payload_async
    _runtime._request_course_map_region_payload_async = _request_course_map_region_payload_async
    _runtime._request_structured_multimodal_payload_async = (
        _request_structured_multimodal_payload_async
    )
    _runtime._post_probe_json_async = _post_probe_json_async
    _runtime._build_course_map_detector_content = _build_course_map_detector_content
    _runtime._build_course_map_region_content = _build_course_map_region_content
    _runtime._extract_output_parsed = _extract_output_parsed
    _runtime._extract_chat_completions_output_parsed = _extract_chat_completions_output_parsed
    _runtime._coerce_detected_regions_payload = _coerce_detected_regions_payload
    _runtime._coerce_course_map_finding = _coerce_course_map_finding
    _runtime._coerce_detected_course_map_region = _coerce_detected_course_map_region
    _runtime._build_rendered_region = _build_rendered_region
    _runtime._build_page_probe_from_detected_and_extracted = (
        _build_page_probe_from_detected_and_extracted
    )
    _runtime._write_json = _write_json


async def _run_curriculum_course_map_probe_runs_async(**kwargs):
    _sync_runtime_overrides()
    return await _runtime_run_curriculum_course_map_probe_runs_async(**kwargs)


async def _run_curriculum_course_map_probe_run_async(**kwargs):
    _sync_runtime_overrides()
    return await _runtime_run_curriculum_course_map_probe_run_async(**kwargs)


async def _probe_curriculum_course_map_page_async(**kwargs):
    _sync_runtime_overrides()
    return await _runtime_probe_curriculum_course_map_page_async(**kwargs)


async def _detect_curriculum_course_map_regions_async(**kwargs):
    _sync_runtime_overrides()
    return await _runtime_detect_curriculum_course_map_regions_async(**kwargs)


async def _extract_curriculum_course_map_region_async(**kwargs):
    _sync_runtime_overrides()
    return await _runtime_extract_curriculum_course_map_region_async(**kwargs)


async def _request_course_map_detector_payload_async(**kwargs):
    _sync_runtime_overrides()
    return await _runtime_request_course_map_detector_payload_async(**kwargs)


async def _request_course_map_region_payload_async(**kwargs):
    _sync_runtime_overrides()
    return await _runtime_request_course_map_region_payload_async(**kwargs)


async def _request_structured_multimodal_payload_async(**kwargs):
    _sync_runtime_overrides()
    return await _runtime_request_structured_multimodal_payload_async(**kwargs)


async def _post_probe_json_async(**kwargs):
    return await _runtime_post_probe_json_async(**kwargs)


def run_curriculum_course_map_multimodal_probe(
    *,
    source: dict[str, str],
    source_bucket: str,
    split_manifest_path: Path = DEFAULT_SPLIT_MANIFEST_PATH,
    sample_manifest_path: Path = DEFAULT_SAMPLE_MANIFEST_PATH,
    gold_manifest_path: Path = DEFAULT_GOLD_MANIFEST_PATH,
    object_store: ObjectStoreByteReader | None = None,
    pdf_bytes: bytes | None = None,
    provider_response_bytes: bytes | None = None,
    layout_elements_bytes: bytes | None = None,
    source_pdf_key: str = default_curriculum_source_pdf_key(),
    provider_response_key: str = default_curriculum_provider_response_key(),
    layout_elements_key: str = default_curriculum_layout_elements_key(),
    output_dir: Path | None = None,
    prompt_runs: int = DEFAULT_PROMPT_RUNS,
    repeatability_threshold: float = DEFAULT_REPEATABILITY_THRESHOLD,
    prompt_transport: str | None = None,
    max_inflight_pages: int = DEFAULT_MAX_INFLIGHT_PAGES,
    max_request_attempts: int = DEFAULT_MAX_REQUEST_ATTEMPTS,
    resume: bool = False,
) -> CurriculumCourseMapProbeReport:
    if prompt_runs <= 0:
        raise ValueError("prompt_runs must be greater than zero")
    if max_inflight_pages <= 0:
        raise ValueError("max_inflight_pages must be greater than zero")
    if max_request_attempts <= 0:
        raise ValueError("max_request_attempts must be greater than zero")
    if resume and output_dir is None:
        raise ValueError("output_dir is required when resume is enabled")
    runtime_object_store = object_store
    if runtime_object_store is None and (
        pdf_bytes is None or provider_response_bytes is None or layout_elements_bytes is None
    ):
        from campus_ingestion_core.object_store_admin import S3ObjectStoreAdmin
        from campus_ingestion_core.settings import ObjectStoreSettings

        runtime_object_store = S3ObjectStoreAdmin(ObjectStoreSettings.from_env(source))
    if pdf_bytes is None:
        if runtime_object_store is None:
            raise ValueError("object_store is required when pdf_bytes is not provided")
        pdf_bytes = runtime_object_store.get_bytes(bucket=source_bucket, key=source_pdf_key)
    if provider_response_bytes is None:
        if runtime_object_store is None:
            raise ValueError(
                "object_store is required when provider_response_bytes is not provided"
            )
        provider_response_bytes = runtime_object_store.get_bytes(
            bucket=source_bucket,
            key=provider_response_key,
        )
    if layout_elements_bytes is None:
        if runtime_object_store is None:
            raise ValueError("object_store is required when layout_elements_bytes is not provided")
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
    sample_manifest = load_curriculum_course_map_sample_manifest(Path(sample_manifest_path))
    gold_manifest = load_curriculum_course_map_gold_manifest(Path(gold_manifest_path))
    resolved_prompt_transport = _normalize_prompt_runtime_transport(
        prompt_transport
        or source.get("PROMPT_RUNTIME_TRANSPORT")
        or DEFAULT_PROMPT_RUNTIME_TRANSPORT
    )
    selected_entries = select_curriculum_course_map_samples(
        inventory=inventory,
        sample_manifest=sample_manifest,
    )
    render_dir = None if output_dir is None else Path(output_dir) / "renders"
    rendered_samples = tuple(
        render_curriculum_course_map_sample(
            pdf_bytes=pdf_bytes,
            entry=entry,
            sample_id=selection.sample_id,
            output_dir=render_dir,
        )
        for selection, entry in selected_entries
    )
    if output_dir is not None:
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        probe_config = _build_probe_config(
            prompt_transport=resolved_prompt_transport,
            prompt_runs=prompt_runs,
            max_inflight_pages=max_inflight_pages,
            max_request_attempts=max_request_attempts,
            source_bucket=source_bucket,
            source_pdf_key=source_pdf_key,
            provider_response_key=provider_response_key,
            layout_elements_key=layout_elements_key,
            split_manifest_path=Path(split_manifest_path),
            sample_manifest_path=Path(sample_manifest_path),
            gold_manifest_path=Path(gold_manifest_path),
        )
        if resume:
            _validate_resume_probe_config(output_path=output_path, expected=probe_config)
        else:
            _write_json(output_path / "probe-config.json", probe_config)
        _write_json(output_path / "inventory.json", [asdict(item) for item in inventory])
        _write_json(
            output_path / "selected-samples.json",
            [
                {"selection": asdict(selection), "inventory": asdict(entry)}
                for selection, entry in selected_entries
            ],
        )
    runs = asyncio.run(
        _run_curriculum_course_map_probe_runs_async(
            source=source,
            rendered_samples=rendered_samples,
            output_dir=Path(output_dir) if output_dir is not None else None,
            prompt_runs=prompt_runs,
            prompt_transport=resolved_prompt_transport,
            max_inflight_pages=max_inflight_pages,
            max_request_attempts=max_request_attempts,
            resume=resume,
        )
    )
    repeatability = build_curriculum_course_map_repeatability_report(
        runs=runs,
        threshold=repeatability_threshold,
    )
    gold = build_curriculum_course_map_gold_report(runs=runs, gold_manifest=gold_manifest)
    admission = build_curriculum_course_map_admission_summary(
        repeatability=repeatability,
        gold=gold,
    )
    report = CurriculumCourseMapProbeReport(
        schema_version=CURRICULUM_COURSE_MAP_PROBE_SCHEMA_VERSION,
        source_bucket=source_bucket,
        raw_asset_id=DEFAULT_CURRICULUM_RAW_ASSET_ID,
        raw_version_id=DEFAULT_CURRICULUM_RAW_VERSION_ID,
        source_pdf_key=source_pdf_key,
        provider_response_key=provider_response_key,
        layout_elements_key=layout_elements_key,
        inventory_count=len(inventory),
        selected_sample_count=len(selected_entries),
        sample_ids=tuple(selection.sample_id for selection, _ in selected_entries),
        run_count=len(runs),
        output_dir=str(Path(output_dir).resolve()) if output_dir is not None else None,
        runs=runs,
        repeatability=repeatability,
        gold=gold,
        admission=admission,
    )
    if output_dir is not None:
        output_path = Path(output_dir)
        _write_json(output_path / "runs.json", [asdict(item) for item in runs])
        _write_json(output_path / "repeatability.json", asdict(repeatability))
        _write_json(output_path / "gold.json", asdict(gold))
        _write_json(output_path / "admission-summary.json", asdict(admission))
        _write_json(output_path / "probe-report.json", asdict(report))
    return report


__all__ = [
    "CURRICULUM_COURSE_MAP_GOLD_MANIFEST_VERSION",
    "CURRICULUM_COURSE_MAP_PROBE_SCHEMA_VERSION",
    "CURRICULUM_COURSE_MAP_SAMPLE_MANIFEST_VERSION",
    "CourseMapEdge",
    "CourseMapFinding",
    "CourseMapNode",
    "CurriculumCourseMapAdmissionSummary",
    "CurriculumCourseMapGoldExpectation",
    "CurriculumCourseMapGoldMapExpectation",
    "CurriculumCourseMapGoldPageScore",
    "CurriculumCourseMapGoldReport",
    "CurriculumCourseMapInventoryEntry",
    "CurriculumCourseMapPageProbe",
    "CurriculumCourseMapProbeReport",
    "CurriculumCourseMapProbeRun",
    "CurriculumCourseMapRenderedRegion",
    "CurriculumCourseMapRenderedSample",
    "CurriculumCourseMapRepeatabilityPageScore",
    "CurriculumCourseMapRepeatabilityReport",
    "CurriculumCourseMapSampleSelection",
    "DetectedCourseMapRegion",
    "build_curriculum_course_map_admission_summary",
    "build_curriculum_course_map_gold_report",
    "build_curriculum_course_map_inventory",
    "build_curriculum_course_map_repeatability_report",
    "default_curriculum_layout_elements_key",
    "default_curriculum_provider_response_key",
    "default_curriculum_source_pdf_key",
    "derive_provider_canvas",
    "load_curriculum_course_map_gold_manifest",
    "load_curriculum_course_map_sample_manifest",
    "load_provider_page_heights",
    "project_provider_bbox_to_pdf_rect",
    "render_curriculum_course_map_sample",
    "run_curriculum_course_map_multimodal_probe",
    "select_curriculum_course_map_samples",
]
