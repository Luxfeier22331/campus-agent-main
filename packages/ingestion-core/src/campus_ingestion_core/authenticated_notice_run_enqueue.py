from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    AuthenticatedNoticeCollectorRunObjectRefs,
)
from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.collected_notice_ingest_queue import (
    build_authenticated_notice_run_ingest_job,
)
from campus_ingestion_core.collected_notice_ingest_queue_store import (
    NoticeIngestQueueStore,
    notice_ingest_job_from_payload,
)

AUTHENTICATED_NOTICE_RUN_ENQUEUE_PLAN_SCHEMA_VERSION = "authenticated_notice_run_enqueue_plan.v1"
AUTHENTICATED_NOTICE_RUN_ENQUEUE_EXECUTE_SCHEMA_VERSION = (
    "authenticated_notice_run_enqueue_execute.v1"
)
DEFAULT_AUTHENTICATED_NOTICE_RUN_REPLAY_BATCH_ID = "authenticated-notice-run-manual"


def build_authenticated_notice_run_enqueue_plan(
    *,
    run_refs: AuthenticatedNoticeCollectorRunObjectRefs,
    site_id: str,
    enqueue_source: str = "manual_replay",
    replay_batch_id: str = DEFAULT_AUTHENTICATED_NOTICE_RUN_REPLAY_BATCH_ID,
    priority: int = 100,
    generated_by: str = "campus_ingestion_worker.enqueue_authenticated_notice_collector_run",
    provenance: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    generated_at = utc_now()
    job = build_authenticated_notice_run_ingest_job(
        source_surface=run_refs.source_surface,
        site_id=site_id,
        run_id=run_refs.run_id,
        source_bucket=run_refs.source_bucket,
        bundle_object_key=run_refs.bundle_object_key,
        bundle_content_sha256=run_refs.bundle_content_sha256,
        bundle_byte_size=run_refs.bundle_byte_size,
        manifest_object_key=run_refs.manifest_object_key,
        manifest_content_sha256=run_refs.manifest_content_sha256,
        manifest_byte_size=run_refs.manifest_byte_size,
        enqueue_source=enqueue_source,
        replay_batch_id=replay_batch_id,
        priority=priority,
        provenance=provenance
        or {
            "collector_run_ledger_status": "success",
            "collector_run_ledger_verification_status": "verified",
        },
    )
    return {
        "schema_version": AUTHENTICATED_NOTICE_RUN_ENQUEUE_PLAN_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "run_id": run_refs.run_id,
        "source_surface": run_refs.source_surface,
        "site_id": site_id,
        "replay_batch_id": replay_batch_id,
        "planned_writes": {"queue_jobs": 1},
        "jobs": [job.to_payload()],
        "counts": {
            "planned_job_count": 1,
            "rejected_count": 0,
            "queue_write_count": 0,
        },
    }


def execute_authenticated_notice_run_enqueue_plan(
    plan: Mapping[str, Any],
    *,
    queue_store: NoticeIngestQueueStore,
) -> dict[str, Any]:
    inserted_count = 0
    existing_count = 0
    enqueued_jobs: list[dict[str, Any]] = []
    for payload in plan.get("jobs") or ():
        if not isinstance(payload, Mapping):
            continue
        job = notice_ingest_job_from_payload(payload)
        existing = queue_store.get(job.job_id)
        record = queue_store.enqueue(job)
        if existing is None:
            inserted_count += 1
        else:
            existing_count += 1
        enqueued_jobs.append(
            {
                "job_id": record.job_id,
                "idempotency_key": record.idempotency_key,
                "status": record.status,
                "source_surface": record.source_surface,
                "source_identity": record.source_identity,
                "run_id": record.run_id,
            }
        )
    counts = dict(plan.get("counts") or {})
    counts.update(
        {
            "inserted_count": inserted_count,
            "existing_count": existing_count,
            "queue_write_count": inserted_count + existing_count,
            "queue_status_counts": queue_store.list_status_counts(),
        }
    )
    return {
        **dict(plan),
        "schema_version": AUTHENTICATED_NOTICE_RUN_ENQUEUE_EXECUTE_SCHEMA_VERSION,
        "mode": "execute",
        "write_enabled": True,
        "planned_writes": {"queue_jobs": len(tuple(plan.get("jobs") or ()))},
        "enqueued_jobs": enqueued_jobs,
        "counts": counts,
    }


def authenticated_notice_run_enqueue_to_output_files(
    payload: Mapping[str, Any],
) -> dict[str, dict[str, Any]]:
    mode = str(payload.get("mode") or "dry_run")
    main_filename = (
        "authenticated-notice-run-enqueue.execute.json"
        if mode == "execute"
        else "authenticated-notice-run-enqueue-plan.dry-run.json"
    )
    return {main_filename: dict(payload)}


__all__ = [
    "AUTHENTICATED_NOTICE_RUN_ENQUEUE_EXECUTE_SCHEMA_VERSION",
    "AUTHENTICATED_NOTICE_RUN_ENQUEUE_PLAN_SCHEMA_VERSION",
    "DEFAULT_AUTHENTICATED_NOTICE_RUN_REPLAY_BATCH_ID",
    "authenticated_notice_run_enqueue_to_output_files",
    "build_authenticated_notice_run_enqueue_plan",
    "execute_authenticated_notice_run_enqueue_plan",
]
