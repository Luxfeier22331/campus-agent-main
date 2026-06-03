from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.official_web_university_collection_alerts import (
    build_official_web_university_collection_alert_summary,
)
from campus_ingestion_worker.official_web_university_collection_compare import (
    compare_official_web_university_collection_runs,
)
from campus_ingestion_worker.official_web_university_collection_constants import (
    UNIVERSITY_COLLECTION_ALERT_SCHEMA_VERSION,
    UNIVERSITY_COLLECTION_COMPARE_SCHEMA_VERSION,
    UNIVERSITY_COLLECTION_PREFLIGHT_SCHEMA_VERSION,
    UNIVERSITY_COLLECTION_RUN_SCHEMA_VERSION,
)
from campus_ingestion_worker.official_web_university_collection_io import (
    _read_required_json,
    _write_json,
)
from campus_ingestion_worker.official_web_university_collection_preflight import (
    run_official_web_university_collection_preflight,
)
from campus_ingestion_worker.official_web_university_collection_runner import (
    run_official_web_university_collection_lane,
)
from campus_ingestion_worker.official_web_university_collection_runtime import (
    CommandRunResult as _CommandRunResult,
)

CommandRunResult = _CommandRunResult


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run school-level official-web collection dev closeout workflows.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    preflight = subparsers.add_parser("preflight")
    preflight.add_argument("--site-id", default="muc_public")
    preflight.add_argument("--lane-id", required=True)
    preflight.add_argument("--repo-root")
    preflight.add_argument("--config-root")
    preflight.add_argument("--run-root")
    preflight.add_argument("--report-dir")

    run = subparsers.add_parser("run")
    run.add_argument("--site-id", default="muc_public")
    run.add_argument("--lane-id", required=True)
    run.add_argument("--repo-root")
    run.add_argument("--config-root")
    run.add_argument("--run-root")
    run.add_argument("--report-dir")
    run.add_argument("--run-id")
    run.add_argument("--skip-preflight", action="store_true")
    run.add_argument("--import-dry-run", action=argparse.BooleanOptionalAction, default=False)
    run.add_argument("--require-promotable", action=argparse.BooleanOptionalAction, default=True)

    compare = subparsers.add_parser("compare")
    compare.add_argument("--current-run-report-path", required=True)
    compare.add_argument("--previous-run-report-path", required=True)
    compare.add_argument("--drop-threshold-ratio", type=float, default=0.7)
    compare.add_argument("--output-path")

    alert = subparsers.add_parser("alert-summary")
    alert.add_argument("--run-report-path", required=True)
    alert.add_argument("--compare-report-path")
    alert.add_argument("--output-path")
    alert.add_argument("--drop-threshold-ratio", type=float, default=0.7)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = _build_parser().parse_args(list(argv) if argv is not None else None)
    if args.command == "preflight":
        _run_preflight_command(args)
        return
    if args.command == "run":
        _run_lane_command(args)
        return
    if args.command == "compare":
        _run_compare_command(args)
        return
    if args.command == "alert-summary":
        _run_alert_summary_command(args)
        return
    raise SystemExit(2)


def _run_preflight_command(args: argparse.Namespace) -> None:
    report = run_official_web_university_collection_preflight(
        site_id=args.site_id,
        lane_id=args.lane_id,
        repo_root=args.repo_root,
        config_root=args.config_root,
        run_root=args.run_root,
        report_dir=args.report_dir,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["status"] != "passed":
        raise SystemExit(1)


def _run_lane_command(args: argparse.Namespace) -> None:
    report = run_official_web_university_collection_lane(
        site_id=args.site_id,
        lane_id=args.lane_id,
        repo_root=args.repo_root,
        config_root=args.config_root,
        run_root=args.run_root,
        report_dir=args.report_dir,
        run_id=args.run_id,
        skip_preflight=bool(args.skip_preflight),
        import_dry_run=bool(args.import_dry_run),
        require_promotable=bool(args.require_promotable),
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["status"] != "succeeded":
        raise SystemExit(1)


def _run_compare_command(args: argparse.Namespace) -> None:
    report = compare_official_web_university_collection_runs(
        current_run_report_path=args.current_run_report_path,
        previous_run_report_path=args.previous_run_report_path,
        drop_threshold_ratio=float(args.drop_threshold_ratio),
        output_path=args.output_path,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["status"] != "succeeded":
        raise SystemExit(1)


def _run_alert_summary_command(args: argparse.Namespace) -> None:
    run_report = _read_required_json(Path(args.run_report_path).resolve(), name="run report")
    compare_report: dict[str, Any] | None = None
    if args.compare_report_path:
        compare_report = _read_required_json(
            Path(args.compare_report_path).resolve(), name="compare report"
        )
    report = build_official_web_university_collection_alert_summary(
        run_report=run_report,
        compare_report=compare_report,
        drop_threshold_ratio=float(args.drop_threshold_ratio),
    )
    if args.output_path:
        _write_json(Path(args.output_path).resolve(), report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if report["status"] != "ok":
        raise SystemExit(1)


__all__ = [
    "UNIVERSITY_COLLECTION_ALERT_SCHEMA_VERSION",
    "UNIVERSITY_COLLECTION_COMPARE_SCHEMA_VERSION",
    "UNIVERSITY_COLLECTION_PREFLIGHT_SCHEMA_VERSION",
    "UNIVERSITY_COLLECTION_RUN_SCHEMA_VERSION",
    "CommandRunResult",
    "build_official_web_university_collection_alert_summary",
    "compare_official_web_university_collection_runs",
    "main",
    "run_official_web_university_collection_lane",
    "run_official_web_university_collection_preflight",
]


if __name__ == "__main__":
    main()
