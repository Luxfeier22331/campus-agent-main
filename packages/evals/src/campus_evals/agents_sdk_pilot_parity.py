from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from campus_contracts import AgentResponse

AGENTS_SDK_NOTICE_GET_PARITY_FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "agents_sdk_notice_get_parity.v1.json"
)


@dataclass(frozen=True, slots=True)
class AgentsSdkPilotLaneExpectation:
    status: str
    selected_tool: str
    failure_kind: str = ""
    argument_keys: tuple[str, ...] = ()
    tool_execution_count: int = 0
    final_answer_present: bool = False


@dataclass(frozen=True, slots=True)
class AgentsSdkPilotParityCase:
    case_id: str
    user_goal: str
    notice_id: str
    source_family: str
    sdk_scenario: str
    provider_scenario: str
    expected_sdk: AgentsSdkPilotLaneExpectation
    expected_provider: AgentsSdkPilotLaneExpectation
    parity_fields: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class AgentsSdkPilotParityCaseSet:
    schema_version: int
    case_family: str
    cases: tuple[AgentsSdkPilotParityCase, ...]


@dataclass(frozen=True, slots=True)
class AgentsSdkPilotParityObservation:
    lane: str
    status: str
    selected_tool: str
    tool_attempted: bool
    tool_outcome: str
    failure_class: str
    failure_kind: str
    argument_keys: tuple[str, ...] = ()
    source_ref_count: int = 0
    result_outcome: str = ""
    tool_execution_count: int = 0
    final_answer_present: bool = False
    tool_output_submitted: bool = False


@dataclass(frozen=True, slots=True)
class AgentsSdkPilotParityResult:
    case_id: str
    passed: bool
    failure_class: str
    reason: str
    sdk_observation: AgentsSdkPilotParityObservation | None = None
    provider_observation: AgentsSdkPilotParityObservation | None = None


@dataclass(frozen=True, slots=True)
class AgentsSdkPilotParityReport:
    passed: bool
    total: int
    passed_count: int
    failed_count: int
    results: tuple[AgentsSdkPilotParityResult, ...]


def load_agents_sdk_notice_get_parity_cases(
    path: str | Path | None = None,
) -> AgentsSdkPilotParityCaseSet:
    payload = _load_json(
        Path(path) if path is not None else AGENTS_SDK_NOTICE_GET_PARITY_FIXTURE_PATH
    )
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("agents sdk notice get parity schema_version must be 1")
    case_family = _required_string(payload.get("case_family"), "case_family")
    if case_family != "agents_sdk_notice_get_parity.v1":
        raise ValueError(
            "agents sdk notice get parity case_family must be agents_sdk_notice_get_parity.v1"
        )
    raw_cases = payload.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValueError("agents sdk notice get parity cases must be a non-empty list")
    cases = tuple(_parse_case(item) for item in raw_cases)
    _validate_cases(cases)
    return AgentsSdkPilotParityCaseSet(
        schema_version=1,
        case_family=case_family,
        cases=cases,
    )


def evaluate_agents_sdk_pilot_parity_cases(
    fixture: AgentsSdkPilotParityCaseSet,
    *,
    sdk_observations: dict[str, AgentsSdkPilotParityObservation],
    provider_observations: dict[str, AgentsSdkPilotParityObservation],
) -> AgentsSdkPilotParityReport:
    results = tuple(
        _evaluate_case(
            case,
            sdk_observations.get(case.case_id),
            provider_observations.get(case.case_id),
        )
        for case in fixture.cases
    )
    passed_count = sum(1 for result in results if result.passed)
    return AgentsSdkPilotParityReport(
        passed=passed_count == len(results),
        total=len(results),
        passed_count=passed_count,
        failed_count=len(results) - passed_count,
        results=results,
    )


def agent_response_to_agents_sdk_pilot_observation(
    lane: str,
    response: AgentResponse,
) -> AgentsSdkPilotParityObservation:
    observability = response.agent_observability
    safe_details = dict(observability.safe_details) if observability is not None else {}
    projection = _lane_projection(lane, safe_details)
    failure_class = observability.failure_class if observability is not None else ""
    tool_outcome = observability.tool_outcome if observability is not None else ""
    result_outcome = observability.result_outcome if observability is not None else ""
    selected_tool = observability.selected_tool if observability is not None else ""
    argument_keys = _string_tuple_from_projection(projection.get("argument_keys"))
    if not argument_keys and lane == "sdk":
        trace = _mapping_or_empty(safe_details.get("agents_sdk_trace_projection"))
        argument_keys = _string_tuple_from_projection(trace.get("tool_argument_keys"))
    return AgentsSdkPilotParityObservation(
        lane=lane,
        status=response.status,
        selected_tool=selected_tool,
        tool_attempted=bool(observability.tool_attempted) if observability is not None else False,
        tool_outcome=tool_outcome,
        failure_class=failure_class,
        failure_kind=_failure_kind(failure_class, tool_outcome, result_outcome),
        argument_keys=argument_keys,
        source_ref_count=int(observability.source_ref_count or 0)
        if observability is not None
        else 0,
        result_outcome=result_outcome,
        tool_execution_count=_int_from_projection(projection.get("tool_execution_count")),
        final_answer_present=bool(response.answer_text.strip()),
        tool_output_submitted=bool(projection.get("tool_output_submitted")),
    )


def _evaluate_case(
    case: AgentsSdkPilotParityCase,
    sdk_observation: AgentsSdkPilotParityObservation | None,
    provider_observation: AgentsSdkPilotParityObservation | None,
) -> AgentsSdkPilotParityResult:
    if sdk_observation is None:
        return _failed_result(case, "missing_sdk_observation", "missing sdk observation")
    if provider_observation is None:
        return _failed_result(
            case,
            "missing_provider_observation",
            "missing provider observation",
            sdk_observation=sdk_observation,
        )
    sdk_mismatch = _expectation_mismatch(sdk_observation, case.expected_sdk)
    if sdk_mismatch:
        return _failed_result(
            case,
            "sdk_observation_mismatch",
            sdk_mismatch,
            sdk_observation=sdk_observation,
            provider_observation=provider_observation,
        )
    provider_mismatch = _expectation_mismatch(provider_observation, case.expected_provider)
    if provider_mismatch:
        return _failed_result(
            case,
            "provider_observation_mismatch",
            provider_mismatch,
            sdk_observation=sdk_observation,
            provider_observation=provider_observation,
        )
    parity_mismatch = _parity_mismatch(case, sdk_observation, provider_observation)
    if parity_mismatch:
        return _failed_result(
            case,
            "parity_mismatch",
            parity_mismatch,
            sdk_observation=sdk_observation,
            provider_observation=provider_observation,
        )
    return AgentsSdkPilotParityResult(
        case_id=case.case_id,
        passed=True,
        failure_class="",
        reason="ok",
        sdk_observation=sdk_observation,
        provider_observation=provider_observation,
    )


def _expectation_mismatch(
    observation: AgentsSdkPilotParityObservation,
    expected: AgentsSdkPilotLaneExpectation,
) -> str:
    for field_name in (
        "status",
        "selected_tool",
        "failure_kind",
        "argument_keys",
        "tool_execution_count",
        "final_answer_present",
    ):
        if getattr(observation, field_name) != getattr(expected, field_name):
            return (
                f"{observation.lane}.{field_name}="
                f"{getattr(observation, field_name)!r}, expected={getattr(expected, field_name)!r}"
            )
    return ""


def _parity_mismatch(
    case: AgentsSdkPilotParityCase,
    sdk_observation: AgentsSdkPilotParityObservation,
    provider_observation: AgentsSdkPilotParityObservation,
) -> str:
    for field_name in case.parity_fields:
        sdk_value = getattr(sdk_observation, field_name)
        provider_value = getattr(provider_observation, field_name)
        if sdk_value != provider_value:
            return f"{field_name}: sdk={sdk_value!r} provider={provider_value!r}"
    return ""


def _failed_result(
    case: AgentsSdkPilotParityCase,
    failure_class: str,
    reason: str,
    *,
    sdk_observation: AgentsSdkPilotParityObservation | None = None,
    provider_observation: AgentsSdkPilotParityObservation | None = None,
) -> AgentsSdkPilotParityResult:
    return AgentsSdkPilotParityResult(
        case_id=case.case_id,
        passed=False,
        failure_class=failure_class,
        reason=reason,
        sdk_observation=sdk_observation,
        provider_observation=provider_observation,
    )


def _lane_projection(lane: str, safe_details: dict[str, object]) -> dict[str, object]:
    if lane == "sdk":
        lifecycle = _mapping_or_empty(safe_details.get("agents_sdk_tool_lifecycle_projection"))
        trace = _mapping_or_empty(safe_details.get("agents_sdk_trace_projection"))
        return {**trace, **lifecycle}
    if lane == "provider":
        return _mapping_or_empty(safe_details.get("provider_tool_call_projection"))
    return {}


def _failure_kind(failure_class: str, tool_outcome: str, result_outcome: str) -> str:
    if not failure_class:
        return ""
    value = " ".join((failure_class, tool_outcome, result_outcome)).lower()
    if "wrong_tool" in value:
        return "wrong_tool"
    if "no_tool_call" in value:
        return "no_tool_call"
    if "bad_arguments" in value or "bad_argument" in value:
        return "bad_arguments"
    if "tool_execution_mismatch" in value:
        return "argument_drift"
    if "tool_execution_failed" in value or "query_service_failed" in value:
        return "tool_execution_failed"
    if "runtime_disabled" in value:
        return "runtime_disabled"
    if "timeout" in value:
        return "timeout"
    return failure_class


def _parse_case(value: object) -> AgentsSdkPilotParityCase:
    item = _mapping(value, "case")
    return AgentsSdkPilotParityCase(
        case_id=_required_string(item.get("case_id"), "case_id"),
        user_goal=_required_string(item.get("user_goal"), "user_goal"),
        notice_id=_optional_string(item.get("notice_id")),
        source_family=_optional_string(item.get("source_family")),
        sdk_scenario=_required_string(item.get("sdk_scenario"), "sdk_scenario"),
        provider_scenario=_required_string(item.get("provider_scenario"), "provider_scenario"),
        expected_sdk=_parse_expectation(item.get("expected_sdk"), "expected_sdk"),
        expected_provider=_parse_expectation(item.get("expected_provider"), "expected_provider"),
        parity_fields=_string_tuple(item.get("parity_fields"), "parity_fields"),
    )


def _parse_expectation(value: object, field_name: str) -> AgentsSdkPilotLaneExpectation:
    item = _mapping(value, field_name)
    return AgentsSdkPilotLaneExpectation(
        status=_required_string(item.get("status"), f"{field_name}.status"),
        selected_tool=_optional_string(item.get("selected_tool")),
        failure_kind=_optional_string(item.get("failure_kind")),
        argument_keys=_string_tuple(
            item.get("argument_keys") or [], f"{field_name}.argument_keys", allow_empty=True
        ),
        tool_execution_count=int(item.get("tool_execution_count") or 0),
        final_answer_present=bool(item.get("final_answer_present")),
    )


def _validate_cases(cases: tuple[AgentsSdkPilotParityCase, ...]) -> None:
    seen_case_ids: set[str] = set()
    allowed_fields = {
        "status",
        "selected_tool",
        "failure_kind",
        "argument_keys",
        "tool_execution_count",
        "final_answer_present",
    }
    for case in cases:
        if case.case_id in seen_case_ids:
            raise ValueError(f"duplicate agents sdk parity case_id: {case.case_id}")
        seen_case_ids.add(case.case_id)
        unsupported = set(case.parity_fields) - allowed_fields
        if unsupported:
            raise ValueError(f"unsupported parity fields for {case.case_id}: {sorted(unsupported)}")


def _load_json(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return _mapping(payload, str(path))


def _mapping(value: object, field_name: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object")
    return dict(value)


def _mapping_or_empty(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}


def _string_tuple(
    value: object,
    field_name: str,
    *,
    allow_empty: bool = False,
) -> tuple[str, ...]:
    if not isinstance(value, list | tuple):
        raise ValueError(f"{field_name} must be a list")
    if not value and not allow_empty:
        raise ValueError(f"{field_name} must be a non-empty list")
    items = tuple(_required_string(item, field_name) for item in value)
    if len(set(items)) != len(items):
        raise ValueError(f"{field_name} must not contain duplicates")
    return tuple(sorted(items))


def _string_tuple_from_projection(value: object) -> tuple[str, ...]:
    if not isinstance(value, list | tuple):
        return ()
    return tuple(sorted(str(item).strip() for item in value if str(item).strip()))


def _int_from_projection(value: object) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int | float):
        return max(0, int(value))
    return 0


def _required_string(value: object, field_name: str) -> str:
    normalized = _optional_string(value)
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


def _optional_string(value: object) -> str:
    return "" if value is None else str(value).strip()


__all__ = [
    "AGENTS_SDK_NOTICE_GET_PARITY_FIXTURE_PATH",
    "AgentsSdkPilotLaneExpectation",
    "AgentsSdkPilotParityCase",
    "AgentsSdkPilotParityCaseSet",
    "AgentsSdkPilotParityObservation",
    "AgentsSdkPilotParityReport",
    "AgentsSdkPilotParityResult",
    "agent_response_to_agents_sdk_pilot_observation",
    "evaluate_agents_sdk_pilot_parity_cases",
    "load_agents_sdk_notice_get_parity_cases",
]
