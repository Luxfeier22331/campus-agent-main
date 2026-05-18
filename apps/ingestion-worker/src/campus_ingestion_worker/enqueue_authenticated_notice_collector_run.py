from __future__ import annotations

import argparse
import json
import os
from collections.abc import Mapping, Sequence
from pathlib import Path

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    resolve_authenticated_notice_collector_run_refs,
)
from campus_ingestion_core.authenticated_notice_run_enqueue import (
    DEFAULT_AUTHENTICATED_NOTICE_RUN_REPLAY_BATCH_ID,
    authenticated_notice_run_enqueue_to_output_files,
    build_authenticated_notice_run_enqueue_plan,
    execute_authenticated_notice_run_enqueue_plan,
)
from campus_ingestion_core.collected_notice_ingest_queue_postgres import (
    DEFAULT_NOTICE_INGEST_QUEUE_OPERATOR_ENV_KEY,
    build_notice_ingest_queue_store_from_env,
)
from campus_ingestion_core.registry import SHARED_POSTGRES_OPERATOR_ENV_KEY

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_OUTPUT_DIR = Path(
    ".planning/workstreams/authenticated-notice-ingest-queue-e2e-automation/"
    "evidence/phase-02-manual-run-enqueue"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Create or execute an authenticated notice run-level ingest queue job"
    )
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--site-id", required=True)
    parser.add_argument("--source-surface", default="notice")
    parser.add_argument("--collector-run-ledger-table")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument(
        "--replay-batch-id", default=DEFAULT_AUTHENTICATED_NOTICE_RUN_REPLAY_BATCH_ID
    )
    parser.add_argument("--priority", type=int, default=100)
    parser.add_argument(
        "--enqueue-source",
        default="manual_replay",
        choices=("historical_backfill", "live_discovery", "manual_replay"),
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Write the queue job. Dry-run is the default.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    env = dict(os.environ)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    run_refs = resolve_authenticated_notice_collector_run_refs(
        env=env,
        run_id=args.run_id,
        expected_source_surface=args.source_surface,
        table_name=(
            args.collector_run_ledger_table
            if args.collector_run_ledger_table
            else "ingestion_projection.authenticated_notice_collector_run"
        ),
    )
    plan = build_authenticated_notice_run_enqueue_plan(
        run_refs=run_refs,
        site_id=args.site_id,
        enqueue_source=args.enqueue_source,
        replay_batch_id=args.replay_batch_id,
        priority=args.priority,
    )
    payload: Mapping[str, object]
    if args.execute:
        store = build_notice_ingest_queue_store_from_env(
            env,
            prefer_operator=_has_operator_database_url(env),
        )
        payload = execute_authenticated_notice_run_enqueue_plan(plan, queue_store=store)
    else:
        payload = plan
    files = write_authenticated_notice_run_enqueue_evidence_files(
        payload=payload,
        output_dir=output_dir,
    )
    summary = {
        "mode": payload["mode"],
        "write_enabled": payload["write_enabled"],
        "output_dir": str(output_dir),
        "files": {name: str(path) for name, path in files.items()},
        "counts": payload["counts"],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))


def write_authenticated_notice_run_enqueue_evidence_files(
    *,
    payload: Mapping[str, object],
    output_dir: Path,
) -> dict[str, Path]:
    written: dict[str, Path] = {}
    for filename, file_payload in authenticated_notice_run_enqueue_to_output_files(payload).items():
        file_path = output_dir / filename
        file_path.write_text(
            json.dumps(file_payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        written[filename] = file_path
    return written


def _has_operator_database_url(env: dict[str, str]) -> bool:
    return any(
        env.get(key)
        for key in (
            DEFAULT_NOTICE_INGEST_QUEUE_OPERATOR_ENV_KEY,
            SHARED_POSTGRES_OPERATOR_ENV_KEY,
        )
    )


__all__ = [
    "DEFAULT_OUTPUT_DIR",
    "build_notice_ingest_queue_store_from_env",
    "build_parser",
    "main",
    "resolve_authenticated_notice_collector_run_refs",
    "write_authenticated_notice_run_enqueue_evidence_files",
]


if __name__ == "__main__":
    main()
