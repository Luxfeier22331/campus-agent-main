from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.resource_profile import (
    build_resource_profile,
    child_process_peak_rss_delta_kb,
    child_process_peak_rss_kb,
    monotonic_seconds,
    utc_now_iso,
)

ON_DEMAND_BATCH_REPORT_SCHEMA_VERSION = "campus_ingestion_on_demand_batch.v1"
_TIME_PEAK_RSS_MARKER = "__CAMPUS_INGESTION_PEAK_RSS_KB__="


@dataclass(frozen=True, slots=True)
class IngestionBatchStep:
    name: str
    module: str
    args: tuple[str, ...] = ()
    expected_exit_codes: tuple[int, ...] = (0,)


@dataclass(frozen=True, slots=True)
class SubprocessResult:
    exit_code: int
    stdout: str
    stderr: str
    peak_rss_kb: int | None = None


def _run_subprocess(command: tuple[str, ...]) -> SubprocessResult:
    wrapped_command = _wrap_with_time(command)
    completed = subprocess.run(
        wrapped_command,
        check=False,
        capture_output=True,
        text=True,
        env=dict(os.environ),
    )
    stderr, peak_rss_kb = _parse_timed_stderr(completed.stderr)
    return SubprocessResult(
        exit_code=completed.returncode,
        stdout=completed.stdout,
        stderr=stderr,
        peak_rss_kb=peak_rss_kb,
    )


def run_batch_step(
    step: IngestionBatchStep,
    *,
    child_rss_delta_kb: Callable[[int], int] = child_process_peak_rss_delta_kb,
) -> dict[str, Any]:
    command = (sys.executable, "-m", step.module, *step.args)
    before_child_peak_rss_kb = child_process_peak_rss_kb()
    started_at = utc_now_iso()
    started = monotonic_seconds()
    subprocess_result = _run_subprocess(command)
    elapsed_seconds = monotonic_seconds() - started
    finished_at = utc_now_iso()
    status = "succeeded" if subprocess_result.exit_code in step.expected_exit_codes else "failed"
    stdout_json = _parse_stdout_json(subprocess_result.stdout)
    peak_rss_kb = (
        subprocess_result.peak_rss_kb
        if subprocess_result.peak_rss_kb is not None
        else child_rss_delta_kb(before_child_peak_rss_kb)
    )
    profile = build_resource_profile(
        command=command,
        status=status,
        exit_code=subprocess_result.exit_code,
        started_at=started_at,
        finished_at=finished_at,
        elapsed_seconds=elapsed_seconds,
        peak_rss_kb=peak_rss_kb,
        metrics=_extract_numeric_metrics(stdout_json),
    )
    return {
        "name": step.name,
        "module": step.module,
        "args": list(step.args),
        "status": status,
        "exit_code": subprocess_result.exit_code,
        "elapsed_seconds": profile["elapsed_seconds"],
        "peak_rss_kb": profile["peak_rss_kb"],
        "profile": profile,
        "stdout_json": stdout_json,
        "stdout_tail": _tail(subprocess_result.stdout),
        "stderr_tail": _tail(subprocess_result.stderr),
    }


def run_official_web_handoff_batch(
    *,
    event_id: str | None = None,
    limit: int = 20,
    force: bool = False,
    promote: bool = False,
) -> dict[str, Any]:
    args: list[str] = []
    if event_id:
        args.extend(("--event-id", event_id))
    args.extend(("--limit", str(limit)))
    if force:
        args.append("--force")
    if promote:
        args.append("--promote")
    return _run_steps(
        batch_kind="official_web_handoffs",
        steps=(
            IngestionBatchStep(
                name="consume_handoffs",
                module="campus_ingestion_worker.official_web_handoff_consumer",
                args=tuple(args),
            ),
        ),
    )


def run_internal_notice_multimodal_drain_batch(
    *,
    limit: int = 100,
    batch_size: int = 20,
    max_attempts: int = 3,
    skip_read_model_rebuild: bool = False,
) -> dict[str, Any]:
    args = [
        "--limit",
        str(limit),
        "--batch-size",
        str(batch_size),
        "--max-attempts",
        str(max_attempts),
    ]
    if skip_read_model_rebuild:
        args.append("--skip-read-model-rebuild")
    return _run_steps(
        batch_kind="internal_notice_multimodal_drain",
        steps=(
            IngestionBatchStep(
                name="drain_multimodal_pending",
                module="campus_ingestion_worker.drain_internal_notice_pending_multimodal",
                args=tuple(args),
            ),
        ),
    )


def run_authenticated_notice_closeout_batch(
    *,
    run_id: str,
    bundle_path: str | None = None,
    manifest_path: str | None = None,
    site_id: str | None = None,
    source_home_url: str | None = None,
    parallel_workers: int = 1,
    worker_id: str = "ondemand",
    shard_size: int = 250,
    batch_size: int = 16,
    max_concurrency: int = 1,
    notice_concurrency: int = 2,
    object_store_concurrency: int = 8,
    lease_seconds: int = 300,
    validate_chunking: bool = False,
    promote: bool = False,
) -> dict[str, Any]:
    steps: list[IngestionBatchStep] = []
    if bundle_path:
        if not site_id or not source_home_url:
            raise ValueError(
                "site_id and source_home_url are required when planning a closeout batch"
            )
        plan_args: list[str] = [
            "--bundle-path",
            bundle_path,
        ]
        if manifest_path:
            plan_args.extend(("--manifest-path", manifest_path))
        plan_args.extend(
            (
                "--site-id",
                site_id,
                "--source-home-url",
                source_home_url,
                "--run-id",
                run_id,
                "--shard-size",
                str(shard_size),
                "--batch-size",
                str(batch_size),
                "--max-concurrency",
                str(max_concurrency),
                "--notice-concurrency",
                str(notice_concurrency),
                "--object-store-concurrency",
                str(object_store_concurrency),
                "--lease-seconds",
                str(lease_seconds),
            )
        )
        steps.append(
            IngestionBatchStep(
                name="plan_closeout",
                module="campus_ingestion_worker.plan_authenticated_notice_closeout",
                args=tuple(plan_args),
            )
        )

    worker_args = ["--run-id", run_id, "--parallel-workers", str(parallel_workers)]
    if parallel_workers == 1:
        worker_args.extend(("--worker-id", worker_id))
    else:
        worker_args.extend(("--worker-id-prefix", worker_id))
    steps.append(
        IngestionBatchStep(
            name="run_closeout_workers",
            module="campus_ingestion_worker.run_authenticated_notice_closeout_worker",
            args=tuple(worker_args),
        )
    )

    if validate_chunking:
        steps.append(
            IngestionBatchStep(
                name="validate_chunking",
                module="campus_ingestion_worker.validate_internal_notice_chunking",
                args=("--closeout-run-id", run_id),
            )
        )
    if promote:
        steps.append(
            IngestionBatchStep(
                name="promote_closeout",
                module="campus_ingestion_worker.promote_authenticated_notice_closeout",
                args=("--run-id", run_id),
            )
        )
    return _run_steps(batch_kind="authenticated_notice_closeout", steps=tuple(steps))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run bounded ingestion batches on demand and exit with a resource report."
    )
    subparsers = parser.add_subparsers(dest="batch_kind", required=True)

    official = subparsers.add_parser(
        "official-web-handoffs",
        help="Consume pending official_web handoff inbox records.",
    )
    official.add_argument("--event-id")
    official.add_argument("--limit", type=_positive_int, default=20)
    official.add_argument("--force", action="store_true")
    official.add_argument("--promote", action="store_true")
    _add_common_output_args(official)

    multimodal = subparsers.add_parser(
        "internal-notice-multimodal-drain",
        help="Drain pending internal_notice multimodal projection rows.",
    )
    multimodal.add_argument("--limit", type=_positive_int, default=100)
    multimodal.add_argument("--batch-size", type=_positive_int, default=20)
    multimodal.add_argument("--max-attempts", type=_positive_int, default=3)
    multimodal.add_argument("--skip-read-model-rebuild", action="store_true")
    _add_common_output_args(multimodal)

    closeout = subparsers.add_parser(
        "authenticated-notice-closeout",
        help="Plan/run/validate/promote an authenticated notice closeout batch.",
    )
    closeout.add_argument("--run-id", required=True)
    closeout.add_argument("--bundle-path")
    closeout.add_argument("--manifest-path")
    closeout.add_argument("--site-id")
    closeout.add_argument("--source-home-url")
    closeout.add_argument("--parallel-workers", type=_positive_int, default=1)
    closeout.add_argument("--worker-id", default="ondemand")
    closeout.add_argument("--shard-size", type=_positive_int, default=250)
    closeout.add_argument("--batch-size", type=_positive_int, default=16)
    closeout.add_argument("--max-concurrency", type=_positive_int, default=1)
    closeout.add_argument("--notice-concurrency", type=_positive_int, default=2)
    closeout.add_argument("--object-store-concurrency", type=_positive_int, default=8)
    closeout.add_argument("--lease-seconds", type=_positive_int, default=300)
    closeout.add_argument("--validate-chunking", action="store_true")
    closeout.add_argument("--promote", action="store_true")
    _add_common_output_args(closeout)

    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        if args.batch_kind == "official-web-handoffs":
            report = run_official_web_handoff_batch(
                event_id=args.event_id,
                limit=args.limit,
                force=args.force,
                promote=args.promote,
            )
        elif args.batch_kind == "internal-notice-multimodal-drain":
            report = run_internal_notice_multimodal_drain_batch(
                limit=args.limit,
                batch_size=args.batch_size,
                max_attempts=args.max_attempts,
                skip_read_model_rebuild=args.skip_read_model_rebuild,
            )
        elif args.batch_kind == "authenticated-notice-closeout":
            report = run_authenticated_notice_closeout_batch(
                run_id=args.run_id,
                bundle_path=args.bundle_path,
                manifest_path=args.manifest_path,
                site_id=args.site_id,
                source_home_url=args.source_home_url,
                parallel_workers=args.parallel_workers,
                worker_id=args.worker_id,
                shard_size=args.shard_size,
                batch_size=args.batch_size,
                max_concurrency=args.max_concurrency,
                notice_concurrency=args.notice_concurrency,
                object_store_concurrency=args.object_store_concurrency,
                lease_seconds=args.lease_seconds,
                validate_chunking=args.validate_chunking,
                promote=args.promote,
            )
        else:
            parser.error(f"unsupported batch kind: {args.batch_kind}")
    except ValueError as exc:
        parser.error(str(exc))
    _write_report(report=report, output_path=args.report_path)
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    if report["status"] != "succeeded":
        raise SystemExit(1)


def _run_steps(
    *,
    batch_kind: str,
    steps: tuple[IngestionBatchStep, ...],
) -> dict[str, Any]:
    started_at = utc_now_iso()
    started = monotonic_seconds()
    step_results: list[dict[str, Any]] = []
    for step in steps:
        result = run_batch_step(step)
        step_results.append(result)
        if result["status"] != "succeeded":
            break
    status = (
        "succeeded"
        if len(step_results) == len(steps)
        and all(step["status"] == "succeeded" for step in step_results)
        else "failed"
    )
    finished_at = utc_now_iso()
    return {
        "schema_version": ON_DEMAND_BATCH_REPORT_SCHEMA_VERSION,
        "batch_kind": batch_kind,
        "status": status,
        "started_at": started_at,
        "finished_at": finished_at,
        "elapsed_seconds": round(monotonic_seconds() - started, 6),
        "planned_step_count": len(steps),
        "executed_step_count": len(step_results),
        "failed_step": _first_failed_step_name(step_results),
        "steps": step_results,
    }


def _parse_stdout_json(stdout: str) -> Any:
    stripped = stdout.strip()
    if not stripped:
        return None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return None


def _wrap_with_time(command: tuple[str, ...]) -> tuple[str, ...]:
    time_binary = shutil.which("time")
    if not time_binary:
        fallback = Path("/usr/bin/time")
        if fallback.exists():
            time_binary = str(fallback)
    if not time_binary:
        return command
    return (
        time_binary,
        "-f",
        f"{_TIME_PEAK_RSS_MARKER}%M",
        *command,
    )


def _parse_timed_stderr(stderr: str) -> tuple[str, int | None]:
    peak_rss_kb: int | None = None
    retained_lines: list[str] = []
    for line in stderr.splitlines():
        if line.startswith(_TIME_PEAK_RSS_MARKER):
            raw_value = line.removeprefix(_TIME_PEAK_RSS_MARKER).strip()
            if raw_value:
                peak_rss_kb = int(raw_value)
            continue
        retained_lines.append(line)
    return "\n".join(retained_lines).strip(), peak_rss_kb


def _extract_numeric_metrics(payload: Any) -> dict[str, int | float]:
    if not isinstance(payload, dict):
        return {}
    metrics: dict[str, int | float] = {}
    for key, value in payload.items():
        if isinstance(value, bool):
            continue
        if isinstance(value, int | float):
            metrics[key] = value
    return metrics


def _tail(value: str, *, max_chars: int = 4000) -> str:
    stripped = value.strip()
    if len(stripped) <= max_chars:
        return stripped
    return stripped[-max_chars:]


def _first_failed_step_name(steps: Sequence[dict[str, Any]]) -> str | None:
    for step in steps:
        if step["status"] != "succeeded":
            return str(step["name"])
    return None


def _positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def _add_common_output_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--report-path",
        help="Optional path for the full on-demand batch JSON report.",
    )


def _write_report(*, report: dict[str, Any], output_path: str | None) -> None:
    if not output_path:
        return
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
    )


__all__ = [
    "ON_DEMAND_BATCH_REPORT_SCHEMA_VERSION",
    "IngestionBatchStep",
    "SubprocessResult",
    "build_parser",
    "main",
    "run_authenticated_notice_closeout_batch",
    "run_batch_step",
    "run_internal_notice_multimodal_drain_batch",
    "run_official_web_handoff_batch",
]


if __name__ == "__main__":
    main()
