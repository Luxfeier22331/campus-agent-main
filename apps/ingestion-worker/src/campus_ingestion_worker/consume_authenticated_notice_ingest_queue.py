from __future__ import annotations

import argparse
import json
import os
from collections.abc import Mapping, Sequence
from pathlib import Path

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer import (
    DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_LIMIT,
    DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_WORKER_ID,
    DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_RETRY_AFTER_SECONDS,
    AuthenticatedNoticeRunQueueConsumeResult,
    consume_authenticated_notice_ingest_queue,
)
from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.collected_notice_ingest_queue_postgres import (
    DEFAULT_NOTICE_INGEST_QUEUE_OPERATOR_ENV_KEY,
    build_notice_ingest_queue_store_from_env,
)
from campus_ingestion_core.registry import SHARED_POSTGRES_OPERATOR_ENV_KEY
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.authenticated_notice_processing_projection_reporting import (
    build_processing_projection_reporter_from_env,
    build_run_processing_projection_reporter_from_env,
)
from campus_ingestion_worker.authenticated_notice_typed_downstream_materialization import (
    materialize_authenticated_notice_typed_downstream,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_OUTPUT_DIR = Path(
    ".planning/workstreams/authenticated-notice-ingest-queue-e2e-automation/"
    "evidence/phase-04-run-level-queue-consumer"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Consume authenticated notice run-level ingest queue jobs"
    )
    parser.add_argument("--execute", action="store_true", help="Complete/fail leased jobs.")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument(
        "--limit", type=int, default=DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_LIMIT
    )
    parser.add_argument(
        "--worker-id", default=DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_WORKER_ID
    )
    parser.add_argument("--lease-seconds", type=int, default=300)
    parser.add_argument(
        "--retry-after-seconds",
        type=int,
        default=DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_RETRY_AFTER_SECONDS,
    )
    parser.add_argument("--replay-batch-id")
    parser.add_argument("--run-id")
    parser.add_argument("--site-id", required=True)
    parser.add_argument("--source-home-url", required=True)
    parser.add_argument("--source-surface", default="notice")
    parser.add_argument(
        "--collector-run-ledger-table",
        default=DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE,
    )
    parser.add_argument("--consumer-admission-manifest-path")
    parser.add_argument(
        "--operations-dir",
        help=(
            "Consumer-owned operations directory. Defaults to <output-dir>/operations; "
            "debug-only media gate overrides may still use --media-gate-evidence-dir."
        ),
    )
    parser.add_argument(
        "--require-media-gate",
        action="store_true",
        help="Require consumer-owned strict media gate evidence before queue completion.",
    )
    parser.add_argument("--media-gate-evidence-dir")
    parser.add_argument("--cleanup-report-path")
    parser.add_argument(
        "--enable-destructive-cleanup",
        action="store_true",
        help="Allow destructive cleanup only when fresh passed media gate evidence is present.",
    )
    parser.add_argument(
        "--materialize-downstream",
        action="store_true",
        help=(
            "Allow downstream projection/read-model materialization. The default is "
            "source-truth-only; Phase 6 owns downstream automation."
        ),
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    env = dict(os.environ)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    operations_dir = Path(args.operations_dir) if args.operations_dir else output_dir / "operations"
    mode = "execute" if args.execute else "dry_run"
    queue_store = build_notice_ingest_queue_store_from_env(
        env,
        prefer_operator=_has_operator_database_url(env),
    )
    object_store = build_object_store_from_env(env)
    result = consume_authenticated_notice_ingest_queue(
        queue_store=queue_store,
        object_store=object_store,
        mode=mode,
        worker_id=args.worker_id,
        lease_seconds=args.lease_seconds,
        limit=args.limit,
        replay_batch_id=args.replay_batch_id,
        run_id=args.run_id,
        site_id=args.site_id,
        source_home_url=args.source_home_url,
        source_surface=args.source_surface,
        collector_run_ledger_table=args.collector_run_ledger_table,
        env=env,
        retry_after_seconds=args.retry_after_seconds,
        source_truth_only=not args.materialize_downstream,
        typed_downstream_materializer=materialize_authenticated_notice_typed_downstream,
        processing_projection_reporter=build_processing_projection_reporter_from_env(env),
        run_processing_projection_reporter=build_run_processing_projection_reporter_from_env(env),
        require_media_gate=args.require_media_gate,
        media_gate_evidence_dir=(
            Path(args.media_gate_evidence_dir) if args.media_gate_evidence_dir else None
        ),
        operations_dir=operations_dir,
        cleanup_report_path=(Path(args.cleanup_report_path) if args.cleanup_report_path else None),
        destructive_cleanup_enabled=args.enable_destructive_cleanup,
        consumer_admission_manifest_path=(
            Path(args.consumer_admission_manifest_path)
            if args.consumer_admission_manifest_path
            else None
        ),
    )
    files = write_authenticated_notice_run_queue_consume_evidence_files(
        result=result,
        output_dir=output_dir,
    )
    print(
        json.dumps(
            {
                "mode": mode,
                "write_enabled": args.execute,
                "output_dir": str(output_dir),
                "files": {name: str(path) for name, path in files.items()},
                "counts": result.queue_consume.get("counts", {}),
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )


def write_authenticated_notice_run_queue_consume_evidence_files(
    *,
    result: AuthenticatedNoticeRunQueueConsumeResult,
    output_dir: Path,
) -> dict[str, Path]:
    written: dict[str, Path] = {}
    for filename, payload in result.to_output_files().items():
        path = output_dir / filename
        path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        written[filename] = path
    return written


def build_object_store_from_env(env: Mapping[str, str]) -> S3ObjectStoreWriter:
    return S3ObjectStoreWriter(ObjectStoreSettings.from_env(dict(env)))


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
    "build_object_store_from_env",
    "build_parser",
    "consume_authenticated_notice_ingest_queue",
    "main",
    "write_authenticated_notice_run_queue_consume_evidence_files",
]


if __name__ == "__main__":
    main()
