from __future__ import annotations

import argparse
import json
from pathlib import Path

from campus_evals.intent_models import IntentEvalReport
from campus_evals.intent_runner import report_to_dict, run_intent_cases
from campus_evals.intent_scenarios import intent_release_gate_cases

DEFAULT_OUTPUT = Path(".tmp/evals/intent-release-gate.json")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run deterministic supervisor intent release-gate cases."
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help="Path to write the JSON intent gate report.",
    )
    return parser


def write_report(report: IntentEvalReport, output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(report_to_dict(report), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def render_summary_text(report: IntentEvalReport, output_path: Path) -> str:
    status = "PASS" if report.failed == 0 else "FAIL"
    return (
        f"Intent release gate: {status} "
        f"passed={report.passed}/{report.total} "
        f"critical={report.critical_passed}/{report.critical_total} "
        f"exact_match={_format_rate(report.overall_exact_match_rate)} "
        f"critical_gate={_format_rate(report.critical_gate_pass_rate)} "
        f"output={output_path}"
    )


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    output_path = Path(args.output)

    report = run_intent_cases(intent_release_gate_cases())
    write_report(report, output_path)
    print(render_summary_text(report, output_path))
    return 0 if report.failed == 0 else 1


def _format_rate(value: float | None) -> str:
    if value is None:
        return "n/a"
    return f"{value:.2%}"


if __name__ == "__main__":
    raise SystemExit(main())


__all__ = [
    "DEFAULT_OUTPUT",
    "build_parser",
    "main",
    "render_summary_text",
    "write_report",
]
