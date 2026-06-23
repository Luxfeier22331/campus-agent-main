from __future__ import annotations

import argparse
import json
from collections.abc import Callable
from pathlib import Path

from campus_shared import load_repo_env

from campus_evals.app_api_chat_runtime import AppApiEvalClient, AppApiEvalClientSettings
from campus_evals.formal_benchmark import run_formal_benchmark
from campus_evals.live_benchmark import (
    build_default_output_dir,
    build_default_profile_http_settings,
)
from campus_evals.models import ExecutionResult, GoldenCase
from campus_evals.ragas_adapter import build_ragas_supplemental_adapter_from_env
from campus_evals.runner import Executor
from campus_evals.scenarios_curriculum_release import (
    curriculum_release_gate_cases,
    curriculum_smoke_cases,
)
from campus_evals.scenarios_handbook import (
    handbook_regression_locked_cases,
    handbook_release_gate_cases,
    handbook_smoke_cases,
)
from campus_evals.scenarios_official_web import (
    official_web_stable_reference_release_gate_cases,
)

DEFAULT_RAGAS_OFFLINE_METRIC_NAMES = ("faithfulness", "answer_relevancy")
RAGAS_EVAL_SURFACES = (
    "student_rules",
    "curriculum_plan",
    "official_web_stable_reference",
)
RAGAS_EVAL_SPLITS = ("smoke", "regression_locked", "release_gate")


def build_ragas_eval_cases(*, surface: str, split: str) -> tuple[GoldenCase, ...]:
    if split not in RAGAS_EVAL_SPLITS:
        raise ValueError(f"unsupported RAGAS eval split: {split}")
    cases = _cases_for_surface(surface)
    return tuple(case for case in cases if case.split == split)


def parse_metric_names(raw: str | None) -> tuple[str, ...]:
    if raw is None or not raw.strip():
        return DEFAULT_RAGAS_OFFLINE_METRIC_NAMES
    metric_names = tuple(item.strip() for item in raw.split(",") if item.strip())
    if not metric_names:
        raise ValueError("metrics must contain at least one metric name")
    return metric_names


def build_app_api_ragas_executor(client: AppApiEvalClient) -> Executor:
    def _execute(case: GoldenCase) -> ExecutionResult:
        execution = client.execute_knowledge_request(case=case)
        return ExecutionResult(
            response=execution.response,
            observed_trace=execution.observed_trace,
            request_correlation=execution.request_correlation,
        )

    return _execute


def run_ragas_offline_benchmark(
    *,
    surface: str,
    split: str,
    metrics: tuple[str, ...],
    output_dir: str | Path,
    reruns: int,
    case_workers: int,
    verbose: bool = False,
    run_benchmark_fn: Callable[..., dict[str, object]] = run_formal_benchmark,
) -> dict[str, object]:
    cases = build_ragas_eval_cases(surface=surface, split=split)
    if not cases:
        raise ValueError(f"no RAGAS eval cases selected for {surface}:{split}")
    client = AppApiEvalClient(
        settings=AppApiEvalClientSettings.from_env(default_timeout_seconds=180.0)
    )
    adapter = build_ragas_supplemental_adapter_from_env(
        metric_names=metrics,
        http_settings=build_default_profile_http_settings(),
    )
    return run_benchmark_fn(
        cases=cases,
        executor=build_app_api_ragas_executor(client),
        supplemental_adapters=(adapter,),
        output_dir=Path(output_dir),
        reruns=reruns,
        case_workers=case_workers,
        benchmark_type="ragas_offline_benchmark",
        verbose=verbose,
    )


def main(argv: list[str] | None = None) -> int:
    load_repo_env()
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.command == "run":
        metrics = parse_metric_names(args.metrics)
        output_dir = Path(args.output_dir) if args.output_dir else _default_output_dir(args)
        summary = run_ragas_offline_benchmark(
            surface=args.surface,
            split=args.split,
            metrics=metrics,
            output_dir=output_dir,
            reruns=args.reruns,
            case_workers=args.case_workers,
            verbose=args.verbose,
        )
        if args.json:
            print(json.dumps(summary, ensure_ascii=False, indent=2))
        else:
            print(output_dir)
        return 0
    raise ValueError(f"unsupported command: {args.command}")


def _cases_for_surface(surface: str) -> tuple[GoldenCase, ...]:
    if surface == "student_rules":
        return (
            handbook_smoke_cases()
            + handbook_regression_locked_cases()
            + handbook_release_gate_cases()
        )
    if surface == "curriculum_plan":
        return curriculum_smoke_cases() + curriculum_release_gate_cases()
    if surface == "official_web_stable_reference":
        return official_web_stable_reference_release_gate_cases()
    raise ValueError(f"unsupported RAGAS eval surface: {surface}")


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run offline RAGAS scoring over existing golden cases and live app-api execution."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    run_parser = subparsers.add_parser("run", help="Run RAGAS scoring.")
    run_parser.add_argument("--surface", choices=RAGAS_EVAL_SURFACES, required=True)
    run_parser.add_argument("--split", choices=RAGAS_EVAL_SPLITS, default="smoke")
    run_parser.add_argument("--metrics", help="Comma-separated RAGAS metrics.")
    run_parser.add_argument("--output-dir", help="Output directory. Defaults to .tmp/evals.")
    run_parser.add_argument("--reruns", type=int, default=1)
    run_parser.add_argument("--case-workers", type=int, default=1)
    run_parser.add_argument("--verbose", action="store_true")
    run_parser.add_argument("--json", action="store_true")
    return parser


def _default_output_dir(args: argparse.Namespace) -> Path:
    return build_default_output_dir(prefix=f"ragas-{args.surface}-{args.split}")


if __name__ == "__main__":
    raise SystemExit(main())
