# ruff: noqa: F401
from __future__ import annotations

from campus_evals import DimensionResult
from campus_evals.workflow_trace_gate import (
    WORKFLOW_TRACE_GATE_CASES_PATH,
    WorkflowTraceCase,
    WorkflowTraceCaseSet,
    WorkflowTraceExpectation,
    attach_workflow_trace_gate,
    evaluate_workflow_trace_case,
    load_process_smoke_workflow_trace_summaries,
    load_workflow_trace_cases,
    validate_workflow_trace_case_set,
)

from tests.evals.formal_benchmark_test_support import (
    HANDBOOK_SCOPE,
    ExecutionResult,
    ObservedTrace,
    Path,
    TemporaryDirectory,
    _completed_case,
    _response,
    _source,
    json,
    run_formal_benchmark,
    unittest,
)


def _trace_summary(**overrides):
    from campus_evals import WorkflowTraceSummary

    defaults = {
        "routing_frame": {"intent": "campus_service_lookup"},
        "context_resolution": {"resolved_scope": "campus_services"},
        "planning_outcome": "direct_structured_tool",
        "workflow_mode": "direct_runtime",
        "direct_vs_delegate_branch": "direct",
        "handoff": {"target": "campus-services-agent", "mode": "structured_runtime"},
        "handoff_chain": (),
        "agent_invocations": (
            {
                "invocation_id": "agent-invocation:campus-services-agent:1",
                "workflow_run_ref": "direct_runtime:campus-services-agent:transport_schedule_lookup",
                "agent_id": "campus-services-agent",
                "status": "completed",
            },
        ),
        "selected_target": "campus-services-agent",
        "selected_tools": ("transport_schedule_lookup",),
        "answer_artifact_projection_ids": ("proj-answer-001",),
        "answer_artifact_kinds": ("schedule_baseline",),
        "context_projections": (
            {
                "projection_id": "proj-answer-001",
                "source_step_id": "handoff:campus-services-agent:transport_schedule_lookup",
                "projection_kind": "schedule_baseline",
                "content_hash": "sha256:answer-projection",
                "safety": {"max_chars": 1600, "fields_present": ["summary"]},
            },
        ),
        "tool_argument_summary": {
            "service_key": "transport_commute",
            "campus": "fengtai",
            "direction": "haidian_to_fengtai",
        },
        "guardrail_outcomes": {"visibility": "public", "auth": "not_required"},
        "fail_close_reason": "",
        "trace_steps": (
            {
                "step_id": "runtime_policy",
                "span_kind": "runtime_policy",
                "parent_step_id": "",
                "outcome": "direct",
            },
            {
                "step_id": "tool_call",
                "span_kind": "tool_call",
                "parent_step_id": "runtime_policy",
                "tool_name": "transport_schedule_lookup",
                "outcome": "completed",
                "result_status": "completed",
                "retry_count": 0,
            },
            {
                "step_id": "finalization",
                "span_kind": "finalization",
                "parent_step_id": "tool_call",
                "outcome": "completed",
                "result_status": "completed",
            },
        ),
        "tool_call_summaries": (
            {
                "schema_version": "tool-call-summary-v1",
                "tool_call_id": "direct_runtime:campus-services-agent:transport_schedule_lookup:tool_call",
                "workflow_run_ref": "direct_runtime:campus-services-agent:transport_schedule_lookup",
                "step_id": "tool_call",
                "lifecycle_state": "completed",
                "result_projection": "bounded_summary",
                "raw_result_included": False,
                "tool_name": "transport_schedule_lookup",
                "result_status": "completed",
                "business_outcome": "resolved_current",
                "argument_summary": {
                    "service_key": "transport_commute",
                    "campus": "fengtai",
                },
                "source_ids": ["transport_schedule:commute"],
            },
        ),
        "runtime_versions": {"supervisor-api": "test"},
        "policy_artifact_versions": {"intent-policy": "v1"},
    }
    defaults.update(overrides)
    return WorkflowTraceSummary(**defaults)


def _workflow_case(**expectation_overrides) -> WorkflowTraceCase:
    expectation_defaults = {
        "direct_vs_delegate_branch": "direct",
        "workflow_mode": "direct_runtime",
        "selected_target": "campus-services-agent",
        "selected_tools": ("transport_schedule_lookup",),
        "expected_answer_artifact_kinds": ("schedule_baseline",),
        "handoff": {"target": "campus-services-agent"},
        "handoff_chain": (),
        "tool_argument_summary": {
            "service_key": "transport_commute",
            "campus": "fengtai",
        },
        "tool_call_summaries": (
            {
                "tool_name": "transport_schedule_lookup",
                "result_status": "completed",
                "argument_summary": {
                    "service_key": "transport_commute",
                    "campus": "fengtai",
                },
                "source_ids": ["transport_schedule:commute"],
            },
        ),
        "expected_tool_order": ("transport_schedule_lookup",),
        "expected_tool_result_statuses": {"transport_schedule_lookup": "completed"},
        "expected_source_ids": ("transport_schedule:commute",),
        "guardrail_outcomes": {"visibility": "public"},
        "fail_close_expected": False,
    }
    expectation_defaults.update(expectation_overrides)
    return WorkflowTraceCase(
        case_id="workflow-transport-schedule",
        family="workflow_trace",
        description="transport schedule direct structured branch",
        expectation=WorkflowTraceExpectation(**expectation_defaults),
    )


def _contains_selected_notice_get(value: object) -> bool:
    if isinstance(value, dict):
        if value.get("selected_tool") == "campus_notice_get":
            return True
        return any(_contains_selected_notice_get(nested) for nested in value.values())
    if isinstance(value, tuple | list):
        return any(_contains_selected_notice_get(item) for item in value)
    return False


__all__ = [name for name in globals() if not name.startswith("__")]
