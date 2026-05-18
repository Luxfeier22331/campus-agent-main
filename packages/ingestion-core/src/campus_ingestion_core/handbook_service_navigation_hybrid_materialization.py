from __future__ import annotations

import json
from base64 import b64encode
from dataclasses import asdict, dataclass
from typing import Protocol

import httpx

from campus_ingestion_core.campusrag_ingestion_artifacts import ProcessedArtifactInput
from campus_ingestion_core.campusrag_ingestion_support import DocumentImportInput
from campus_ingestion_core.handbook_service_navigation_projection_support import (
    _build_handbook_service_navigation_hybrid_document_from_projection_bytes,
    _resolve_projection_extractor_runtime,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.object_store import (
    build_source_projection_artifact_key,
    infer_year_label,
)

FLOW_GRAPH_FILENAME = "flow-graph.json"
HANDOOK_SERVICE_NAVIGATION_PROJECTION_SCHEMA_VERSION = "handbook_service_navigation_projection_v1"
DEFAULT_PROMPT_RUNTIME_BASE_URL = "https://api.openai.com/v1"
DEFAULT_PROMPT_RUNTIME_CONNECT_TIMEOUT_SECONDS = 10.0
DEFAULT_PROMPT_RUNTIME_READ_TIMEOUT_SECONDS = 30.0
DEFAULT_PROMPT_RUNTIME_WRITE_TIMEOUT_SECONDS = 10.0
DEFAULT_PROMPT_RUNTIME_POOL_TIMEOUT_SECONDS = 3.0
DEFAULT_RENDER_DPI = 180


class ObjectStoreByteReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class ServiceNavigationStep:
    step_id: str
    step_text: str
    next_step_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.step_id.strip():
            raise ValueError("step_id is required")
        if not self.step_text.strip():
            raise ValueError("step_text is required")


@dataclass(frozen=True, slots=True)
class ServiceNavigationFlow:
    flow_heading: str
    audience_scope: str
    steps: tuple[ServiceNavigationStep, ...]
    manual_review_notes: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.flow_heading.strip():
            raise ValueError("flow_heading is required")


@dataclass(frozen=True, slots=True)
class ServiceNavigationPageFinding:
    source_page: int
    page_heading: str
    flows: tuple[ServiceNavigationFlow, ...]

    def __post_init__(self) -> None:
        if self.source_page <= 0:
            raise ValueError("source_page must be greater than zero")
        if not self.page_heading.strip():
            raise ValueError("page_heading is required")


@dataclass(frozen=True, slots=True)
class ServiceNavigationFlowGraph:
    document_title: str
    page_findings: tuple[ServiceNavigationPageFinding, ...]
    global_manual_review_required: bool

    def __post_init__(self) -> None:
        if not self.document_title.strip():
            raise ValueError("document_title is required")
        if not self.page_findings:
            raise ValueError("page_findings must not be empty")


def is_handbook_service_navigation_projection(
    *,
    projection_name: str,
    target_collection: str,
    attachment_role: str | None,
    source_page_start: int | None,
    source_page_end: int | None,
) -> bool:
    return (
        projection_name == "handbook_navigation_service_catalog"
        and target_collection == "service_catalog"
        and (attachment_role or "").strip() == "service_navigation_document"
        and source_page_start == 252
        and source_page_end == 255
    )


def build_handbook_service_navigation_hybrid_document(
    *,
    source: dict[str, str],
    reader: ObjectStoreByteReader,
    source_bucket: str,
    raw_asset_record: RawAssetRecord,
    source_document_id: str,
    source_uri: str,
    source_handbook_section: str,
    target_document_id: str,
    target_title: str,
    projection_name: str,
    derived_from: str,
    parent_document_id: str,
    attachment_kind: str | None,
    attachment_role: str | None,
    provider_response_key: str,
    layout_elements_key: str,
    source_page_start: int,
    source_page_end: int,
    entitlement_groups: tuple[str, ...],
    visibility_scope: str | None,
    visibility_level: str,
    import_source: str,
) -> DocumentImportInput:
    projection_artifact = materialize_handbook_service_navigation_projection_artifact(
        source=source,
        reader=reader,
        source_bucket=source_bucket,
        raw_asset_record=raw_asset_record,
        source_document_id=source_document_id,
        source_uri=source_uri,
        source_handbook_section=source_handbook_section,
        target_document_id=target_document_id,
        target_title=target_title,
        projection_name=projection_name,
        source_page_start=source_page_start,
        source_page_end=source_page_end,
    )
    return _build_handbook_service_navigation_hybrid_document_from_projection_bytes(
        projection_artifact_bytes=projection_artifact.data,
        projection_artifact_key=projection_artifact.object_key,
        raw_asset_record=raw_asset_record,
        source_document_id=source_document_id,
        source_uri=source_uri,
        source_handbook_section=source_handbook_section,
        target_document_id=target_document_id,
        target_title=target_title,
        projection_name=projection_name,
        derived_from=derived_from,
        parent_document_id=parent_document_id,
        attachment_kind=attachment_kind,
        attachment_role=attachment_role,
        provider_response_key=provider_response_key,
        layout_elements_key=layout_elements_key,
        source_page_start=source_page_start,
        source_page_end=source_page_end,
        entitlement_groups=entitlement_groups,
        visibility_scope=visibility_scope,
        visibility_level=visibility_level,
        import_source=import_source,
        additional_processed_artifacts=(projection_artifact,),
    )


def materialize_handbook_service_navigation_projection_artifact(
    *,
    source: dict[str, str],
    reader: ObjectStoreByteReader,
    source_bucket: str,
    raw_asset_record: RawAssetRecord,
    source_document_id: str,
    source_uri: str,
    source_handbook_section: str,
    target_document_id: str,
    target_title: str,
    projection_name: str,
    source_page_start: int,
    source_page_end: int,
) -> ProcessedArtifactInput:
    raw_pdf_bytes = reader.get_bytes(bucket=source_bucket, key=raw_asset_record.object_key)
    page_pngs = _render_declared_pdf_pages_to_pngs(
        pdf_bytes=raw_pdf_bytes,
        page_start=source_page_start,
        page_end=source_page_end,
    )
    flow_graph = _extract_service_navigation_flow_graph(
        source=source,
        target_title=target_title,
        page_images=page_pngs,
        source_page_start=source_page_start,
        source_page_end=source_page_end,
    )
    _validate_flow_graph(
        flow_graph=flow_graph,
        target_title=target_title,
        source_page_start=source_page_start,
        source_page_end=source_page_end,
    )

    year = infer_year_label(raw_asset_record.source_filename)
    flow_graph_key = build_source_projection_artifact_key(
        raw_asset_id=raw_asset_record.raw_asset_id,
        raw_version_id=raw_asset_record.raw_version_id,
        projection_name=projection_name,
        filename=FLOW_GRAPH_FILENAME,
        year=year,
    )
    flow_graph_bytes = (
        json.dumps(
            {
                "schema_version": HANDOOK_SERVICE_NAVIGATION_PROJECTION_SCHEMA_VERSION,
                "projection_name": projection_name,
                "raw_asset_id": raw_asset_record.raw_asset_id,
                "raw_version_id": raw_asset_record.raw_version_id,
                "source_document_id": source_document_id,
                "source_uri": source_uri,
                "source_handbook_section": source_handbook_section,
                "source_page_start": source_page_start,
                "source_page_end": source_page_end,
                "target_document_id": target_document_id,
                "target_title": target_title,
                "extractor_runtime": _resolve_projection_extractor_runtime(source),
                "flow_graph": asdict(flow_graph),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    ).encode("utf-8")
    return ProcessedArtifactInput(
        object_key=flow_graph_key,
        data=flow_graph_bytes,
        content_type="application/json",
    )


def build_handbook_service_navigation_hybrid_document_from_projection_artifact(
    *,
    reader: ObjectStoreByteReader,
    source_bucket: str,
    projection_artifact_key: str,
    raw_asset_record: RawAssetRecord,
    source_document_id: str,
    source_uri: str,
    source_handbook_section: str,
    target_document_id: str,
    target_title: str,
    projection_name: str,
    derived_from: str,
    parent_document_id: str,
    attachment_kind: str | None,
    attachment_role: str | None,
    provider_response_key: str,
    layout_elements_key: str,
    source_page_start: int,
    source_page_end: int,
    entitlement_groups: tuple[str, ...],
    visibility_scope: str | None,
    visibility_level: str,
    import_source: str,
) -> DocumentImportInput:
    projection_artifact_bytes = reader.get_bytes(bucket=source_bucket, key=projection_artifact_key)
    return _build_handbook_service_navigation_hybrid_document_from_projection_bytes(
        projection_artifact_bytes=projection_artifact_bytes,
        projection_artifact_key=projection_artifact_key,
        raw_asset_record=raw_asset_record,
        source_document_id=source_document_id,
        source_uri=source_uri,
        source_handbook_section=source_handbook_section,
        target_document_id=target_document_id,
        target_title=target_title,
        projection_name=projection_name,
        derived_from=derived_from,
        parent_document_id=parent_document_id,
        attachment_kind=attachment_kind,
        attachment_role=attachment_role,
        provider_response_key=provider_response_key,
        layout_elements_key=layout_elements_key,
        source_page_start=source_page_start,
        source_page_end=source_page_end,
        entitlement_groups=entitlement_groups,
        visibility_scope=visibility_scope,
        visibility_level=visibility_level,
        import_source=import_source,
        additional_processed_artifacts=(),
    )


def _validate_flow_graph(
    *,
    flow_graph: ServiceNavigationFlowGraph,
    target_title: str,
    source_page_start: int,
    source_page_end: int,
) -> None:
    if flow_graph.document_title.strip() != target_title.strip():
        raise ValueError("flow graph title mismatch")
    expected_pages = tuple(range(source_page_start, source_page_end + 1))
    actual_pages = tuple(page.source_page for page in flow_graph.page_findings)
    if actual_pages != expected_pages:
        raise ValueError(
            f"flow graph page mapping mismatch: expected {expected_pages}, got {actual_pages}"
        )
    if flow_graph.global_manual_review_required:
        raise ValueError("flow graph manual review state is not supported")
    has_body_bearing_steps = False
    for page_finding in flow_graph.page_findings:
        for flow in page_finding.flows:
            if flow.manual_review_notes:
                raise ValueError(
                    "flow graph manual review notes are not supported: "
                    f"page {page_finding.source_page} flow {flow.flow_heading!r}"
                )
            step_ids = {step.step_id for step in flow.steps}
            if flow.steps:
                has_body_bearing_steps = True
            for step in flow.steps:
                missing = [
                    next_step_id
                    for next_step_id in step.next_step_ids
                    if next_step_id not in step_ids
                ]
                if missing:
                    raise ValueError(
                        f"flow graph contains dangling next_step_ids on page {page_finding.source_page}: {missing}"
                    )
    if not has_body_bearing_steps:
        raise ValueError("flow graph must contain body-bearing steps")


def _render_declared_pdf_pages_to_pngs(
    *,
    pdf_bytes: bytes,
    page_start: int,
    page_end: int,
) -> tuple[tuple[int, bytes], ...]:
    try:
        import fitz
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("pymupdf is required for service navigation page rendering") from exc
    with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
        if page_end > document.page_count:
            raise ValueError(
                f"declared page range {page_start}-{page_end} exceeds PDF page_count {document.page_count}"
            )
        rendered: list[tuple[int, bytes]] = []
        for page_number in range(page_start, page_end + 1):
            page = document.load_page(page_number - 1)
            pixmap = page.get_pixmap(dpi=DEFAULT_RENDER_DPI, alpha=False)
            rendered.append((page_number, pixmap.tobytes("png")))
        return tuple(rendered)


def _extract_service_navigation_flow_graph(
    *,
    source: dict[str, str],
    target_title: str,
    page_images: tuple[tuple[int, bytes], ...],
    source_page_start: int,
    source_page_end: int,
) -> ServiceNavigationFlowGraph:
    api_key = (source.get("PROMPT_RUNTIME_API_KEY") or "").strip()
    model_name = (source.get("PROMPT_RUNTIME_MODEL") or "").strip()
    base_url = (source.get("PROMPT_RUNTIME_BASE_URL") or DEFAULT_PROMPT_RUNTIME_BASE_URL).strip()
    reasoning_effort = (source.get("PROMPT_RUNTIME_REASONING_EFFORT") or "").strip()
    max_output_tokens = (source.get("PROMPT_RUNTIME_MAX_OUTPUT_TOKENS") or "").strip()
    if not api_key:
        raise ValueError(
            "PROMPT_RUNTIME_API_KEY is required for service navigation hybrid extraction"
        )
    if not model_name:
        raise ValueError(
            "PROMPT_RUNTIME_MODEL is required for service navigation hybrid extraction"
        )

    system_text = (
        "You are extracting a bounded campus service navigation flow graph from declared PDF pages only. "
        "Return only verified page-local flow titles, steps, edges, and manual review notes. "
        "Do not invent pages, policies, or explanatory text beyond what is visible."
    )
    user_text = (
        f"Target title: {target_title}\n"
        f"Allowed source page range: {source_page_start}-{source_page_end}\n"
        "Return one page_finding for every allowed source page in ascending order, including pages with zero flows."
    )
    content: list[dict[str, object]] = [{"type": "input_text", "text": user_text}]
    for page_number, page_png in page_images:
        content.append({"type": "input_text", "text": f"Source page {page_number}"})
        content.append(
            {
                "type": "input_image",
                "image_url": f"data:image/png;base64,{b64encode(page_png).decode('ascii')}",
            }
        )
    payload: dict[str, object] = {
        "model": model_name,
        "stream": False,
        "input": [
            {
                "role": "system",
                "type": "message",
                "content": [{"type": "input_text", "text": system_text}],
            },
            {
                "role": "user",
                "type": "message",
                "content": content,
            },
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "service_navigation_flow_graph",
                "schema": _service_navigation_flow_graph_schema(),
                "strict": True,
            }
        },
    }
    if reasoning_effort:
        payload["reasoning"] = {"effort": reasoning_effort}
    if max_output_tokens:
        payload["max_output_tokens"] = int(max_output_tokens)
    timeout = httpx.Timeout(
        connect=DEFAULT_PROMPT_RUNTIME_CONNECT_TIMEOUT_SECONDS,
        read=DEFAULT_PROMPT_RUNTIME_READ_TIMEOUT_SECONDS,
        write=DEFAULT_PROMPT_RUNTIME_WRITE_TIMEOUT_SECONDS,
        pool=DEFAULT_PROMPT_RUNTIME_POOL_TIMEOUT_SECONDS,
    )
    with httpx.Client(base_url=base_url, timeout=timeout) as client:
        response = client.post(
            "/responses",
            json=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:  # pragma: no cover
        raise ValueError(
            f"service navigation hybrid extraction request failed: {response.status_code} {response.text}"
        ) from exc
    response_json = response.json()
    if not isinstance(response_json, dict):
        raise ValueError("service navigation hybrid extraction response must be a JSON object")
    if str(response_json.get("status", "")).strip() not in {"", "completed"}:
        raise ValueError(
            f"service navigation hybrid extraction status {response_json.get('status')!r}"
        )
    if response_json.get("error"):
        raise ValueError(json.dumps(response_json["error"], ensure_ascii=False))
    raw_payload = response_json.get("output_parsed")
    if raw_payload is None:
        raw_payload = _extract_output_parsed(response_json)
    return _coerce_flow_graph(raw_payload)


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
                return json.loads(text)
    raise ValueError("service navigation hybrid extraction response missing parsed output")


def _coerce_flow_graph(payload: object) -> ServiceNavigationFlowGraph:
    if not isinstance(payload, dict):
        raise ValueError("service navigation hybrid extraction payload must be a JSON object")
    page_findings = tuple(
        ServiceNavigationPageFinding(
            source_page=int(page["source_page"]),
            page_heading=str(page["page_heading"]),
            flows=tuple(
                ServiceNavigationFlow(
                    flow_heading=str(flow["flow_heading"]),
                    audience_scope=str(flow.get("audience_scope") or ""),
                    steps=tuple(
                        ServiceNavigationStep(
                            step_id=str(step["step_id"]),
                            step_text=str(step["step_text"]),
                            next_step_ids=tuple(
                                str(item) for item in step.get("next_step_ids") or ()
                            ),
                        )
                        for step in flow.get("steps") or ()
                    ),
                    manual_review_notes=tuple(
                        str(item) for item in flow.get("manual_review_notes") or ()
                    ),
                )
                for flow in page.get("flows") or ()
            ),
        )
        for page in payload.get("page_findings") or ()
    )
    return ServiceNavigationFlowGraph(
        document_title=str(payload.get("document_title") or ""),
        page_findings=page_findings,
        global_manual_review_required=bool(payload.get("global_manual_review_required", False)),
    )


def _service_navigation_flow_graph_schema() -> dict[str, object]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["document_title", "page_findings", "global_manual_review_required"],
        "properties": {
            "document_title": {"type": "string"},
            "global_manual_review_required": {"type": "boolean"},
            "page_findings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["source_page", "page_heading", "flows"],
                    "properties": {
                        "source_page": {"type": "integer"},
                        "page_heading": {"type": "string"},
                        "flows": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": [
                                    "flow_heading",
                                    "audience_scope",
                                    "steps",
                                    "manual_review_notes",
                                ],
                                "properties": {
                                    "flow_heading": {"type": "string"},
                                    "audience_scope": {"type": "string"},
                                    "manual_review_notes": {
                                        "type": "array",
                                        "items": {"type": "string"},
                                    },
                                    "steps": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "additionalProperties": False,
                                            "required": ["step_id", "step_text", "next_step_ids"],
                                            "properties": {
                                                "step_id": {"type": "string"},
                                                "step_text": {"type": "string"},
                                                "next_step_ids": {
                                                    "type": "array",
                                                    "items": {"type": "string"},
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
    }


__all__ = [
    "FLOW_GRAPH_FILENAME",
    "HANDOOK_SERVICE_NAVIGATION_PROJECTION_SCHEMA_VERSION",
    "ServiceNavigationFlow",
    "ServiceNavigationFlowGraph",
    "ServiceNavigationPageFinding",
    "ServiceNavigationStep",
    "build_handbook_service_navigation_hybrid_document",
    "build_handbook_service_navigation_hybrid_document_from_projection_artifact",
    "is_handbook_service_navigation_projection",
    "materialize_handbook_service_navigation_projection_artifact",
]
