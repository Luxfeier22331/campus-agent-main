from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime
import json
from pathlib import Path
from typing import Callable

from campus_evals.handbook_benchmark import (
    collect_repairable_handbook_benchmark_targets,
    repair_handbook_formal_benchmark,
    run_handbook_formal_benchmark,
)
from campus_evals.models import GoldenCase
from campus_evals.runner import Executor, SupplementalAdapter
from campus_evals.settings import SupplementalHTTPSettings


CasesFactory = Callable[[], tuple[GoldenCase, ...]]
SupplementalAdaptersFactory = Callable[[], tuple[SupplementalAdapter, ...]]


@dataclass(frozen=True, slots=True)
class BenchmarkProfile:
    profile_id: str
    benchmark_type: str
    repair_benchmark_type: str
    run_prefix: str
    repair_prefix: str
    description: str
    policy_path: Path
    cases_factory: CasesFactory
    executor_factory: Callable[[], Executor]
    supplemental_adapters_factory: SupplementalAdaptersFactory
    http_settings: SupplementalHTTPSettings = SupplementalHTTPSettings()
    pass_policy_path_to_core: bool = True
    pass_benchmark_type_to_core: bool = True
    pass_repair_benchmark_type_to_core: bool = True


def build_default_profile_http_settings() -> SupplementalHTTPSettings:
    # handbook/curriculum formal acceptance includes heavy report-only ragas metrics
    # such as faithfulness/context_precision that routinely exceed low-latency judge budgets.
    # Keep the live benchmark profile aligned with the repo-tracked readiness evidence instead
    # of inheriting a chat-style timeout ceiling.
    return SupplementalHTTPSettings(
        read_timeout_seconds=180.0,
        retry_attempts=1,
        circuit_breaker_failure_threshold=5,
        circuit_breaker_cooldown_seconds=15.0,
        request_min_interval_seconds=1.0,
    )


def build_default_output_dir(*, prefix: str, timestamp: str | None = None) -> Path:
    resolved_timestamp = timestamp or datetime.now().strftime("%Y%m%dT%H%M%S")
    return Path(".tmp/evals") / f"{prefix}-{resolved_timestamp}"


def build_parser_for_profile(profile: BenchmarkProfile) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=profile.description)
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run", help=f"Run a fresh {profile.profile_id} live benchmark.")
    run_parser.add_argument("--reruns", type=int, default=3, help="Number of reruns for the live benchmark.")
    run_parser.add_argument("--output-dir", help="Optional output directory. Defaults to timestamped .tmp/evals path.")
    run_parser.add_argument("--verbose", action="store_true", help="Print high-signal supplemental runtime events.")
    run_parser.add_argument("--log-jsonl", help="Optional runtime event JSONL path for this run.")

    repair_parser = subparsers.add_parser(
        "repair",
        help="Repair transient infra failures from an existing benchmark dir.",
    )
    repair_parser.add_argument("--benchmark-dir", required=True, help="Path to an existing benchmark artifact directory.")
    repair_parser.add_argument("--output-dir", help="Optional output directory. Defaults to timestamped .tmp/evals path.")
    repair_parser.add_argument("--verbose", action="store_true", help="Print high-signal supplemental runtime events.")
    repair_parser.add_argument("--log-jsonl", help="Optional runtime event JSONL path for this repair run.")

    accept_parser = subparsers.add_parser(
        "accept",
        help="Run acceptance flow: live run, repair transient failures when needed, then write final summary.",
    )
    accept_parser.add_argument("--reruns", type=int, default=3, help="Number of reruns for the initial live benchmark.")
    accept_parser.add_argument("--output-dir", help="Optional output directory. Defaults to timestamped .tmp/evals path.")
    accept_parser.add_argument("--verbose", action="store_true", help="Print high-signal supplemental runtime events.")
    accept_parser.add_argument(
        "--log-jsonl",
        help="Optional runtime event JSONL base path. Accept mode derives separate run/repair event logs from it.",
    )

    return parser


def run_live_benchmark_profile(
    *,
    profile: BenchmarkProfile,
    reruns: int,
    output_dir: str | Path,
    run_benchmark_fn=None,
    verbose: bool = False,
    runtime_events_path: str | Path | None = None,
) -> dict[str, object]:
    resolved_run_benchmark_fn = run_benchmark_fn or run_handbook_formal_benchmark
    kwargs: dict[str, object] = {
        "cases": profile.cases_factory(),
        "executor": profile.executor_factory(),
        "supplemental_adapters": profile.supplemental_adapters_factory(),
        "output_dir": Path(output_dir),
        "reruns": reruns,
    }
    if profile.pass_policy_path_to_core:
        kwargs["policy_path"] = profile.policy_path
    if profile.pass_benchmark_type_to_core:
        kwargs["benchmark_type"] = profile.benchmark_type
    if verbose:
        kwargs["verbose"] = True
    if runtime_events_path is not None:
        kwargs["runtime_events_path"] = Path(runtime_events_path)
    return resolved_run_benchmark_fn(**kwargs)


def repair_live_benchmark_profile(
    *,
    profile: BenchmarkProfile,
    benchmark_dir: str | Path,
    output_dir: str | Path,
    repair_benchmark_fn=None,
    verbose: bool = False,
    runtime_events_path: str | Path | None = None,
) -> dict[str, object]:
    resolved_repair_benchmark_fn = repair_benchmark_fn or repair_handbook_formal_benchmark
    kwargs: dict[str, object] = {
        "cases": profile.cases_factory(),
        "executor": profile.executor_factory(),
        "supplemental_adapters": profile.supplemental_adapters_factory(),
        "benchmark_dir": Path(benchmark_dir),
        "output_dir": Path(output_dir),
    }
    if profile.pass_policy_path_to_core:
        kwargs["policy_path"] = profile.policy_path
    if profile.pass_repair_benchmark_type_to_core:
        kwargs["benchmark_type"] = profile.repair_benchmark_type
    if verbose:
        kwargs["verbose"] = True
    if runtime_events_path is not None:
        kwargs["runtime_events_path"] = Path(runtime_events_path)
    return resolved_repair_benchmark_fn(**kwargs)


def accept_live_benchmark_profile(
    *,
    profile: BenchmarkProfile,
    reruns: int,
    output_dir: str | Path,
    run_benchmark_fn=None,
    repair_benchmark_fn=None,
    verbose: bool = False,
    runtime_events_path: str | Path | None = None,
) -> dict[str, object]:
    resolved_output_dir = Path(output_dir)
    resolved_output_dir.mkdir(parents=True, exist_ok=True)
    initial_run_dir = resolved_output_dir / "run"
    repair_run_dir = resolved_output_dir / "repair"
    run_events_path, repair_events_path = _resolve_accept_runtime_event_paths(runtime_events_path)

    if verbose:
        print("[accept] stage=run status=started")
    initial_summary = run_live_benchmark_profile(
        profile=profile,
        reruns=reruns,
        output_dir=initial_run_dir,
        run_benchmark_fn=run_benchmark_fn,
        verbose=verbose,
        runtime_events_path=run_events_path,
    )
    if verbose:
        print("[accept] stage=run status=completed")

    repair_targets = collect_repairable_handbook_benchmark_targets(initial_run_dir)
    selected_target_count = len(repair_targets)
    final_source_summary = initial_summary
    resolved_repair_dir: Path | None = None
    if selected_target_count > 0:
        if verbose:
            print(f"[accept] stage=repair status=started selected_targets={selected_target_count}")
        final_source_summary = repair_live_benchmark_profile(
            profile=profile,
            benchmark_dir=initial_run_dir,
            output_dir=repair_run_dir,
            repair_benchmark_fn=repair_benchmark_fn,
            verbose=verbose,
            runtime_events_path=repair_events_path,
        )
        resolved_repair_dir = repair_run_dir
        if verbose:
            print("[accept] stage=repair status=completed")
    elif verbose:
        print("[accept] stage=repair status=skipped selected_targets=0")

    final_summary = {
        "schema_version": 1,
        "benchmark_type": profile.benchmark_type,
        "mode": "acceptance",
        "initial_run_dir": str(initial_run_dir),
        "repair_run_dir": str(resolved_repair_dir) if resolved_repair_dir is not None else None,
        "deterministic_verdict": _deterministic_verdict(final_source_summary),
        "supplemental_verdict": str(dict(final_source_summary.get("gate_report") or {}).get("overall_verdict") or "warn"),
        "final_overall_verdict": _final_overall_verdict(final_source_summary),
        "initial_gate_report": dict(initial_summary.get("gate_report") or {}),
        "final_gate_report": dict(final_source_summary.get("gate_report") or {}),
        "repair": {
            "selected_target_count": selected_target_count,
            "applied_target_count": int(dict(final_source_summary.get("repair") or {}).get("applied_target_count") or 0),
            "remaining_transient_failures": _count_remaining_transient_failures(final_source_summary),
        },
        "provider_runtime": dict(final_source_summary.get("supplemental_runtime") or {}),
        "runtime_observability": _build_accept_runtime_observability(
            initial_summary=initial_summary,
            final_source_summary=final_source_summary,
            run_events_path=run_events_path,
            repair_events_path=repair_events_path,
        ),
    }
    (resolved_output_dir / "accept-config.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "benchmark_type": profile.benchmark_type,
                "reruns": reruns,
                "initial_run_dir": str(initial_run_dir),
                "repair_run_dir": str(repair_run_dir),
                "runtime_events": {
                    "run": str(run_events_path) if run_events_path is not None else None,
                    "repair": str(repair_events_path) if repair_events_path is not None else None,
                },
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    (resolved_output_dir / "final-summary.json").write_text(
        json.dumps(final_summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    if verbose:
        print(f"[accept] stage=final status={final_summary['final_overall_verdict']}")
    return final_summary


def main_for_profile(
    *,
    profile: BenchmarkProfile,
    argv: list[str] | None = None,
    output_dir_builder: Callable[..., Path] = build_default_output_dir,
    run_benchmark_fn=None,
    repair_benchmark_fn=None,
    accept_benchmark_fn=None,
) -> int:
    args = build_parser_for_profile(profile).parse_args(argv)
    resolved_accept_benchmark_fn = accept_benchmark_fn or accept_live_benchmark_profile

    if args.command == "run":
        output_dir = Path(args.output_dir) if args.output_dir else output_dir_builder(prefix=profile.run_prefix)
        run_live_benchmark_profile(
            profile=profile,
            reruns=args.reruns,
            output_dir=output_dir,
            run_benchmark_fn=run_benchmark_fn,
            verbose=bool(args.verbose),
            runtime_events_path=args.log_jsonl,
        )
        print(output_dir)
        return 0

    if args.command == "accept":
        output_dir = (
            Path(args.output_dir)
            if args.output_dir
            else output_dir_builder(prefix=f"{profile.run_prefix}-accept")
        )
        resolved_accept_benchmark_fn(
            profile=profile,
            reruns=args.reruns,
            output_dir=output_dir,
            run_benchmark_fn=run_benchmark_fn,
            repair_benchmark_fn=repair_benchmark_fn,
            verbose=bool(args.verbose),
            runtime_events_path=args.log_jsonl,
        )
        print(output_dir)
        return 0

    output_dir = Path(args.output_dir) if args.output_dir else output_dir_builder(prefix=profile.repair_prefix)
    repair_live_benchmark_profile(
        profile=profile,
        benchmark_dir=Path(args.benchmark_dir),
        output_dir=output_dir,
        repair_benchmark_fn=repair_benchmark_fn,
        verbose=bool(args.verbose),
        runtime_events_path=args.log_jsonl,
    )
    print(output_dir)
    return 0


def _resolve_accept_runtime_event_paths(
    runtime_events_path: str | Path | None,
) -> tuple[Path | None, Path | None]:
    if runtime_events_path is None:
        return None, None
    base = Path(runtime_events_path)
    suffix = base.suffix or ".jsonl"
    stem = base.name[: -len(suffix)] if base.suffix else base.name
    run_path = base.with_name(f"{stem}.run{suffix}")
    repair_path = base.with_name(f"{stem}.repair{suffix}")
    return run_path, repair_path


def _deterministic_verdict(summary: dict[str, object]) -> str:
    deterministic = dict(summary.get("deterministic") or {})
    stable = bool(deterministic.get("stable_across_runs"))
    mean_pass_rate = deterministic.get("mean_pass_rate")
    if stable and mean_pass_rate == 1.0:
        return "pass"
    return "fail"


def _final_overall_verdict(summary: dict[str, object]) -> str:
    deterministic_verdict = _deterministic_verdict(summary)
    if deterministic_verdict == "fail":
        return "fail"
    gate_verdict = str(dict(summary.get("gate_report") or {}).get("overall_verdict") or "warn")
    if gate_verdict == "pass":
        return "pass"
    if gate_verdict == "warn":
        return "warn"
    return "fail"


def _count_remaining_transient_failures(summary: dict[str, object]) -> int:
    aggregate = dict(dict(summary.get("aggregate") or {}).get("supplemental") or {})
    return sum(
        int(dict(metric_summary.get("overall") or {}).get("transient_runtime_failure_count") or 0)
        for metric_summary in aggregate.values()
        if isinstance(metric_summary, dict)
    )


def _build_accept_runtime_observability(
    *,
    initial_summary: dict[str, object],
    final_source_summary: dict[str, object],
    run_events_path: Path | None,
    repair_events_path: Path | None,
) -> dict[str, object]:
    initial_runtime = dict(initial_summary.get("runtime_observability") or {})
    final_runtime = dict(final_source_summary.get("runtime_observability") or {})
    return {
        "run_events_path": str(run_events_path) if run_events_path is not None else initial_runtime.get("events_path"),
        "repair_events_path": (
            str(repair_events_path)
            if repair_events_path is not None
            else final_runtime.get("events_path")
            if final_runtime != initial_runtime
            else None
        ),
        "run_session_id": initial_runtime.get("session_id"),
        "repair_session_id": (
            final_runtime.get("session_id")
            if final_runtime != initial_runtime
            else None
        ),
        "run_provider_summary_path": initial_runtime.get("provider_summary_path"),
        "repair_provider_summary_path": (
            final_runtime.get("provider_summary_path")
            if final_runtime != initial_runtime
            else None
        ),
    }
