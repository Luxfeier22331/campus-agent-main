from __future__ import annotations

import argparse
import json
from pathlib import Path

from campus_evals.intent_models import IntentEvalReport
from campus_evals.intent_policy_artifact import intent_policy_gate_metadata
from campus_evals.intent_runner import report_to_dict, run_intent_cases
from campus_evals.intent_scenarios import intent_release_gate_cases, intent_suite_cases

DEFAULT_OUTPUT = Path(".tmp/evals/intent-release-gate.json")
DEFAULT_SUITES = (
    "release_gate",
    "context_follow_up",
    "version_compat",
    "observed_regression",
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run deterministic supervisor intent gate suites.")
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help="Path to write the JSON intent gate report.",
    )
    parser.add_argument(
        "--suite",
        action="append",
        choices=DEFAULT_SUITES,
        help="Intent suite to run. Repeat to select multiple suites. Defaults to all gate suites.",
    )
    return parser


def run_intent_suite(suite: str) -> IntentEvalReport:
    cases = intent_release_gate_cases() if suite == "release_gate" else intent_suite_cases(suite)
    return run_intent_cases(cases)


def run_intent_gate(suites: tuple[str, ...] = DEFAULT_SUITES) -> dict[str, object]:
    suite_reports = {suite: run_intent_suite(suite) for suite in suites}
    return build_gate_payload(suite_reports)


def build_gate_payload(suite_reports: dict[str, IntentEvalReport]) -> dict[str, object]:
    suite_payloads = {suite: report_to_dict(report) for suite, report in suite_reports.items()}
    policy_metadata = intent_policy_gate_metadata()
    return {
        "schema_version": 1,
        "case_set_version": policy_metadata["case_set_version"],
        "policy_artifact": {
            "schema_version": policy_metadata["schema_version"],
            "policy_version": policy_metadata["policy_version"],
            "classifier_version": policy_metadata["classifier_version"],
            "intent_schema_version": policy_metadata["intent_schema_version"],
        },
        "total": sum(report.total for report in suite_reports.values()),
        "passed": sum(report.passed for report in suite_reports.values()),
        "failed": sum(report.failed for report in suite_reports.values()),
        "critical_total": sum(report.critical_total for report in suite_reports.values()),
        "critical_passed": sum(report.critical_passed for report in suite_reports.values()),
        "suites": suite_payloads,
    }


def write_report(payload: dict[str, object], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def render_summary_text(payload: dict[str, object], output_path: Path) -> str:
    status = "PASS" if int(payload["failed"]) == 0 else "FAIL"
    return (
        f"Intent release gate: {status} "
        f"passed={payload['passed']}/{payload['total']} "
        f"critical={payload['critical_passed']}/{payload['critical_total']} "
        f"suites={','.join(str(key) for key in dict(payload['suites']))} "
        f"output={output_path}"
    )


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    output_path = Path(args.output)
    suites = tuple(args.suite) if args.suite else DEFAULT_SUITES

    payload = run_intent_gate(suites)
    write_report(payload, output_path)
    print(render_summary_text(payload, output_path))
    return 0 if int(payload["failed"]) == 0 else 1


def _format_rate(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value:.2%}"


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "DEFAULT_OUTPUT",
    "DEFAULT_SUITES",
    "build_gate_payload",
    "build_parser",
    "main",
    "render_summary_text",
    "run_intent_gate",
    "run_intent_suite",
    "write_report",
]
