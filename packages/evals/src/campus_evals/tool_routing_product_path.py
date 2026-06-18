from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass, field
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

TOOL_ROUTING_CASES_PATH = fixture_path("tools.routing.product_path")


@dataclass(frozen=True, slots=True)
class ToolRoutingCase:
    case_id: str
    user_goal: str
    split: str
    expected_tool: str
    expected_terminal_outcome: str
    expected_arguments: dict[str, object] = field(default_factory=dict)
    expected_response_contract: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ToolRoutingCaseSet:
    schema_version: int
    case_family: str
    cases: tuple[ToolRoutingCase, ...]


@dataclass(frozen=True, slots=True)
class ToolRoutingObservation:
    case_id: str
    selected_tool: str
    terminal_outcome: str
    argument_summary: dict[str, object] = field(default_factory=dict)
    response_contract: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ToolRoutingResult:
    case_id: str
    passed: bool
    failure_class: str
    reason: str


@dataclass(frozen=True, slots=True)
class ToolRoutingReport:
    passed: bool
    total: int
    passed_count: int
    failed_count: int
    results: tuple[ToolRoutingResult, ...]


def load_tool_routing_cases(path: str | Path | None = None) -> ToolRoutingCaseSet:
    payload = load_json_object(Path(path) if path is not None else TOOL_ROUTING_CASES_PATH)
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("tool routing case schema_version must be 1")
    case_family = required_string(payload.get("case_family"), "case_family")
    if case_family != "tool_routing_product_path.v1":
        raise ValueError("unsupported tool routing case_family")
    raw_cases = payload.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValueError("tool routing cases must be a non-empty list")
    cases = tuple(_parse_case(item) for item in raw_cases)
    _reject_duplicate_case_ids(case.case_id for case in cases)
    return ToolRoutingCaseSet(schema_version=1, case_family=case_family, cases=cases)


def evaluate_tool_routing_cases(
    cases: tuple[ToolRoutingCase, ...],
    observations: Mapping[str, ToolRoutingObservation],
) -> ToolRoutingReport:
    results = tuple(_evaluate_case(case, observations.get(case.case_id)) for case in cases)
    passed_count = sum(1 for result in results if result.passed)
    return ToolRoutingReport(
        passed=passed_count == len(results),
        total=len(results),
        passed_count=passed_count,
        failed_count=len(results) - passed_count,
        results=results,
    )


def run_tool_routing_product_path_profile(
    *,
    output_dir: Path,
    cases_path: Path | None = None,
    observations_path: Path | None = None,
    git_head_resolver: Callable[[], str | None] | None = None,
) -> EvalProfileReport:
    case_set = load_tool_routing_cases(cases_path)
    observations = _load_observations(observations_path)
    report = evaluate_tool_routing_cases(case_set.cases, observations)
    return write_profile_report(
        output_dir=output_dir,
        profile_id="tool_routing_product_path",
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
    case: ToolRoutingCase,
    observation: ToolRoutingObservation | None,
) -> ToolRoutingResult:
    if observation is None:
        return ToolRoutingResult(case.case_id, False, "missing_observation", "missing observation")
    if observation.selected_tool != case.expected_tool:
        return ToolRoutingResult(
            case.case_id,
            False,
            "routing_error",
            f"selected_tool={observation.selected_tool}",
        )
    if observation.terminal_outcome != case.expected_terminal_outcome:
        failure_class = (
            "authorization_fail_close"
            if case.expected_terminal_outcome == "authorization_denied"
            else "read_model_gap"
        )
        return ToolRoutingResult(
            case.case_id,
            False,
            failure_class,
            f"terminal_outcome={observation.terminal_outcome}",
        )
    for key, expected_value in case.expected_arguments.items():
        if observation.argument_summary.get(key) != expected_value:
            return ToolRoutingResult(
                case.case_id,
                False,
                "argument_extraction_error",
                f"argument_summary.{key}={observation.argument_summary.get(key)!r}",
            )
    for key, expected_value in case.expected_response_contract.items():
        if observation.response_contract.get(key) != expected_value:
            return ToolRoutingResult(
                case.case_id,
                False,
                "read_model_gap",
                f"response_contract.{key}={observation.response_contract.get(key)!r}",
            )
    return ToolRoutingResult(case.case_id, True, "", "ok")


def _load_observations(path: Path | None) -> dict[str, ToolRoutingObservation]:
    return {
        case_id: ToolRoutingObservation(
            case_id=case_id,
            selected_tool=required_string(item.get("selected_tool"), "selected_tool"),
            terminal_outcome=required_string(item.get("terminal_outcome"), "terminal_outcome"),
            argument_summary=mapping(item.get("argument_summary")),
            response_contract=mapping(item.get("response_contract")),
        )
        for case_id, item in load_observation_mapping(path).items()
    }


def _parse_case(payload: object) -> ToolRoutingCase:
    if not isinstance(payload, dict):
        raise ValueError("tool routing case must be an object")
    return ToolRoutingCase(
        case_id=required_string(payload.get("case_id"), "case_id"),
        user_goal=required_string(payload.get("user_goal"), "user_goal"),
        split=required_string(payload.get("split"), "split"),
        expected_tool=required_string(payload.get("expected_tool"), "expected_tool"),
        expected_terminal_outcome=required_string(
            payload.get("expected_terminal_outcome"),
            "expected_terminal_outcome",
        ),
        expected_arguments=mapping(payload.get("expected_arguments")),
        expected_response_contract=mapping(payload.get("expected_response_contract")),
    )


def _reject_duplicate_case_ids(case_ids: object) -> None:
    seen: set[str] = set()
    for case_id in case_ids:
        if case_id in seen:
            raise ValueError(f"duplicate tool routing case_id: {case_id}")
        seen.add(case_id)


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Run tool routing product-path profile.")
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
        raise ValueError("tool routing product-path gate is deterministic and requires reruns=1")
    if args.collect_runtime:
        raise ValueError("tool routing runtime collection is not implemented yet")
    report = run_tool_routing_product_path_profile(
        output_dir=Path(args.output_dir),
        cases_path=Path(args.cases_path) if args.cases_path else None,
        observations_path=Path(args.observations_path) if args.observations_path else None,
    )
    if args.json:
        print(report.output_path.read_text(encoding="utf-8").strip())
    elif args.verbose:
        print(f"tool-routing-product-path: {'PASS' if report.passed else 'FAIL'}")
    return 0 if report.passed else 1
