from __future__ import annotations

from typing import Any

from campus_ingestion_core import service_guide_projection_support as _support
from campus_ingestion_core.service_guide_projection_constants import (
    HANDBOOK_SERVICE_NAVIGATION_SOURCE_FAMILY,
)

_default_target_document_id = _support.default_target_document_id
_list_of_dicts = _support.list_of_dicts
_positive_int = _support.positive_int
_required_text = _support.required_text
_require_mapping = _support.require_mapping
_string_list = _support.string_list


def _coerce_handbook_flow_graph_source(
    *,
    flow_graph_artifact: dict[str, Any],
    target_document_id: str | None,
    target_title: str | None,
    source_document_id: str | None,
    source_page_start: int | None,
    source_page_end: int | None,
) -> dict[str, Any]:
    artifact = _require_mapping(flow_graph_artifact, "flow_graph_artifact")
    if "flow_graph" in artifact:
        schema_version = str(artifact.get("schema_version") or "").strip()
        if schema_version != HANDBOOK_SERVICE_NAVIGATION_SOURCE_FAMILY:
            raise ValueError(
                "unsupported handbook service navigation projection schema_version: "
                f"{schema_version!r}"
            )
        flow_graph = _require_mapping(artifact.get("flow_graph"), "flow_graph")
        resolved_target_title = (
            target_title
            or _required_text(artifact.get("target_title"))
            or _required_text(flow_graph.get("document_title"))
            or "手册服务流程"
        )
        resolved_target_document_id = (
            target_document_id
            or _required_text(artifact.get("target_document_id"))
            or _default_target_document_id(resolved_target_title)
        )
        resolved_source_document_id = (
            source_document_id or _required_text(artifact.get("source_document_id")) or ""
        )
        resolved_page_start = source_page_start or int(artifact.get("source_page_start") or 0)
        resolved_page_end = source_page_end or int(artifact.get("source_page_end") or 0)
    else:
        flow_graph = artifact
        resolved_target_title = (
            target_title or _required_text(flow_graph.get("document_title")) or "手册服务流程"
        )
        resolved_target_document_id = target_document_id or _default_target_document_id(
            resolved_target_title
        )
        resolved_source_document_id = source_document_id or ""
        resolved_page_start = source_page_start or 0
        resolved_page_end = source_page_end or 0

    page_findings = _list_of_dicts(flow_graph.get("page_findings"))
    if not page_findings:
        raise ValueError("flow_graph.page_findings must be a non-empty array")
    pages = [int(page.get("source_page") or 0) for page in page_findings]
    if not resolved_page_start:
        resolved_page_start = min(page for page in pages if page > 0)
    if not resolved_page_end:
        resolved_page_end = max(page for page in pages if page > 0)
    return {
        "target_title": resolved_target_title,
        "target_document_id": resolved_target_document_id,
        "source_document_id": resolved_source_document_id,
        "source_page_start": resolved_page_start,
        "source_page_end": resolved_page_end,
        "global_manual_review_required": _reject_manual_review_required(
            flow_graph.get("global_manual_review_required")
        ),
        "page_findings": page_findings,
    }


def _coerce_handbook_flow_graph_document_data_source(
    *,
    document_data: dict[str, Any],
    target_document_id: str | None,
    source_document_id: str | None,
) -> dict[str, Any]:
    payload = _require_mapping(document_data, "document_data")
    extraction_status = _required_text(payload.get("extractionStatus")) or ""
    if extraction_status != "ready":
        raise ValueError("handbook flow graph document data extractionStatus must be ready")
    title = _required_text(payload.get("title"))
    if title is None:
        raise ValueError("handbook flow graph document data title is required")
    page_start = _positive_int(payload.get("sourcePageStart"), "sourcePageStart")
    page_end = _positive_int(payload.get("sourcePageEnd"), "sourcePageEnd")
    page_findings: list[dict[str, Any]] = []
    for page in _list_of_dicts(payload.get("pageFindings")):
        flows: list[dict[str, Any]] = []
        for flow in _list_of_dicts(page.get("flows")):
            steps: list[dict[str, Any]] = []
            for step in _list_of_dicts(flow.get("steps")):
                step_text = _required_text(step.get("stepText"))
                if step_text is None:
                    continue
                steps.append(
                    {
                        "step_id": _required_text(step.get("stepId")) or "",
                        "step_text": step_text,
                        "next_step_ids": _string_list(step.get("nextStepIds")),
                    }
                )
            if not steps:
                continue
            flows.append(
                {
                    "flow_heading": _required_text(flow.get("flowHeading")) or "未命名流程",
                    "audience_scope": _required_text(flow.get("audienceScope")) or "",
                    "steps": steps,
                    "manual_review_notes": _string_list(flow.get("manualReviewNotes")),
                }
            )
        if not flows:
            continue
        page_findings.append(
            {
                "source_page": _positive_int(page.get("sourcePage"), "sourcePage"),
                "page_heading": _required_text(page.get("pageHeading")) or "",
                "flows": flows,
            }
        )
    if not page_findings:
        raise ValueError("handbook flow graph document data pageFindings has no usable flows")
    return {
        "target_title": title,
        "target_document_id": target_document_id or _default_target_document_id(title),
        "source_document_id": source_document_id or "",
        "source_page_start": page_start,
        "source_page_end": page_end,
        "global_manual_review_required": _reject_manual_review_required(
            payload.get("manualReviewRequired")
        ),
        "page_findings": page_findings,
    }


def _reject_manual_review_required(value: object) -> bool:
    if bool(value):
        raise ValueError("service guide projection no longer supports manual review required")
    return False


__all__ = [
    "_coerce_handbook_flow_graph_document_data_source",
    "_coerce_handbook_flow_graph_source",
]
