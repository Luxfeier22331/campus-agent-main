from __future__ import annotations

import re
from dataclasses import replace

from campus_contracts import (
    AgentRequest,
    AgentResponse,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagProjectionContextSummary,
)

_WORKFLOW_CONTEXT_SECTION_RE = re.compile(
    r"(已读取的班车基线|已读取的通知上下文|已读取的通知变更集)：\n(?P<body>.*?)(?=\n\n已读取的|\Z)",
    re.S,
)
_PROJECTION_DOC_ID_SAFE_RE = re.compile(r"[^a-zA-Z0-9_-]+")
_NOTICE_CHANGE_SET_KIND = "notice_change_set"
_SCHEDULE_BASELINE_KIND = "schedule_baseline"
_NOTICE_CONTEXT_KIND = "notice_context"
_SUPPORTED_PROJECTION_KINDS = {
    _SCHEDULE_BASELINE_KIND,
    _NOTICE_CONTEXT_KIND,
    _NOTICE_CHANGE_SET_KIND,
}
_TRANSPORT_OVERRIDE_SCOPE = KnowledgeScope(
    corpus="workflow",
    collection="transport_notice_override",
)


def maybe_build_unscoped_workflow_projection_response(
    *,
    request: AgentRequest,
    build_rag_result_payload,
) -> AgentResponse | None:
    projection_evidence = maybe_build_workflow_projection_evidence(
        request=request,
        scope=_TRANSPORT_OVERRIDE_SCOPE,
        existing_evidence=EvidenceBundle(
            query_text=request.user_goal,
            corpus=_TRANSPORT_OVERRIDE_SCOPE.corpus,
            collection=_TRANSPORT_OVERRIDE_SCOPE.collection,
            sources=(),
        ),
    )
    if projection_evidence is None:
        return None
    projection_context_summaries = mark_workflow_projection_summaries_as_grounding_evidence(
        _projection_context_summaries_from_request(request),
        projection_evidence,
    )
    return AgentResponse(
        target="rag-agent",
        status="completed",
        answer_text=build_workflow_projection_answer_text(projection_evidence),
        confidence="medium",
        result=build_rag_result_payload(
            evidence=projection_evidence,
            resolved_scope=_TRANSPORT_OVERRIDE_SCOPE,
            handbook_plan=None,
            request_id=request.request_id,
            allow_session_follow_up=True,
            semantic_outcome="grounded_workflow_projection",
            grounding_verdict="grounded",
            projection_context_summaries=projection_context_summaries,
        ),
    )


def build_workflow_projection_completed_response(
    *,
    request: AgentRequest,
    projection_evidence: EvidenceBundle,
    retrieved_evidence: EvidenceBundle,
    retrieval_execution_result,
    resolved_scope: KnowledgeScope,
    handbook_plan,
    curriculum_plan,
    curriculum_course_plan,
    curriculum_program_family_plan,
    confidence: str,
    build_rag_result_payload,
    planner_information_needs=(),
    projection_context_summaries=(),
) -> AgentResponse:
    return AgentResponse(
        target="rag-agent",
        status="completed",
        answer_text=build_workflow_projection_answer_text(projection_evidence),
        confidence=confidence,
        result=build_rag_result_payload(
            evidence=projection_evidence,
            retrieved_evidence=retrieved_evidence,
            retrieval_execution_result=retrieval_execution_result,
            resolved_scope=resolved_scope,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
            request_id=request.request_id,
            allow_session_follow_up=True,
            semantic_outcome="grounded_workflow_projection",
            grounding_verdict="grounded",
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
        ),
    )


def maybe_build_workflow_projection_evidence(
    *,
    request: AgentRequest,
    scope: KnowledgeScope,
    existing_evidence: EvidenceBundle,
) -> EvidenceBundle | None:
    if existing_evidence.sources:
        return None
    workflow_context = request.workflow_context
    projection_refs = tuple(
        item
        for item in workflow_context.projection_refs
        if str(item.get("projection_kind") or "").strip() in _SUPPORTED_PROJECTION_KINDS
    )
    if not projection_refs or not _has_transport_override_projection_set(projection_refs):
        return None
    summaries = _workflow_context_summaries(request.user_goal)
    if not summaries:
        return None
    sources = tuple(
        _projection_ref_to_evidence_source(
            projection_ref=projection_ref,
            index=index,
            snippet=summaries.get(
                str(projection_ref.get("projection_kind") or "").strip(),
                "",
            ),
            collection=scope.collection,
        )
        for index, projection_ref in enumerate(projection_refs, start=1)
        if summaries.get(str(projection_ref.get("projection_kind") or "").strip(), "").strip()
    )
    if not sources:
        return None
    return EvidenceBundle(
        query_text=request.user_goal,
        corpus=scope.corpus,
        collection=scope.collection,
        sources=sources,
    )


def build_workflow_projection_answer_text(evidence: EvidenceBundle) -> str:
    schedule_summary = _first_snippet_for_projection_kind(evidence, _SCHEDULE_BASELINE_KIND)
    change_set_summary = _first_snippet_for_projection_kind(evidence, _NOTICE_CHANGE_SET_KIND)
    notice_summary = _first_snippet_for_projection_kind(evidence, _NOTICE_CONTEXT_KIND)
    if change_set_summary and schedule_summary:
        return "根据已读取的班车基线和通知变更集，" + change_set_summary
    if change_set_summary:
        return "根据已读取的通知变更集，" + change_set_summary
    if notice_summary:
        return "根据已读取的通知上下文，" + notice_summary
    return "根据已读取的 workflow 投影，当前已有可用于回答的受限摘要。"


def mark_workflow_projection_summaries_as_grounding_evidence(
    summaries: tuple[RagProjectionContextSummary, ...],
    evidence: EvidenceBundle,
) -> tuple[RagProjectionContextSummary, ...]:
    grounded_kinds = {
        str(source.anchor.get("projection_kind") or "").strip()
        for source in evidence.sources
        if str(source.anchor.get("projection_kind") or "").strip()
    }
    if not grounded_kinds:
        return summaries
    return tuple(
        replace(summary, evidence_use="grounding_evidence")
        if summary.projection_kind in grounded_kinds
        else summary
        for summary in summaries
    )


def _has_transport_override_projection_set(
    projection_refs: tuple[dict[str, object], ...],
) -> bool:
    kinds = {str(item.get("projection_kind") or "").strip() for item in projection_refs}
    return _SCHEDULE_BASELINE_KIND in kinds and _NOTICE_CHANGE_SET_KIND in kinds


def _projection_context_summaries_from_request(
    request: AgentRequest,
) -> tuple[RagProjectionContextSummary, ...]:
    summaries = []
    for projection_ref in request.workflow_context.projection_refs:
        safety = projection_ref.get("safety")
        summaries.append(
            RagProjectionContextSummary(
                projection_id=str(projection_ref.get("projection_id") or "").strip(),
                source_step_id=str(projection_ref.get("source_step_id") or "").strip(),
                projection_kind=str(projection_ref.get("projection_kind") or "").strip(),
                content_hash=str(projection_ref.get("content_hash") or "").strip(),
                safety_summary=dict(safety) if isinstance(safety, dict) else {},
                evidence_use="planning_framing",
            )
        )
    return tuple(summaries)


def _workflow_context_summaries(user_goal: str) -> dict[str, str]:
    summaries: dict[str, str] = {}
    for match in _WORKFLOW_CONTEXT_SECTION_RE.finditer(user_goal):
        label = match.group(1).strip()
        body = _normalize_summary_text(match.group("body"))
        if not body:
            continue
        projection_kind = _projection_kind_for_section_label(label)
        if not projection_kind:
            continue
        summaries[projection_kind] = body
    return summaries


def _projection_kind_for_section_label(label: str) -> str:
    if label == "已读取的班车基线":
        return _SCHEDULE_BASELINE_KIND
    if label == "已读取的通知上下文":
        return _NOTICE_CONTEXT_KIND
    if label == "已读取的通知变更集":
        return _NOTICE_CHANGE_SET_KIND
    return ""


def _normalize_summary_text(value: str) -> str:
    lines = []
    for raw_line in value.splitlines():
        line = " ".join(raw_line.strip().split())
        if line:
            lines.append(line)
    return "；".join(lines).strip("；")


def _projection_ref_to_evidence_source(
    *,
    projection_ref: dict[str, object],
    index: int,
    snippet: str,
    collection: str,
) -> EvidenceSource:
    projection_id = str(projection_ref.get("projection_id") or "").strip()
    projection_kind = str(projection_ref.get("projection_kind") or "").strip()
    safe_projection_id = _safe_projection_id(projection_id) or f"projection-{index}"
    source_step_id = str(projection_ref.get("source_step_id") or "").strip()
    return EvidenceSource(
        doc_id=f"workflow-projection:{projection_kind}:{safe_projection_id}",
        revision_track="source-faithful",
        version_id=str(projection_ref.get("content_hash") or "").strip() or "workflow-context",
        chunk_id=f"workflow-projection:{projection_kind}:{safe_projection_id}:chunk-0001",
        anchor={
            "projection_id": projection_id,
            "projection_kind": projection_kind,
            "source_step_id": source_step_id,
        },
        canonical_url="",
        latest_url="",
        source_channel="manual_curated",
        collection=collection,
        is_current=True,
        snippet=snippet,
        score=0.86 if projection_kind == _NOTICE_CHANGE_SET_KIND else 0.8,
        source_title=_source_title_for_projection_kind(projection_kind),
        structural_path=("workflow_projection", projection_kind),
        content_kind="workflow_projection",
        content_role="table_fact",
        semantic_role="grounding_fact",
        claim_type="fact",
        is_answer_bearing=True,
        canonical_source_id=projection_id,
        canonical_source_title=_source_title_for_projection_kind(projection_kind),
        source_unit_kind="workflow_step_output_projection",
        source_unit_key=source_step_id,
        source_trust_tier="T1",
    )


def _safe_projection_id(projection_id: str) -> str:
    normalized = projection_id.replace(":", "-")
    return _PROJECTION_DOC_ID_SAFE_RE.sub("-", normalized).strip("-")


def _source_title_for_projection_kind(projection_kind: str) -> str:
    if projection_kind == _SCHEDULE_BASELINE_KIND:
        return "班车基线"
    if projection_kind == _NOTICE_CONTEXT_KIND:
        return "通知上下文"
    if projection_kind == _NOTICE_CHANGE_SET_KIND:
        return "通知变更集"
    return "workflow projection"


def _first_snippet_for_projection_kind(evidence: EvidenceBundle, projection_kind: str) -> str:
    for source in evidence.sources:
        if str(source.anchor.get("projection_kind") or "").strip() == projection_kind:
            return source.snippet.strip()
    return ""


__all__ = [
    "build_workflow_projection_answer_text",
    "mark_workflow_projection_summaries_as_grounding_evidence",
    "maybe_build_unscoped_workflow_projection_response",
    "maybe_build_workflow_projection_evidence",
]
