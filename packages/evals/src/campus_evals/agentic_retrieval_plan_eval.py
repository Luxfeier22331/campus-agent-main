from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

from campus_evals.models import reject_forbidden_workflow_trace_keys

AGENTIC_RETRIEVAL_PLAN_CASES_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "agentic_retrieval_plan_cases.v1.json"
)


@dataclass(frozen=True, slots=True)
class AgenticRetrievalPlanExpected:
    decomposition: tuple[str, ...]
    step_plan: tuple[str, ...]
    freshness_branch: str
    live_branch_outcome: str
    fail_close_reason: str
    supporting_evidence_ids: tuple[str, ...]
    final_answer_status: str


@dataclass(frozen=True, slots=True)
class AgenticRetrievalPlanCase:
    case_id: str
    user_goal: str
    split: str
    expected: AgenticRetrievalPlanExpected


@dataclass(frozen=True, slots=True)
class AgenticRetrievalPlanCaseSet:
    schema_version: int
    case_family: str
    cases: tuple[AgenticRetrievalPlanCase, ...]


@dataclass(frozen=True, slots=True)
class AgenticRetrievalPlanObservation:
    case_id: str
    decomposition: tuple[str, ...]
    step_plan: tuple[str, ...]
    freshness_branch: str
    live_branch_outcome: str
    fail_close_reason: str = ""
    supporting_evidence_ids: tuple[str, ...] = ()
    final_answer_status: str = ""

    def __post_init__(self) -> None:
        reject_forbidden_workflow_trace_keys(asdict(self), "agentic_retrieval_plan_observation")


@dataclass(frozen=True, slots=True)
class AgenticRetrievalPlanResult:
    case_id: str
    passed: bool
    failure_classes: tuple[str, ...]
    reason: str


@dataclass(frozen=True, slots=True)
class AgenticRetrievalPlanReport:
    passed: bool
    total: int
    passed_count: int
    failed_count: int
    results: tuple[AgenticRetrievalPlanResult, ...]


def load_agentic_retrieval_plan_cases(
    path: str | Path | None = None,
) -> AgenticRetrievalPlanCaseSet:
    payload = _load_json(Path(path) if path is not None else AGENTIC_RETRIEVAL_PLAN_CASES_PATH)
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("agentic retrieval plan schema_version must be 1")
    if _required_string(payload.get("case_family"), "case_family") != "agentic_retrieval_plan.v1":
        raise ValueError("unsupported agentic retrieval plan case_family")
    raw_cases = payload.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValueError("agentic retrieval plan cases must be a non-empty list")
    cases = tuple(_parse_case(item) for item in raw_cases)
    _reject_duplicate_case_ids(case.case_id for case in cases)
    return AgenticRetrievalPlanCaseSet(
        schema_version=1,
        case_family="agentic_retrieval_plan.v1",
        cases=cases,
    )


def evaluate_agentic_retrieval_plan_cases(
    cases: tuple[AgenticRetrievalPlanCase, ...],
    observations: dict[str, AgenticRetrievalPlanObservation],
    *,
    output_path: Path | None = None,
) -> AgenticRetrievalPlanReport:
    results = tuple(_evaluate_case(case, observations.get(case.case_id)) for case in cases)
    passed_count = sum(1 for result in results if result.passed)
    report = AgenticRetrievalPlanReport(
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
                    "case_family": "agentic_retrieval_plan.v1",
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


def _evaluate_case(
    case: AgenticRetrievalPlanCase,
    observation: AgenticRetrievalPlanObservation | None,
) -> AgenticRetrievalPlanResult:
    if observation is None:
        return AgenticRetrievalPlanResult(
            case_id=case.case_id,
            passed=False,
            failure_classes=("missing_observation",),
            reason="missing observation",
        )

    expected = case.expected
    failures: list[tuple[str, str]] = []
    if observation.decomposition != expected.decomposition:
        failures.append(("plan_error", "decomposition mismatch"))
    if observation.step_plan != expected.step_plan:
        failures.append(("plan_error", "step_plan mismatch"))
    if observation.freshness_branch != expected.freshness_branch:
        failures.append(("freshness_branch_error", "freshness_branch mismatch"))
    if (
        observation.live_branch_outcome != expected.live_branch_outcome
        or observation.fail_close_reason != expected.fail_close_reason
    ):
        failures.append(("live_branch_fail_close_error", "live branch outcome mismatch"))
    if observation.supporting_evidence_ids != expected.supporting_evidence_ids:
        failures.append(("evidence_error", "supporting evidence mismatch"))
    if observation.final_answer_status != expected.final_answer_status:
        failures.append(("final_answer_error", "final answer status mismatch"))

    failure_classes = _unique_failure_classes(failures)
    return AgenticRetrievalPlanResult(
        case_id=case.case_id,
        passed=not failure_classes,
        failure_classes=failure_classes,
        reason="ok" if not failures else "; ".join(reason for _, reason in failures),
    )


def _unique_failure_classes(failures: list[tuple[str, str]]) -> tuple[str, ...]:
    ordered: list[str] = []
    for failure_class, _ in failures:
        if failure_class not in ordered:
            ordered.append(failure_class)
    return tuple(ordered)


def _parse_case(payload: object) -> AgenticRetrievalPlanCase:
    item = _mapping(payload, "case")
    expected = _mapping(item.get("expected"), "case.expected")
    return AgenticRetrievalPlanCase(
        case_id=_required_string(item.get("case_id"), "case_id"),
        user_goal=_required_string(item.get("user_goal"), "user_goal"),
        split=_required_string(item.get("split"), "split"),
        expected=AgenticRetrievalPlanExpected(
            decomposition=_string_tuple(expected.get("decomposition"), "expected.decomposition"),
            step_plan=_string_tuple(expected.get("step_plan"), "expected.step_plan"),
            freshness_branch=_required_string(
                expected.get("freshness_branch"),
                "expected.freshness_branch",
            ),
            live_branch_outcome=_required_string(
                expected.get("live_branch_outcome"),
                "expected.live_branch_outcome",
            ),
            fail_close_reason=str(expected.get("fail_close_reason") or ""),
            supporting_evidence_ids=_string_tuple(
                expected.get("supporting_evidence_ids"),
                "expected.supporting_evidence_ids",
            ),
            final_answer_status=_required_string(
                expected.get("final_answer_status"),
                "expected.final_answer_status",
            ),
        ),
    )


def _load_json(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def _mapping(value: object, field_name: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object")
    return dict(value)


def _string_tuple(value: object, field_name: str) -> tuple[str, ...]:
    if not isinstance(value, list | tuple) or not value:
        raise ValueError(f"{field_name} must be a non-empty list")
    return tuple(_required_string(item, field_name) for item in value)


def _required_string(value: object, field_name: str) -> str:
    normalized = "" if value is None else str(value).strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


def _reject_duplicate_case_ids(case_ids) -> None:
    seen: set[str] = set()
    for case_id in case_ids:
        if case_id in seen:
            raise ValueError(f"duplicate agentic retrieval plan case_id: {case_id}")
        seen.add(case_id)


__all__ = [
    "AGENTIC_RETRIEVAL_PLAN_CASES_PATH",
    "AgenticRetrievalPlanCase",
    "AgenticRetrievalPlanCaseSet",
    "AgenticRetrievalPlanExpected",
    "AgenticRetrievalPlanObservation",
    "AgenticRetrievalPlanReport",
    "AgenticRetrievalPlanResult",
    "evaluate_agentic_retrieval_plan_cases",
    "load_agentic_retrieval_plan_cases",
]
