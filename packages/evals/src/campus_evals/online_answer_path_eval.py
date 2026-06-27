from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

from campus_evals.fixture_registry import fixture_path
from campus_evals.models import reject_forbidden_workflow_trace_keys

ONLINE_ANSWER_PATH_CASES_PATH = fixture_path("e2e.online_answer_path.main_path")
ONLINE_ANSWER_PRODUCT_PATH_CASES_PATH = fixture_path("e2e.online_answer_path.product_path")
ONLINE_ANSWER_PATH_RELEASE_SPLITS = ("release_gate", "regression_locked")


@dataclass(frozen=True, slots=True)
class OnlineAnswerPathExpected:
    selected_tool: str
    terminal_status: str
    semantic_outcome: str
    fail_close_reason: str = ""
    response_contract: dict[str, object] = field(default_factory=dict)
    operator_backflow: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class OnlineAnswerPathCase:
    case_id: str
    user_goal: str
    split: str
    expected: OnlineAnswerPathExpected
    case_family: str = "online_answer_main_path.v1"
    response_contract: dict[str, object] = field(default_factory=dict)
    source_truth: dict[str, object] = field(default_factory=dict)
    trace_contract: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class OnlineAnswerPathCaseSet:
    schema_version: int
    case_family: str
    cases: tuple[OnlineAnswerPathCase, ...]


@dataclass(frozen=True, slots=True)
class OnlineAnswerPathObservation:
    case_id: str
    request_id: str
    trace_id: str
    selected_tool: str
    terminal_status: str
    semantic_outcome: str
    fail_close_reason: str = ""
    response_contract: dict[str, object] = field(default_factory=dict)
    operator_backflow: dict[str, object] = field(default_factory=dict)
    request_correlation: dict[str, object] = field(default_factory=dict)
    workflow_trace_summary: dict[str, object] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for field_name, payload in (
            ("response_contract", self.response_contract),
            ("operator_backflow", self.operator_backflow),
            ("request_correlation", self.request_correlation),
            ("workflow_trace_summary", self.workflow_trace_summary),
        ):
            reject_forbidden_workflow_trace_keys(payload, field_name)


@dataclass(frozen=True, slots=True)
class OnlineAnswerPathResult:
    case_id: str
    passed: bool
    reason: str
    request_id: str = ""
    trace_id: str = ""


@dataclass(frozen=True, slots=True)
class OnlineAnswerPathReport:
    passed: bool
    total: int
    passed_count: int
    failed_count: int
    results: tuple[OnlineAnswerPathResult, ...]


def load_online_answer_path_cases(
    path: str | Path | None = None,
) -> OnlineAnswerPathCaseSet:
    payload = _load_json(Path(path) if path is not None else ONLINE_ANSWER_PATH_CASES_PATH)
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("online answer path schema_version must be 1")
    case_family = _required_string(payload.get("case_family"), "case_family")
    if case_family not in {"online_answer_path.v1", "online_answer_main_path.v1"}:
        raise ValueError("unsupported online answer path case_family")
    raw_cases = payload.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValueError("online answer path cases must be a non-empty list")
    cases = tuple(_parse_case(item, case_family=case_family) for item in raw_cases)
    _reject_duplicate_case_ids(case.case_id for case in cases)
    return OnlineAnswerPathCaseSet(
        schema_version=1,
        case_family=case_family,
        cases=cases,
    )


def build_online_answer_path_report(
    cases: tuple[OnlineAnswerPathCase, ...],
    observations: dict[str, OnlineAnswerPathObservation],
    *,
    output_path: Path | None = None,
) -> OnlineAnswerPathReport:
    results = tuple(_evaluate_case(case, observations.get(case.case_id)) for case in cases)
    passed_count = sum(1 for result in results if result.passed)
    report = OnlineAnswerPathReport(
        passed=passed_count == len(results),
        total=len(results),
        passed_count=passed_count,
        failed_count=len(results) - passed_count,
        results=results,
    )
    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(
                {
                    "schema_version": 1,
                    "case_family": _case_family_for_report(cases),
                    "summary": {
                        "total": report.total,
                        "passed": report.passed_count,
                        "failed": report.failed_count,
                        "overall_passed": report.passed,
                    },
                    "results": [asdict(result) for result in report.results],
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    return report


def filter_online_answer_path_cases(
    case_set: OnlineAnswerPathCaseSet,
    *,
    splits: tuple[str, ...] = ONLINE_ANSWER_PATH_RELEASE_SPLITS,
) -> OnlineAnswerPathCaseSet:
    split_set = set(splits)
    return OnlineAnswerPathCaseSet(
        schema_version=case_set.schema_version,
        case_family=case_set.case_family,
        cases=tuple(case for case in case_set.cases if case.split in split_set),
    )


def _case_family_for_report(cases: tuple[OnlineAnswerPathCase, ...]) -> str:
    if not cases:
        return "online_answer_main_path.v1"
    families = {case.case_family for case in cases}
    if len(families) != 1:
        raise ValueError(f"online answer path report cannot mix case families: {families}")
    return cases[0].case_family


def _evaluate_case(
    case: OnlineAnswerPathCase,
    observation: OnlineAnswerPathObservation | None,
) -> OnlineAnswerPathResult:
    if observation is None:
        return OnlineAnswerPathResult(case.case_id, False, "missing observation")
    failures: list[str] = []
    if not observation.request_id.strip():
        failures.append("request_id missing")
    if not observation.trace_id.strip():
        failures.append("trace_id missing")
    if observation.selected_tool != case.expected.selected_tool:
        failures.append(
            f"selected_tool expected {case.expected.selected_tool!r}, got {observation.selected_tool!r}"
        )
    if observation.terminal_status != case.expected.terminal_status:
        failures.append(
            f"terminal_status expected {case.expected.terminal_status!r}, got {observation.terminal_status!r}"
        )
    if observation.semantic_outcome != case.expected.semantic_outcome:
        failures.append(
            f"semantic_outcome expected {case.expected.semantic_outcome!r}, got {observation.semantic_outcome!r}"
        )
    if (
        case.expected.fail_close_reason
        and observation.fail_close_reason != case.expected.fail_close_reason
    ):
        failures.append(
            f"fail_close_reason expected {case.expected.fail_close_reason!r}, got {observation.fail_close_reason!r}"
        )
    failures.extend(
        _subset_mismatch_reasons(
            "response_contract",
            case.expected.response_contract,
            observation.response_contract,
        )
    )
    failures.extend(
        _subset_mismatch_reasons(
            "operator_backflow",
            case.expected.operator_backflow,
            observation.operator_backflow,
        )
    )
    failures.extend(_workflow_trace_mismatch_reasons(case, observation))
    return OnlineAnswerPathResult(
        case_id=case.case_id,
        passed=not failures,
        reason="ok" if not failures else "; ".join(failures),
        request_id=observation.request_id,
        trace_id=observation.trace_id,
    )


def _parse_case(payload: object, *, case_family: str) -> OnlineAnswerPathCase:
    if case_family == "online_answer_main_path.v1":
        return _parse_main_path_case(payload, case_family=case_family)
    return _parse_product_path_case(payload, case_family=case_family)


def _parse_product_path_case(payload: object, *, case_family: str) -> OnlineAnswerPathCase:
    item = _mapping(payload, "case")
    expected = _mapping(item.get("expected"), "case.expected")
    response_contract = _mapping(
        expected.get("response_contract"),
        "expected.response_contract",
    )
    return OnlineAnswerPathCase(
        case_id=_required_string(item.get("case_id"), "case_id"),
        user_goal=_required_string(item.get("user_goal"), "user_goal"),
        split=_required_string(item.get("split"), "split"),
        expected=OnlineAnswerPathExpected(
            selected_tool=_required_string(expected.get("selected_tool"), "selected_tool"),
            terminal_status=_required_string(
                expected.get("terminal_status"),
                "terminal_status",
            ),
            semantic_outcome=_required_string(
                expected.get("semantic_outcome"),
                "semantic_outcome",
            ),
            fail_close_reason=str(expected.get("fail_close_reason") or ""),
            response_contract=response_contract,
            operator_backflow=_mapping(
                expected.get("operator_backflow"),
                "expected.operator_backflow",
            ),
        ),
        case_family=case_family,
        response_contract=response_contract,
    )


def _parse_main_path_case(payload: object, *, case_family: str) -> OnlineAnswerPathCase:
    item = _mapping(payload, "case")
    expected = _mapping(item.get("expected"), "case.expected")
    source_truth = _mapping(expected.get("source_truth"), "expected.source_truth")
    trace_contract = _mapping(expected.get("trace_contract"), "expected.trace_contract")
    answer_contract = _mapping(expected.get("answer_contract"), "expected.answer_contract")
    terminal_outcome = _required_string(expected.get("terminal_outcome"), "terminal_outcome")
    domain = _required_string(item.get("domain"), "domain")
    response_contract_metadata: dict[str, object] = {
        **answer_contract,
        "domain": domain,
        "evidence_required": bool(source_truth.get("evidence_required")),
    }
    return OnlineAnswerPathCase(
        case_id=_required_string(item.get("case_id"), "case_id"),
        user_goal=_required_string(item.get("user_utterance"), "user_utterance"),
        split=_required_string(item.get("split"), "split"),
        expected=OnlineAnswerPathExpected(
            selected_tool=_required_string(
                expected.get("selected_tool"),
                "selected_tool",
            ),
            terminal_status=_terminal_status_from_main_path_outcome(terminal_outcome),
            semantic_outcome=_semantic_outcome_from_main_path_outcome(terminal_outcome),
            response_contract=answer_contract,
            operator_backflow={
                "quality_candidate_supported": True,
            },
        ),
        case_family=case_family,
        response_contract=response_contract_metadata,
        source_truth=source_truth,
        trace_contract=trace_contract,
    )


def _terminal_status_from_main_path_outcome(outcome: str) -> str:
    if outcome == "completed":
        return "completed"
    if outcome == "clarification":
        return "needs_clarification"
    if outcome == "fail_closed":
        return "error"
    raise ValueError(f"unsupported online answer main path terminal_outcome: {outcome}")


def _semantic_outcome_from_main_path_outcome(outcome: str) -> str:
    if outcome == "completed":
        return "answered"
    if outcome == "clarification":
        return "clarification"
    if outcome == "fail_closed":
        return "fail_close"
    raise ValueError(f"unsupported online answer main path terminal_outcome: {outcome}")


def _subset_mismatch_reasons(
    field_name: str,
    expected: dict[str, object],
    actual: dict[str, object],
) -> list[str]:
    return [
        f"{field_name}.{key} expected {expected_value!r}, got {actual.get(key)!r}"
        for key, expected_value in expected.items()
        if actual.get(key) != expected_value
    ]


def _workflow_trace_mismatch_reasons(
    case: OnlineAnswerPathCase,
    observation: OnlineAnswerPathObservation,
) -> list[str]:
    trace = observation.workflow_trace_summary
    if not trace:
        return []
    failures: list[str] = []
    trace_target = _normalized_trace_target(trace.get("selected_tool"))
    if trace_target != observation.selected_tool:
        failures.append(
            "workflow_trace_summary.selected_tool expected "
            f"{observation.selected_tool!r}, got {trace_target!r}"
        )
    branch = str(trace.get("direct_vs_delegate_branch") or "").strip()
    expected_branches = _expected_trace_branches(case.expected.semantic_outcome)
    if expected_branches and branch not in expected_branches:
        failures.append(
            "workflow_trace_summary.direct_vs_delegate_branch expected one of "
            f"{sorted(expected_branches)!r}, got {branch!r}"
        )
    trace_fail_close_reason = str(trace.get("fail_close_reason") or "").strip()
    if (
        case.expected.fail_close_reason
        and trace_fail_close_reason != case.expected.fail_close_reason
    ):
        failures.append(
            "workflow_trace_summary.fail_close_reason expected "
            f"{case.expected.fail_close_reason!r}, got {trace_fail_close_reason!r}"
        )
    return failures


def _normalized_trace_target(value: object) -> str:
    normalized = "" if value is None else str(value).strip()
    return normalized or "none"


def _expected_trace_branches(semantic_outcome: str) -> set[str]:
    if semantic_outcome == "answered":
        return {"delegate", "direct", "direct_answer", "tool"}
    if semantic_outcome == "clarification":
        return {"clarification"}
    if semantic_outcome == "fail_close":
        return {"fail_close"}
    return set()


def _load_json(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def _mapping(value: object, field_name: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object")
    return dict(value)


def _required_string(value: object, field_name: str) -> str:
    normalized = "" if value is None else str(value).strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


def _reject_duplicate_case_ids(case_ids) -> None:
    seen: set[str] = set()
    for case_id in case_ids:
        if case_id in seen:
            raise ValueError(f"duplicate online answer path case_id: {case_id}")
        seen.add(case_id)


__all__ = [
    "ONLINE_ANSWER_PATH_CASES_PATH",
    "ONLINE_ANSWER_PATH_RELEASE_SPLITS",
    "ONLINE_ANSWER_PRODUCT_PATH_CASES_PATH",
    "OnlineAnswerPathCase",
    "OnlineAnswerPathCaseSet",
    "OnlineAnswerPathExpected",
    "OnlineAnswerPathObservation",
    "OnlineAnswerPathReport",
    "OnlineAnswerPathResult",
    "build_online_answer_path_report",
    "filter_online_answer_path_cases",
    "load_online_answer_path_cases",
]
