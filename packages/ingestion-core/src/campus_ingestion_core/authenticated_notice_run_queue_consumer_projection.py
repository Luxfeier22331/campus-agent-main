from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import replace
from typing import Any

from campus_ingestion_core.authenticated_notice_processing_projection import (
    AuthenticatedNoticeProcessingProjectionReporter,
    build_authenticated_notice_processing_snapshots,
)
from campus_ingestion_core.authenticated_notice_run_processing_projection import (
    AuthenticatedNoticeRunProcessingProjectionReporter,
    build_authenticated_notice_run_processing_snapshots,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    typed_materialization_candidate_count as _typed_materialization_candidate_count,
)
from campus_ingestion_core.campusrag_ingestion_reporting import utc_now


def _should_invoke_typed_materializer(import_result: Mapping[str, Any]) -> bool:
    if _typed_materialization_candidate_count(import_result) > 0:
        return True
    selected_notice_ids = import_result.get("selected_notice_ids")
    if isinstance(selected_notice_ids, str | bytes) or not isinstance(
        selected_notice_ids,
        Sequence,
    ):
        return False
    return any(str(item).strip() for item in selected_notice_ids)


def _report_processing_projection(
    *,
    reporter: AuthenticatedNoticeProcessingProjectionReporter | None,
    record,
    trace_row: Mapping[str, Any],
    producer_version: str,
) -> None:
    if reporter is None:
        return
    projected_at = utc_now()
    snapshots = build_authenticated_notice_processing_snapshots(
        record=record,
        trace_row=trace_row,
        projected_at=projected_at,
        producer_version=producer_version,
    )
    if not snapshots:
        trace_row["processing_projection_report"] = {
            "status": "skipped",
            "reason": "no_selected_notice_ids",
        }
        return
    try:
        reporter.report(snapshots=snapshots)
        trace_row["processing_projection_report"] = {
            "status": "reported",
            "snapshot_count": len(snapshots),
            "projected_at": projected_at,
        }
    except Exception as exc:
        trace_row["processing_projection_report"] = {
            "status": "failed",
            "snapshot_count": len(snapshots),
            "error_message": str(exc),
        }


def _report_run_processing_projection(
    *,
    reporter: AuthenticatedNoticeRunProcessingProjectionReporter | None,
    records: Sequence[Any],
    trace_rows: Sequence[Mapping[str, Any]],
    producer_version: str,
    trace_rows_out: Sequence[dict[str, Any]],
) -> None:
    if reporter is None or not records:
        return
    projected_at = utc_now()
    snapshots = build_authenticated_notice_run_processing_snapshots(
        records=records,
        trace_rows=trace_rows,
        projected_at=projected_at,
        producer_version=producer_version,
    )
    if not snapshots:
        for trace_row in trace_rows_out:
            trace_row["run_processing_projection_report"] = {
                "status": "skipped",
                "reason": "no_run_snapshot",
            }
        return
    try:
        reporter.report(snapshots=snapshots)
        for trace_row in trace_rows_out:
            trace_row["run_processing_projection_report"] = {
                "status": "reported",
                "snapshot_count": len(snapshots),
                "projected_at": projected_at,
            }
    except Exception as exc:
        for trace_row in trace_rows_out:
            trace_row["run_processing_projection_report"] = {
                "status": "failed",
                "snapshot_count": len(snapshots),
                "error_message": str(exc),
            }


def _record_for_run_processing_projection(record, trace_row: Mapping[str, Any]):
    trace_status = str(trace_row.get("status") or "").strip()
    status = (
        "succeeded"
        if trace_status == "completed"
        else trace_status
        if trace_status in {"failed_retryable", "failed_terminal", "manual_review", "dead_letter"}
        else record.status
    )
    return replace(
        record,
        status=status,
        last_error_code=_optional_text(trace_row.get("error_code")) or record.last_error_code,
        last_error_message=(
            _optional_text(trace_row.get("error_message")) or record.last_error_message
        ),
    )


def _optional_text(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None
