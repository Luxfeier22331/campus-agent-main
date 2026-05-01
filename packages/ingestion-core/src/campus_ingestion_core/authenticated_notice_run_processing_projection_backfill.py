from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from campus_ingestion_core.authenticated_notice_run_processing_projection import (
    DEFAULT_PRODUCER_VERSION,
    AuthenticatedNoticeRunProcessingProjectionReporter,
    build_authenticated_notice_run_processing_snapshots,
)
from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.collected_notice_ingest_queue_store import NoticeIngestQueueRecord

BACKFILL_PRODUCER_VERSION = f"{DEFAULT_PRODUCER_VERSION}.backfill.v1"


def backfill_authenticated_notice_run_processing_projection(
    *,
    records: Sequence[NoticeIngestQueueRecord],
    trace_rows: Sequence[Mapping[str, Any]],
    reporter: AuthenticatedNoticeRunProcessingProjectionReporter,
    collector_run_token: str | None = None,
    run_id: str | None = None,
    replay_batch_id: str | None = None,
    projected_at: str | None = None,
    producer_version: str = BACKFILL_PRODUCER_VERSION,
) -> dict[str, Any]:
    normalized_collector_run_token = _optional_text(collector_run_token)
    normalized_run_id = _optional_text(run_id)
    normalized_replay_batch_id = _optional_text(replay_batch_id)
    timestamp = _optional_text(projected_at) or utc_now()
    candidate_records = tuple(
        record
        for record in records
        if (not normalized_run_id or record.run_id == normalized_run_id)
        and (not normalized_replay_batch_id or record.replay_batch_id == normalized_replay_batch_id)
        and (
            not normalized_collector_run_token
            or _collector_run_token(record) == normalized_collector_run_token
        )
    )

    findings: list[dict[str, Any]] = []
    snapshots = build_authenticated_notice_run_processing_snapshots(
        records=candidate_records,
        trace_rows=trace_rows,
        projected_at=timestamp,
        producer_version=producer_version,
    )
    if not snapshots and candidate_records:
        findings.append(
            {
                "severity": "medium",
                "code": "projection_empty",
                "message": "no operator-safe run processing snapshot could be built",
            }
        )
    if not candidate_records:
        findings.append(
            {
                "severity": "medium",
                "code": "queue_records_missing",
                "message": "no queue records matched run-level projection filters",
            }
        )
    if snapshots:
        reporter.report(snapshots=snapshots)

    medium_or_higher_count = sum(
        1 for finding in findings if finding.get("severity") in {"medium", "high"}
    )
    return {
        "schema_version": "authenticated_notice_run_processing_projection_backfill.v1",
        "generated_at": timestamp,
        "producer_version": producer_version,
        "candidate_record_count": len(candidate_records),
        "reported_snapshot_count": len(snapshots),
        "skipped_record_count": 0 if snapshots else len(candidate_records),
        "collector_run_token": normalized_collector_run_token,
        "run_id": normalized_run_id,
        "replay_batch_id": normalized_replay_batch_id,
        "findings": findings,
        "medium_or_higher_finding_count": medium_or_higher_count,
        "verdict": "passed" if medium_or_higher_count == 0 else "failed",
    }


def _collector_run_token(record: NoticeIngestQueueRecord) -> str:
    parts = record.run_id.split(":")
    if len(parts) >= 3 and parts[1] == record.source_surface:
        return parts[2]
    return record.run_id


def _optional_text(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


__all__ = [
    "BACKFILL_PRODUCER_VERSION",
    "backfill_authenticated_notice_run_processing_projection",
]
