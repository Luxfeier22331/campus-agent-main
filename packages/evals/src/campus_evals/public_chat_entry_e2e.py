from __future__ import annotations

import argparse
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass
from pathlib import Path

from campus_evals.fixture_registry import fixture_path
from campus_evals.profile_report import (
    EvalProfileReport,
    load_json_object,
    load_observation_mapping,
    mapping,
    required_string,
    version_summary,
    write_profile_report,
)

PUBLIC_CHAT_ENTRY_CASES_PATH = fixture_path("e2e.public_chat.entry")


@dataclass(frozen=True, slots=True)
class PublicChatEntryCase:
    case_id: str
    user_goal: str
    split: str
    expected_terminal_outcome: str
    expected_response_contract: dict[str, object]
    expected_answer_contract: dict[str, object]


@dataclass(frozen=True, slots=True)
class PublicChatEntryCaseSet:
    schema_version: int
    case_family: str
    cases: tuple[PublicChatEntryCase, ...]


@dataclass(frozen=True, slots=True)
class PublicChatEntryObservation:
    case_id: str
    request_id: str
    trace_id: str
    terminal_outcome: str
    response_contract: dict[str, object]
    answer_text: str = ""
    request_path: str = "/api/chat/requests"


@dataclass(frozen=True, slots=True)
class PublicChatEntryResult:
    case_id: str
    passed: bool
    failure_class: str
    reason: str
    request_id: str = ""
    trace_id: str = ""


@dataclass(frozen=True, slots=True)
class PublicChatEntryReport:
    passed: bool
    total: int
    passed_count: int
    failed_count: int
    results: tuple[PublicChatEntryResult, ...]


def load_public_chat_entry_cases(path: str | Path | None = None) -> PublicChatEntryCaseSet:
    payload = load_json_object(Path(path) if path is not None else PUBLIC_CHAT_ENTRY_CASES_PATH)
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("public chat entry case schema_version must be 1")
    case_family = required_string(payload.get("case_family"), "case_family")
    if case_family != "public_chat_entry_e2e.v1":
        raise ValueError("unsupported public chat entry case_family")
    raw_cases = payload.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValueError("public chat entry cases must be a non-empty list")
    cases = tuple(_parse_case(item) for item in raw_cases)
    _reject_duplicate_case_ids(case.case_id for case in cases)
    return PublicChatEntryCaseSet(schema_version=1, case_family=case_family, cases=cases)


def evaluate_public_chat_entry_cases(
    cases: tuple[PublicChatEntryCase, ...],
    observations: Mapping[str, PublicChatEntryObservation],
) -> PublicChatEntryReport:
    results = tuple(_evaluate_case(case, observations.get(case.case_id)) for case in cases)
    passed_count = sum(1 for result in results if result.passed)
    return PublicChatEntryReport(
        passed=passed_count == len(results),
        total=len(results),
        passed_count=passed_count,
        failed_count=len(results) - passed_count,
        results=results,
    )


def run_public_chat_entry_e2e_profile(
    *,
    output_dir: Path,
    cases_path: Path | None = None,
    observations_path: Path | None = None,
    git_head_resolver: Callable[[], str | None] | None = None,
) -> EvalProfileReport:
    case_set = load_public_chat_entry_cases(cases_path)
    observations = _load_observations(observations_path)
    report = evaluate_public_chat_entry_cases(case_set.cases, observations)
    return write_profile_report(
        output_dir=output_dir,
        profile_id="public_chat_entry_e2e",
        case_family=case_set.case_family,
        report_passed=report.passed,
        total=report.total,
        passed_count=report.passed_count,
        failed_count=report.failed_count,
        results=tuple(asdict(result) for result in report.results),
        version_summary=version_summary(
            case_set_version=case_set.case_family,
            git_head_resolver=git_head_resolver,
        ),
    )


def _evaluate_case(
    case: PublicChatEntryCase,
    observation: PublicChatEntryObservation | None,
) -> PublicChatEntryResult:
    if observation is None:
        return PublicChatEntryResult(
            case.case_id,
            False,
            "missing_observation",
            "missing observation",
        )
    if observation.request_path != "/api/chat/requests":
        return PublicChatEntryResult(
            case.case_id,
            False,
            "wrong_entry_path",
            f"request_path={observation.request_path}",
            observation.request_id,
            observation.trace_id,
        )
    if not observation.request_id.strip() or not observation.trace_id.strip():
        return PublicChatEntryResult(
            case.case_id,
            False,
            "request_correlation_missing",
            "request_id or trace_id missing",
            observation.request_id,
            observation.trace_id,
        )
    if observation.terminal_outcome != case.expected_terminal_outcome:
        return PublicChatEntryResult(
            case.case_id,
            False,
            "terminal_outcome_mismatch",
            f"terminal_outcome={observation.terminal_outcome}",
            observation.request_id,
            observation.trace_id,
        )
    for key, expected_value in case.expected_response_contract.items():
        if observation.response_contract.get(key) != expected_value:
            return PublicChatEntryResult(
                case.case_id,
                False,
                "response_contract_mismatch",
                f"response_contract.{key}={observation.response_contract.get(key)!r}",
                observation.request_id,
                observation.trace_id,
            )
    answer_contract_failure = _answer_contract_failure(case, observation)
    if answer_contract_failure is not None:
        return PublicChatEntryResult(
            case.case_id,
            False,
            "answer_contract_mismatch",
            answer_contract_failure,
            observation.request_id,
            observation.trace_id,
        )
    return PublicChatEntryResult(
        case.case_id,
        True,
        "",
        "ok",
        observation.request_id,
        observation.trace_id,
    )


def _load_observations(path: Path | None) -> dict[str, PublicChatEntryObservation]:
    return {
        case_id: PublicChatEntryObservation(
            case_id=case_id,
            request_id=required_string(item.get("request_id"), "request_id"),
            trace_id=required_string(item.get("trace_id"), "trace_id"),
            terminal_outcome=required_string(item.get("terminal_outcome"), "terminal_outcome"),
            response_contract=mapping(item.get("response_contract")),
            answer_text=str(item.get("answer_text") or ""),
            request_path=str(item.get("request_path") or "/api/chat/requests"),
        )
        for case_id, item in load_observation_mapping(path).items()
    }


def _parse_case(payload: object) -> PublicChatEntryCase:
    if not isinstance(payload, dict):
        raise ValueError("public chat entry case must be an object")
    return PublicChatEntryCase(
        case_id=required_string(payload.get("case_id"), "case_id"),
        user_goal=required_string(payload.get("user_goal"), "user_goal"),
        split=required_string(payload.get("split"), "split"),
        expected_terminal_outcome=required_string(
            payload.get("expected_terminal_outcome"),
            "expected_terminal_outcome",
        ),
        expected_response_contract=mapping(payload.get("expected_response_contract")),
        expected_answer_contract=mapping(payload.get("expected_answer_contract") or {}),
    )


def _answer_contract_failure(
    case: PublicChatEntryCase,
    observation: PublicChatEntryObservation,
) -> str | None:
    if not case.expected_answer_contract:
        return None
    answer_text = observation.answer_text.strip()
    for phrase in _string_list(case.expected_answer_contract.get("must_contain")):
        if phrase not in answer_text:
            return f"answer_text missing required phrase: {phrase}"
    for phrase in _string_list(case.expected_answer_contract.get("must_not_contain")):
        if phrase in answer_text:
            return f"answer_text contains forbidden phrase: {phrase}"
    return None


def _string_list(value: object) -> tuple[str, ...]:
    if value is None:
        return ()
    if not isinstance(value, list):
        raise ValueError("answer contract fields must be lists")
    items: list[str] = []
    for item in value:
        text = str(item).strip()
        if not text:
            raise ValueError("answer contract entries must be non-empty strings")
        items.append(text)
    return tuple(items)


def _reject_duplicate_case_ids(case_ids: object) -> None:
    seen: set[str] = set()
    for case_id in case_ids:
        if case_id in seen:
            raise ValueError(f"duplicate public chat entry case_id: {case_id}")
        seen.add(case_id)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run public chat entry E2E profile.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    accept = subparsers.add_parser("accept")
    accept.add_argument("--output-dir", required=True)
    accept.add_argument("--reruns", type=int, default=1)
    accept.add_argument("--cases-path")
    accept.add_argument("--observations-path")
    accept.add_argument("--collect-runtime", action="store_true")
    accept.add_argument("--artifact-path", action="append", default=[])
    accept.add_argument("--verbose", action="store_true")
    accept.add_argument("--log-jsonl")
    accept.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if args.command != "accept":
        raise ValueError(f"unsupported command: {args.command}")
    if args.reruns != 1:
        raise ValueError("public chat entry E2E gate is deterministic and requires reruns=1")
    if args.collect_runtime:
        raise ValueError("public chat entry browser runtime collection is not implemented yet")
    report = run_public_chat_entry_e2e_profile(
        output_dir=Path(args.output_dir),
        cases_path=Path(args.cases_path) if args.cases_path else None,
        observations_path=Path(args.observations_path) if args.observations_path else None,
    )
    if args.json:
        print(report.output_path.read_text(encoding="utf-8").strip())
    elif args.verbose:
        print(f"public-chat-entry-e2e: {'PASS' if report.passed else 'FAIL'}")
    return 0 if report.passed else 1
