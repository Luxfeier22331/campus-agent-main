from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_COLUMNS,
    AuthenticatedNoticeCollectorRunObjectRefs,
    collector_run_refs_from_row,
)
from campus_ingestion_core.authenticated_notice_run_enqueue import (
    AUTHENTICATED_NOTICE_RUN_ENQUEUE_EXECUTE_SCHEMA_VERSION,
    build_authenticated_notice_run_enqueue_plan,
    execute_authenticated_notice_run_enqueue_plan,
)
from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.collected_notice_ingest_queue_store import (
    NoticeIngestQueueStore,
    notice_ingest_job_from_payload,
)
from campus_ingestion_core.registry import _postgres_connection, _qualified_table_sql

VERIFIED_AUTHENTICATED_NOTICE_RUN_ENQUEUE_SCAN_PLAN_SCHEMA_VERSION = (
    "verified_authenticated_notice_run_enqueue_scan_plan.v1"
)
VERIFIED_AUTHENTICATED_NOTICE_RUN_ENQUEUE_SCAN_EXECUTE_SCHEMA_VERSION = (
    "verified_authenticated_notice_run_enqueue_scan_execute.v1"
)


@dataclass(frozen=True, slots=True)
class VerifiedAuthenticatedNoticeRunEnqueueCandidate:
    site_id: str
    run_refs: AuthenticatedNoticeCollectorRunObjectRefs


def build_verified_authenticated_notice_run_enqueue_scan_plan(
    *,
    candidates: Iterable[VerifiedAuthenticatedNoticeRunEnqueueCandidate],
    queue_store: NoticeIngestQueueStore,
    replay_batch_id: str,
    generated_at: str | None = None,
    enqueue_source: str = "live_discovery",
    priority: int = 100,
    generated_by: str = "campus_ingestion_worker.enqueue_verified_authenticated_notice_runs",
) -> dict[str, Any]:
    jobs: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    scanned_count = 0
    for candidate in candidates:
        scanned_count += 1
        run_plan = build_authenticated_notice_run_enqueue_plan(
            run_refs=candidate.run_refs,
            site_id=candidate.site_id,
            enqueue_source=enqueue_source,
            replay_batch_id=replay_batch_id,
            priority=priority,
            generated_by=generated_by,
            provenance={
                "source": "verified_collector_run_scan",
                "collector_run_ledger_status": "success",
                "collector_run_ledger_verification_status": "verified",
            },
        )
        job_payload = run_plan["jobs"][0]
        job = notice_ingest_job_from_payload(job_payload)
        existing = queue_store.get(job.job_id)
        if existing is not None:
            skipped.append(
                {
                    "run_id": candidate.run_refs.run_id,
                    "job_id": job.job_id,
                    "status": existing.status,
                    "reason": "already_queued",
                }
            )
            continue
        jobs.append(job_payload)
    return {
        "schema_version": VERIFIED_AUTHENTICATED_NOTICE_RUN_ENQUEUE_SCAN_PLAN_SCHEMA_VERSION,
        "generated_at": generated_at or utc_now(),
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "replay_batch_id": replay_batch_id,
        "enqueue_source": enqueue_source,
        "jobs": jobs,
        "skipped_runs": skipped,
        "counts": {
            "scanned_run_count": scanned_count,
            "already_queued_count": len(skipped),
            "planned_job_count": len(jobs),
            "queue_write_count": 0,
        },
    }


def execute_verified_authenticated_notice_run_enqueue_scan_plan(
    plan: Mapping[str, Any],
    *,
    queue_store: NoticeIngestQueueStore,
) -> dict[str, Any]:
    payload = {
        "schema_version": AUTHENTICATED_NOTICE_RUN_ENQUEUE_EXECUTE_SCHEMA_VERSION,
        "mode": "dry_run",
        "write_enabled": False,
        "jobs": list(plan.get("jobs") or ()),
        "counts": dict(plan.get("counts") or {}),
    }
    executed = execute_authenticated_notice_run_enqueue_plan(payload, queue_store=queue_store)
    return {
        **dict(plan),
        "schema_version": VERIFIED_AUTHENTICATED_NOTICE_RUN_ENQUEUE_SCAN_EXECUTE_SCHEMA_VERSION,
        "mode": "execute",
        "write_enabled": True,
        "enqueued_jobs": executed["enqueued_jobs"],
        "counts": executed["counts"],
    }


def list_verified_authenticated_notice_run_enqueue_candidates(
    *,
    database_url: str,
    table_name: str,
    source_surface: str = "notice",
    limit: int = 100,
) -> tuple[VerifiedAuthenticatedNoticeRunEnqueueCandidate, ...]:
    table_sql = _qualified_table_sql(table_name)
    columns_sql = ", ".join(AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_COLUMNS)
    with _postgres_connection(database_url) as conn, conn.cursor() as cursor:
        cursor.execute(
            f"""
            select {columns_sql}
            from {table_sql}
            where source_surface = %s
                and status = 'success'
                and verification_status = 'verified'
            order by finished_at asc nulls last, started_at asc, run_id asc
            limit %s
            """,
            (source_surface, int(limit)),
        )
        rows = cursor.fetchall()
    candidates = []
    for row in rows:
        payload = dict(zip(AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_COLUMNS, row, strict=True))
        candidates.append(
            VerifiedAuthenticatedNoticeRunEnqueueCandidate(
                site_id=str(payload.get("site_id") or ""),
                run_refs=collector_run_refs_from_row(
                    payload,
                    expected_source_surface=source_surface,
                ),
            )
        )
    return tuple(candidates)


def verified_authenticated_notice_run_enqueue_scan_to_output_files(
    payload: Mapping[str, Any],
) -> dict[str, dict[str, Any]]:
    mode = str(payload.get("mode") or "dry_run")
    filename = (
        "verified-authenticated-notice-run-enqueue-scan.execute.json"
        if mode == "execute"
        else "verified-authenticated-notice-run-enqueue-scan.dry-run.json"
    )
    return {filename: dict(payload)}


__all__ = [
    "VERIFIED_AUTHENTICATED_NOTICE_RUN_ENQUEUE_SCAN_EXECUTE_SCHEMA_VERSION",
    "VERIFIED_AUTHENTICATED_NOTICE_RUN_ENQUEUE_SCAN_PLAN_SCHEMA_VERSION",
    "VerifiedAuthenticatedNoticeRunEnqueueCandidate",
    "build_verified_authenticated_notice_run_enqueue_scan_plan",
    "execute_verified_authenticated_notice_run_enqueue_scan_plan",
    "list_verified_authenticated_notice_run_enqueue_candidates",
    "verified_authenticated_notice_run_enqueue_scan_to_output_files",
]
