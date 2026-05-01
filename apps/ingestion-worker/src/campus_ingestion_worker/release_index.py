from __future__ import annotations

import argparse
import json
import time
from collections.abc import Sequence
from dataclasses import asdict, is_dataclass

from campus_ingestion_core import RebuildRequest, rebuild_local_data

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.ingestion_run_telemetry import (
    build_ingestion_run_event_emitter,
    emit_ingestion_run_telemetry,
    summarize_ingestion_run_telemetry,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run a release-oriented provider-response replay indexing flow"
    )
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument("--raw-version-id", required=True)
    parser.add_argument("--raw-asset-id")
    parser.add_argument("--source-pdf")
    parser.add_argument("--reset-index", action="store_true")
    publish_group = parser.add_mutually_exclusive_group()
    publish_group.add_argument("--publish-alias", dest="publish_alias", action="store_true")
    publish_group.add_argument("--no-publish-alias", dest="publish_alias", action="store_false")
    parser.set_defaults(publish_alias=False)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    if args.publish_alias:
        raise ValueError(
            "provider_response_replay cannot publish qdrant alias; use release_registry_scope"
        )
    emit_event = build_ingestion_run_event_emitter()
    started_at = time.perf_counter()
    started_telemetry = emit_ingestion_run_telemetry(
        event_name="ingestion.run.started",
        attributes={
            "schema_version": "ingestion-run-telemetry-v1",
            "operation": "provider_response_replay_release",
            "stage": "provider_response_replay",
            "run_id": args.raw_version_id,
            "corpus": args.corpus,
            "collection": args.collection,
            "status": "started",
            "publish_alias": args.publish_alias,
            "reset_index": args.reset_index,
        },
        emit_event=emit_event,
    )
    request = RebuildRequest(
        corpus=args.corpus,
        collection=args.collection,
        import_mode="provider_response_replay",
        raw_asset_id=args.raw_asset_id,
        raw_version_id=args.raw_version_id,
        source_pdf=args.source_pdf,
        reset_qdrant=args.reset_index,
        index_qdrant=True,
        publish_qdrant_alias=args.publish_alias,
    )
    try:
        report = rebuild_local_data(request=request)
    except Exception as exc:
        emit_ingestion_run_telemetry(
            event_name="ingestion.run.failed",
            attributes={
                "schema_version": "ingestion-run-telemetry-v1",
                "operation": "provider_response_replay_release",
                "stage": "provider_response_replay",
                "run_id": args.raw_version_id,
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
    import_summary = _summarize_import_result_for_telemetry(report.import_result)
    completed_telemetry = emit_ingestion_run_telemetry(
        event_name="ingestion.run.completed",
        attributes={
            "schema_version": "ingestion-run-telemetry-v1",
            "operation": "provider_response_replay_release",
            "stage": "provider_response_replay",
            "run_id": args.raw_version_id,
            "corpus": args.corpus,
            "collection": args.collection,
            "status": str(import_summary.get("status") or "completed"),
            "duration_ms": max(0, round((time.perf_counter() - started_at) * 1000)),
            "success_count": import_summary.get("success_count"),
            "skipped_count": import_summary.get("skipped_count"),
            "failed_count": import_summary.get("failed_count"),
            "publish_alias": args.publish_alias,
            "reset_index": args.reset_index,
        },
        emit_event=emit_event,
    )
    payload["telemetry"] = summarize_ingestion_run_telemetry(
        started_telemetry,
        completed_telemetry,
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _summarize_import_result_for_telemetry(result: object) -> dict[str, object]:
    if is_dataclass(result):
        result = asdict(result)
    if isinstance(result, dict):
        return {
            key: result[key]
            for key in ("status", "success_count", "skipped_count", "failed_count")
            if key in result
        }
    return {}


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
