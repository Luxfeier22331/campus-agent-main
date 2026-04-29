from __future__ import annotations

import argparse
import json
import os
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.collected_notice_consumption_reset import (
    execute_collected_notice_reset,
    generate_collected_notice_post_reset_audit,
    generate_collected_notice_reset_backup,
    generate_collected_notice_reset_dry_run_report,
    resolve_collected_notice_reset_database_url,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Reset collected notice consumption state to captured-but-not-imported."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    dry_run = subparsers.add_parser("dry-run", help="Write reset dry-run report.")
    dry_run.add_argument("--output", required=True)
    dry_run.add_argument("--input-ref", action="append", default=[])

    backup = subparsers.add_parser("backup", help="Write backup artifact for a dry-run report.")
    backup.add_argument("--dry-run-report", required=True)
    backup.add_argument("--output", required=True)

    execute = subparsers.add_parser("execute", help="Execute reset after dry-run and backup.")
    execute.add_argument("--dry-run-report", required=True)
    execute.add_argument("--backup-report", required=True)
    execute.add_argument("--output", required=True)
    execute.add_argument("--yes", action="store_true")

    audit = subparsers.add_parser("audit", help="Write post-reset audit report.")
    audit.add_argument("--execute-report")
    audit.add_argument("--output", required=True)

    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)

    database_url = resolve_collected_notice_reset_database_url(os.environ)
    if args.command == "dry-run":
        report = generate_collected_notice_reset_dry_run_report(
            database_url=database_url,
            input_refs=tuple(str(item) for item in args.input_ref),
        )
        _write_json(Path(args.output), report)
        return

    if args.command == "backup":
        dry_run_report = _read_json(Path(args.dry_run_report))
        report = generate_collected_notice_reset_backup(
            database_url=database_url,
            dry_run_report=dry_run_report,
        )
        _write_json(Path(args.output), report)
        return

    if args.command == "execute":
        if not args.yes:
            parser.error("pass --yes to execute reset")
        dry_run_report = _read_json(Path(args.dry_run_report))
        backup_report = _read_json(Path(args.backup_report))
        report = execute_collected_notice_reset(
            database_url=database_url,
            dry_run_report=dry_run_report,
            backup_report=backup_report,
        )
        _write_json(Path(args.output), report)
        return

    if args.command == "audit":
        execute_report = _read_json(Path(args.execute_report)) if args.execute_report else None
        report = generate_collected_notice_post_reset_audit(
            database_url=database_url,
            execute_report=execute_report,
        )
        _write_json(Path(args.output), report)
        return

    raise ValueError(f"unsupported command: {args.command}")


def _read_json(path: Path) -> Mapping[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True, default=str) + "\n",
        encoding="utf-8",
    )


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
