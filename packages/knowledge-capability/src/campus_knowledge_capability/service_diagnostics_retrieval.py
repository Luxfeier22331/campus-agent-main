from __future__ import annotations

from campus_contracts import RetrievalPlanSummary, RetrievalStepActivitySummary
from campus_retrieval_core import RetrievalExecutionResult


def _build_retrieval_plan_summary(
    execution_result: RetrievalExecutionResult | None,
) -> RetrievalPlanSummary | None:
    if execution_result is None:
        return None
    return RetrievalPlanSummary(
        plan_id=execution_result.plan.plan_id,
        query_mode=execution_result.plan.query_mode,
        replan_count=execution_result.replan_count,
        terminal_state=_resolve_retrieval_terminal_state(execution_result),
        step_activities=tuple(
            RetrievalStepActivitySummary(
                step_id=activity.step_id,
                step_type=activity.step_type,
                corpus=activity.corpus,
                collection=activity.collection,
                status=activity.status,
                need_ids=activity.need_ids,
                top_k=activity.top_k,
                latency_ms=activity.latency_ms,
                candidate_count=activity.candidate_count,
                reference_count=activity.reference_count,
                failure_kind=activity.failure_kind or "",
            )
            for activity in execution_result.step_activities
        ),
    )


def _resolve_retrieval_terminal_state(
    execution_result: RetrievalExecutionResult,
) -> str:
    statuses = tuple(result.status for result in execution_result.step_results)
    if "failed" in statuses:
        return "failed_closed"
    if "blocked" in statuses:
        return "blocked"
    return "completed"


__all__ = [
    "_build_retrieval_plan_summary",
    "_resolve_retrieval_terminal_state",
]
