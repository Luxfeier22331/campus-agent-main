from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from campus_evals.fixture_registry import fixture_path

PROVIDER_TOOL_CALL_CASES_PATH = fixture_path("tools.provider_tool_calls")


@dataclass(frozen=True, slots=True)
class ProviderToolCallCase:
    case_id: str
    user_goal: str
    allowed_tools: tuple[str, ...]
    expected_tool: str
    expected_outcome: str


@dataclass(frozen=True, slots=True)
class ProviderToolCallCaseFixture:
    schema_version: int
    cases: tuple[ProviderToolCallCase, ...]


def load_provider_tool_call_cases(
    path: str | Path | None = None,
) -> ProviderToolCallCaseFixture:
    payload = _load_json(Path(path) if path is not None else PROVIDER_TOOL_CALL_CASES_PATH)
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("provider tool call cases schema_version must be 1")
    raw_cases = payload.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValueError("provider tool call cases must be a non-empty list")
    cases = tuple(_parse_case(item) for item in raw_cases)
    _validate_cases(cases)
    return ProviderToolCallCaseFixture(schema_version=1, cases=cases)


def _parse_case(value: object) -> ProviderToolCallCase:
    item = _mapping(value, "case")
    return ProviderToolCallCase(
        case_id=_required_string(item.get("case_id"), "case_id"),
        user_goal=_required_string(item.get("user_goal"), "user_goal"),
        allowed_tools=_string_tuple(item.get("allowed_tools"), "allowed_tools"),
        expected_tool=_optional_string(item.get("expected_tool")),
        expected_outcome=_required_string(item.get("expected_outcome"), "expected_outcome"),
    )


def _validate_cases(cases: tuple[ProviderToolCallCase, ...]) -> None:
    seen_case_ids: set[str] = set()
    allowed_outcomes = {
        "function_call_selected",
        "no_function_call",
        "wrong_tool_call",
        "invalid_arguments",
        "tool_result_projected",
        "internal_tool_closed",
    }
    for case in cases:
        if case.case_id in seen_case_ids:
            raise ValueError(f"duplicate provider tool call case_id: {case.case_id}")
        seen_case_ids.add(case.case_id)
        if case.expected_outcome not in allowed_outcomes:
            raise ValueError(f"unsupported provider tool call outcome: {case.expected_outcome}")


def _load_json(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return _mapping(payload, str(path))


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
    normalized = _optional_string(value)
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


def _optional_string(value: object) -> str:
    return "" if value is None else str(value).strip()


__all__ = [
    "PROVIDER_TOOL_CALL_CASES_PATH",
    "ProviderToolCallCase",
    "ProviderToolCallCaseFixture",
    "load_provider_tool_call_cases",
]
