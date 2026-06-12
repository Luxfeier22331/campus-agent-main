from __future__ import annotations

import json
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field, replace
from pathlib import Path

from campus_evals.models import (
    DimensionResult,
    ExecutionResult,
    OrchestrationCaseResults,
    WorkflowTraceSummary,
    reject_forbidden_workflow_trace_keys,
)
from campus_evals.workflow_trace_gate_projection import (
    _trace_projection_completeness,
)

WORKFLOW_TRACE_GATE_CASES_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "workflow_trace_gate_cases.v1.json"
)


@dataclass(frozen=True, slots=True)
class WorkflowTraceExpectation:
    direct_vs_delegate_branch: str
    selected_capability: str
    workflow_mode: str = ""
    selected_tools: tuple[str, ...] = field(default_factory=tuple)
    expected_answer_artifact_kinds: tuple[str, ...] = field(default_factory=tuple)
    handoff: dict[str, object] = field(default_factory=dict)
    handoff_chain: tuple[dict[str, object], ...] = field(default_factory=tuple)
    tool_argument_summary: dict[str, object] = field(default_factory=dict)
    tool_call_summaries: tuple[dict[str, object], ...] = field(default_factory=tuple)
    expected_tool_order: tuple[str, ...] = field(default_factory=tuple)
    expected_tool_result_statuses: dict[str, object] = field(default_factory=dict)
    expected_context_projection_kinds: tuple[str, ...] = field(default_factory=tuple)
    expected_source_ids: tuple[str, ...] = field(default_factory=tuple)
    fail_close_provenance: dict[str, object] = field(default_factory=dict)
    guardrail_outcomes: dict[str, object] = field(default_factory=dict)
    fail_close_expected: bool = False
    fail_close_reason: str = ""

    def __post_init__(self) -> None:
        for field_name, payload in (
            ("handoff", self.handoff),
            ("handoff_chain", self.handoff_chain),
            ("tool_argument_summary", self.tool_argument_summary),
            ("tool_call_summaries", self.tool_call_summaries),
            ("expected_tool_result_statuses", self.expected_tool_result_statuses),
            ("fail_close_provenance", self.fail_close_provenance),
            ("guardrail_outcomes", self.guardrail_outcomes),
        ):
            reject_forbidden_workflow_trace_keys(payload, field_name)


@dataclass(frozen=True, slots=True)
class WorkflowTraceCase:
    case_id: str
    family: str
    description: str
    expectation: WorkflowTraceExpectation


@dataclass(frozen=True, slots=True)
class WorkflowTraceCaseSet:
    schema_version: int
    case_family: str
    cases: tuple[WorkflowTraceCase, ...]


def load_workflow_trace_cases(
    path: str | Path = WORKFLOW_TRACE_GATE_CASES_PATH,
) -> WorkflowTraceCaseSet:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    return WorkflowTraceCaseSet(
        schema_version=int(payload.get("schema_version") or 1),
        case_family=str(payload.get("case_family") or ""),
        cases=tuple(_workflow_trace_case(item) for item in payload.get("cases") or ()),
    )


def evaluate_workflow_trace_case(
    case: WorkflowTraceCase,
    summary: WorkflowTraceSummary | None,
) -> OrchestrationCaseResults:
    if summary is None:
        missing = DimensionResult(False, "workflow_trace_summary is missing")
        return OrchestrationCaseResults(
            direct_vs_delegate_branch_correctness=missing,
            handoff_correctness=missing,
            tool_argument_precision=missing,
            guardrail_correctness=missing,
            fail_close_correctness=missing,
            trace_projection_completeness=missing,
        )

    expectation = case.expectation
    return OrchestrationCaseResults(
        direct_vs_delegate_branch_correctness=_equals(
            "direct_vs_delegate_branch",
            summary.direct_vs_delegate_branch,
            expectation.direct_vs_delegate_branch,
        ),
        handoff_correctness=_combine_dimension_results(
            _equals("workflow_mode", summary.workflow_mode, expectation.workflow_mode)
            if expectation.workflow_mode
            else DimensionResult(True, "not_applicable"),
            _equals("selected_capability", summary.selected_capability, expectation.selected_capability),
            _mapping_contains("handoff", summary.handoff, expectation.handoff),
            _handoff_chain_contains(summary.handoff_chain, expectation.handoff_chain),
        ),
        tool_argument_precision=_combine_dimension_results(
            _equals("selected_tools", summary.selected_tools, expectation.selected_tools),
            _mapping_contains(
                "tool_argument_summary",
                summary.tool_argument_summary,
                expectation.tool_argument_summary,
            ),
        ),
        guardrail_correctness=_mapping_contains(
            "guardrail_outcomes",
            summary.guardrail_outcomes,
            expectation.guardrail_outcomes,
        ),
        fail_close_correctness=_fail_close_result(summary, expectation),
        trace_projection_completeness=_trace_projection_completeness(summary, expectation),
        tool_order_correctness=_tool_order_result(summary, expectation),
        tool_result_status_correctness=_tool_result_status_result(summary, expectation),
        fail_close_provenance=_mapping_contains(
            "fail_close_provenance",
            _fail_close_provenance(summary),
            expectation.fail_close_provenance,
        ),
        evidence_source_selection=_evidence_source_selection_result(summary, expectation),
    )


def evaluate_workflow_trace_cases(
    cases: Iterable[WorkflowTraceCase],
    summaries_by_case_id: dict[str, WorkflowTraceSummary | None],
) -> dict[str, OrchestrationCaseResults]:
    return {
        case.case_id: evaluate_workflow_trace_case(
            case,
            summaries_by_case_id.get(case.case_id),
        )
        for case in cases
    }


def load_process_smoke_workflow_trace_summaries(
    report_paths: Iterable[str | Path],
    *,
    profile_case_ids: dict[str, str],
) -> dict[str, WorkflowTraceSummary]:
    summaries: dict[str, WorkflowTraceSummary] = {}
    for report_path in report_paths:
        payload = json.loads(Path(report_path).read_text(encoding="utf-8"))
        profile = str(payload.get("profile") or "").strip()
        case_id = profile_case_ids.get(profile, "")
        if not case_id:
            continue
        summary_payload = _process_smoke_workflow_trace_payload(payload)
        if summary_payload is None:
            continue
        summaries[case_id] = _workflow_trace_summary_from_payload(summary_payload)
    return summaries


def validate_workflow_trace_case_set(case_set: WorkflowTraceCaseSet) -> None:
    if case_set.schema_version <= 0:
        raise ValueError("schema_version must be positive")
    if not case_set.case_family.strip():
        raise ValueError("case_family must not be empty")
    case_ids = [case.case_id for case in case_set.cases]
    if any(not case_id.strip() for case_id in case_ids):
        raise ValueError("workflow trace case_id must not be empty")
    if len(set(case_ids)) != len(case_ids):
        raise ValueError("workflow trace case_id must be unique")
    for case in case_set.cases:
        _validate_workflow_trace_expectation(case)


def _validate_workflow_trace_expectation(case: WorkflowTraceCase) -> None:
    selected_tools = tuple(tool for tool in case.expectation.selected_tools if tool.strip())
    if not selected_tools:
        return
    if not case.expectation.tool_call_summaries:
        raise ValueError(
            f"{case.case_id} expectation.tool_call_summaries is required "
            "when selected_tools is not empty"
        )
    tool_names = []
    for index, item in enumerate(case.expectation.tool_call_summaries):
        tool_name = str(item.get("tool_name") or item.get("tool") or "").strip()
        if not tool_name:
            raise ValueError(
                f"{case.case_id} expectation.tool_call_summaries[{index}].tool_name "
                "must not be empty"
            )
        result_status = str(item.get("result_status") or item.get("status") or "").strip()
        if not result_status:
            raise ValueError(
                f"{case.case_id} expectation.tool_call_summaries[{index}].result_status "
                "must not be empty"
            )
        tool_names.append(tool_name)
    missing_tools = [tool for tool in selected_tools if tool not in tool_names]
    if missing_tools:
        raise ValueError(
            f"{case.case_id} expectation.tool_call_summaries missing selected tools: "
            + ", ".join(missing_tools)
        )


def attach_workflow_trace_gate(
    executor: Callable[[object], ExecutionResult],
    *,
    workflow_trace_cases: Iterable[WorkflowTraceCase] | None = None,
) -> Callable[[object], ExecutionResult]:
    case_map = {
        case.case_id: case
        for case in (
            tuple(workflow_trace_cases)
            if workflow_trace_cases is not None
            else load_workflow_trace_cases().cases
        )
    }

    def wrapped(case: object) -> ExecutionResult:
        execution = executor(case)
        case_id = str(getattr(case, "case_id", ""))
        workflow_case = case_map.get(case_id)
        if workflow_case is None:
            return execution
        return replace(
            execution,
            orchestration_case_results=evaluate_workflow_trace_case(
                workflow_case,
                execution.workflow_trace_summary,
            ),
        )

    return wrapped


def _workflow_trace_case(payload: object) -> WorkflowTraceCase:
    item = dict(payload or {})
    expectation = dict(item.get("expectation") or {})
    return WorkflowTraceCase(
        case_id=str(item.get("case_id") or ""),
        family=str(item.get("family") or ""),
        description=str(item.get("description") or ""),
        expectation=WorkflowTraceExpectation(
            direct_vs_delegate_branch=str(expectation.get("direct_vs_delegate_branch") or ""),
            workflow_mode=str(expectation.get("workflow_mode") or ""),
            selected_capability=str(expectation.get("selected_capability") or ""),
            selected_tools=tuple(str(tool) for tool in expectation.get("selected_tools") or ()),
            expected_answer_artifact_kinds=tuple(
                str(kind) for kind in expectation.get("expected_answer_artifact_kinds") or ()
            ),
            handoff=dict(expectation.get("handoff") or {}),
            handoff_chain=tuple(dict(item) for item in expectation.get("handoff_chain") or ()),
            tool_argument_summary=dict(expectation.get("tool_argument_summary") or {}),
            tool_call_summaries=tuple(
                dict(item) for item in expectation.get("tool_call_summaries") or ()
            ),
            expected_tool_order=tuple(
                str(tool) for tool in expectation.get("expected_tool_order") or ()
            ),
            expected_tool_result_statuses=dict(
                expectation.get("expected_tool_result_statuses") or {}
            ),
            expected_context_projection_kinds=tuple(
                str(kind) for kind in expectation.get("expected_context_projection_kinds") or ()
            ),
            expected_source_ids=tuple(
                str(source_id) for source_id in expectation.get("expected_source_ids") or ()
            ),
            fail_close_provenance=dict(expectation.get("fail_close_provenance") or {}),
            guardrail_outcomes=dict(expectation.get("guardrail_outcomes") or {}),
            fail_close_expected=bool(expectation.get("fail_close_expected") or False),
            fail_close_reason=str(expectation.get("fail_close_reason") or ""),
        ),
    )


def _process_smoke_workflow_trace_payload(payload: dict[str, object]) -> object | None:
    answer = payload.get("answer")
    if isinstance(answer, dict):
        return answer.get("workflow_trace_summary") or answer.get("workflowTraceSummary")
    if isinstance(answer, str):
        try:
            parsed = json.loads(answer)
        except json.JSONDecodeError:
            return None
        if isinstance(parsed, dict):
            return parsed.get("workflow_trace_summary") or parsed.get("workflowTraceSummary")
    return None


def _workflow_trace_summary_from_payload(payload: object) -> WorkflowTraceSummary:
    record = dict(payload or {}) if isinstance(payload, dict) else {}
    selected_tools = _list_value(record, "selected_tools", "selectedTools")
    handoff_chain = _list_value(record, "handoff_chain", "handoffChain")
    context_projections = _list_value(record, "context_projections", "contextProjections")
    capability_invocations = _list_value(record, "capability_invocations", "agentInvocations")
    answer_artifact_projection_ids = _list_value(
        record,
        "answer_artifact_projection_ids",
        "answerArtifactProjectionIds",
    )
    answer_artifact_kinds = _list_value(
        record,
        "answer_artifact_kinds",
        "answerArtifactKinds",
    )
    return WorkflowTraceSummary(
        routing_frame=_dict_value(record, "routing_frame", "routingFrame"),
        context_resolution=_dict_value(record, "context_resolution", "contextResolution"),
        planning_outcome=_string_value(record, "planning_outcome", "planningOutcome"),
        direct_vs_delegate_branch=_string_value(
            record,
            "direct_vs_delegate_branch",
            "directVsDelegateBranch",
        ),
        workflow_mode=_string_value(record, "workflow_mode", "workflowMode"),
        handoff=_dict_value(record, "handoff"),
        handoff_chain=tuple(dict(item) for item in handoff_chain if isinstance(item, dict)),
        capability_invocations=tuple(dict(item) for item in capability_invocations if isinstance(item, dict)),
        selected_capability=_string_value(record, "selected_capability", "selectedCapability"),
        selected_tools=tuple(str(item) for item in selected_tools if str(item).strip()),
        context_projections=tuple(
            dict(item) for item in context_projections if isinstance(item, dict)
        ),
        answer_artifact_projection_ids=tuple(
            str(item) for item in answer_artifact_projection_ids if str(item).strip()
        ),
        answer_artifact_kinds=tuple(
            str(item) for item in answer_artifact_kinds if str(item).strip()
        ),
        tool_argument_summary=_dict_value(
            record,
            "tool_argument_summary",
            "toolArgumentSummary",
        ),
        trace_steps=_tuple_dict_value(record, "trace_steps", "traceSteps"),
        tool_call_summaries=_tuple_dict_value(
            record,
            "tool_call_summaries",
            "toolCallSummaries",
        ),
        guardrail_outcomes=_dict_value(record, "guardrail_outcomes", "guardrailOutcomes"),
        fail_close_reason=_string_value(record, "fail_close_reason", "failCloseReason"),
        runtime_versions=_dict_value(record, "runtime_versions", "runtimeVersions"),
        policy_artifact_versions=_dict_value(
            record,
            "policy_artifact_versions",
            "policyArtifactVersions",
        ),
    )


def _record_value(record: dict[str, object], *keys: str) -> object:
    for key in keys:
        if key in record:
            return record[key]
    return None


def _string_value(record: dict[str, object], *keys: str) -> str:
    value = _record_value(record, *keys)
    return value.strip() if isinstance(value, str) else ""


def _dict_value(record: dict[str, object], *keys: str) -> dict[str, object]:
    value = _record_value(record, *keys)
    return dict(value) if isinstance(value, dict) else {}


def _list_value(record: dict[str, object], *keys: str) -> list[object]:
    value = _record_value(record, *keys)
    return list(value) if isinstance(value, list | tuple) else []


def _tuple_dict_value(record: dict[str, object], *keys: str) -> tuple[dict[str, object], ...]:
    return tuple(dict(item) for item in _list_value(record, *keys) if isinstance(item, dict))


def _equals(field_name: str, observed: object, expected: object) -> DimensionResult:
    passed = observed == expected
    return DimensionResult(
        passed=passed,
        reason="" if passed else f"{field_name}={observed!r}, expected {expected!r}",
    )


def _mapping_contains(
    field_name: str,
    observed: dict[str, object],
    expected: dict[str, object],
) -> DimensionResult:
    missing_or_mismatch = {
        key: {"observed": observed.get(key), "expected": expected_value}
        for key, expected_value in expected.items()
        if observed.get(key) != expected_value
    }
    passed = not missing_or_mismatch
    return DimensionResult(
        passed=passed,
        reason="" if passed else f"{field_name} mismatch: {missing_or_mismatch}",
    )


def _handoff_chain_contains(
    observed: tuple[dict[str, object], ...],
    expected: tuple[dict[str, object], ...],
) -> DimensionResult:
    if not expected:
        return DimensionResult(True, "not_applicable")
    if len(observed) < len(expected):
        return DimensionResult(
            False,
            f"handoff_chain length={len(observed)}, expected at least {len(expected)}",
        )
    failures = []
    for index, expected_item in enumerate(expected):
        result = _mapping_contains(f"handoff_chain[{index}]", observed[index], expected_item)
        if not result.passed:
            failures.append(result.reason)
    return DimensionResult(
        passed=not failures,
        reason="; ".join(failure for failure in failures if failure),
    )


def _combine_dimension_results(*results: DimensionResult) -> DimensionResult:
    failures = [result.reason for result in results if not result.passed]
    return DimensionResult(
        passed=not failures,
        reason="; ".join(failure for failure in failures if failure),
    )


def _fail_close_result(
    summary: WorkflowTraceSummary,
    expectation: WorkflowTraceExpectation,
) -> DimensionResult:
    observed_fail_close = bool(summary.fail_close_reason)
    if observed_fail_close != expectation.fail_close_expected:
        return DimensionResult(
            False,
            f"fail_close={observed_fail_close}, expected {expectation.fail_close_expected}",
        )
    if expectation.fail_close_reason and summary.fail_close_reason != expectation.fail_close_reason:
        return DimensionResult(
            False,
            f"fail_close_reason={summary.fail_close_reason!r}, expected {expectation.fail_close_reason!r}",
        )
    return DimensionResult(True)


def _tool_order_result(
    summary: WorkflowTraceSummary,
    expectation: WorkflowTraceExpectation,
) -> DimensionResult:
    expected = expectation.expected_tool_order or expectation.selected_tools
    if not expected:
        return DimensionResult(True, "not_applicable")
    observed = _observed_tool_order(summary)
    passed = observed == expected
    return DimensionResult(
        passed=passed,
        reason="" if passed else f"tool_order={observed!r}, expected {expected!r}",
    )


def _observed_tool_order(summary: WorkflowTraceSummary) -> tuple[str, ...]:
    tool_call_order = tuple(
        str(item.get("tool_name") or item.get("tool") or "")
        for item in summary.tool_call_summaries
        if str(item.get("tool_name") or item.get("tool") or "").strip()
    )
    return tool_call_order or summary.selected_tools


def _tool_result_status_result(
    summary: WorkflowTraceSummary,
    expectation: WorkflowTraceExpectation,
) -> DimensionResult:
    if not expectation.expected_tool_result_statuses:
        return DimensionResult(True, "not_applicable")
    observed = {
        str(item.get("tool_name") or item.get("tool") or ""): item.get("result_status")
        or item.get("status")
        for item in summary.tool_call_summaries
        if str(item.get("tool_name") or item.get("tool") or "").strip()
    }
    mismatches = {
        tool_name: {"observed": observed.get(tool_name), "expected": expected_status}
        for tool_name, expected_status in expectation.expected_tool_result_statuses.items()
        if observed.get(tool_name) != expected_status
    }
    return DimensionResult(
        passed=not mismatches,
        reason="" if not mismatches else f"result_status mismatch: {mismatches}",
    )


def _fail_close_provenance(summary: WorkflowTraceSummary) -> dict[str, object]:
    provenance = {}
    if summary.fail_close_reason:
        provenance["reason"] = summary.fail_close_reason
    for item in summary.tool_call_summaries:
        tool_name = str(item.get("tool_name") or item.get("tool") or "")
        fail_close_reason = item.get("fail_close_reason") or item.get("failCloseReason")
        if tool_name and fail_close_reason:
            provenance[tool_name] = fail_close_reason
    return provenance


def _evidence_source_selection_result(
    summary: WorkflowTraceSummary,
    expectation: WorkflowTraceExpectation,
) -> DimensionResult:
    if not expectation.expected_source_ids:
        return DimensionResult(True, "not_applicable")
    observed_source_ids = _observed_source_ids(summary)
    missing = [
        source_id
        for source_id in expectation.expected_source_ids
        if source_id not in observed_source_ids
    ]
    return DimensionResult(
        passed=not missing,
        reason="" if not missing else f"source_ids missing: {missing}",
    )


def _observed_source_ids(summary: WorkflowTraceSummary) -> set[str]:
    source_ids: set[str] = set()
    for item in summary.tool_call_summaries:
        for key in ("source_ids", "sourceIds", "evidence_ids", "evidenceIds"):
            raw_values = item.get(key)
            if isinstance(raw_values, list | tuple):
                source_ids.update(str(value) for value in raw_values if str(value).strip())
        source_id = item.get("source_id") or item.get("sourceId")
        if source_id:
            source_ids.add(str(source_id))
    return source_ids
