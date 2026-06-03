from __future__ import annotations

import argparse
import json
import os
from collections.abc import Mapping, Sequence
from pathlib import Path

from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.collected_notice_ingest_queue_memory import (
    InMemoryNoticeIngestQueueStore,
)
from campus_ingestion_core.collected_notice_ingest_queue_postgres import (
    DEFAULT_NOTICE_INGEST_QUEUE_OPERATOR_ENV_KEY,
    build_notice_ingest_queue_store_from_env,
)
from campus_ingestion_core.collected_notice_ingest_queue_store import (
    NoticeIngestQueueStore,
    notice_ingest_job_from_payload,
)
from campus_ingestion_core.collected_notice_queue_consumer import (
    DEFAULT_QUEUE_CONSUME_LIMIT,
    DEFAULT_QUEUE_CONSUME_WORKER_ID,
    CollectedNoticeQueueConsumeResult,
    CollectedNoticeQueueConsumeWriter,
    QueueConsumeObjectReader,
    consume_collected_notice_ingest_queue,
)
from campus_ingestion_core.registry import SHARED_POSTGRES_OPERATOR_ENV_KEY
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_HISTORICAL_ENQUEUE_PLAN_PATH = Path(
    "var/ingestion-evidence/collected-notice-consumption-replay-closeout/"
    "evidence/phase-04-7-historical-captured-inventory-synthetic-enqueue/"
    "historical-enqueue-plan.dry-run.json"
)
DEFAULT_PHASE_04_8_OUTPUT_DIR = Path(
    "var/ingestion-evidence/collected-notice-consumption-replay-closeout/"
    "evidence/phase-04-8-queue-consumer-reimport-path"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Consume collected notice ingest queue jobs into reimport/searchable evidence"
    )
    parser.add_argument("--execute", action="store_true", help="Complete/fail leased jobs.")
    parser.add_argument("--output-dir", default=str(DEFAULT_PHASE_04_8_OUTPUT_DIR))
    parser.add_argument("--limit", type=int, default=DEFAULT_QUEUE_CONSUME_LIMIT)
    parser.add_argument("--worker-id", default=DEFAULT_QUEUE_CONSUME_WORKER_ID)
    parser.add_argument("--lease-seconds", type=int, default=300)
    parser.add_argument("--replay-batch-id")
    parser.add_argument(
        "--historical-enqueue-plan-path",
        default=str(DEFAULT_HISTORICAL_ENQUEUE_PLAN_PATH),
        help="Dry-run seed queue plan when queue jobs have not been enqueued to PG yet.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    env = dict(os.environ)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    mode = "execute" if args.execute else "dry_run"
    queue_store = _build_queue_store(args=args, env=env)
    object_store = build_object_store_from_env(env)
    writer = build_queue_consume_writer_from_env(env) if args.execute else None
    result = consume_collected_notice_ingest_queue(
        queue_store=queue_store,
        object_store=object_store,
        mode=mode,
        worker_id=args.worker_id,
        lease_seconds=args.lease_seconds,
        limit=args.limit,
        replay_batch_id=args.replay_batch_id,
        writer=writer,
        env=env,
    )
    files = write_queue_consume_evidence_files(result=result, output_dir=output_dir)
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


def write_queue_consume_evidence_files(
    *,
    result: CollectedNoticeQueueConsumeResult,
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


def build_object_store_from_env(env: Mapping[str, str]) -> QueueConsumeObjectReader:
    return S3ObjectStoreWriter(ObjectStoreSettings.from_env(dict(env)))


def build_queue_consume_writer_from_env(
    env: Mapping[str, str],
) -> CollectedNoticeQueueConsumeWriter | None:
    del env
    return None


def build_queue_store_from_historical_enqueue_plan_path(
    plan_path: Path,
) -> InMemoryNoticeIngestQueueStore:
    payload = json.loads(Path(plan_path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("historical enqueue plan must be a JSON object")
    store = InMemoryNoticeIngestQueueStore()
    for job_payload in payload.get("jobs") or ():
        if isinstance(job_payload, Mapping):
            store.enqueue(notice_ingest_job_from_payload(job_payload))
    return store


def _build_queue_store(
    *,
    args: argparse.Namespace,
    env: dict[str, str],
) -> NoticeIngestQueueStore:
    plan_path = Path(args.historical_enqueue_plan_path)
    if not args.execute and plan_path.exists():
        return build_queue_store_from_historical_enqueue_plan_path(plan_path)
    return build_notice_ingest_queue_store_from_env(
        env,
        prefer_operator=_has_operator_database_url(env),
    )


def _has_operator_database_url(env: dict[str, str]) -> bool:
    return any(
        env.get(key)
        for key in (
            DEFAULT_NOTICE_INGEST_QUEUE_OPERATOR_ENV_KEY,
            SHARED_POSTGRES_OPERATOR_ENV_KEY,
        )
    )


__all__ = [
    "build_notice_ingest_queue_store_from_env",
    "build_object_store_from_env",
    "build_parser",
    "build_queue_consume_writer_from_env",
    "build_queue_store_from_historical_enqueue_plan_path",
    "consume_collected_notice_ingest_queue",
    "main",
    "write_queue_consume_evidence_files",
]


if __name__ == "__main__":
    main()
