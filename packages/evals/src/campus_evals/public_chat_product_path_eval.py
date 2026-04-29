from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path

from campus_evals.models import reject_forbidden_workflow_trace_keys

PUBLIC_CHAT_PRODUCT_PATH_CASES_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "public_chat_product_path_cases.v1.json"
)


@dataclass(frozen=True, slots=True)
class PublicChatProductPathExpected:
    selected_target: str
    terminal_outcome: str
    fail_close_reason: str = ""
    response_contract: dict[str, object] = field(default_factory=dict)
    operator_backflow: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class PublicChatProductPathCase:
    case_id: str
    user_goal: str
    split: str
    expected: PublicChatProductPathExpected


@dataclass(frozen=True, slots=True)
class PublicChatProductPathCaseSet:
    schema_version: int
    case_family: str
    cases: tuple[PublicChatProductPathCase, ...]


@dataclass(frozen=True, slots=True)
class PublicChatProductPathObservation:
    case_id: str
    request_id: str
    trace_id: str
    selected_target: str
    terminal_outcome: str
    fail_close_reason: str = ""
    response_contract: dict[str, object] = field(default_factory=dict)
    operator_backflow: dict[str, object] = field(default_factory=dict)
    request_correlation: dict[str, object] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for field_name, payload in (
            ("response_contract", self.response_contract),
            ("operator_backflow", self.operator_backflow),
            ("request_correlation", self.request_correlation),
        ):
            reject_forbidden_workflow_trace_keys(payload, field_name)


@dataclass(frozen=True, slots=True)
class PublicChatProductPathResult:
    case_id: str
    passed: bool
    reason: str
    request_id: str = ""
    trace_id: str = ""


@dataclass(frozen=True, slots=True)
class PublicChatProductPathReport:
    passed: bool
    total: int
    passed_count: int
    failed_count: int
    results: tuple[PublicChatProductPathResult, ...]


def load_public_chat_product_path_cases(
    path: str | Path | None = None,
) -> PublicChatProductPathCaseSet:
    payload = _load_json(Path(path) if path is not None else PUBLIC_CHAT_PRODUCT_PATH_CASES_PATH)
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("public chat product path schema_version must be 1")
    if _required_string(payload.get("case_family"), "case_family") != "public_chat_product_path.v1":
        raise ValueError("unsupported public chat product path case_family")
    raw_cases = payload.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValueError("public chat product path cases must be a non-empty list")
    cases = tuple(_parse_case(item) for item in raw_cases)
    _reject_duplicate_case_ids(case.case_id for case in cases)
    return PublicChatProductPathCaseSet(
        schema_version=1,
        case_family="public_chat_product_path.v1",
        cases=cases,
    )


def build_public_chat_product_path_report(
    cases: tuple[PublicChatProductPathCase, ...],
    observations: dict[str, PublicChatProductPathObservation],
    *,
    output_path: Path | None = None,
) -> PublicChatProductPathReport:
    results = tuple(_evaluate_case(case, observations.get(case.case_id)) for case in cases)
    passed_count = sum(1 for result in results if result.passed)
    report = PublicChatProductPathReport(
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
                    "case_family": "public_chat_product_path.v1",
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
    case: PublicChatProductPathCase,
    observation: PublicChatProductPathObservation | None,
) -> PublicChatProductPathResult:
    if observation is None:
        return PublicChatProductPathResult(case.case_id, False, "missing observation")
    failures: list[str] = []
    if not observation.request_id.strip():
        failures.append("request_id missing")
    if not observation.trace_id.strip():
        failures.append("trace_id missing")
    if observation.selected_target != case.expected.selected_target:
        failures.append(
            f"selected_target expected {case.expected.selected_target!r}, got {observation.selected_target!r}"
        )
    if observation.terminal_outcome != case.expected.terminal_outcome:
        failures.append(
            f"terminal_outcome expected {case.expected.terminal_outcome!r}, got {observation.terminal_outcome!r}"
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
    return PublicChatProductPathResult(
        case_id=case.case_id,
        passed=not failures,
        reason="ok" if not failures else "; ".join(failures),
        request_id=observation.request_id,
        trace_id=observation.trace_id,
    )


def _parse_case(payload: object) -> PublicChatProductPathCase:
    item = _mapping(payload, "case")
    expected = _mapping(item.get("expected"), "case.expected")
    return PublicChatProductPathCase(
        case_id=_required_string(item.get("case_id"), "case_id"),
        user_goal=_required_string(item.get("user_goal"), "user_goal"),
        split=_required_string(item.get("split"), "split"),
        expected=PublicChatProductPathExpected(
            selected_target=_required_string(expected.get("selected_target"), "selected_target"),
            terminal_outcome=_required_string(
                expected.get("terminal_outcome"),
                "terminal_outcome",
            ),
            fail_close_reason=str(expected.get("fail_close_reason") or ""),
            response_contract=_mapping(
                expected.get("response_contract"),
                "expected.response_contract",
            ),
            operator_backflow=_mapping(
                expected.get("operator_backflow"),
                "expected.operator_backflow",
            ),
        ),
    )


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
            raise ValueError(f"duplicate public chat product path case_id: {case_id}")
        seen.add(case_id)


__all__ = [
    "PUBLIC_CHAT_PRODUCT_PATH_CASES_PATH",
    "PublicChatProductPathCase",
    "PublicChatProductPathCaseSet",
    "PublicChatProductPathExpected",
    "PublicChatProductPathObservation",
    "PublicChatProductPathReport",
    "PublicChatProductPathResult",
    "build_public_chat_product_path_report",
    "load_public_chat_product_path_cases",
]
