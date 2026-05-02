from __future__ import annotations

import argparse
import json
import time
from collections.abc import Sequence
from dataclasses import asdict

from campus_ingestion_core import release_registry_scope

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.ingestion_run_telemetry import (
    build_ingestion_run_event_emitter,
    emit_ingestion_run_telemetry,
    summarize_ingestion_run_telemetry,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run a release-managed registry scope indexing flow"
    )
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument("--preparation-run-id")
    parser.add_argument("--acceptance-case-path")
    parser.add_argument("--release-admission-manifest-key")
    parser.add_argument("--reset-index", action="store_true")
    publish_group = parser.add_mutually_exclusive_group()
    publish_group.add_argument("--publish-alias", dest="publish_alias", action="store_true")
    publish_group.add_argument("--no-publish-alias", dest="publish_alias", action="store_false")
    parser.set_defaults(publish_alias=True)
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
            "operation": "registry_scope_release",
            "stage": "index_release",
            "run_id": args.preparation_run_id
            or f"{args.corpus}:{args.collection}:registry_scope_release",
            "preparation_run_id": args.preparation_run_id or "",
            "corpus": args.corpus,
            "collection": args.collection,
            "status": "started",
            "publish_alias": args.publish_alias,
            "reset_index": args.reset_index,
        },
        emit_event=emit_event,
    )
    try:
        report = release_registry_scope(
            corpus=args.corpus,
            collection=args.collection,
            preparation_run_id=args.preparation_run_id,
            acceptance_case_path=args.acceptance_case_path,
            release_admission_manifest_key=args.release_admission_manifest_key,
            reset_index=args.reset_index,
            publish_alias=args.publish_alias,
        )
    except Exception as exc:
        emit_ingestion_run_telemetry(
            event_name="ingestion.run.failed",
            attributes={
                "schema_version": "ingestion-run-telemetry-v1",
                "operation": "registry_scope_release",
                "stage": "index_release",
                "run_id": args.preparation_run_id
                or f"{args.corpus}:{args.collection}:registry_scope_release",
                "preparation_run_id": args.preparation_run_id or "",
                "corpus": args.corpus,
                "collection": args.collection,
                "status": "failed",
                "failure_kind": exc.__class__.__name__,
                "duration_ms": max(0, round((time.perf_counter() - started_at) * 1000)),
                "publish_alias": args.publish_alias,
                "reset_index": args.reset_index,
            },
            emit_event=emit_event,
        )
        raise
    payload = asdict(report)
    completed_telemetry = emit_ingestion_run_telemetry(
        event_name="ingestion.run.completed",
        attributes={
            "schema_version": "ingestion-run-telemetry-v1",
            "operation": "registry_scope_release",
            "stage": "index_release",
            "run_id": report.release_id,
            "release_id": report.release_id,
            "corpus": report.corpus,
            "collection": report.collection,
            "status": "completed",
            "duration_ms": max(0, round((time.perf_counter() - started_at) * 1000)),
            "document_count": report.document_count,
            "point_count": report.point_count,
            "qdrant_upsert_count": report.point_count,
            "validation_status": report.validation_status,
            "retrieval_acceptance_status": report.retrieval_acceptance_status,
            "post_publish_audit_status": report.post_publish_audit_status,
            "embedding_cache_hit_count": report.embedding_cache_hit_count,
            "embedding_cache_miss_count": report.embedding_cache_miss_count,
            "embedding_provider_call_count": report.embedding_provider_call_count,
            "embedding_call_count": report.embedding_provider_call_count,
            "publish_alias": args.publish_alias,
            "published": bool(report.published_at),
            "reset_index": args.reset_index,
        },
        emit_event=emit_event,
    )
    payload["telemetry"] = summarize_ingestion_run_telemetry(
        started_telemetry,
        completed_telemetry,
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))


__all__ = ["build_parser", "main", "release_registry_scope"]


if __name__ == "__main__":
    main()
