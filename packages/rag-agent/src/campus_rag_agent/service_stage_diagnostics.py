from __future__ import annotations

from campus_contracts import EvidenceBundle, RagStageActivitySummary
from campus_retrieval_core import RetrievalExecutionResult

from campus_rag_agent.retrieval_adequacy import RetrievalAdequacyAssessment


def build_rag_stage_activity_summaries(
    *,
    request_id: str,
    evidence: EvidenceBundle,
    retrieved_evidence: EvidenceBundle | None,
    retrieval_execution_result: RetrievalExecutionResult | None,
    retrieval_adequacy: RetrievalAdequacyAssessment | None,
    semantic_outcome: str,
    no_answer_reason: str,
    grounding_verdict: str,
    prompt_runtime_state: str,
) -> tuple[RagStageActivitySummary, ...]:
    plan_id = (
        retrieval_execution_result.plan.plan_id
        if retrieval_execution_result is not None
        else _fallback_plan_id(evidence)
    )
    query_mode = (
        retrieval_execution_result.plan.query_mode
        if retrieval_execution_result is not None
        else "current"
    )
    candidate_count = len(retrieved_evidence.sources) if retrieved_evidence is not None else 0
    if not candidate_count:
        candidate_count = len(evidence.sources)
    supporting_evidence_count = len(evidence.sources)
    fallback_reason = _resolve_fallback_reason(
        retrieval_adequacy=retrieval_adequacy,
        no_answer_reason=no_answer_reason,
        prompt_runtime_state=prompt_runtime_state,
    )
    retrieval_ms = _retrieval_latency_ms(retrieval_execution_result)

    return (
        RagStageActivitySummary(
            request_id=request_id,
            plan_id=plan_id,
            query_mode=query_mode,
            stage_name="planner",
            stage_status="completed" if plan_id else "unresolved",
            candidate_count=0,
            supporting_evidence_count=0,
            latency_ms=0,
            retrieval_ms=0,
            prompt_ms=0,
            adapter_ms=0,
            diagnostic_ms=0,
        ),
        RagStageActivitySummary(
            request_id=request_id,
            plan_id=plan_id,
            query_mode=query_mode,
            stage_name="retrieval",
            stage_status=_retrieval_stage_status(retrieval_execution_result, candidate_count),
            candidate_count=candidate_count,
            supporting_evidence_count=0,
            fallback_reason=_retrieval_fallback_reason(retrieval_execution_result),
            latency_ms=retrieval_ms,
            retrieval_ms=retrieval_ms,
            prompt_ms=0,
            adapter_ms=0,
            diagnostic_ms=0,
        ),
        RagStageActivitySummary(
            request_id=request_id,
            plan_id=plan_id,
            query_mode=query_mode,
            stage_name="evidence_selection",
            stage_status=_evidence_selection_stage_status(
                semantic_outcome=semantic_outcome,
                fallback_reason=fallback_reason,
            ),
            candidate_count=candidate_count,
            supporting_evidence_count=supporting_evidence_count,
            fallback_reason=fallback_reason,
            latency_ms=0,
            retrieval_ms=0,
            prompt_ms=0,
            adapter_ms=0,
            diagnostic_ms=0,
        ),
        RagStageActivitySummary(
            request_id=request_id,
            plan_id=plan_id,
            query_mode=query_mode,
            stage_name="synthesis",
            stage_status=_synthesis_stage_status(semantic_outcome=semantic_outcome),
            candidate_count=candidate_count,
            supporting_evidence_count=supporting_evidence_count,
            fallback_reason=prompt_runtime_state,
            latency_ms=0,
            retrieval_ms=0,
            prompt_ms=0,
            adapter_ms=0,
            diagnostic_ms=0,
        ),
        RagStageActivitySummary(
            request_id=request_id,
            plan_id=plan_id,
            query_mode=query_mode,
            stage_name="grounding",
            stage_status=_grounding_stage_status(
                semantic_outcome=semantic_outcome,
                grounding_verdict=grounding_verdict,
            ),
            candidate_count=candidate_count,
            supporting_evidence_count=supporting_evidence_count,
            grounding_verdict=grounding_verdict,
            fallback_reason=(
                "insufficient_grounding"
                if grounding_verdict and grounding_verdict != "grounded"
                else ""
            ),
            latency_ms=0,
            retrieval_ms=0,
            prompt_ms=0,
            adapter_ms=0,
            diagnostic_ms=0,
        ),
    )


def _fallback_plan_id(evidence: EvidenceBundle) -> str:
    corpus = evidence.corpus.strip()
    collection = evidence.collection.strip()
    if not corpus or not collection:
        return ""
    return f"{corpus}:{collection}:unexecuted"


def _resolve_fallback_reason(
    *,
    retrieval_adequacy: RetrievalAdequacyAssessment | None,
    no_answer_reason: str,
    prompt_runtime_state: str,
) -> str:
    if retrieval_adequacy is not None and retrieval_adequacy.verdict != "sufficient":
        return retrieval_adequacy.reason
    return no_answer_reason or prompt_runtime_state


def _retrieval_latency_ms(execution_result: RetrievalExecutionResult | None) -> int:
    if execution_result is None:
        return 0
    return sum(activity.latency_ms or 0 for activity in execution_result.step_activities)


def _retrieval_stage_status(
    execution_result: RetrievalExecutionResult | None,
    candidate_count: int,
) -> str:
    if execution_result is None:
        return "completed" if candidate_count else "not_run"
    statuses = {result.status for result in execution_result.step_results}
    if "failed" in statuses:
        return "failed_closed"
    if "blocked" in statuses:
        return "blocked"
    if candidate_count:
        return "completed"
    return "empty"


def _retrieval_fallback_reason(execution_result: RetrievalExecutionResult | None) -> str:
    if execution_result is None:
        return ""
    for result in execution_result.step_results:
        if result.failure is not None:
            return result.failure.failure_kind
    return ""


def _evidence_selection_stage_status(
    *,
    semantic_outcome: str,
    fallback_reason: str,
) -> str:
    if semantic_outcome in {"grounded_answer", "compare_grounded_answer"}:
        return "completed"
    if fallback_reason:
        return "failed_closed"
    return "completed"


def _synthesis_stage_status(*, semantic_outcome: str) -> str:
    if semantic_outcome in {"grounded_answer", "compare_grounded_answer"}:
        return "completed"
    if semantic_outcome:
        return "skipped"
    return "not_run"


def _grounding_stage_status(
    *,
    semantic_outcome: str,
    grounding_verdict: str,
) -> str:
    if grounding_verdict == "grounded":
        return "completed"
    if grounding_verdict:
        return "failed_closed"
    if semantic_outcome in {"grounded_answer", "compare_grounded_answer"}:
        return "completed"
    return "skipped"


__all__ = [
    "build_rag_stage_activity_summaries",
]
