from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from campus_ingestion_core.authenticated_notice_processing_projection import (
    DEFAULT_PRODUCER_VERSION,
    AuthenticatedNoticeProcessingProjectionReporter,
    build_authenticated_notice_processing_snapshots,
)
from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.collected_notice_ingest_queue_store import NoticeIngestQueueRecord

BACKFILL_PRODUCER_VERSION = f"{DEFAULT_PRODUCER_VERSION}.backfill.v1"

_TERMINAL_SUCCESS_STATUSES = {"completed", "tool_ready", "materialized"}


def backfill_authenticated_notice_processing_projection(
    *,
    records: Sequence[NoticeIngestQueueRecord],
    trace_rows: Sequence[Mapping[str, Any]],
    reporter: AuthenticatedNoticeProcessingProjectionReporter,
    notice_ids: Sequence[str] = (),
    run_id: str | None = None,
    replay_batch_id: str | None = None,
    projected_at: str | None = None,
    producer_version: str = BACKFILL_PRODUCER_VERSION,
) -> dict[str, Any]:
    normalized_notice_ids = _normalized_set(notice_ids)
    normalized_run_id = _optional_text(run_id)
    normalized_replay_batch_id = _optional_text(replay_batch_id)
    timestamp = _optional_text(projected_at) or utc_now()
    candidate_records = tuple(
        record
        for record in records
        if (not normalized_run_id or record.run_id == normalized_run_id)
        and (not normalized_replay_batch_id or record.replay_batch_id == normalized_replay_batch_id)
    )
    traces_by_job_id = _trace_rows_by_job_id(trace_rows)

    findings: list[dict[str, Any]] = []
    snapshots: list[dict[str, Any]] = []
    skipped_count = 0
    for record in candidate_records:
        matching_rows = traces_by_job_id.get(record.job_id, ())
        if not matching_rows:
            skipped_count += 1
            findings.append(
                _finding(
                    severity="medium",
                    code="trace_missing",
                    message=f"no consume trace row found for queue job {record.job_id}",
                    record=record,
                )
            )
            continue
        merged_trace = _merge_trace_rows(matching_rows)
        record_snapshots = build_authenticated_notice_processing_snapshots(
            record=record,
            trace_row=merged_trace,
            projected_at=timestamp,
            producer_version=producer_version,
        )
        if normalized_notice_ids:
            record_snapshots = tuple(
                snapshot
                for snapshot in record_snapshots
                if str(snapshot.get("noticeId") or "").strip() in normalized_notice_ids
            )
        if not record_snapshots:
            skipped_count += 1
            findings.append(
                _finding(
                    severity="medium",
                    code="projection_empty",
                    message=f"no operator-safe processing snapshot could be built for {record.job_id}",
                    record=record,
                )
            )
            continue
        snapshots.extend(dict(snapshot) for snapshot in record_snapshots)
        findings.extend(_conflict_findings(record=record, snapshots=record_snapshots))

    if snapshots:
        reporter.report(snapshots=tuple(snapshots))

    medium_or_higher_count = sum(
        1 for finding in findings if finding.get("severity") in {"medium", "high"}
    )
    return {
        "schema_version": "authenticated_notice_processing_projection_backfill.v1",
        "generated_at": timestamp,
        "producer_version": producer_version,
        "candidate_record_count": len(candidate_records),
        "reported_snapshot_count": len(snapshots),
        "skipped_record_count": skipped_count,
        "notice_ids": sorted(normalized_notice_ids),
        "run_id": normalized_run_id,
        "replay_batch_id": normalized_replay_batch_id,
        "findings": findings,
        "medium_or_higher_finding_count": medium_or_higher_count,
        "verdict": "passed" if medium_or_higher_count == 0 else "failed",
    }


def _merge_trace_rows(rows: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    ordered_rows = sorted(rows, key=_trace_sort_key)
    effective = dict(max(ordered_rows, key=_trace_rank))
    progress_events: list[Mapping[str, Any]] = []
    for row in ordered_rows:
        for event in _list_of_mappings(row.get("progress_events")):
            progress_events.append(event)
    if progress_events:
        effective["progress_events"] = progress_events
    return effective


def _trace_rank(row: Mapping[str, Any]) -> tuple[int, str]:
    downstream = _mapping(row.get("downstream_materialization"))
    typed = _mapping(downstream.get("typed_materialization"))
    status = str(row.get("status") or "").strip()
    downstream_status = str(downstream.get("status") or "").strip()
    typed_status = str(typed.get("status") or "").strip()
    success_rank = (
        2
        if (
            status in _TERMINAL_SUCCESS_STATUSES
            or downstream_status == "completed"
            or typed_status == "completed"
        )
        else 0
    )
    if status in {"failed_retryable", "failed_terminal"}:
        success_rank = 1
    return (success_rank, _trace_sort_key(row))


def _trace_sort_key(row: Mapping[str, Any]) -> str:
    generated_at = _optional_text(row.get("generated_at"))
    if generated_at:
        return generated_at
    for event in _list_of_mappings(row.get("progress_events")):
        event_time = _optional_text(event.get("generated_at") or event.get("occurredAt"))
        if event_time:
            return event_time
    return ""


def _conflict_findings(
    *,
    record: NoticeIngestQueueRecord,
    snapshots: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    for snapshot in snapshots:
        if (
            str(snapshot.get("candidateKind") or "") == "transport_schedule"
            and bool(snapshot.get("toolReady"))
            and int(_mapping(snapshot.get("readModelCounts")).get("scheduledDepartures") or 0) <= 0
        ):
            findings.append(
                _finding(
                    severity="medium",
                    code="transport_schedule_tool_ready_without_departures",
                    message="transport schedule snapshot is tool-ready without scheduled departures",
                    record=record,
                    notice_id=str(snapshot.get("noticeId") or ""),
                )
            )
    return findings


def _trace_rows_by_job_id(
    trace_rows: Sequence[Mapping[str, Any]],
) -> dict[str, tuple[Mapping[str, Any], ...]]:
    grouped: dict[str, list[Mapping[str, Any]]] = {}
    for row in trace_rows:
        job_id = _optional_text(row.get("job_id") or row.get("jobId"))
        if not job_id:
            continue
        grouped.setdefault(job_id, []).append(row)
    return {key: tuple(value) for key, value in grouped.items()}


def _finding(
    *,
    severity: str,
    code: str,
    message: str,
    record: NoticeIngestQueueRecord,
    notice_id: str | None = None,
) -> dict[str, Any]:
    return {
        "severity": severity,
        "code": code,
        "message": message,
        "job_id": record.job_id,
        "run_id": record.run_id,
        "notice_id": notice_id,
    }


def _normalized_set(values: Sequence[str]) -> set[str]:
    return {value for value in (_optional_text(item) for item in values) if value}


def _optional_text(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


def _mapping(value: object) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _list_of_mappings(value: object) -> tuple[Mapping[str, Any], ...]:
    if isinstance(value, Sequence) and not isinstance(value, str | bytes):
        return tuple(item for item in value if isinstance(item, Mapping))
    return ()


__all__ = [
    "BACKFILL_PRODUCER_VERSION",
    "backfill_authenticated_notice_processing_projection",
]
