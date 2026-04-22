from __future__ import annotations

import json
import time
from pathlib import Path

import httpx

from campus_ingestion_core.curriculum_course_map_multimodal_probe_coercion import (
    _coerce_course_map_finding,
    _coerce_detected_course_map_region,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_shared import (
    CURRICULUM_COURSE_MAP_PROBE_SCHEMA_VERSION,
    DEFAULT_PROMPT_RUNTIME_BASE_URL,
    CurriculumCourseMapPageProbe,
    CurriculumCourseMapRenderedSample,
)


def _build_probe_config(
    *,
    prompt_transport: str,
    prompt_runs: int,
    max_inflight_pages: int,
    max_request_attempts: int,
    source_bucket: str,
    source_pdf_key: str,
    provider_response_key: str,
    layout_elements_key: str,
    split_manifest_path: Path,
    sample_manifest_path: Path,
    gold_manifest_path: Path,
) -> dict[str, object]:
    return {
        "schema_version": CURRICULUM_COURSE_MAP_PROBE_SCHEMA_VERSION,
        "prompt_transport": prompt_transport,
        "prompt_runs": prompt_runs,
        "max_inflight_pages": max_inflight_pages,
        "max_request_attempts": max_request_attempts,
        "source_bucket": source_bucket,
        "source_pdf_key": source_pdf_key,
        "provider_response_key": provider_response_key,
        "layout_elements_key": layout_elements_key,
        "split_manifest_path": str(split_manifest_path.resolve()),
        "sample_manifest_path": str(sample_manifest_path.resolve()),
        "gold_manifest_path": str(gold_manifest_path.resolve()),
    }


def _validate_resume_probe_config(*, output_path: Path, expected: dict[str, object]) -> None:
    config_path = output_path / "probe-config.json"
    if not config_path.exists():
        raise ValueError("resume requires existing probe-config.json")
    actual = json.loads(config_path.read_text(encoding="utf-8"))
    if actual != expected:
        raise ValueError("resume probe-config.json does not match current probe configuration")


def _resolve_base_url(source: dict[str, str]) -> str:
    return (
        source.get("PROMPT_RUNTIME_BASE_URL")
        or source.get("LLM_BASE_URL")
        or DEFAULT_PROMPT_RUNTIME_BASE_URL
    ).strip()


def _build_progress_state(
    *,
    rendered_samples: tuple[CurriculumCourseMapRenderedSample, ...],
    prompt_runs: int,
) -> dict[str, object]:
    return {
        "schema_version": CURRICULUM_COURSE_MAP_PROBE_SCHEMA_VERSION,
        "sample_ids": [sample.sample_id for sample in rendered_samples],
        "prompt_runs": prompt_runs,
        "completed_pages_by_run": {str(run_index): [] for run_index in range(1, prompt_runs + 1)},
        "completed_runs": [],
        "updated_at_epoch_seconds": round(time.time(), 3),
    }


def _sample_output_dir(*, output_dir: Path, run_index: int, sample_id: str) -> Path:
    return output_dir / "page-results" / f"run-{run_index:02d}" / sample_id


def _detected_maps_path(*, output_dir: Path, run_index: int, sample_id: str) -> Path:
    return (
        _sample_output_dir(output_dir=output_dir, run_index=run_index, sample_id=sample_id)
        / "detected-maps.json"
    )


def _extracted_map_path(
    *,
    output_dir: Path,
    run_index: int,
    sample_id: str,
    map_index: int,
) -> Path:
    return (
        _sample_output_dir(output_dir=output_dir, run_index=run_index, sample_id=sample_id)
        / "maps"
        / f"map-{map_index:02d}.json"
    )


def _page_summary_path(*, output_dir: Path, run_index: int, sample_id: str) -> Path:
    return (
        _sample_output_dir(output_dir=output_dir, run_index=run_index, sample_id=sample_id)
        / "page-summary.json"
    )


def _load_detected_maps_checkpoint(path: Path):
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("detected-maps checkpoint must be a JSON list")
    return tuple(_coerce_detected_course_map_region(item) for item in payload)


def _load_extracted_map_checkpoint(path: Path):
    payload = json.loads(path.read_text(encoding="utf-8"))
    return _coerce_course_map_finding(payload)


def _load_page_probe_checkpoint(path: Path) -> CurriculumCourseMapPageProbe:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("page probe checkpoint must be a JSON object")
    return CurriculumCourseMapPageProbe(
        sample_id=str(payload.get("sample_id") or "").strip(),
        page_number=int(payload.get("page_number") or 0),
        document_id=str(payload.get("document_id") or "").strip(),
        document_title=str(payload.get("document_title") or "").strip(),
        parent_heading_hint=str(payload.get("parent_heading_hint") or "").strip(),
        detected_maps=tuple(
            _coerce_detected_course_map_region(item) for item in payload.get("detected_maps") or ()
        ),
        course_maps=tuple(
            _coerce_course_map_finding(item) for item in payload.get("course_maps") or ()
        ),
        manual_review_required=bool(payload.get("manual_review_required", False)),
        global_manual_review_notes=tuple(
            str(value).strip() for value in payload.get("global_manual_review_notes") or ()
        ),
    )


def _append_jsonl(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def _is_retryable_probe_exception(exc: Exception) -> bool:
    if isinstance(
        exc,
        (
            httpx.ConnectError,
            httpx.ReadTimeout,
            httpx.WriteTimeout,
            httpx.PoolTimeout,
            httpx.ReadError,
        ),
    ):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code == 429 or 500 <= exc.response.status_code < 600
    return False


__all__ = [
    "_append_jsonl",
    "_build_probe_config",
    "_build_progress_state",
    "_detected_maps_path",
    "_extracted_map_path",
    "_is_retryable_probe_exception",
    "_load_detected_maps_checkpoint",
    "_load_extracted_map_checkpoint",
    "_load_page_probe_checkpoint",
    "_page_summary_path",
    "_resolve_base_url",
    "_sample_output_dir",
    "_validate_resume_probe_config",
]
