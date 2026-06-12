from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

TOOL_FAMILY_DENOMINATOR_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "tool_family_denominators.v1.json"
)
TOOL_SPEC_REGISTRY_PATH = (
    Path(__file__).resolve().parents[4] / "configs" / "runtime" / "tools.v3.json"
)


@dataclass(frozen=True, slots=True)
class ToolDenominator:
    tool_name: str
    capability_family: str
    denominator_splits: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ToolDenominatorCase:
    case_id: str
    tool_name: str
    split: str
    expected_result_status: str
    expected_arguments: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ToolFamilyDenominator:
    schema_version: int
    tools: tuple[ToolDenominator, ...]
    cases: tuple[ToolDenominatorCase, ...]


@dataclass(frozen=True, slots=True)
class ToolObservation:
    case_id: str
    selected_tool: str
    result_status: str
    argument_summary: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ToolDenominatorResult:
    case_id: str
    tool_name: str
    passed: bool
    failure_class: str
    reason: str


@dataclass(frozen=True, slots=True)
class ToolFamilyDenominatorReport:
    passed: bool
    total: int
    passed_count: int
    failed_count: int
    results: tuple[ToolDenominatorResult, ...]


def load_tool_family_denominator(path: str | Path | None = None) -> ToolFamilyDenominator:
    payload = _load_json(Path(path) if path is not None else TOOL_FAMILY_DENOMINATOR_PATH)
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("tool family denominator schema_version must be 1")
    raw_tools = payload.get("tools")
    raw_cases = payload.get("cases")
    if not isinstance(raw_tools, list) or not raw_tools:
        raise ValueError("tool family denominator tools must be a non-empty list")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValueError("tool family denominator cases must be a non-empty list")
    tools = tuple(_parse_tool(item) for item in raw_tools)
    cases = tuple(_parse_case(item) for item in raw_cases)
    _validate_fixture(tools, cases)
    return ToolFamilyDenominator(schema_version=1, tools=tools, cases=cases)


def tool_spec_tool_names(path: str | Path | None = None) -> tuple[str, ...]:
    payload = _load_json(Path(path) if path is not None else TOOL_SPEC_REGISTRY_PATH)
    if payload.get("schema_version") != "tool-spec-registry-v2":
        raise ValueError("tool spec schema_version must be tool-spec-registry-v2")
    raw_tools = payload.get("tools")
    if not isinstance(raw_tools, list) or not raw_tools:
        raise ValueError("tool spec tools must be a non-empty list")
    names: list[str] = []
    for raw_tool in raw_tools:
        tool = _mapping(raw_tool, "tool")
        if tool.get("active") is True and tool.get("runtime_posture") != "sdk_internal_admitted":
            names.append(_required_string(tool.get("name"), "tool.name"))
    if len(set(names)) != len(names):
        raise ValueError("tool spec active tool names must not contain duplicates")
    return tuple(names)


def tool_spec_sdk_internal_function_names(path: str | Path | None = None) -> tuple[str, ...]:
    payload = _load_json(Path(path) if path is not None else TOOL_SPEC_REGISTRY_PATH)
    if payload.get("schema_version") != "tool-spec-registry-v2":
        raise ValueError("tool spec schema_version must be tool-spec-registry-v2")
    raw_tools = payload.get("tools")
    if not isinstance(raw_tools, list) or not raw_tools:
        raise ValueError("tool spec tools must be a non-empty list")
    names: list[str] = []
    for raw_tool in raw_tools:
        tool = _mapping(raw_tool, "tool")
        if (
            tool.get("active") is True
            and tool.get("surface") == "capability_internal"
            and tool.get("runtime_posture") == "sdk_internal_admitted"
        ):
            names.append(_required_string(tool.get("name"), "tool.name"))
    if len(set(names)) != len(names):
        raise ValueError("tool spec sdk internal function names must not contain duplicates")
    return tuple(names)


def evaluate_tool_family_denominator(
    fixture: ToolFamilyDenominator,
    observations: dict[str, ToolObservation],
) -> ToolFamilyDenominatorReport:
    results = tuple(_evaluate_case(case, observations.get(case.case_id)) for case in fixture.cases)
    passed_count = sum(1 for result in results if result.passed)
    return ToolFamilyDenominatorReport(
        passed=passed_count == len(results),
        total=len(results),
        passed_count=passed_count,
        failed_count=len(results) - passed_count,
        results=results,
    )


def _evaluate_case(
    case: ToolDenominatorCase,
    observation: ToolObservation | None,
) -> ToolDenominatorResult:
    if observation is None:
        return ToolDenominatorResult(
            case.case_id,
            case.tool_name,
            False,
            "missing_observation",
            "missing observation",
        )
    if observation.selected_tool != case.tool_name:
        return ToolDenominatorResult(
            case.case_id,
            case.tool_name,
            False,
            "routing_error",
            f"selected_tool={observation.selected_tool}",
        )
    if (
        case.expected_result_status == "authorization_denied"
        and observation.result_status != "authorization_denied"
    ):
        return ToolDenominatorResult(
            case.case_id,
            case.tool_name,
            False,
            "authorization_fail_close",
            f"result_status={observation.result_status}",
        )
    if observation.result_status != case.expected_result_status:
        return ToolDenominatorResult(
            case.case_id,
            case.tool_name,
            False,
            "read_model_gap",
            f"result_status={observation.result_status}",
        )
    for key, expected_value in case.expected_arguments.items():
        if observation.argument_summary.get(key) != expected_value:
            return ToolDenominatorResult(
                case.case_id,
                case.tool_name,
                False,
                "read_model_gap",
                f"argument_summary.{key}={observation.argument_summary.get(key)!r}",
            )
    return ToolDenominatorResult(case.case_id, case.tool_name, True, "", "ok")


def _parse_tool(payload: object) -> ToolDenominator:
    item = _mapping(payload, "tool")
    return ToolDenominator(
        tool_name=_required_string(item.get("tool_name"), "tool_name"),
        capability_family=_required_string(item.get("capability_family"), "capability_family"),
        denominator_splits=_string_tuple(item.get("denominator_splits"), "denominator_splits"),
    )


def _parse_case(payload: object) -> ToolDenominatorCase:
    item = _mapping(payload, "case")
    return ToolDenominatorCase(
        case_id=_required_string(item.get("case_id"), "case_id"),
        tool_name=_required_string(item.get("tool_name"), "tool_name"),
        split=_required_string(item.get("split"), "split"),
        expected_result_status=_required_string(
            item.get("expected_result_status"),
            "expected_result_status",
        ),
        expected_arguments=_mapping(item.get("expected_arguments") or {}, "expected_arguments"),
    )


def _validate_fixture(
    tools: tuple[ToolDenominator, ...],
    cases: tuple[ToolDenominatorCase, ...],
) -> None:
    tool_names = {tool.tool_name for tool in tools}
    if len(tool_names) != len(tools):
        raise ValueError("duplicate tool denominator tool_name")
    required_splits = {"smoke", "release_gate", "regression_locked", "exploratory"}
    for tool in tools:
        if not required_splits.issubset(set(tool.denominator_splits)):
            raise ValueError(f"tool denominator missing required splits: {tool.tool_name}")
    seen_case_ids: set[str] = set()
    for case in cases:
        if case.case_id in seen_case_ids:
            raise ValueError(f"duplicate tool denominator case_id: {case.case_id}")
        if case.tool_name not in tool_names:
            raise ValueError(f"case references unknown tool: {case.tool_name}")
        seen_case_ids.add(case.case_id)


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
    items = tuple(_required_string(item, field_name) for item in value)
    if len(set(items)) != len(items):
        raise ValueError(f"{field_name} must not contain duplicates")
    return items


def _required_string(value: object, field_name: str) -> str:
    normalized = "" if value is None else str(value).strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


__all__ = [
    "TOOL_FAMILY_DENOMINATOR_PATH",
    "ToolDenominator",
    "ToolDenominatorCase",
    "ToolDenominatorResult",
    "ToolFamilyDenominator",
    "ToolFamilyDenominatorReport",
    "ToolObservation",
    "evaluate_tool_family_denominator",
    "load_tool_family_denominator",
    "tool_spec_tool_names",
]
