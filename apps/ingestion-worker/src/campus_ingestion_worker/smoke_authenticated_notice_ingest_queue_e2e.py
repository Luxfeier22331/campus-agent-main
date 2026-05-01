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
from campus_ingestion_core.authenticated_notice_processor_profiles import (
    select_processor_profile,
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
    parser.add_argument("--lease-seconds", type=int, default=300)
    parser.add_argument("--require-media-gate", action="store_true")
    parser.add_argument("--media-gate-evidence-dir")
    parser.add_argument("--cleanup-report-path")
    parser.add_argument("--materialize-downstream", action="store_true")
    parser.add_argument(
        "--require-child-task-contract",
        action="store_true",
        help="Fail smoke on medium-or-higher child task contract findings.",
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
    child_task_contract = _child_task_contract_summary(
        sample_id=str(args.sample_id or ""),
        source_surface=args.source_surface,
        require_child_task_contract=args.require_child_task_contract,
    )
    findings.extend(child_task_contract["findings"])
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
            lease_seconds=args.lease_seconds,
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
        _write_consume_evidence_files(consume_result, output_dir=operations_dir)
        consume_summary = consume_result.queue_consume
        counts = consume_summary.get("counts", {})
        if int(counts.get("failed_count", 0)) > 0:
            findings.append(
                {
                    "severity": "high",
                    "code": "queue_consume_failed",
                    "message": "authenticated notice queue consume reported failures",
                }
            )
        if (
            int(counts.get("completed_count", 0)) == 0
            and int(counts.get("imported_count", 0)) == 0
            and int(counts.get("leased_count", 0)) == 0
            and int(counts.get("failed_count", 0)) == 0
        ):
            findings.append(
                {
                    "severity": "high",
                    "code": "queue_consume_no_progress",
                    "message": (
                        "authenticated notice execute smoke made no queue progress; "
                        "verify the run_id is not already completed or filtered out"
                    ),
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
            "child_task_contract",
        ],
        "enqueue_plan": enqueue_plan,
        "queue_write_summary": dict(queue_write_summary or {}),
        "consume_summary": dict(consume_summary or {}),
        "child_task_contract": child_task_contract,
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


def _write_consume_evidence_files(
    consume_result: Any,
    *,
    output_dir: Path,
) -> dict[str, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    written: dict[str, Path] = {}
    for filename, file_payload in consume_result.to_output_files().items():
        file_path = output_dir / filename
        file_path.write_text(
            json.dumps(file_payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        written[filename] = file_path
    return written


def _child_task_contract_summary(
    *,
    sample_id: str,
    source_surface: str,
    require_child_task_contract: bool,
) -> dict[str, Any]:
    if not require_child_task_contract:
        return {
            "required": False,
            "verdict": "skipped",
            "processor_profile": {},
            "findings": [],
        }
    profile = select_processor_profile(
        source_surface=source_surface,
        sample_id=sample_id,
        target_family="transport_schedule",
        media_roles=["schedule_table_carrier"] if sample_id == "355867" else [],
        title="关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知"
        if sample_id == "355867"
        else "",
    )
    findings: list[dict[str, Any]] = []
    if sample_id == "355867" and profile["processor_order"][0] != "ocr_table_extraction":
        findings.append(
            {
                "severity": "high",
                "code": "schedule_image_not_ocr_first",
                "message": "notice 355867 must select OCR/table extraction before multimodal",
            }
        )
    if profile.get("multimodal_policy") != "explicit_escalation_only":
        findings.append(
            {
                "severity": "medium",
                "code": "multimodal_not_explicit_escalation",
                "message": "generic multimodal must be an explicit escalation lane",
            }
        )
    return {
        "required": True,
        "verdict": "passed"
        if not any(item.get("severity") in {"medium", "high"} for item in findings)
        else "failed",
        "processor_profile": profile,
        "findings": findings,
    }


__all__ = ["SMOKE_SCHEMA_VERSION", "build_parser", "main"]


if __name__ == "__main__":
    main()
