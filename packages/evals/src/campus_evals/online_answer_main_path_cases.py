from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from campus_evals.fixture_registry import fixture_path

ONLINE_ANSWER_MAIN_PATH_CASES_PATH = fixture_path("e2e.online_answer_path.main_path")


@dataclass(frozen=True, slots=True)
class OnlineAnswerMainPathSourceTruth:
    expected_collections: tuple[str, ...]
    evidence_required: bool


@dataclass(frozen=True, slots=True)
class OnlineAnswerMainPathTraceContract:
    required_stages: tuple[str, ...]
    forbidden_stages: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class OnlineAnswerMainPathExpected:
    selected_tool: str
    terminal_outcome: str
    source_truth: OnlineAnswerMainPathSourceTruth
    trace_contract: OnlineAnswerMainPathTraceContract
    answer_contract: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class OnlineAnswerMainPathCase:
    case_id: str
    user_utterance: str
    domain: str
    split: str
    expected: OnlineAnswerMainPathExpected


@dataclass(frozen=True, slots=True)
class OnlineAnswerMainPathCaseSet:
    schema_version: int
    case_family: str
    cases: tuple[OnlineAnswerMainPathCase, ...]


def load_online_answer_main_path_cases(
    path: str | Path | None = None,
) -> OnlineAnswerMainPathCaseSet:
    source_path = Path(path) if path is not None else ONLINE_ANSWER_MAIN_PATH_CASES_PATH
    payload = _load_json_object(source_path)
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("online answer main path schema_version must be 1")
    case_family = _required_string(payload.get("case_family"), "case_family")
    if case_family != "online_answer_main_path.v1":
        raise ValueError("unsupported online answer main path case_family")
    raw_cases = payload.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValueError("online answer main path cases must be a non-empty list")
    cases = tuple(_parse_case(item) for item in raw_cases)
    _reject_duplicate_case_ids(case.case_id for case in cases)
    return OnlineAnswerMainPathCaseSet(
        schema_version=1,
        case_family=case_family,
        cases=cases,
    )


def _parse_case(payload: object) -> OnlineAnswerMainPathCase:
    item = _mapping(payload, "case")
    expected = _mapping(item.get("expected"), "case.expected")
    source_truth = _mapping(expected.get("source_truth"), "case.expected.source_truth")
    trace_contract = _mapping(expected.get("trace_contract"), "case.expected.trace_contract")
    return OnlineAnswerMainPathCase(
        case_id=_required_string(item.get("case_id"), "case.case_id"),
        user_utterance=_required_string(item.get("user_utterance"), "case.user_utterance"),
        domain=_required_string(item.get("domain"), "case.domain"),
        split=_required_string(item.get("split"), "case.split"),
        expected=OnlineAnswerMainPathExpected(
            selected_tool=_required_string(
                expected.get("selected_tool"),
                "case.expected.selected_tool",
            ),
            terminal_outcome=_required_string(
                expected.get("terminal_outcome"),
                "case.expected.terminal_outcome",
            ),
            source_truth=OnlineAnswerMainPathSourceTruth(
                expected_collections=_string_tuple(
                    source_truth.get("expected_collections"),
                    "case.expected.source_truth.expected_collections",
                    allow_empty=True,
                ),
                evidence_required=_required_bool(
                    source_truth.get("evidence_required"),
                    "case.expected.source_truth.evidence_required",
                ),
            ),
            trace_contract=OnlineAnswerMainPathTraceContract(
                required_stages=_string_tuple(
                    trace_contract.get("required_stages"),
                    "case.expected.trace_contract.required_stages",
                ),
                forbidden_stages=_string_tuple(
                    trace_contract.get("forbidden_stages", []),
                    "case.expected.trace_contract.forbidden_stages",
                    allow_empty=True,
                ),
            ),
            answer_contract=_mapping(
                expected.get("answer_contract"),
                "case.expected.answer_contract",
            ),
        ),
    )


def _load_json_object(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return _mapping(payload, "payload")


def _mapping(payload: object, field_name: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError(f"{field_name} must be an object")
    return payload


def _required_string(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be a non-empty string")
    return value


def _required_bool(value: object, field_name: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{field_name} must be a boolean")
    return value


def _string_tuple(
    value: object,
    field_name: str,
    *,
    allow_empty: bool = False,
) -> tuple[str, ...]:
    if not isinstance(value, list):
        raise ValueError(f"{field_name} must be a list")
    values = tuple(_required_string(item, field_name) for item in value)
    if not allow_empty and not values:
        raise ValueError(f"{field_name} must not be empty")
    return values


def _reject_duplicate_case_ids(case_ids: tuple[str, ...] | object) -> None:
    seen: set[str] = set()
    duplicates: list[str] = []
    for case_id in case_ids:
        if case_id in seen:
            duplicates.append(case_id)
        seen.add(case_id)
    if duplicates:
        raise ValueError(f"duplicate online answer main path case_id values: {duplicates}")


__all__ = [
    "ONLINE_ANSWER_MAIN_PATH_CASES_PATH",
    "OnlineAnswerMainPathCase",
    "OnlineAnswerMainPathCaseSet",
    "OnlineAnswerMainPathExpected",
    "OnlineAnswerMainPathSourceTruth",
    "OnlineAnswerMainPathTraceContract",
    "load_online_answer_main_path_cases",
]
