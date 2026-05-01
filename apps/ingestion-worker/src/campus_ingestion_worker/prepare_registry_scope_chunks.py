from __future__ import annotations

import argparse
import json
import time
from collections.abc import Sequence
from dataclasses import asdict

from campus_ingestion_core import prepare_registry_scope_chunks

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.ingestion_run_telemetry import (
    build_ingestion_run_event_emitter,
    emit_ingestion_run_telemetry,
    summarize_ingestion_run_telemetry,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Prepare and validate registry scope chunks without embeddings or indexing"
    )
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument("--preparation-run-id", required=True)
    parser.add_argument("--closeout-run-id")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    emit_event = build_ingestion_run_event_emitter()
    started_at = time.perf_counter()
    started_telemetry = emit_ingestion_run_telemetry(
        event_name="ingestion.run.started",
        attributes={
            "schema_version": "ingestion-run-telemetry-v1",
            "operation": "registry_scope_chunk_preparation",
            "stage": "chunking",
            "run_id": args.preparation_run_id,
            "preparation_run_id": args.preparation_run_id,
            "corpus": args.corpus,
            "collection": args.collection,
            "status": "started",
        },
        emit_event=emit_event,
    )
    try:
        report = prepare_registry_scope_chunks(
            corpus=args.corpus,
            collection=args.collection,
            preparation_run_id=args.preparation_run_id,
            closeout_run_id=args.closeout_run_id,
        )
    except Exception as exc:
        emit_ingestion_run_telemetry(
            event_name="ingestion.run.failed",
            attributes={
                "schema_version": "ingestion-run-telemetry-v1",
                "operation": "registry_scope_chunk_preparation",
                "stage": "chunking",
                "run_id": args.preparation_run_id,
                "preparation_run_id": args.preparation_run_id,
                "corpus": args.corpus,
                "collection": args.collection,
                "status": "failed",
                "failure_kind": exc.__class__.__name__,
                "duration_ms": max(0, round((time.perf_counter() - started_at) * 1000)),
            },
            emit_event=emit_event,
        )
        raise
    payload = asdict(report)
    completed_telemetry = emit_ingestion_run_telemetry(
        event_name="ingestion.run.completed",
        attributes={
            "schema_version": "ingestion-run-telemetry-v1",
            "operation": "registry_scope_chunk_preparation",
            "stage": "chunking",
            "run_id": report.preparation_run_id,
            "preparation_run_id": report.preparation_run_id,
            "corpus": report.corpus,
            "collection": report.collection,
            "status": "completed",
            "duration_ms": max(0, round((time.perf_counter() - started_at) * 1000)),
            "document_count": report.document_count,
            "chunk_count": report.chunk_count,
            "validation_status": report.validation_status,
            "selection_mode": report.selection_mode,
        },
        emit_event=emit_event,
    )
    payload["telemetry"] = summarize_ingestion_run_telemetry(
        started_telemetry,
        completed_telemetry,
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))


__all__ = ["build_parser", "main", "prepare_registry_scope_chunks"]


if __name__ == "__main__":
    main()
