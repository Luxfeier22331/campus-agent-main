from __future__ import annotations

import argparse
import json
import os
from collections.abc import Mapping, Sequence
from pathlib import Path

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE,
    collector_run_ledger_database_url_from_env,
)
from campus_ingestion_core.collected_notice_ingest_queue_postgres import (
    build_notice_ingest_queue_store_from_env,
)
from campus_ingestion_core.verified_authenticated_notice_run_enqueue_scan import (
    build_verified_authenticated_notice_run_enqueue_scan_plan,
    execute_verified_authenticated_notice_run_enqueue_scan_plan,
    list_verified_authenticated_notice_run_enqueue_candidates,
    verified_authenticated_notice_run_enqueue_scan_to_output_files,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_OUTPUT_DIR = Path(
    "var/ingestion-evidence/authenticated-notice-ingest-queue-e2e-automation/"
    "evidence/verified-run-scheduled-enqueue"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Scan verified authenticated notice collector runs and enqueue missing ingest jobs."
    )
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--source-surface", default="notice")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--replay-batch-id", required=True)
    parser.add_argument(
        "--collector-run-ledger-table",
        default=DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE,
    )
    parser.add_argument("--execute", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    env = dict(os.environ)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    queue_store = build_notice_ingest_queue_store_from_env(env, prefer_operator=True)
    candidates = list_verified_authenticated_notice_run_enqueue_candidates(
        database_url=collector_run_ledger_database_url_from_env(env),
        table_name=args.collector_run_ledger_table,
        source_surface=args.source_surface,
        limit=args.limit,
    )
    plan = build_verified_authenticated_notice_run_enqueue_scan_plan(
        candidates=candidates,
        queue_store=queue_store,
        replay_batch_id=args.replay_batch_id,
    )
    payload: Mapping[str, object]
    if args.execute:
        payload = execute_verified_authenticated_notice_run_enqueue_scan_plan(
            plan,
            queue_store=queue_store,
        )
    else:
        payload = plan
    files = write_verified_authenticated_notice_run_enqueue_scan_evidence_files(
        payload=payload,
        output_dir=output_dir,
    )
    print(
        json.dumps(
            {
                "mode": payload["mode"],
                "write_enabled": payload["write_enabled"],
                "counts": payload["counts"],
                "files": {name: str(path) for name, path in files.items()},
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )


def write_verified_authenticated_notice_run_enqueue_scan_evidence_files(
    *,
    payload: Mapping[str, object],
    output_dir: Path,
) -> dict[str, Path]:
    written: dict[str, Path] = {}
    for filename, file_payload in verified_authenticated_notice_run_enqueue_scan_to_output_files(
        payload
    ).items():
        path = output_dir / filename
        path.write_text(
            json.dumps(file_payload, ensure_ascii=False, indent=2, sort_keys=True, default=str)
            + "\n",
            encoding="utf-8",
        )
        written[filename] = path
    return written


__all__ = [
    "DEFAULT_OUTPUT_DIR",
    "build_parser",
    "main",
    "write_verified_authenticated_notice_run_enqueue_scan_evidence_files",
]


if __name__ == "__main__":
    main()
