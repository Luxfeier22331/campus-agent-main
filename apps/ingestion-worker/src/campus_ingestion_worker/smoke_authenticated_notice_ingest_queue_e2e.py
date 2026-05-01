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

from campus_ingestion_worker.authenticated_notice_processing_projection_reporting import (
    build_processing_projection_reporter_from_env,
)
from campus_ingestion_worker.authenticated_notice_typed_downstream_materialization import (
    materialize_authenticated_notice_typed_downstream,
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
        "--require-downstream-materialization",
        action="store_true",
        help="Fail smoke unless downstream projection/read-model materialization completes.",
    )
    parser.add_argument(
        "--require-processing-projection",
        action="store_true",
        help="Fail smoke unless the consumer reports app-api authenticated notice projection.",
    )
    parser.add_argument("--expected-notice-id")
    parser.add_argument("--expected-candidate-kind")
    parser.add_argument("--expected-target-surface")
    parser.add_argument(
        "--expected-read-model-count",
        action="append",
        default=[],
        help="Expected read-model count in key=value form, for example scheduledDepartures=49.",
    )
    parser.add_argument("--consumer-admission-manifest-path")
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
    post_run_audit: Mapping[str, Any] | None = None
    findings: list[dict[str, Any]] = []
    child_task_contract = _child_task_contract_summary(
        sample_id=str(args.sample_id or ""),
        source_surface=args.source_surface,
        require_child_task_contract=args.require_child_task_contract,
    )
    findings.extend(child_task_contract["findings"])
    if args.execute:
        processing_projection_reporter = build_processing_projection_reporter_from_env(env)
        if args.require_processing_projection and processing_projection_reporter is None:
            findings.append(
                {
                    "severity": "high",
                    "code": "app_api_projection_callback_missing",
                    "message": (
                        "INGESTION_WORKER_APP_API_BASE_URL and "
                        "INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET are required "
                        "when --require-processing-projection is set"
                    ),
                }
            )
            report = _build_report(
                args=args,
                mode=mode,
                enqueue_plan=enqueue_plan,
                queue_write_summary=queue_write_summary,
                consume_summary=consume_summary,
                post_run_audit=post_run_audit,
                child_task_contract=child_task_contract,
                findings=findings,
            )
            _write_report(report, output_dir=output_dir)
            return
        queue_store = build_notice_ingest_queue_store_from_env(env, prefer_operator=True)
        materialize_downstream = (
            args.materialize_downstream or args.require_downstream_materialization
        )
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
            processing_projection_reporter=processing_projection_reporter,
            typed_downstream_materializer=materialize_authenticated_notice_typed_downstream,
            media_gate_evidence_dir=(
                Path(args.media_gate_evidence_dir) if args.media_gate_evidence_dir else None
            ),
            operations_dir=operations_dir,
            cleanup_report_path=(
                Path(args.cleanup_report_path) if args.cleanup_report_path else None
            ),
            source_truth_only=not materialize_downstream,
            consumer_admission_manifest_path=(
                Path(args.consumer_admission_manifest_path)
                if args.consumer_admission_manifest_path
                else None
            ),
        )
        consume_files = _write_consume_evidence_files(consume_result, output_dir=operations_dir)
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
        post_run_audit = _post_run_audit(
            queue_store=queue_store,
            queue_write_summary=queue_write_summary,
            consume_result=consume_result,
            consume_files=consume_files,
            require_downstream_materialization=args.require_downstream_materialization,
            require_processing_projection=args.require_processing_projection,
            expected_notice_id=args.expected_notice_id,
            expected_candidate_kind=args.expected_candidate_kind,
            expected_target_surface=args.expected_target_surface,
            expected_read_model_counts=_parse_expected_read_model_counts(
                args.expected_read_model_count
            ),
        )
        findings.extend(post_run_audit["findings"])
    report = _build_report(
        args=args,
        mode=mode,
        enqueue_plan=enqueue_plan,
        queue_write_summary=queue_write_summary,
        consume_summary=consume_summary,
        post_run_audit=post_run_audit,
        child_task_contract=child_task_contract,
        findings=findings,
    )
    _write_report(report, output_dir=output_dir)


def _build_report(
    *,
    args: Any,
    mode: str,
    enqueue_plan: Mapping[str, Any],
    queue_write_summary: Mapping[str, Any] | None,
    consume_summary: Mapping[str, Any] | None,
    post_run_audit: Mapping[str, Any] | None,
    child_task_contract: Mapping[str, Any],
    findings: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    medium_or_higher_count = sum(
        1 for item in findings if item.get("severity") in {"medium", "high"}
    )
    return {
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
        "post_run_audit": dict(post_run_audit or {}),
        "child_task_contract": child_task_contract,
        "findings": [dict(finding) for finding in findings],
        "medium_or_higher_finding_count": medium_or_higher_count,
        "verdict": _verdict(findings),
    }


def _write_report(report: Mapping[str, Any], *, output_dir: Path) -> None:
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


def _post_run_audit(
    *,
    queue_store: Any,
    queue_write_summary: Mapping[str, Any],
    consume_result: Any,
    consume_files: Mapping[str, Path],
    require_downstream_materialization: bool,
    require_processing_projection: bool = False,
    expected_notice_id: str | None = None,
    expected_candidate_kind: str | None = None,
    expected_target_surface: str | None = None,
    expected_read_model_counts: Mapping[str, int] | None = None,
) -> dict[str, Any]:
    findings: list[dict[str, Any]] = []
    queue_jobs = []
    for item in queue_write_summary.get("enqueued_jobs") or ():
        if not isinstance(item, Mapping):
            continue
        job_id = str(item.get("job_id") or "")
        if not job_id:
            continue
        record = queue_store.get(job_id)
        summary = _queue_record_summary(record, job_id=job_id)
        queue_jobs.append(summary)
        if summary.get("status") != "succeeded":
            findings.append(
                {
                    "severity": "high",
                    "code": "post_run_queue_not_succeeded",
                    "message": f"post-run queue job {job_id} is not succeeded",
                }
            )
    trace = consume_result.trace if isinstance(consume_result.trace, Mapping) else {}
    trace_rows = trace.get("trace_rows") if isinstance(trace.get("trace_rows"), list) else []
    first_trace_row = trace_rows[0] if trace_rows and isinstance(trace_rows[0], Mapping) else {}
    first_heartbeat = (
        first_trace_row.get("lease_heartbeat")
        if isinstance(first_trace_row.get("lease_heartbeat"), Mapping)
        else {}
    )
    if first_heartbeat.get("heartbeat_failed") is True:
        findings.append(
            {
                "severity": "high",
                "code": "post_run_lease_heartbeat_failed",
                "message": "consumer trace reported a failed queue lease heartbeat",
            }
        )
    downstream_materialization = (
        first_trace_row.get("downstream_materialization")
        if isinstance(first_trace_row.get("downstream_materialization"), Mapping)
        else {}
    )
    if (
        require_downstream_materialization
        and downstream_materialization.get("status") != "completed"
    ):
        findings.append(
            {
                "severity": "high",
                "code": "downstream_materialization_missing",
                "message": "downstream materialization acceptance lane did not complete",
            }
        )
    processing_projection_report = (
        first_trace_row.get("processing_projection_report")
        if isinstance(first_trace_row.get("processing_projection_report"), Mapping)
        else {}
    )
    if require_processing_projection and processing_projection_report.get("status") != "reported":
        findings.append(
            {
                "severity": "high",
                "code": "processing_projection_not_reported",
                "message": "consumer did not report authenticated notice processing projection",
            }
        )
    expected_notice = _expected_notice_summary(
        downstream_materialization=downstream_materialization,
        expected_notice_id=expected_notice_id,
        expected_candidate_kind=expected_candidate_kind,
        expected_target_surface=expected_target_surface,
        expected_read_model_counts=expected_read_model_counts or {},
    )
    findings.extend(expected_notice["findings"])
    evidence_files = {
        filename: {"path": str(path), "exists": path.exists()}
        for filename, path in consume_files.items()
    }
    for filename, file_summary in evidence_files.items():
        if not file_summary["exists"]:
            findings.append(
                {
                    "severity": "high",
                    "code": "post_run_evidence_file_missing",
                    "message": f"consumer evidence file was not written: {filename}",
                }
            )
    return {
        "queue_jobs": queue_jobs,
        "trace": {
            "trace_row_count": len(trace_rows),
            "first_status": first_trace_row.get("status"),
            "first_import_result": first_trace_row.get("import_result", {}),
            "first_lease_heartbeat": first_heartbeat,
        },
        "downstream_materialization": downstream_materialization,
        "processing_projection_report": processing_projection_report,
        "expected_notice": expected_notice,
        "evidence_files": evidence_files,
        "findings": findings,
    }


def _expected_notice_summary(
    *,
    downstream_materialization: Mapping[str, Any],
    expected_notice_id: str | None,
    expected_candidate_kind: str | None,
    expected_target_surface: str | None,
    expected_read_model_counts: Mapping[str, int],
) -> dict[str, Any]:
    normalized_notice_id = str(expected_notice_id or "").strip()
    if not normalized_notice_id:
        return {"verdict": "skipped", "findings": []}
    typed = (
        downstream_materialization.get("typed_materialization")
        if isinstance(downstream_materialization.get("typed_materialization"), Mapping)
        else {}
    )
    releases = typed.get("materialized_releases") if isinstance(typed, Mapping) else ()
    release = _release_for_notice(releases, normalized_notice_id)
    findings: list[dict[str, Any]] = []
    if not release:
        findings.append(
            {
                "severity": "high",
                "code": "expected_notice_not_materialized",
                "message": f"expected notice {normalized_notice_id} was not materialized downstream",
            }
        )
        return {"verdict": "failed", "notice_id": normalized_notice_id, "findings": findings}
    candidate_kind = str(release.get("candidate_kind") or release.get("candidateKind") or "")
    target_surface = _target_surface(candidate_kind)
    counts_by_notice = (
        release.get("notice_read_model_counts") or release.get("noticeReadModelCounts") or {}
    )
    counts = (
        counts_by_notice.get(normalized_notice_id) if isinstance(counts_by_notice, Mapping) else {}
    )
    counts = counts if isinstance(counts, Mapping) else {}
    if expected_candidate_kind and candidate_kind != expected_candidate_kind:
        findings.append(
            {
                "severity": "high",
                "code": "expected_candidate_kind_mismatch",
                "message": (
                    f"expected {expected_candidate_kind}, observed {candidate_kind or 'unknown'}"
                ),
            }
        )
    if expected_target_surface and target_surface != expected_target_surface:
        findings.append(
            {
                "severity": "high",
                "code": "expected_target_surface_mismatch",
                "message": (
                    f"expected {expected_target_surface}, observed {target_surface or 'unknown'}"
                ),
            }
        )
    for key, expected_value in expected_read_model_counts.items():
        observed_value = int(counts.get(key) or 0)
        if observed_value != expected_value:
            findings.append(
                {
                    "severity": "high",
                    "code": "expected_read_model_count_mismatch",
                    "message": f"expected {key}={expected_value}, observed {observed_value}",
                }
            )
    return {
        "verdict": "passed"
        if not any(item.get("severity") in {"medium", "high"} for item in findings)
        else "failed",
        "notice_id": normalized_notice_id,
        "candidate_kind": candidate_kind or None,
        "target_surface": target_surface,
        "read_model_counts": dict(counts),
        "findings": findings,
    }


def _release_for_notice(value: object, notice_id: str) -> Mapping[str, Any]:
    if not isinstance(value, Sequence) or isinstance(value, str | bytes):
        return {}
    for item in value:
        if not isinstance(item, Mapping):
            continue
        notice_ids = item.get("notice_ids") or item.get("noticeIds") or ()
        if (
            isinstance(notice_ids, Sequence)
            and not isinstance(notice_ids, str | bytes)
            and notice_id in {str(candidate) for candidate in notice_ids}
        ):
            return item
    return {}


def _parse_expected_read_model_counts(values: Sequence[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        key, separator, raw_count = str(value).partition("=")
        if not separator or not key.strip():
            raise ValueError("--expected-read-model-count must use key=value form")
        counts[key.strip()] = int(raw_count)
    return counts


def _target_surface(candidate_kind: str) -> str | None:
    if candidate_kind in {"transport_schedule", "service_status"}:
        return "campus_services"
    return None


def _verdict(findings: Sequence[Mapping[str, Any]]) -> str:
    medium_or_higher = [item for item in findings if item.get("severity") in {"medium", "high"}]
    if not medium_or_higher:
        return "passed"
    if any(item.get("code") == "app_api_projection_callback_missing" for item in medium_or_higher):
        return "blocked"
    return "failed"


def _queue_record_summary(record: Any, *, job_id: str) -> dict[str, Any]:
    if record is None:
        return {
            "job_id": job_id,
            "status": "missing",
        }
    return {
        "job_id": str(getattr(record, "job_id", job_id)),
        "status": str(getattr(record, "status", "")),
        "attempt_count": int(getattr(record, "attempt_count", 0)),
        "leased_by": getattr(record, "leased_by", None),
        "lease_expires_at": _json_value(getattr(record, "lease_expires_at", None)),
        "last_error_code": getattr(record, "last_error_code", None),
        "last_error_message": getattr(record, "last_error_message", None),
        "updated_at": _json_value(getattr(record, "updated_at", None)),
    }


def _json_value(value: Any) -> Any:
    if value is None or isinstance(value, str | int | float | bool):
        return value
    return str(value)


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
