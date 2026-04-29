from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.collected_notice_ingest_queue import (
    NoticeIngestObjectRef,
    build_file_release_source_identity,
    build_internal_notice_source_identity,
    build_notice_ingest_job,
)
from campus_ingestion_core.collected_notice_ingest_queue_store import (
    NoticeIngestQueueStore,
    notice_ingest_job_from_payload,
)

HISTORICAL_ENQUEUE_PLAN_SCHEMA_VERSION = "collected_notice_historical_enqueue_plan.v1"
HISTORICAL_ENQUEUE_EXECUTE_SCHEMA_VERSION = "collected_notice_historical_enqueue_execute.v1"
HISTORICAL_ENQUEUE_REJECTED_REPORT_SCHEMA_VERSION = (
    "collected_notice_historical_enqueue_rejected_deferred_report.v1"
)
HISTORICAL_ENQUEUE_COVERAGE_REPORT_SCHEMA_VERSION = (
    "collected_notice_historical_enqueue_coverage_report.v1"
)
PHASE_04_7_ID = "phase-04-7-historical-captured-inventory-synthetic-enqueue"
DEFAULT_HISTORICAL_REPLAY_BATCH_ID = "phase-04-7-historical-backfill"
SUPPORTED_HISTORICAL_ENQUEUE_SOURCE_SURFACES = ("notice", "file_release")
_BUNDLE_ROLES = frozenset(("collector_bundle", "collector-run/bundle.json"))
_MANIFEST_ROLE_BY_SURFACE = {
    "notice": "source-truth/notice-manifest.json",
    "file_release": "source-truth/file-release-manifest.json",
}


def build_historical_notice_enqueue_plan(
    reimport_plan_payload: Mapping[str, Any],
    *,
    replay_batch_id: str = DEFAULT_HISTORICAL_REPLAY_BATCH_ID,
    generated_by: str = "campus_ingestion_worker.enqueue_collected_notice_historical_inventory",
    priority: int = 100,
) -> dict[str, Any]:
    generated_at = utc_now()
    candidates = _source_truth_candidates(reimport_plan_payload)
    jobs: list[dict[str, Any]] = []
    rejected_items: list[dict[str, Any]] = []
    seen_idempotency_keys: set[str] = set()
    for index, candidate in enumerate(candidates):
        projected = _project_candidate_to_job(
            candidate,
            replay_batch_id=replay_batch_id,
            priority=priority,
        )
        if isinstance(projected, _RejectedHistoricalEnqueueItem):
            rejected_items.append(projected.to_payload(index=index))
            continue
        idempotency_key = str(projected["idempotency_key"])
        if idempotency_key in seen_idempotency_keys:
            rejected_items.append(
                _RejectedHistoricalEnqueueItem(
                    candidate=candidate,
                    reason_codes=("duplicate_idempotency_key",),
                    source_identity=str(projected.get("source_identity") or ""),
                    idempotency_key=idempotency_key,
                ).to_payload(index=index)
            )
            continue
        seen_idempotency_keys.add(idempotency_key)
        jobs.append(projected)
    input_rejected_run_items = _input_rejected_run_items(reimport_plan_payload)
    all_rejected_items = [*rejected_items, *input_rejected_run_items]
    counts = _base_counts(
        source_truth_candidate_count=len(candidates),
        jobs=jobs,
        candidate_rejected_items=rejected_items,
        input_rejected_run_items=input_rejected_run_items,
    )
    plan = {
        "schema_version": HISTORICAL_ENQUEUE_PLAN_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "dry_run",
        "write_enabled": False,
        "phase": PHASE_04_7_ID,
        "source_reimport_report_id": reimport_plan_payload.get("report_id"),
        "input_refs": dict(reimport_plan_payload.get("input_refs") or {}),
        "replay_batch_id": replay_batch_id,
        "selection_policy": {
            "name": "historical-captured-inventory-synthetic-enqueue",
            "version": "phase4.7.v1",
            "source_surfaces": list(SUPPORTED_HISTORICAL_ENQUEUE_SOURCE_SURFACES),
        },
        "planned_writes": {
            "queue_jobs": len(jobs),
            "source_truth_rows": 0,
            "searchable_rows": 0,
            "downstream_rows": 0,
        },
        "jobs": jobs,
        "rejected_items": all_rejected_items,
        "counts": counts,
    }
    plan["rejected_deferred_report"] = build_historical_enqueue_rejected_deferred_report(plan)
    plan["coverage_report"] = build_historical_enqueue_coverage_report(plan)
    return plan


def execute_historical_notice_enqueue_plan(
    plan: Mapping[str, Any],
    *,
    queue_store: NoticeIngestQueueStore,
) -> dict[str, Any]:
    inserted_count = 0
    existing_count = 0
    enqueued_jobs = []
    for payload in plan.get("jobs") or ():
        if not isinstance(payload, Mapping):
            continue
        job = notice_ingest_job_from_payload(payload)
        existing = _store_get(queue_store, job.job_id)
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
    result = {
        **dict(plan),
        "schema_version": HISTORICAL_ENQUEUE_EXECUTE_SCHEMA_VERSION,
        "mode": "execute",
        "write_enabled": True,
        "planned_writes": {
            "queue_jobs": len(tuple(plan.get("jobs") or ())),
            "source_truth_rows": 0,
            "searchable_rows": 0,
            "downstream_rows": 0,
        },
        "enqueued_jobs": enqueued_jobs,
        "counts": counts,
    }
    result["coverage_report"] = build_historical_enqueue_coverage_report(result)
    result["rejected_deferred_report"] = build_historical_enqueue_rejected_deferred_report(result)
    return result


def historical_enqueue_to_output_files(payload: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    mode = str(payload.get("mode") or "dry_run")
    main_filename = (
        "historical-enqueue.execute.json"
        if mode == "execute"
        else "historical-enqueue-plan.dry-run.json"
    )
    return {
        main_filename: dict(payload),
        "historical-enqueue-rejected-deferred-report.json": (
            build_historical_enqueue_rejected_deferred_report(payload)
        ),
        "enqueue-coverage-report.json": build_historical_enqueue_coverage_report(payload),
    }


def build_historical_enqueue_rejected_deferred_report(
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    rejected_items = tuple(
        item for item in payload.get("rejected_items") or () if isinstance(item, Mapping)
    )
    reason_counts = Counter(
        reason for item in rejected_items for reason in tuple(item.get("reason_codes") or ())
    )
    return {
        "schema_version": HISTORICAL_ENQUEUE_REJECTED_REPORT_SCHEMA_VERSION,
        "generated_at": payload.get("generated_at"),
        "generated_by": payload.get("generated_by"),
        "mode": payload.get("mode"),
        "phase": PHASE_04_7_ID,
        "rejected_count": len(rejected_items),
        "deferred_count": 0,
        "reason_counts": dict(sorted(reason_counts.items())),
        "rejected_items": [dict(item) for item in rejected_items],
        "deferred_items": [],
    }


def build_historical_enqueue_coverage_report(payload: Mapping[str, Any]) -> dict[str, Any]:
    counts = dict(payload.get("counts") or {})
    source_truth_candidate_count = int(counts.get("source_truth_candidate_count") or 0)
    planned_job_count = int(counts.get("planned_job_count") or 0)
    candidate_rejected_count = int(
        counts.get("candidate_rejected_count", counts.get("rejected_count") or 0) or 0
    )
    rejected_count = int(counts.get("rejected_count") or 0)
    queue_write_count = int(counts.get("queue_write_count") or 0)
    reconciled = source_truth_candidate_count == planned_job_count + candidate_rejected_count
    return {
        "schema_version": HISTORICAL_ENQUEUE_COVERAGE_REPORT_SCHEMA_VERSION,
        "generated_at": payload.get("generated_at"),
        "generated_by": payload.get("generated_by"),
        "mode": payload.get("mode"),
        "phase": PHASE_04_7_ID,
        "source_truth_candidate_count": source_truth_candidate_count,
        "planned_job_count": planned_job_count,
        "rejected_count": rejected_count,
        "queue_write_count": queue_write_count,
        "write_enabled": bool(payload.get("write_enabled")),
        "verdict": "passed" if reconciled else "failed",
        "reason": "" if reconciled else "candidate_count_does_not_reconcile",
    }


class _RejectedHistoricalEnqueueItem:
    def __init__(
        self,
        *,
        candidate: Mapping[str, Any],
        reason_codes: Sequence[str],
        source_identity: str = "",
        idempotency_key: str = "",
        error: str = "",
    ) -> None:
        self.candidate = candidate
        self.reason_codes = tuple(reason_codes)
        self.source_identity = source_identity
        self.idempotency_key = idempotency_key
        self.error = error

    def to_payload(self, *, index: int) -> dict[str, Any]:
        return {
            "candidate_index": index,
            "source_surface": self.candidate.get("source_surface"),
            "source_identifier": self.candidate.get("source_identifier"),
            "site_id": self.candidate.get("site_id"),
            "run_id": self.candidate.get("run_id"),
            "source_identity": self.source_identity,
            "idempotency_key": self.idempotency_key,
            "reason_codes": list(self.reason_codes),
            "error": self.error,
        }


def _source_truth_candidates(payload: Mapping[str, Any]) -> tuple[Mapping[str, Any], ...]:
    write_manifest = payload.get("write_manifest_candidate")
    if not isinstance(write_manifest, Mapping):
        raise ValueError("reimport plan missing write_manifest_candidate")
    candidates = write_manifest.get("source_truth_candidates")
    if not isinstance(candidates, Sequence) or isinstance(candidates, str | bytes):
        raise ValueError("reimport plan source_truth_candidates must be a list")
    return tuple(item for item in candidates if isinstance(item, Mapping))


def _input_rejected_run_items(payload: Mapping[str, Any]) -> list[dict[str, Any]]:
    input_refs = payload.get("input_refs")
    if not isinstance(input_refs, Mapping):
        return []
    rejected_run_refs = input_refs.get("rejected_run_refs") or ()
    if not isinstance(rejected_run_refs, Sequence) or isinstance(rejected_run_refs, str | bytes):
        return []
    items: list[dict[str, Any]] = []
    for index, item in enumerate(rejected_run_refs):
        if not isinstance(item, Mapping):
            continue
        items.append(
            {
                "candidate_index": None,
                "input_rejected_run_index": index,
                "source_surface": item.get("source_surface"),
                "source_identifier": item.get("source_identifier"),
                "site_id": item.get("site_id"),
                "run_id": item.get("run_id"),
                "source_identity": "",
                "idempotency_key": "",
                "reason_codes": list(item.get("reason_codes") or ()),
                "error": item.get("failure_reason") or item.get("error") or "",
            }
        )
    return items


def _project_candidate_to_job(
    candidate: Mapping[str, Any],
    *,
    replay_batch_id: str,
    priority: int,
) -> dict[str, Any] | _RejectedHistoricalEnqueueItem:
    source_surface = str(candidate.get("source_surface") or "").strip()
    if source_surface not in SUPPORTED_HISTORICAL_ENQUEUE_SOURCE_SURFACES:
        return _RejectedHistoricalEnqueueItem(
            candidate=candidate,
            reason_codes=("unsupported_source_surface",),
        )
    source_identifier = str(candidate.get("source_identifier") or "").strip()
    site_id = str(candidate.get("site_id") or "").strip()
    document = candidate.get("document")
    content_hash = (
        str(document.get("content_hash") or "").strip() if isinstance(document, Mapping) else ""
    )
    refs = _candidate_object_refs(candidate)
    manifest_ref = _find_ref_by_role(refs, _MANIFEST_ROLE_BY_SURFACE[source_surface])
    bundle_ref = _find_first_ref_by_roles(refs, _BUNDLE_ROLES)
    reason_codes = []
    if manifest_ref is None:
        reason_codes.append("missing_capture_manifest_object_ref")
    if bundle_ref is None:
        reason_codes.append("missing_bundle_object_ref")
    if not source_identifier or not site_id or not content_hash:
        reason_codes.append("missing_required_source_identity")
    if reason_codes:
        return _RejectedHistoricalEnqueueItem(
            candidate=candidate,
            reason_codes=tuple(reason_codes),
        )
    try:
        source_identity = (
            build_file_release_source_identity(file_release_id=source_identifier)
            if source_surface == "file_release"
            else build_internal_notice_source_identity(
                site_id=site_id,
                source_notice_id=source_identifier,
            )
        )
        capture_id = _capture_id(
            source_surface=source_surface,
            site_id=site_id,
            source_identifier=source_identifier,
            content_hash=content_hash,
        )
        job = build_notice_ingest_job(
            source_channel=str(candidate.get("source_channel") or "authenticated_notice_portal"),
            source_surface=source_surface,
            source_identity=source_identity,
            capture_id=capture_id,
            capture_manifest_object_ref=manifest_ref,
            source_object_refs=refs,
            content_hash=content_hash,
            run_id=str(candidate.get("run_id") or ""),
            enqueue_source="historical_backfill",
            replay_batch_id=replay_batch_id,
            priority=priority,
        )
    except ValueError as exc:
        return _RejectedHistoricalEnqueueItem(
            candidate=candidate,
            reason_codes=("invalid_notice_ingest_job",),
            error=str(exc),
        )
    return job.to_payload()


def _candidate_object_refs(candidate: Mapping[str, Any]) -> tuple[NoticeIngestObjectRef, ...]:
    refs = candidate.get("source_object_refs") or ()
    if not isinstance(refs, Sequence) or isinstance(refs, str | bytes):
        return ()
    object_refs = []
    for ref in refs:
        if not isinstance(ref, Mapping):
            continue
        try:
            object_refs.append(_object_ref_from_mapping(ref))
        except ValueError:
            continue
    return tuple(object_refs)


def _object_ref_from_mapping(ref: Mapping[str, Any]) -> NoticeIngestObjectRef:
    return NoticeIngestObjectRef(
        bucket=str(ref.get("bucket") or ""),
        key=str(ref.get("key") or ""),
        role=str(ref.get("role") or ""),
        content_sha256=str(ref.get("content_sha256") or ref.get("sha256") or ""),
        byte_size=ref.get("byte_size"),
    )


def _find_ref_by_role(
    refs: Sequence[NoticeIngestObjectRef],
    role: str,
) -> NoticeIngestObjectRef | None:
    for ref in refs:
        if ref.role == role:
            return ref
    return None


def _find_first_ref_by_roles(
    refs: Sequence[NoticeIngestObjectRef],
    roles: frozenset[str],
) -> NoticeIngestObjectRef | None:
    for ref in refs:
        if ref.role in roles:
            return ref
    return None


def _capture_id(
    *,
    source_surface: str,
    site_id: str,
    source_identifier: str,
    content_hash: str,
) -> str:
    if source_surface == "file_release":
        return f"capture:file-release:{source_identifier}:{content_hash}"
    return f"capture:{site_id}:notice:{source_identifier}:{content_hash}"


def _base_counts(
    *,
    source_truth_candidate_count: int,
    jobs: Sequence[Mapping[str, Any]],
    candidate_rejected_items: Sequence[Mapping[str, Any]],
    input_rejected_run_items: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    rejected_items = [*candidate_rejected_items, *input_rejected_run_items]
    return {
        "source_truth_candidate_count": source_truth_candidate_count,
        "planned_job_count": len(jobs),
        "candidate_rejected_count": len(candidate_rejected_items),
        "input_rejected_run_count": len(input_rejected_run_items),
        "rejected_count": len(rejected_items),
        "duplicate_idempotency_key_count": sum(
            1
            for item in rejected_items
            if "duplicate_idempotency_key" in tuple(item.get("reason_codes") or ())
        ),
        "by_source_surface": dict(Counter(str(job["source_surface"]) for job in jobs)),
    }


def _store_get(queue_store: NoticeIngestQueueStore, job_id: str) -> object | None:
    get = getattr(queue_store, "get", None)
    if get is None:
        return None
    return get(job_id)


__all__ = [
    "DEFAULT_HISTORICAL_REPLAY_BATCH_ID",
    "HISTORICAL_ENQUEUE_COVERAGE_REPORT_SCHEMA_VERSION",
    "HISTORICAL_ENQUEUE_EXECUTE_SCHEMA_VERSION",
    "HISTORICAL_ENQUEUE_PLAN_SCHEMA_VERSION",
    "HISTORICAL_ENQUEUE_REJECTED_REPORT_SCHEMA_VERSION",
    "PHASE_04_7_ID",
    "SUPPORTED_HISTORICAL_ENQUEUE_SOURCE_SURFACES",
    "build_historical_enqueue_coverage_report",
    "build_historical_enqueue_rejected_deferred_report",
    "build_historical_notice_enqueue_plan",
    "execute_historical_notice_enqueue_plan",
    "historical_enqueue_to_output_files",
]
