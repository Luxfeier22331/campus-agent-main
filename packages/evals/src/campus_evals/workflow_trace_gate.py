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

WORKFLOW_TRACE_GATE_CASES_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "workflow_trace_gate_cases.v1.json"
)


@dataclass(frozen=True, slots=True)
class WorkflowTraceExpectation:
    direct_vs_delegate_branch: str
    selected_target: str
    selected_tools: tuple[str, ...] = field(default_factory=tuple)
    handoff: dict[str, object] = field(default_factory=dict)
    tool_argument_summary: dict[str, object] = field(default_factory=dict)
    tool_call_summaries: tuple[dict[str, object], ...] = field(default_factory=tuple)
    expected_tool_order: tuple[str, ...] = field(default_factory=tuple)
    expected_tool_result_statuses: dict[str, object] = field(default_factory=dict)
    expected_source_ids: tuple[str, ...] = field(default_factory=tuple)
    fail_close_provenance: dict[str, object] = field(default_factory=dict)
    guardrail_outcomes: dict[str, object] = field(default_factory=dict)
    fail_close_expected: bool = False
    fail_close_reason: str = ""

    def __post_init__(self) -> None:
        for field_name, payload in (
            ("handoff", self.handoff),
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
            _equals("selected_target", summary.selected_target, expectation.selected_target),
            _mapping_contains("handoff", summary.handoff, expectation.handoff),
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
        trace_projection_completeness=_trace_projection_completeness(summary),
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
            selected_target=str(expectation.get("selected_target") or ""),
            selected_tools=tuple(str(tool) for tool in expectation.get("selected_tools") or ()),
            handoff=dict(expectation.get("handoff") or {}),
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
            expected_source_ids=tuple(
                str(source_id) for source_id in expectation.get("expected_source_ids") or ()
            ),
            fail_close_provenance=dict(expectation.get("fail_close_provenance") or {}),
            guardrail_outcomes=dict(expectation.get("guardrail_outcomes") or {}),
            fail_close_expected=bool(expectation.get("fail_close_expected") or False),
            fail_close_reason=str(expectation.get("fail_close_reason") or ""),
        ),
    )


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
        source_id for source_id in expectation.expected_source_ids if source_id not in observed_source_ids
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


def _trace_projection_completeness(summary: WorkflowTraceSummary) -> DimensionResult:
    missing = []
    if not summary.direct_vs_delegate_branch:
        missing.append("direct_vs_delegate_branch")
    if not summary.selected_target:
        missing.append("selected_target")
    if (
        not summary.selected_tools
        and not summary.fail_close_reason
        and summary.direct_vs_delegate_branch != "clarification"
    ):
        missing.append("selected_tools")
    if not summary.planning_outcome:
        missing.append("planning_outcome")
    return DimensionResult(
        passed=not missing,
        reason="" if not missing else "missing workflow trace fields: " + ", ".join(missing),
    )
