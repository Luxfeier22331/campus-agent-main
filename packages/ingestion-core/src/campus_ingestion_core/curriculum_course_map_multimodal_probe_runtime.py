from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import asdict
from pathlib import Path

import httpx

from campus_ingestion_core.curriculum_course_map_multimodal_probe_coercion import (
    _build_page_probe_from_detected_and_extracted,
    _coerce_course_map_finding,
    _coerce_detected_regions_payload,
    _extract_chat_completions_output_parsed,
    _extract_output_parsed,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_prompt import (
    _build_course_map_detector_content,
    _build_course_map_region_content,
    _curriculum_course_map_detector_schema,
    _curriculum_course_map_region_schema,
    _normalize_prompt_runtime_transport,
    _png_data_url,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_render import (
    _build_rendered_region,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_runtime_support import (
    _append_jsonl,
    _build_progress_state,
    _detected_maps_path,
    _extracted_map_path,
    _is_retryable_probe_exception,
    _load_detected_maps_checkpoint,
    _load_extracted_map_checkpoint,
    _load_page_probe_checkpoint,
    _page_summary_path,
    _resolve_base_url,
    _sample_output_dir,
)
from campus_ingestion_core.curriculum_course_map_multimodal_probe_shared import (
    DEFAULT_MAX_REQUEST_ATTEMPTS,
    DEFAULT_PROMPT_RUNTIME_CONNECT_TIMEOUT_SECONDS,
    DEFAULT_PROMPT_RUNTIME_POOL_TIMEOUT_SECONDS,
    DEFAULT_PROMPT_RUNTIME_READ_TIMEOUT_SECONDS,
    DEFAULT_PROMPT_RUNTIME_WRITE_TIMEOUT_SECONDS,
    CourseMapFinding,
    CurriculumCourseMapPageProbe,
    CurriculumCourseMapProbeRun,
    CurriculumCourseMapRenderedRegion,
    CurriculumCourseMapRenderedSample,
    DetectedCourseMapRegion,
    PromptRuntimeTransport,
    _write_json,
)

_DEFAULT_TIMEOUT = httpx.Timeout(
    connect=DEFAULT_PROMPT_RUNTIME_CONNECT_TIMEOUT_SECONDS,
    read=DEFAULT_PROMPT_RUNTIME_READ_TIMEOUT_SECONDS,
    write=DEFAULT_PROMPT_RUNTIME_WRITE_TIMEOUT_SECONDS,
    pool=DEFAULT_PROMPT_RUNTIME_POOL_TIMEOUT_SECONDS,
)

AttemptRecorder = Callable[[dict[str, object]], Awaitable[None]]


async def _run_curriculum_course_map_probe_runs_async(
    *,
    source: dict[str, str],
    rendered_samples: tuple[CurriculumCourseMapRenderedSample, ...],
    output_dir: Path | None,
    prompt_runs: int,
    prompt_transport: PromptRuntimeTransport,
    max_inflight_pages: int,
    max_request_attempts: int,
    resume: bool,
) -> tuple[CurriculumCourseMapProbeRun, ...]:
    progress_state = _build_progress_state(
        rendered_samples=rendered_samples, prompt_runs=prompt_runs
    )
    metrics_lock = asyncio.Lock()
    progress_lock = asyncio.Lock()
    async with httpx.AsyncClient(
        base_url=_resolve_base_url(source), timeout=_DEFAULT_TIMEOUT
    ) as http_client:
        runs: list[CurriculumCourseMapProbeRun] = []
        for run_index in range(1, prompt_runs + 1):
            run = await _run_curriculum_course_map_probe_run_async(
                run_index=run_index,
                source=source,
                rendered_samples=rendered_samples,
                output_dir=output_dir,
                prompt_transport=prompt_transport,
                max_inflight_pages=max_inflight_pages,
                max_request_attempts=max_request_attempts,
                resume=resume,
                http_client=http_client,
                progress_state=progress_state,
                progress_lock=progress_lock,
                metrics_lock=metrics_lock,
            )
            runs.append(run)
        return tuple(runs)


async def _run_curriculum_course_map_probe_run_async(
    *,
    run_index: int,
    source: dict[str, str],
    rendered_samples: tuple[CurriculumCourseMapRenderedSample, ...],
    output_dir: Path | None,
    prompt_transport: PromptRuntimeTransport,
    max_inflight_pages: int,
    max_request_attempts: int,
    resume: bool,
    http_client: httpx.AsyncClient | None,
    progress_state: dict[str, object] | None = None,
    progress_lock: asyncio.Lock | None = None,
    metrics_lock: asyncio.Lock | None = None,
) -> CurriculumCourseMapProbeRun:
    semaphore = asyncio.Semaphore(max_inflight_pages)
    pages: list[CurriculumCourseMapPageProbe | None] = [None] * len(rendered_samples)

    async def record_metric(row: dict[str, object]) -> None:
        if output_dir is None:
            return
        if metrics_lock is None:
            _append_jsonl(output_dir / "page-metrics.jsonl", row)
            return
        async with metrics_lock:
            _append_jsonl(output_dir / "page-metrics.jsonl", row)

    async def update_progress(sample_id: str) -> None:
        if output_dir is None or progress_state is None:
            return
        run_key = str(run_index)
        completed = progress_state.setdefault("completed_pages_by_run", {})
        sample_ids = completed.setdefault(run_key, [])
        if sample_id not in sample_ids:
            sample_ids.append(sample_id)
            sample_ids.sort()
        completed_runs = progress_state.setdefault("completed_runs", [])
        if len(sample_ids) == len(rendered_samples) and run_key not in completed_runs:
            completed_runs.append(run_key)
            completed_runs.sort()
        progress_state["updated_at_epoch_seconds"] = round(time.time(), 3)
        if progress_lock is None:
            _write_json(output_dir / "progress.json", progress_state)
            return
        async with progress_lock:
            _write_json(output_dir / "progress.json", progress_state)

    async def execute_sample(
        index: int, sample: CurriculumCourseMapRenderedSample
    ) -> tuple[int, CurriculumCourseMapPageProbe]:
        sample_dir = (
            _sample_output_dir(
                output_dir=output_dir, run_index=run_index, sample_id=sample.sample_id
            )
            if output_dir is not None
            else None
        )
        summary_path = (
            _page_summary_path(
                output_dir=output_dir, run_index=run_index, sample_id=sample.sample_id
            )
            if output_dir is not None
            else None
        )
        if resume and summary_path is not None and summary_path.exists():
            page = _load_page_probe_checkpoint(summary_path)
            await record_metric(
                {
                    "run_index": run_index,
                    "sample_id": sample.sample_id,
                    "map_index": None,
                    "stage": "page",
                    "attempt": 0,
                    "transport": prompt_transport,
                    "status": "checkpoint_reused",
                    "duration_ms": 0,
                    "started_at_epoch_seconds": round(time.time(), 3),
                    "completed_at_epoch_seconds": round(time.time(), 3),
                }
            )
            await update_progress(sample.sample_id)
            return index, page

        async with semaphore:
            page = await _probe_curriculum_course_map_page_async(
                source=source,
                rendered_sample=sample,
                prompt_transport=prompt_transport,
                max_request_attempts=max_request_attempts,
                http_client=http_client,
                on_attempt=record_metric,
                run_index=run_index,
                output_dir=sample_dir,
                resume=resume,
            )
        if summary_path is not None:
            summary_path.parent.mkdir(parents=True, exist_ok=True)
            _write_json(summary_path, asdict(page))
        await update_progress(sample.sample_id)
        return index, page

    results = await asyncio.gather(
        *(execute_sample(index, sample) for index, sample in enumerate(rendered_samples))
    )
    for index, page in results:
        pages[index] = page
    return CurriculumCourseMapProbeRun(
        run_index=run_index,
        pages=tuple(page for page in pages if page is not None),
    )


async def _probe_curriculum_course_map_page_async(
    *,
    source: dict[str, str],
    rendered_sample: CurriculumCourseMapRenderedSample,
    prompt_transport: PromptRuntimeTransport,
    max_request_attempts: int,
    http_client: httpx.AsyncClient | None,
    on_attempt: AttemptRecorder,
    run_index: int,
    output_dir: Path | None,
    resume: bool,
) -> CurriculumCourseMapPageProbe:
    checkpoint_path = (
        _detected_maps_path(
            output_dir=output_dir, run_index=run_index, sample_id=rendered_sample.sample_id
        )
        if output_dir is not None
        else None
    )
    if resume and checkpoint_path is not None and checkpoint_path.exists():
        detected_maps = _load_detected_maps_checkpoint(checkpoint_path)
        await on_attempt(
            {
                "run_index": run_index,
                "sample_id": rendered_sample.sample_id,
                "map_index": None,
                "stage": "detect",
                "attempt": 0,
                "transport": prompt_transport,
                "status": "checkpoint_reused",
                "duration_ms": 0,
                "started_at_epoch_seconds": round(time.time(), 3),
                "completed_at_epoch_seconds": round(time.time(), 3),
            }
        )
    else:
        detected_maps = await _detect_curriculum_course_map_regions_async(
            source=source,
            rendered_sample=rendered_sample,
            prompt_transport=prompt_transport,
            max_request_attempts=max_request_attempts,
            http_client=http_client,
            on_attempt=on_attempt,
            run_index=run_index,
        )
        if checkpoint_path is not None:
            checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
            _write_json(checkpoint_path, [asdict(region) for region in detected_maps])

    extracted_maps: list[CourseMapFinding] = []
    for detected_region in detected_maps:
        map_path = (
            _extracted_map_path(
                output_dir=output_dir,
                run_index=run_index,
                sample_id=rendered_sample.sample_id,
                map_index=detected_region.map_index,
            )
            if output_dir is not None
            else None
        )
        if resume and map_path is not None and map_path.exists():
            finding = _load_extracted_map_checkpoint(map_path)
            await on_attempt(
                {
                    "run_index": run_index,
                    "sample_id": rendered_sample.sample_id,
                    "map_index": detected_region.map_index,
                    "stage": "extract",
                    "attempt": 0,
                    "transport": prompt_transport,
                    "status": "checkpoint_reused",
                    "duration_ms": 0,
                    "started_at_epoch_seconds": round(time.time(), 3),
                    "completed_at_epoch_seconds": round(time.time(), 3),
                }
            )
        else:
            rendered_region = _build_rendered_region(
                rendered_sample=rendered_sample,
                detected_region=detected_region,
                output_dir=(output_dir / "regions") if output_dir is not None else None,
            )
            finding = await _extract_curriculum_course_map_region_async(
                source=source,
                rendered_sample=rendered_sample,
                rendered_region=rendered_region,
                prompt_transport=prompt_transport,
                max_request_attempts=max_request_attempts,
                http_client=http_client,
                on_attempt=on_attempt,
                run_index=run_index,
            )
            if map_path is not None:
                map_path.parent.mkdir(parents=True, exist_ok=True)
                _write_json(map_path, asdict(finding))
        extracted_maps.append(finding)
    return _build_page_probe_from_detected_and_extracted(
        rendered_sample=rendered_sample,
        detected_maps=detected_maps,
        extracted_maps=tuple(sorted(extracted_maps, key=lambda item: item.map_index)),
    )


async def _detect_curriculum_course_map_regions_async(
    *,
    source: dict[str, str],
    rendered_sample: CurriculumCourseMapRenderedSample,
    prompt_transport: PromptRuntimeTransport,
    max_request_attempts: int,
    http_client: httpx.AsyncClient | None,
    on_attempt: AttemptRecorder,
    run_index: int,
) -> tuple[DetectedCourseMapRegion, ...]:
    payload = await _request_course_map_detector_payload_async(
        transport=prompt_transport,
        source=source,
        rendered_sample=rendered_sample,
        http_client=http_client,
        max_request_attempts=max_request_attempts,
        on_attempt=on_attempt,
        run_index=run_index,
    )
    return _coerce_detected_regions_payload(rendered_sample=rendered_sample, payload=payload)


async def _extract_curriculum_course_map_region_async(
    *,
    source: dict[str, str],
    rendered_sample: CurriculumCourseMapRenderedSample,
    rendered_region: CurriculumCourseMapRenderedRegion,
    prompt_transport: PromptRuntimeTransport,
    max_request_attempts: int,
    http_client: httpx.AsyncClient | None,
    on_attempt: AttemptRecorder,
    run_index: int,
) -> CourseMapFinding:
    payload = await _request_course_map_region_payload_async(
        transport=prompt_transport,
        source=source,
        rendered_sample=rendered_sample,
        rendered_region=rendered_region,
        http_client=http_client,
        max_request_attempts=max_request_attempts,
        on_attempt=on_attempt,
        run_index=run_index,
    )
    return _coerce_course_map_finding(
        {
            "map_index": rendered_region.detected_region.map_index,
            "map_title": payload.get("map_title"),
            "stage_labels": payload.get("stage_labels") or (),
            "nodes": payload.get("nodes") or (),
            "edges": payload.get("edges") or (),
            "manual_review_notes": payload.get("manual_review_notes") or (),
        }
    )


async def _request_course_map_detector_payload_async(
    *,
    transport: PromptRuntimeTransport,
    source: dict[str, str],
    rendered_sample: CurriculumCourseMapRenderedSample,
    http_client: httpx.AsyncClient | None,
    max_request_attempts: int,
    on_attempt: AttemptRecorder,
    run_index: int,
) -> dict[str, object]:
    return await _request_structured_multimodal_payload_async(
        transport=transport,
        source=source,
        path_label="detect",
        schema=_curriculum_course_map_detector_schema(),
        system_prompt=(
            "You are detecting bounded course-map regions inside a curriculum page image crop. "
            "A single course map spanning most of the crop still counts as one detected map region, "
            "so return one full-region bbox instead of an empty list in that case. "
            "Return one JSON object with key detected_maps. "
            "Each detected map item must use exactly these keys: "
            "map_title, title_confidence, region_bbox_normalized, manual_review_notes. "
            "Do not rename them to aliases like regions, map_regions, or bbox. "
            "Do not invent missing titles. If the title is not clearly visible, return map_title as null "
            "and title_confidence as absent or partial."
        ),
        user_content=_build_course_map_detector_content(rendered_sample=rendered_sample),
        rendered_sample=rendered_sample,
        http_client=http_client,
        max_request_attempts=max_request_attempts,
        on_attempt=on_attempt,
        run_index=run_index,
        map_index=None,
    )


async def _request_course_map_region_payload_async(
    *,
    transport: PromptRuntimeTransport,
    source: dict[str, str],
    rendered_sample: CurriculumCourseMapRenderedSample,
    rendered_region: CurriculumCourseMapRenderedRegion,
    http_client: httpx.AsyncClient | None,
    max_request_attempts: int,
    on_attempt: AttemptRecorder,
    run_index: int,
) -> dict[str, object]:
    return await _request_structured_multimodal_payload_async(
        transport=transport,
        source=source,
        path_label="extract",
        schema=_curriculum_course_map_region_schema(),
        system_prompt=(
            "You are extracting one bounded curriculum course map. "
            "Stability is more important than recall. "
            "Return one JSON object with exactly these top-level keys: "
            "map_title, stage_labels, nodes, edges, manual_review_notes. "
            "Each node must use keys node_label, stage_label, category_label. "
            "Each edge must use keys source_label and target_label. "
            "Do not rename them to label, id, from, or to. "
            "Only output edges whose arrow direction is clearly visible. "
            "Do not infer missing edges, hidden prerequisites, or off-region content. "
            "If a stage or category is unclear, use an empty string instead of omitting the field. "
            "If no clear map title is visible inside this region, return map_title as null."
        ),
        user_content=_build_course_map_region_content(
            rendered_sample=rendered_sample,
            rendered_region=rendered_region,
        ),
        rendered_sample=rendered_sample,
        http_client=http_client,
        max_request_attempts=max_request_attempts,
        on_attempt=on_attempt,
        run_index=run_index,
        map_index=rendered_region.detected_region.map_index,
    )


async def _request_structured_multimodal_payload_async(
    *,
    transport: PromptRuntimeTransport,
    source: dict[str, str],
    path_label: str,
    schema: dict[str, object],
    system_prompt: str,
    user_content: list[dict[str, object]],
    rendered_sample: CurriculumCourseMapRenderedSample,
    http_client: httpx.AsyncClient | None,
    max_request_attempts: int,
    on_attempt: AttemptRecorder,
    run_index: int,
    map_index: int | None,
) -> dict[str, object]:
    api_key = (source.get("PROMPT_RUNTIME_API_KEY") or "").strip()
    model_name = (source.get("PROMPT_RUNTIME_MODEL") or "").strip()
    reasoning_effort = (source.get("PROMPT_RUNTIME_REASONING_EFFORT") or "").strip()
    max_output_tokens = (source.get("PROMPT_RUNTIME_MAX_OUTPUT_TOKENS") or "").strip()
    if not api_key:
        raise ValueError("PROMPT_RUNTIME_API_KEY is required for curriculum course-map probe")
    if not model_name:
        raise ValueError("PROMPT_RUNTIME_MODEL is required for curriculum course-map probe")
    if http_client is None:
        raise ValueError("http_client is required for async probe requests")
    if transport == "responses":
        payload: dict[str, object] = {
            "model": model_name,
            "stream": False,
            "input": _build_responses_multimodal_input(
                system_prompt=system_prompt,
                user_content=user_content,
            ),
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": f"curriculum_course_map_{path_label}",
                    "schema": schema,
                    "strict": True,
                }
            },
        }
        if reasoning_effort:
            payload["reasoning"] = {"effort": reasoning_effort}
        if max_output_tokens:
            payload["max_output_tokens"] = int(max_output_tokens)
        response_json = await _post_probe_json_async(
            http_client=http_client,
            path="/responses",
            payload=payload,
            api_key=api_key,
            max_request_attempts=max_request_attempts,
            on_attempt=on_attempt,
            run_index=run_index,
            sample_id=rendered_sample.sample_id,
            transport="responses",
            stage=path_label,
            map_index=map_index,
        )
        raw_payload = response_json.get("output_parsed")
        if raw_payload is None:
            raw_payload = _extract_output_parsed(response_json)
        if not isinstance(raw_payload, dict):
            raise ValueError("curriculum course-map probe parsed payload must be a JSON object")
        return raw_payload

    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": f"curriculum_course_map_{path_label}",
                "schema": schema,
                "strict": True,
            },
        },
    }
    if reasoning_effort:
        payload["reasoning_effort"] = reasoning_effort
    if max_output_tokens:
        payload["max_completion_tokens"] = int(max_output_tokens)
    response_json = await _post_probe_json_async(
        http_client=http_client,
        path="/chat/completions",
        payload=payload,
        api_key=api_key,
        max_request_attempts=max_request_attempts,
        on_attempt=on_attempt,
        run_index=run_index,
        sample_id=rendered_sample.sample_id,
        transport="chat_completions",
        stage=path_label,
        map_index=map_index,
    )
    raw_payload = _extract_chat_completions_output_parsed(response_json)
    if not isinstance(raw_payload, dict):
        raise ValueError("curriculum course-map probe parsed payload must be a JSON object")
    return raw_payload


def _build_responses_multimodal_input(
    *,
    system_prompt: str,
    user_content: list[dict[str, object]],
) -> list[dict[str, object]]:
    return [
        {
            "role": "system",
            "type": "message",
            "content": system_prompt,
        },
        {
            "role": "user",
            "type": "message",
            "content": _to_responses_multimodal_content(user_content),
        },
    ]


def _to_responses_multimodal_content(
    content: list[dict[str, object]],
) -> list[dict[str, object]]:
    converted: list[dict[str, object]] = []
    for item in content:
        item_type = item.get("type")
        if item_type == "text":
            converted.append({"type": "input_text", "text": str(item.get("text") or "")})
            continue
        if item_type == "image_url":
            image_url = item.get("image_url")
            if isinstance(image_url, dict):
                url = str(image_url.get("url") or "").strip()
                detail = str(image_url.get("detail") or "").strip()
            else:
                url = str(image_url or "").strip()
                detail = str(item.get("detail") or "").strip()
            if not url:
                raise ValueError("image_url content item missing url")
            converted_item: dict[str, object] = {"type": "input_image", "image_url": url}
            if detail:
                converted_item["detail"] = detail
            converted.append(converted_item)
            continue
        converted.append(dict(item))
    return converted


async def _post_probe_json_async(
    *,
    http_client: httpx.AsyncClient,
    path: str,
    payload: dict[str, object],
    api_key: str,
    max_request_attempts: int = DEFAULT_MAX_REQUEST_ATTEMPTS,
    on_attempt: AttemptRecorder,
    run_index: int,
    sample_id: str,
    transport: str,
    stage: str,
    map_index: int | None,
) -> dict[str, object]:
    last_error: Exception | None = None
    for attempt in range(1, max_request_attempts + 1):
        started_at = time.time()
        duration_ms = 0
        try:
            response = await http_client.post(
                path,
                json=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
            )
            duration_ms = round((time.time() - started_at) * 1000)
            await on_attempt(
                {
                    "run_index": run_index,
                    "sample_id": sample_id,
                    "map_index": map_index,
                    "stage": stage,
                    "attempt": attempt,
                    "transport": transport,
                    "status": response.status_code,
                    "duration_ms": duration_ms,
                    "started_at_epoch_seconds": round(started_at, 3),
                    "completed_at_epoch_seconds": round(started_at + (duration_ms / 1000), 3),
                }
            )
            if (
                response.status_code == 429 or 500 <= response.status_code < 600
            ) and attempt < max_request_attempts:
                await asyncio.sleep(float(2 ** (attempt - 1)))
                continue
            response.raise_for_status()
            response_json = response.json()
            if not isinstance(response_json, dict):
                raise ValueError("curriculum course-map probe response must be a JSON object")
            return response_json
        except Exception as exc:
            last_error = exc
            duration_ms = round((time.time() - started_at) * 1000)
            await on_attempt(
                {
                    "run_index": run_index,
                    "sample_id": sample_id,
                    "map_index": map_index,
                    "stage": stage,
                    "attempt": attempt,
                    "transport": transport,
                    "status": type(exc).__name__,
                    "duration_ms": duration_ms,
                    "started_at_epoch_seconds": round(started_at, 3),
                    "completed_at_epoch_seconds": round(started_at + (duration_ms / 1000), 3),
                }
            )
            if not _is_retryable_probe_exception(exc) or attempt >= max_request_attempts:
                if isinstance(exc, httpx.HTTPStatusError):
                    raise ValueError(
                        f"curriculum course-map probe request failed: {exc.response.status_code} {exc.response.text}"
                    ) from exc
                raise
            await asyncio.sleep(float(2 ** (attempt - 1)))
    if last_error is None:  # pragma: no cover
        raise RuntimeError("unreachable")
    raise last_error


__all__ = [
    "_build_course_map_detector_content",
    "_build_course_map_region_content",
    "_curriculum_course_map_detector_schema",
    "_curriculum_course_map_region_schema",
    "_detect_curriculum_course_map_regions_async",
    "_extract_curriculum_course_map_region_async",
    "_normalize_prompt_runtime_transport",
    "_png_data_url",
    "_post_probe_json_async",
    "_probe_curriculum_course_map_page_async",
    "_request_course_map_detector_payload_async",
    "_request_course_map_region_payload_async",
    "_request_structured_multimodal_payload_async",
    "_run_curriculum_course_map_probe_run_async",
    "_run_curriculum_course_map_probe_runs_async",
]
