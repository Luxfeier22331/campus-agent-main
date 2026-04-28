from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass
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
_DEFAULT_MAX_BATCH_ITEMS = 200
_DEFAULT_MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
_DEFAULT_MAX_OCR_INPUT_BYTES = 25 * 1024 * 1024
_DEFAULT_MAX_OCR_CACHE_ENTRIES = 1
_DEFAULT_MAX_OCR_CACHE_TOTAL_BYTES = 4 * 1024 * 1024
_DEFAULT_PEAK_RSS_WARN_KB = 512 * 1024
_DEFAULT_PEAK_RSS_HARD_KB = 768 * 1024


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


@dataclass(frozen=True, slots=True)
class OnDemandBatchPolicy:
    max_batch_items: int = _DEFAULT_MAX_BATCH_ITEMS
    max_attachment_bytes: int = _DEFAULT_MAX_ATTACHMENT_BYTES
    max_ocr_input_bytes: int = _DEFAULT_MAX_OCR_INPUT_BYTES
    max_ocr_cache_entries: int = _DEFAULT_MAX_OCR_CACHE_ENTRIES
    max_ocr_cache_total_bytes: int = _DEFAULT_MAX_OCR_CACHE_TOTAL_BYTES
    peak_rss_warn_kb: int = _DEFAULT_PEAK_RSS_WARN_KB
    peak_rss_hard_kb: int = _DEFAULT_PEAK_RSS_HARD_KB

    def to_env_overrides(self) -> dict[str, str]:
        cache_enabled = self.max_ocr_cache_entries > 0 and self.max_ocr_cache_total_bytes > 0
        return {
            "INGESTION_MAX_ATTACHMENT_BYTES": str(self.max_attachment_bytes),
            "INGESTION_MAX_OCR_INPUT_BYTES": str(self.max_ocr_input_bytes),
            "INGESTION_OCR_PROVIDER_RESPONSE_CACHE_MAX_ENTRIES": str(self.max_ocr_cache_entries),
            "INGESTION_OCR_PROVIDER_RESPONSE_CACHE_MAX_BYTES": str(self.max_ocr_cache_total_bytes),
            "INGESTION_OCR_PROVIDER_RESPONSE_CACHE_ENABLED": "1" if cache_enabled else "0",
        }


def _run_subprocess(
    command: tuple[str, ...],
    *,
    env_overrides: dict[str, str] | None = None,
) -> SubprocessResult:
    wrapped_command = _wrap_with_time(command)
    env = dict(os.environ)
    if env_overrides:
        env.update(env_overrides)
    completed = subprocess.run(
        wrapped_command,
        check=False,
        capture_output=True,
        text=True,
        env=env,
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
    env_overrides: dict[str, str] | None = None,
    child_rss_delta_kb: Callable[[int], int] = child_process_peak_rss_delta_kb,
) -> dict[str, Any]:
    command = (sys.executable, "-m", step.module, *step.args)
    before_child_peak_rss_kb = child_process_peak_rss_kb()
    started_at = utc_now_iso()
    started = monotonic_seconds()
    subprocess_result = _run_subprocess(command, env_overrides=env_overrides)
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
    policy: OnDemandBatchPolicy | None = None,
) -> dict[str, Any]:
    runtime_policy = policy or load_batch_policy()
    _require_within_batch_limit(name="limit", value=limit, policy=runtime_policy)
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
        policy=runtime_policy,
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
    consumer_admission_manifest_path: str | None = None,
    policy: OnDemandBatchPolicy | None = None,
) -> dict[str, Any]:
    runtime_policy = policy or load_batch_policy()
    _require_within_batch_limit(name="limit", value=limit, policy=runtime_policy)
    _require_within_batch_limit(name="batch-size", value=batch_size, policy=runtime_policy)
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
    if consumer_admission_manifest_path:
        args.extend(
            (
                "--consumer-admission-manifest-path",
                consumer_admission_manifest_path,
            )
        )
    return _run_steps(
        batch_kind="internal_notice_multimodal_drain",
        policy=runtime_policy,
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
    policy: OnDemandBatchPolicy | None = None,
) -> dict[str, Any]:
    runtime_policy = policy or load_batch_policy()
    _require_within_batch_limit(name="batch-size", value=batch_size, policy=runtime_policy)
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
    return _run_steps(
        batch_kind="authenticated_notice_closeout",
        policy=runtime_policy,
        steps=tuple(steps),
    )


def run_wechat_public_notice_batch(
    *,
    selection_path: str | None = None,
    article_manifest_keys: tuple[str, ...] = (),
    source_bucket: str | None = None,
    capture_run_id: str | None = None,
    latest_completed_capture_run: bool = False,
    capture_account_slug: str | None = None,
    dry_run: bool = False,
    emit_read_model_evidence: bool = False,
    policy: OnDemandBatchPolicy | None = None,
) -> dict[str, Any]:
    runtime_policy = policy or load_batch_policy()
    _require_within_batch_limit(
        name="article-manifest-key count",
        value=max(1, len(article_manifest_keys)),
        policy=runtime_policy,
    )
    args: list[str] = []
    if selection_path:
        args.extend(("--selection-path", selection_path))
    for key in article_manifest_keys:
        args.extend(("--article-manifest-key", key))
    if source_bucket:
        args.extend(("--source-bucket", source_bucket))
    if capture_run_id:
        args.extend(("--capture-run-id", capture_run_id))
    if latest_completed_capture_run:
        args.append("--latest-completed-capture-run")
    if capture_account_slug:
        args.extend(("--capture-account-slug", capture_account_slug))
    if dry_run:
        args.append("--dry-run")
    if emit_read_model_evidence:
        args.append("--emit-read-model-evidence")
    return _run_steps(
        batch_kind="wechat_public_notices",
        policy=runtime_policy,
        steps=(
            IngestionBatchStep(
                name="project_wechat_public_notices",
                module="campus_ingestion_worker.project_wechat_public_notices",
                args=tuple(args),
            ),
        ),
    )


def run_wechat_public_notice_multimodal_drain_batch(
    *,
    notice_ids: tuple[str, ...] = (),
    selection_path: str | None = None,
    limit: int = 100,
    batch_size: int = 20,
    max_attempts: int = 3,
    skip_read_model_rebuild: bool = False,
    policy: OnDemandBatchPolicy | None = None,
) -> dict[str, Any]:
    runtime_policy = policy or load_batch_policy()
    _require_within_batch_limit(name="limit", value=limit, policy=runtime_policy)
    _require_within_batch_limit(name="batch-size", value=batch_size, policy=runtime_policy)
    args = [
        "--limit",
        str(limit),
        "--batch-size",
        str(batch_size),
        "--max-attempts",
        str(max_attempts),
    ]
    if selection_path:
        args.extend(("--selection-path", selection_path))
    for notice_id in notice_ids:
        args.extend(("--notice-id", notice_id))
    if skip_read_model_rebuild:
        args.append("--skip-read-model-rebuild")
    return _run_steps(
        batch_kind="wechat_public_notice_multimodal_drain",
        policy=runtime_policy,
        steps=(
            IngestionBatchStep(
                name="drain_wechat_public_notice_pending_multimodal",
                module="campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal",
                args=tuple(args),
            ),
        ),
    )


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
    _add_common_runtime_args(official)

    multimodal = subparsers.add_parser(
        "internal-notice-multimodal-drain",
        help="Drain pending internal_notice multimodal projection rows.",
    )
    multimodal.add_argument("--limit", type=_positive_int, default=100)
    multimodal.add_argument("--batch-size", type=_positive_int, default=20)
    multimodal.add_argument("--max-attempts", type=_positive_int, default=3)
    multimodal.add_argument("--skip-read-model-rebuild", action="store_true")
    multimodal.add_argument(
        "--consumer-admission-manifest-path",
        default=(
            os.getenv("INGESTION_ON_DEMAND_DRAIN_CONSUMER_ADMISSION_MANIFEST_PATH", "").strip()
            or None
        ),
        help=("Path to internal notice consumer admission manifest required by multimodal drain."),
    )
    _add_common_runtime_args(multimodal)

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
    closeout.add_argument("--object-store-concurrency", type=_positive_int, default=2)
    closeout.add_argument("--lease-seconds", type=_positive_int, default=300)
    closeout.add_argument("--validate-chunking", action="store_true")
    closeout.add_argument("--promote", action="store_true")
    _add_common_runtime_args(closeout)

    wechat = subparsers.add_parser(
        "wechat-public-notices",
        help="Project selected WeChat public notice source-truth artifacts.",
    )
    wechat.add_argument("--selection-path")
    wechat.add_argument("--article-manifest-key", action="append", default=[])
    wechat.add_argument("--source-bucket")
    wechat.add_argument("--capture-run-id")
    wechat.add_argument("--latest-completed-capture-run", action="store_true")
    wechat.add_argument("--capture-account-slug")
    wechat.add_argument("--dry-run", action="store_true")
    wechat.add_argument("--emit-read-model-evidence", action="store_true")
    _add_common_runtime_args(wechat)

    wechat_multimodal = subparsers.add_parser(
        "wechat-public-notice-multimodal-drain",
        help="Drain pending WeChat public-notice multimodal projection rows.",
    )
    wechat_multimodal.add_argument("--notice-id", action="append", default=[])
    wechat_multimodal.add_argument("--selection-path")
    wechat_multimodal.add_argument("--limit", type=_positive_int, default=100)
    wechat_multimodal.add_argument("--batch-size", type=_positive_int, default=20)
    wechat_multimodal.add_argument("--max-attempts", type=_positive_int, default=3)
    wechat_multimodal.add_argument("--skip-read-model-rebuild", action="store_true")
    _add_common_runtime_args(wechat_multimodal)

    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    policy = load_batch_policy(
        max_batch_items=getattr(args, "max_batch_items", None),
        max_attachment_bytes=getattr(args, "max_attachment_bytes", None),
        max_ocr_input_bytes=getattr(args, "max_ocr_input_bytes", None),
        max_ocr_cache_entries=getattr(args, "max_ocr_cache_entries", None),
        max_ocr_cache_total_bytes=getattr(args, "max_ocr_cache_total_bytes", None),
        peak_rss_warn_kb=getattr(args, "peak_rss_warn_kb", None),
        peak_rss_hard_kb=getattr(args, "peak_rss_hard_kb", None),
    )
    try:
        if args.batch_kind == "official-web-handoffs":
            report = run_official_web_handoff_batch(
                event_id=args.event_id,
                limit=args.limit,
                force=args.force,
                promote=args.promote,
                policy=policy,
            )
        elif args.batch_kind == "internal-notice-multimodal-drain":
            if not args.consumer_admission_manifest_path:
                parser.error(
                    "internal-notice-multimodal-drain requires "
                    "--consumer-admission-manifest-path or "
                    "INGESTION_ON_DEMAND_DRAIN_CONSUMER_ADMISSION_MANIFEST_PATH"
                )
            report = run_internal_notice_multimodal_drain_batch(
                limit=args.limit,
                batch_size=args.batch_size,
                max_attempts=args.max_attempts,
                skip_read_model_rebuild=args.skip_read_model_rebuild,
                consumer_admission_manifest_path=args.consumer_admission_manifest_path,
                policy=policy,
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
                policy=policy,
            )
        elif args.batch_kind == "wechat-public-notices":
            report = run_wechat_public_notice_batch(
                selection_path=args.selection_path,
                article_manifest_keys=tuple(args.article_manifest_key or ()),
                source_bucket=args.source_bucket,
                capture_run_id=args.capture_run_id,
                latest_completed_capture_run=bool(args.latest_completed_capture_run),
                capture_account_slug=args.capture_account_slug,
                dry_run=bool(args.dry_run),
                emit_read_model_evidence=bool(args.emit_read_model_evidence),
                policy=policy,
            )
        elif args.batch_kind == "wechat-public-notice-multimodal-drain":
            report = run_wechat_public_notice_multimodal_drain_batch(
                notice_ids=tuple(args.notice_id or ()),
                selection_path=args.selection_path,
                limit=args.limit,
                batch_size=args.batch_size,
                max_attempts=args.max_attempts,
                skip_read_model_rebuild=bool(args.skip_read_model_rebuild),
                policy=policy,
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
    policy: OnDemandBatchPolicy,
    steps: tuple[IngestionBatchStep, ...],
) -> dict[str, Any]:
    started_at = utc_now_iso()
    started = monotonic_seconds()
    step_results: list[dict[str, Any]] = []
    for step in steps:
        result = run_batch_step(step, env_overrides=policy.to_env_overrides())
        step_results.append(result)
        if result["status"] != "succeeded":
            break
    step_status = (
        "succeeded"
        if len(step_results) == len(steps)
        and all(step["status"] == "succeeded" for step in step_results)
        else "failed"
    )
    finished_at = utc_now_iso()
    max_step_peak_rss_kb = (
        max(int(step.get("peak_rss_kb") or 0) for step in step_results) if step_results else 0
    )
    rss_budget_status = _classify_rss_budget(
        peak_rss_kb=max_step_peak_rss_kb,
        policy=policy,
    )
    status = "failed" if rss_budget_status == "hard_exceeded" else step_status
    failed_step = (
        "resource_budget"
        if rss_budget_status == "hard_exceeded" and step_status == "succeeded"
        else _first_failed_step_name(step_results)
    )
    return {
        "schema_version": ON_DEMAND_BATCH_REPORT_SCHEMA_VERSION,
        "batch_kind": batch_kind,
        "status": status,
        "started_at": started_at,
        "finished_at": finished_at,
        "elapsed_seconds": round(monotonic_seconds() - started, 6),
        "planned_step_count": len(steps),
        "executed_step_count": len(step_results),
        "failed_step": failed_step,
        "policy": asdict(policy),
        "resource_budget": {
            "max_step_peak_rss_kb": max_step_peak_rss_kb,
            "peak_rss_warn_kb": policy.peak_rss_warn_kb,
            "peak_rss_hard_kb": policy.peak_rss_hard_kb,
            "status": rss_budget_status,
        },
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


def _non_negative_int(value: str) -> int:
    parsed = int(value)
    if parsed < 0:
        raise argparse.ArgumentTypeError("must be a non-negative integer")
    return parsed


def _add_common_runtime_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--report-path",
        help="Optional path for the full on-demand batch JSON report.",
    )
    parser.add_argument("--max-batch-items", type=_positive_int)
    parser.add_argument("--max-attachment-bytes", type=_positive_int)
    parser.add_argument("--max-ocr-input-bytes", type=_positive_int)
    parser.add_argument("--max-ocr-cache-entries", type=_non_negative_int)
    parser.add_argument("--max-ocr-cache-total-bytes", type=_non_negative_int)
    parser.add_argument("--peak-rss-warn-kb", type=_positive_int)
    parser.add_argument("--peak-rss-hard-kb", type=_positive_int)


def _write_report(*, report: dict[str, Any], output_path: str | None) -> None:
    if not output_path:
        return
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8"
    )


def load_batch_policy(
    *,
    max_batch_items: int | None = None,
    max_attachment_bytes: int | None = None,
    max_ocr_input_bytes: int | None = None,
    max_ocr_cache_entries: int | None = None,
    max_ocr_cache_total_bytes: int | None = None,
    peak_rss_warn_kb: int | None = None,
    peak_rss_hard_kb: int | None = None,
) -> OnDemandBatchPolicy:
    env = os.environ
    resolved = OnDemandBatchPolicy(
        max_batch_items=max_batch_items
        if max_batch_items is not None
        else _env_int(env, "INGESTION_ON_DEMAND_MAX_BATCH_ITEMS", _DEFAULT_MAX_BATCH_ITEMS),
        max_attachment_bytes=max_attachment_bytes
        if max_attachment_bytes is not None
        else _env_int(
            env, "INGESTION_ON_DEMAND_MAX_ATTACHMENT_BYTES", _DEFAULT_MAX_ATTACHMENT_BYTES
        ),
        max_ocr_input_bytes=max_ocr_input_bytes
        if max_ocr_input_bytes is not None
        else _env_int(env, "INGESTION_ON_DEMAND_MAX_OCR_INPUT_BYTES", _DEFAULT_MAX_OCR_INPUT_BYTES),
        max_ocr_cache_entries=max_ocr_cache_entries
        if max_ocr_cache_entries is not None
        else _env_int(
            env, "INGESTION_ON_DEMAND_OCR_CACHE_MAX_ENTRIES", _DEFAULT_MAX_OCR_CACHE_ENTRIES
        ),
        max_ocr_cache_total_bytes=max_ocr_cache_total_bytes
        if max_ocr_cache_total_bytes is not None
        else _env_int(
            env,
            "INGESTION_ON_DEMAND_OCR_CACHE_MAX_TOTAL_BYTES",
            _DEFAULT_MAX_OCR_CACHE_TOTAL_BYTES,
        ),
        peak_rss_warn_kb=peak_rss_warn_kb
        if peak_rss_warn_kb is not None
        else _env_int(env, "INGESTION_ON_DEMAND_PEAK_RSS_WARN_KB", _DEFAULT_PEAK_RSS_WARN_KB),
        peak_rss_hard_kb=peak_rss_hard_kb
        if peak_rss_hard_kb is not None
        else _env_int(env, "INGESTION_ON_DEMAND_PEAK_RSS_HARD_KB", _DEFAULT_PEAK_RSS_HARD_KB),
    )
    if resolved.peak_rss_hard_kb < resolved.peak_rss_warn_kb:
        raise ValueError("peak_rss_hard_kb must be greater than or equal to peak_rss_warn_kb")
    return resolved


def _env_int(env: dict[str, str], key: str, default: int) -> int:
    raw = str(env.get(key) or "").strip()
    if not raw:
        return default
    parsed = int(raw)
    if parsed < 0:
        raise ValueError(f"{key} must be non-negative")
    return parsed


def _require_within_batch_limit(*, name: str, value: int, policy: OnDemandBatchPolicy) -> None:
    if value > policy.max_batch_items:
        raise ValueError(
            f"{name}={value} exceeds INGESTION_ON_DEMAND_MAX_BATCH_ITEMS={policy.max_batch_items}"
        )


def _classify_rss_budget(*, peak_rss_kb: int, policy: OnDemandBatchPolicy) -> str:
    if peak_rss_kb >= policy.peak_rss_hard_kb:
        return "hard_exceeded"
    if peak_rss_kb >= policy.peak_rss_warn_kb:
        return "warn_exceeded"
    return "within_budget"


__all__ = [
    "ON_DEMAND_BATCH_REPORT_SCHEMA_VERSION",
    "IngestionBatchStep",
    "OnDemandBatchPolicy",
    "SubprocessResult",
    "build_parser",
    "load_batch_policy",
    "main",
    "run_authenticated_notice_closeout_batch",
    "run_batch_step",
    "run_internal_notice_multimodal_drain_batch",
    "run_official_web_handoff_batch",
    "run_wechat_public_notice_batch",
]


if __name__ == "__main__":
    main()
