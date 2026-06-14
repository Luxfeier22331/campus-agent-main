from __future__ import annotations

from typing import Protocol

from campus_evals.models import DimensionResult, WorkflowTraceSummary

SUPPORTED_WORKFLOW_MODES = frozenset(("terminal", "single_step", "multi_step"))


class WorkflowTraceProjectionExpectation(Protocol):
    expected_context_projection_kinds: tuple[str, ...]
    expected_answer_artifact_kinds: tuple[str, ...]


def _trace_projection_completeness(
    summary: WorkflowTraceSummary,
    expectation: WorkflowTraceProjectionExpectation | None = None,
) -> DimensionResult:
    missing = []
    if not summary.direct_vs_delegate_branch:
        missing.append("direct_vs_delegate_branch")
    if not summary.workflow_mode:
        missing.append("workflow_mode")
    elif summary.workflow_mode not in SUPPORTED_WORKFLOW_MODES:
        missing.append("workflow_mode.supported")
    if not summary.selected_capability:
        missing.append("selected_capability")
    if summary.workflow_mode == "terminal" and summary.selected_capability != "none":
        missing.append("selected_capability.none_sentinel")
    if (
        summary.workflow_mode == "single_step"
        and summary.direct_vs_delegate_branch == "delegate"
        and not summary.handoff_chain
    ):
        missing.append("handoff_chain")
    if summary.workflow_mode == "multi_step" and len(summary.handoff_chain) < 2:
        missing.append("handoff_chain.multi_step")
    if summary.workflow_mode == "multi_step" and not summary.context_projections:
        missing.append("context_projections.multi_step")
    if expectation is not None and expectation.expected_context_projection_kinds:
        observed_kinds = tuple(
            str(item.get("projection_kind") or "").strip()
            for item in summary.context_projections
            if str(item.get("projection_kind") or "").strip()
        )
        if observed_kinds != expectation.expected_context_projection_kinds:
            missing.append("context_projections.expected_kinds")
    if summary.workflow_mode == "multi_step":
        if not summary.answer_artifact_projection_ids:
            missing.append("answer_artifact_projection_ids")
        if not summary.answer_artifact_kinds:
            missing.append("answer_artifact_kinds")
    if (
        expectation is not None
        and expectation.expected_answer_artifact_kinds
        and summary.answer_artifact_kinds != expectation.expected_answer_artifact_kinds
    ):
        missing.append("answer_artifact_kinds.expected")
    missing.extend(_context_projection_summary_gaps(summary))
    missing.extend(_answer_artifact_usage_gaps(summary))
    requires_capability_invocations = (
        summary.workflow_mode == "single_step"
        and summary.direct_vs_delegate_branch == "delegate"
        and not summary.capability_invocations
    ) or (summary.workflow_mode == "multi_step" and not summary.capability_invocations)
    if requires_capability_invocations:
        missing.append("capability_invocations")
    elif summary.workflow_mode in {"single_step", "multi_step"}:
        missing.extend(_agent_invocation_graph_gaps(summary))
    if (
        not summary.selected_tools
        and not summary.fail_close_reason
        and summary.direct_vs_delegate_branch != "clarification"
        and summary.workflow_mode != "terminal"
        and not _is_internal_notice_resolve(summary)
    ):
        missing.append("selected_tools")
    if summary.selected_tools and not summary.tool_call_summaries:
        missing.append("tool_call_summaries")
    if summary.tool_call_summaries:
        missing.extend(_tool_call_summary_provenance_gaps(summary))
    if not summary.planning_outcome:
        missing.append("planning_outcome")
    if not summary.trace_steps:
        missing.append("trace_steps")
    elif _trace_steps_lack_timeline_fields(summary.trace_steps):
        missing.append("trace_steps.timeline_fields")
    return DimensionResult(
        passed=not missing,
        reason="" if not missing else "missing workflow trace fields: " + ", ".join(missing),
    )


def _context_projection_summary_gaps(summary: WorkflowTraceSummary) -> list[str]:
    gaps: list[str] = []
    for projection in summary.context_projections:
        if "payload" in projection:
            gaps.append("context_projections.raw_payload")
            break
        for key in ("projection_id", "source_step_id", "projection_kind", "content_hash", "safety"):
            if not projection.get(key):
                gaps.append("context_projections.summary_fields")
                return gaps
    return gaps


def _answer_artifact_usage_gaps(summary: WorkflowTraceSummary) -> list[str]:
    if not summary.answer_artifact_projection_ids and not summary.answer_artifact_kinds:
        return []
    if len(summary.answer_artifact_projection_ids) != len(summary.answer_artifact_kinds):
        return ["answer_artifact_usage.length_mismatch"]
    projection_by_id = {
        str(item.get("projection_id") or "").strip(): str(item.get("projection_kind") or "").strip()
        for item in summary.context_projections
        if str(item.get("projection_id") or "").strip()
    }
    gaps: list[str] = []
    for projection_id, projection_kind in zip(
        summary.answer_artifact_projection_ids,
        summary.answer_artifact_kinds,
        strict=False,
    ):
        observed_kind = projection_by_id.get(projection_id)
        if not observed_kind:
            gaps.append("answer_artifact_usage.unknown_projection")
            break
        if observed_kind != projection_kind:
            gaps.append("answer_artifact_usage.kind_mismatch")
            break
    return gaps


def _tool_call_summary_provenance_gaps(summary: WorkflowTraceSummary) -> list[str]:
    gaps: list[str] = []
    for item in summary.tool_call_summaries:
        if item.get("result_projection") != "bounded_summary" or item.get(
            "raw_result_included"
        ) not in (False, None):
            gaps.append("tool_call_summaries.bounded")
            break
    for item in summary.tool_call_summaries:
        result_status = str(item.get("result_status") or item.get("status") or "").strip()
        source_ids = _source_ids_from_tool_summary(item)
        fail_close_reason = str(
            item.get("fail_close_reason") or item.get("failCloseReason") or ""
        ).strip()
        if result_status in _FAIL_CLOSE_TOOL_RESULT_STATUSES and not fail_close_reason:
            gaps.append("tool_call_summaries.fail_close_reason")
            break
        if (
            _tool_result_needs_source_ref(result_status)
            and not source_ids
            and not fail_close_reason
        ):
            gaps.append("tool_call_summaries.provenance")
            break
    return gaps


_FAIL_CLOSE_TOOL_RESULT_STATUSES = frozenset(
    (
        "temporarily_unverifiable",
        "projection_missing",
        "authorization_denied",
        "error",
        "failed",
        "timed_out",
    )
)


def _tool_result_needs_source_ref(result_status: str) -> bool:
    return result_status not in {
        "",
        "clarification_required",
        "not_found",
        "no_result",
        "invalid_request",
    }


def _source_ids_from_tool_summary(item: dict[str, object]) -> set[str]:
    source_ids: set[str] = set()
    for key in ("source_ids", "sourceIds", "evidence_ids", "evidenceIds"):
        raw_values = item.get(key)
        if isinstance(raw_values, list | tuple):
            source_ids.update(str(value) for value in raw_values if str(value).strip())
    source_id = item.get("source_id") or item.get("sourceId")
    if source_id:
        source_ids.add(str(source_id))
    return source_ids


def _agent_invocation_graph_gaps(summary: WorkflowTraceSummary) -> list[str]:
    expected_targets = _expected_invocation_targets(summary)
    observed_targets = tuple(
        str(item.get("capability_id") or item.get("agentId") or "").strip()
        for item in summary.capability_invocations
    )
    gaps: list[str] = []
    if expected_targets and observed_targets[: len(expected_targets)] != expected_targets:
        gaps.append("capability_invocations.target_alignment")
    if summary.workflow_mode == "multi_step":
        gaps.extend(_multi_step_agent_invocation_graph_gaps(summary))
    return gaps


def _expected_invocation_targets(summary: WorkflowTraceSummary) -> tuple[str, ...]:
    if summary.handoff_chain:
        return tuple(
            str(
                item.get("target") or item.get("capability_id") or item.get("agentId") or ""
            ).strip()
            for item in summary.handoff_chain
            if str(
                item.get("target") or item.get("capability_id") or item.get("agentId") or ""
            ).strip()
        )
    if summary.selected_capability and summary.selected_capability != "none":
        return (summary.selected_capability,)
    return ()


def _multi_step_agent_invocation_graph_gaps(summary: WorkflowTraceSummary) -> list[str]:
    gaps: list[str] = []
    invocation_ids = tuple(
        str(item.get("invocation_id") or item.get("invocationId") or "").strip()
        for item in summary.capability_invocations
    )
    if len(invocation_ids) < 2 or not all(invocation_ids):
        gaps.append("capability_invocations.multi_step_nodes")
    else:
        for index, invocation in enumerate(summary.capability_invocations[1:], start=1):
            parent_id = str(
                invocation.get("parent_invocation_id") or invocation.get("parentInvocationId") or ""
            ).strip()
            if parent_id != invocation_ids[index - 1]:
                gaps.append("capability_invocations.parent_edge")
                break
    projection_ids = {
        str(item.get("projection_id") or item.get("projectionId") or "").strip()
        for item in summary.context_projections
        if str(item.get("projection_id") or item.get("projectionId") or "").strip()
    }
    if projection_ids and not _capability_invocations_reference_projection_ids(
        summary.capability_invocations,
        projection_ids,
    ):
        gaps.append("capability_invocations.projection_refs")
    return gaps


def _capability_invocations_reference_projection_ids(
    invocations: tuple[dict[str, object], ...],
    projection_ids: set[str],
) -> bool:
    for invocation in invocations[1:]:
        refs = {
            str(value).strip()
            for value in _list_value(invocation, "projection_ids", "projectionIds")
            if str(value).strip()
        }
        if refs & projection_ids:
            return True
    return False


def _list_value(record: dict[str, object], *keys: str) -> list[object]:
    for key in keys:
        value = record.get(key)
        if isinstance(value, list):
            return value
    return []


def _is_internal_notice_resolve(summary: WorkflowTraceSummary) -> bool:
    payload_kind = str(summary.tool_argument_summary.get("payload_kind") or "").strip()
    if payload_kind == "campus_notice_get":
        return True
    handoff_payload_kind = str(summary.handoff.get("payload_kind") or "").strip()
    return handoff_payload_kind == "campus_notice_get"


def _trace_steps_lack_timeline_fields(trace_steps: tuple[dict[str, object], ...]) -> bool:
    for step in trace_steps:
        if not isinstance(step, dict):
            return True
        step_id = _trace_step_string(step, "step_id", "stepId")
        span_kind = _trace_step_string(step, "span_kind", "spanKind")
        if not step_id or not span_kind:
            return True
        if not _trace_step_has_key(step, "parent_step_id", "parentStepId"):
            return True
        if not (
            _trace_step_string(step, "outcome")
            or _trace_step_string(step, "result_status", "resultStatus", "status")
        ):
            return True
        if span_kind == "tool_call" or step_id == "tool_call":
            if not _trace_step_string(step, "result_status", "resultStatus", "status"):
                return True
            if not _trace_step_has_key(step, "retry_count", "retryCount"):
                return True
    return False


def _trace_step_string(step: dict[str, object], *keys: str) -> str:
    for key in keys:
        value = step.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _trace_step_has_key(step: dict[str, object], *keys: str) -> bool:
    return any(key in step for key in keys)
