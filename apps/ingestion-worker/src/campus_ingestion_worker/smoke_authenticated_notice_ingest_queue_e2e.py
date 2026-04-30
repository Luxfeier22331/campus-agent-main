from __future__ import annotations

import argparse
import json
import os
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    resolve_authenticated_notice_collector_run_refs,
)
from campus_ingestion_core.authenticated_notice_run_enqueue import (
    build_authenticated_notice_run_enqueue_plan,
    execute_authenticated_notice_run_enqueue_plan,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer import (
    consume_authenticated_notice_ingest_queue,
)
from campus_ingestion_core.collected_notice_ingest_queue_postgres import (
    build_notice_ingest_queue_store_from_env,
)

from campus_ingestion_worker.consume_authenticated_notice_ingest_queue import (
    build_object_store_from_env,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env

SMOKE_SCHEMA_VERSION = "authenticated_notice_ingest_queue_e2e_smoke.v1"
DEFAULT_OUTPUT_DIR = Path(
    ".planning/workstreams/authenticated-notice-ingest-queue-e2e-automation/"
    "evidence/phase-08-captured-content-e2e-smoke"
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Smoke authenticated notice collector -> ingest queue -> consumer path."
    )
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--site-id", required=True)
    parser.add_argument("--source-home-url", required=True)
    parser.add_argument("--source-surface", default="notice")
    parser.add_argument("--sample-id")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--operations-dir")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--require-media-gate", action="store_true")
    parser.add_argument("--media-gate-evidence-dir")
    parser.add_argument("--cleanup-report-path")
    parser.add_argument("--materialize-downstream", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    env = dict(os.environ)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    operations_dir = Path(args.operations_dir) if args.operations_dir else output_dir / "operations"
    mode = "execute" if args.execute else "dry_run"
    run_refs = resolve_authenticated_notice_collector_run_refs(
        env=env,
        run_id=args.run_id,
        expected_source_surface=args.source_surface,
    )
    enqueue_plan = build_authenticated_notice_run_enqueue_plan(
        run_refs=run_refs,
        site_id=args.site_id,
        enqueue_source="manual_replay",
        replay_batch_id=f"authenticated-notice-smoke:{args.run_id}",
        generated_by="campus_ingestion_worker.smoke_authenticated_notice_ingest_queue_e2e",
        provenance={
            "smoke": True,
            "sample_id": str(args.sample_id or ""),
            "source": "captured_content",
        },
    )
    consume_summary: Mapping[str, Any] | None = None
    queue_write_summary: Mapping[str, Any] | None = None
    findings: list[dict[str, Any]] = []
    if args.execute:
        queue_store = build_notice_ingest_queue_store_from_env(env, prefer_operator=True)
        queue_write_summary = execute_authenticated_notice_run_enqueue_plan(
            enqueue_plan,
            queue_store=queue_store,
        )
        consume_result = consume_authenticated_notice_ingest_queue(
            queue_store=queue_store,
            object_store=build_object_store_from_env(env),
            mode="execute",
            run_id=args.run_id,
            site_id=args.site_id,
            source_home_url=args.source_home_url,
            source_surface=args.source_surface,
            env=env,
            require_media_gate=args.require_media_gate,
            media_gate_evidence_dir=(
                Path(args.media_gate_evidence_dir) if args.media_gate_evidence_dir else None
            ),
            operations_dir=operations_dir,
            cleanup_report_path=(
                Path(args.cleanup_report_path) if args.cleanup_report_path else None
            ),
            source_truth_only=not args.materialize_downstream,
        )
        consume_summary = consume_result.queue_consume
        if int(consume_summary.get("counts", {}).get("failed_count", 0)) > 0:
            findings.append(
                {
                    "severity": "high",
                    "code": "queue_consume_failed",
                    "message": "authenticated notice queue consume reported failures",
                }
            )
    report = {
        "schema_version": SMOKE_SCHEMA_VERSION,
        "mode": mode,
        "write_enabled": args.execute,
        "run_id": args.run_id,
        "sample_id": str(args.sample_id or ""),
        "site_id": args.site_id,
        "source_surface": args.source_surface,
        "planned_path": [
            "collector_verified_run_ledger",
            "ingest_queue_enqueue",
            "ingest_queue_consume",
            "source_truth_import",
            "media_gate",
            "downstream_materialization",
            "cleanup_guard",
        ],
        "enqueue_plan": enqueue_plan,
        "queue_write_summary": dict(queue_write_summary or {}),
        "consume_summary": dict(consume_summary or {}),
        "findings": findings,
        "medium_or_higher_finding_count": sum(
            1 for item in findings if item.get("severity") in {"medium", "high"}
        ),
        "verdict": "passed"
        if not any(item.get("severity") in {"medium", "high"} for item in findings)
        else "failed",
    }
    output_path = output_dir / "authenticated-notice-ingest-queue-e2e-smoke.json"
    output_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "mode": report["mode"],
                "write_enabled": report["write_enabled"],
                "run_id": report["run_id"],
                "sample_id": report["sample_id"],
                "output_path": str(output_path),
                "verdict": report["verdict"],
                "medium_or_higher_finding_count": report["medium_or_higher_finding_count"],
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
    )


__all__ = ["SMOKE_SCHEMA_VERSION", "build_parser", "main"]


if __name__ == "__main__":
    main()
