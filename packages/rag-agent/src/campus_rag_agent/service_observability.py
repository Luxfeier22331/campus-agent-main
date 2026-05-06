from __future__ import annotations

from dataclasses import replace
from typing import Any

from campus_contracts import AgentObservability, AgentResponse, RagResultDiagnostics


def with_rag_agent_observability(response: AgentResponse) -> AgentResponse:
    diagnostics = _response_diagnostics(response)
    source_ref_count = _source_ref_count(response)
    tool_outcome = _tool_outcome(response, diagnostics)
    safe_details = _safe_details(
        response=response,
        diagnostics=diagnostics,
        source_ref_count=source_ref_count,
        tool_outcome=tool_outcome,
    )
    return replace(
        response,
        agent_observability=AgentObservability(
            selected_tool="retrieval.query",
            tool_attempted=_tool_attempted(diagnostics),
            tool_outcome=tool_outcome,
            failure_class=_failure_class(response, diagnostics),
            fail_close_reason=_fail_close_reason(response, diagnostics),
            clarification_reason=diagnostics.clarification_reason if diagnostics else "",
            result_outcome=tool_outcome,
            source_ref_count=source_ref_count,
            access_decision=_access_decision(diagnostics),
            safe_details=safe_details,
        ),
    )


def _response_diagnostics(response: AgentResponse) -> RagResultDiagnostics | None:
    result = response.result
    diagnostics = getattr(result, "diagnostics", None)
    if isinstance(diagnostics, RagResultDiagnostics):
        return diagnostics
    return None


def _source_ref_count(response: AgentResponse) -> int:
    result = response.result
    evidence = getattr(result, "evidence", None)
    sources = getattr(evidence, "sources", ())
    return len(tuple(sources or ()))


def _tool_attempted(diagnostics: RagResultDiagnostics | None) -> bool:
    return diagnostics is not None and diagnostics.retrieval_plan_summary is not None


def _tool_outcome(
    response: AgentResponse,
    diagnostics: RagResultDiagnostics | None,
) -> str:
    if diagnostics is not None:
        if diagnostics.semantic_outcome:
            return diagnostics.semantic_outcome
        if diagnostics.no_answer_reason:
            return diagnostics.no_answer_reason
    if response.error is not None and response.error.code:
        return response.error.code
    return response.status


def _failure_class(
    response: AgentResponse,
    diagnostics: RagResultDiagnostics | None,
) -> str:
    if response.error is not None:
        return response.error.code
    if response.status == "needs_clarification":
        return "clarification"
    if diagnostics is None:
        return ""
    if diagnostics.no_answer_reason:
        return diagnostics.no_answer_reason
    if diagnostics.grounding_downgraded:
        return "grounding_downgraded"
    if diagnostics.freshness_fail_closed:
        return "freshness_fail_closed"
    return ""


def _fail_close_reason(
    response: AgentResponse,
    diagnostics: RagResultDiagnostics | None,
) -> str:
    if response.error is not None:
        return response.error.code
    if diagnostics is None:
        return ""
    if diagnostics.freshness_fail_closed or diagnostics.grounding_downgraded:
        return diagnostics.no_answer_reason or diagnostics.semantic_outcome
    if diagnostics.semantic_outcome == "restricted_access_denied":
        return "restricted_access_denied"
    return ""


def _access_decision(diagnostics: RagResultDiagnostics | None) -> str:
    if diagnostics is not None and diagnostics.semantic_outcome == "restricted_access_denied":
        return "denied"
    return "allowed"


def _safe_details(
    *,
    response: AgentResponse,
    diagnostics: RagResultDiagnostics | None,
    source_ref_count: int,
    tool_outcome: str,
) -> dict[str, Any]:
    result_guardrail: dict[str, Any] = {
        "schema_version": "agent-result-guardrail-v1",
        "outcome": _result_guardrail_outcome(response, diagnostics, source_ref_count),
        "source_ref_count": source_ref_count,
    }
    if diagnostics is not None:
        _set_if_present(
            result_guardrail,
            "retrieval_adequacy_verdict",
            diagnostics.retrieval_adequacy_verdict,
        )
        _set_if_present(
            result_guardrail,
            "retrieval_adequacy_reason",
            diagnostics.retrieval_adequacy_reason,
        )
        _set_if_present(result_guardrail, "grounding_verdict", diagnostics.grounding_verdict)
        result_guardrail["unsupported_field_count"] = len(diagnostics.unsupported_fields)
        _set_if_present(result_guardrail, "no_answer_reason", diagnostics.no_answer_reason)
        _set_if_present(result_guardrail, "semantic_outcome", diagnostics.semantic_outcome)
        _set_if_present(result_guardrail, "prompt_runtime_state", diagnostics.prompt_runtime_state)
    if response.error is not None:
        result_guardrail["error_code"] = response.error.code

    details: dict[str, Any] = {
        "agent_execution_projection": {
            "schema_version": "agent-execution-projection-v1",
            "projection_owner": "rag-agent",
            "selected_tool": "retrieval.query",
            "payload_kind": "rag_request",
            "tool_selection_reason": _tool_selection_reason(diagnostics),
        },
        "result_guardrail": result_guardrail,
    }
    agent_plan = _agent_plan(diagnostics)
    if agent_plan:
        details["agent_plan"] = agent_plan
    if tool_outcome:
        details["result_type"] = tool_outcome
    details.update(_existing_safe_details(response))
    return details


def _existing_safe_details(response: AgentResponse) -> dict[str, Any]:
    observability = response.agent_observability
    if observability is None:
        return {}
    return dict(observability.safe_details)


def _agent_plan(diagnostics: RagResultDiagnostics | None) -> dict[str, Any]:
    if diagnostics is None or diagnostics.retrieval_plan_summary is None:
        return {}
    plan = diagnostics.retrieval_plan_summary
    return {
        "schema_version": "agent-local-plan-v1",
        "planner": "rag_retrieval_planner",
        "selected_tool": "retrieval.query",
        "plan_id": plan.plan_id,
        "query_mode": plan.query_mode,
        "terminal_state": plan.terminal_state,
        "replan_count": plan.replan_count,
        "step_count": len(plan.step_activities),
    }


def _tool_selection_reason(diagnostics: RagResultDiagnostics | None) -> str:
    if diagnostics is not None and diagnostics.retrieval_plan_summary is not None:
        return "retrieval_plan_executed"
    return "pre_retrieval_outcome"


def _result_guardrail_outcome(
    response: AgentResponse,
    diagnostics: RagResultDiagnostics | None,
    source_ref_count: int,
) -> str:
    if response.error is not None:
        return "fail_close"
    if response.status == "needs_clarification":
        return "clarification"
    if diagnostics is not None:
        if diagnostics.semantic_outcome == "grounded_answer":
            return "source_backed" if source_ref_count > 0 else "source_gap"
        if diagnostics.semantic_outcome == "restricted_access_denied":
            return "access_denied"
        if diagnostics.grounding_downgraded or diagnostics.freshness_fail_closed:
            return "fail_close"
    if response.status == "completed":
        return "source_backed" if source_ref_count > 0 else "source_gap"
    if response.status == "no_answer":
        return "source_gap"
    return "unclassified"


def _set_if_present(target: dict[str, Any], key: str, value: object) -> None:
    if value:
        target[key] = value
