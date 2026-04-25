from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.internal_notice_consumption_admission import (
    build_internal_notice_consumption_admission_store_from_env,
    record_internal_notice_consumption_admission,
)
from campus_ingestion_core.internal_notice_multimodal_processing import (
    build_internal_notice_multimodal_attempt_store_from_env,
    drain_internal_notice_pending_multimodal_entries,
)
from campus_ingestion_core.internal_notice_read_model import rebuild_internal_notice_read_model
from campus_ingestion_core.notice_consumption_projection import (
    build_notice_consumption_projection_store_from_env,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.internal_notice_selection import (
    build_internal_notice_selection_provenance,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Drain internal_notice pending multimodal entries from projection truth"
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--selection-path")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--batch-size", type=int, default=20)
    parser.add_argument("--max-attempts", type=int, default=3)
    parser.add_argument("--skip-read-model-rebuild", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    selection = build_internal_notice_selection_provenance(
        explicit_notice_ids=args.notice_ids,
        selection_path=args.selection_path,
        extra_command_args={
            "limit": int(args.limit),
            "batch_size": int(args.batch_size),
            "max_attempts": int(args.max_attempts),
            "skip_read_model_rebuild": bool(args.skip_read_model_rebuild),
        },
    )
    selection_source = selection.selection_source or "projection_pending_scan"
    command_args = dict(selection.command_args)
    command_args["selection_source"] = selection_source
    projection_store = build_notice_consumption_projection_store_from_env()
    admission_store = build_internal_notice_consumption_admission_store_from_env()
    admission_created_at = utc_now()
    batch_id = record_internal_notice_consumption_admission(
        source_corpus=args.corpus,
        source_collection=args.collection,
        command="multimodal_drain",
        notice_ids=selection.notice_ids,
        status="started",
        created_at=admission_created_at,
        selection_source=selection_source,
        selection_path=selection.selection_path,
        selection_sha256=selection.selection_sha256,
        command_args=command_args,
        store=admission_store,
    )
    attempt_store = build_internal_notice_multimodal_attempt_store_from_env(prefer_operator=True)
    try:
        report = drain_internal_notice_pending_multimodal_entries(
            source_corpus=args.corpus,
            source_collection=args.collection,
            notice_ids=selection.notice_ids,
            projection_store=projection_store,
            attempt_store=attempt_store,
            max_attempts=args.max_attempts,
            limit=args.limit,
            batch_size=args.batch_size,
            admission_batch_id=batch_id,
            admission_command="multimodal_drain",
            admission_created_at=admission_created_at,
        )
        payload = asdict(report)
        if args.skip_read_model_rebuild or not report.pending_notice_ids:
            payload["read_model_rebuilt_count"] = 0
        else:
            rows = rebuild_internal_notice_read_model(
                source_corpus=args.corpus,
                source_collection=args.collection,
                notice_ids=report.pending_notice_ids,
            )
            payload["read_model_rebuilt_count"] = len(rows)
    except Exception as exc:
        record_internal_notice_consumption_admission(
            source_corpus=args.corpus,
            source_collection=args.collection,
            command="multimodal_drain",
            notice_ids=selection.notice_ids,
            status="failed",
            batch_id=batch_id,
            created_at=admission_created_at,
            error=str(exc),
            selection_source=selection_source,
            selection_path=selection.selection_path,
            selection_sha256=selection.selection_sha256,
            command_args=command_args,
            store=admission_store,
        )
        raise
    payload["batch_id"] = record_internal_notice_consumption_admission(
        source_corpus=args.corpus,
        source_collection=args.collection,
        command="multimodal_drain",
        notice_ids=report.pending_notice_ids,
        status="completed",
        batch_id=batch_id,
        created_at=admission_created_at,
        result_counts={
            "pending_entry_count": report.pending_entry_count,
            "processed_count": report.processed_count,
            "failed_count": report.failed_count,
            "read_model_rebuilt_count": int(payload["read_model_rebuilt_count"]),
        },
        selection_source=selection_source,
        selection_path=selection.selection_path,
        selection_sha256=selection.selection_sha256,
        command_args=command_args,
        store=admission_store,
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


__all__ = [
    "build_parser",
    "drain_internal_notice_pending_multimodal_entries",
    "main",
    "rebuild_internal_notice_read_model",
]


if __name__ == "__main__":
    main()
