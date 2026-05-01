from __future__ import annotations

import re
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any, Protocol

from campus_ingestion_core.collected_notice_ingest_queue_store import NoticeIngestQueueRecord

REDACTION_VERSION = "authenticated_notice_processing_redaction.v1"
DEFAULT_PRODUCER_VERSION = "campus_ingestion_core.authenticated_notice_run_processing_projection.v1"

_TERMINAL_STATUSES = frozenset(
    {"succeeded", "manual_review", "failed_terminal", "dead_letter", "cancelled"}
)
_FAILED_STATUSES = frozenset({"failed_terminal", "dead_letter"})
_ACTIVE_STATUSES = frozenset({"queued", "leased", "failed_retryable", "blocked"})
_FORBIDDEN_KEYS = frozenset(
    {
        "artifact_path",
        "attachments",
        "attachment_bytes",
        "attachmentBytes",
        "body_text",
        "bodyText",
        "bucket",
        "bundle_object_key",
        "bundle_path",
        "bundleObjectKey",
        "bundlePath",
        "content_blocks",
        "cookie",
        "credentials",
        "current_object_key",
        "currentObjectKey",
        "html",
        "input_refs",
        "key",
        "local_path",
        "localPath",
        "manifest_object_key",
        "manifest_path",
        "manifestObjectKey",
        "manifestPath",
        "object_key",
        "objectKey",
        "ocr_payload",
        "ocr_tables",
        "ocr_text",
        "ocrPayload",
        "ocrTables",
        "ocrText",
        "output_refs",
        "presigned_url",
        "presignedUrl",
        "raw_body",
        "raw_html",
        "raw_stack",
        "rawBody",
        "rawHtml",
        "rawStack",
        "release_object_key",
        "releaseObjectKey",
        "source_file_path",
        "source_object_refs",
        "sourceFilePath",
        "sourceObjectRefs",
        "stack",
    }
)


class AuthenticatedNoticeRunProcessingProjectionReporter(Protocol):
    def report(self, *, snapshots: Sequence[Mapping[str, Any]]) -> None: ...


def build_authenticated_notice_run_processing_snapshots(
    *,
    records: Sequence[NoticeIngestQueueRecord],
    trace_rows: Sequence[Mapping[str, Any]],
    projected_at: str,
    producer_version: str = DEFAULT_PRODUCER_VERSION,
) -> tuple[dict[str, Any], ...]:
    traces_by_job_id = _trace_rows_by_job_id(trace_rows)
    grouped: dict[tuple[str, str, str, str], list[NoticeIngestQueueRecord]] = {}
    for record in records:
        site_id = _site_id(record)
        collector_run_token = _collector_run_token(record)
        key = (record.source_channel, record.source_surface, site_id, collector_run_token)
        grouped.setdefault(key, []).append(record)

    snapshots: list[dict[str, Any]] = []
    for (source_channel, source_surface, site_id, collector_run_token), run_records in sorted(
        grouped.items(),
        key=lambda item: item[0],
    ):
        ordered_records = sorted(run_records, key=_record_sort_key)
        latest_record = ordered_records[-1]
        merged_trace_rows = tuple(
            row for record in ordered_records for row in traces_by_job_id.get(record.job_id, ())
        )
        queue_status_counts = dict(Counter(record.status for record in ordered_records))
        run_key = f"{source_channel}:{source_surface}:{site_id}:{collector_run_token}"
        snapshot = {
            "id": f"{source_channel}:run:{site_id}:{collector_run_token}",
            "runKey": run_key,
            "sourceChannel": source_channel,
            "sourceSurface": source_surface,
            "siteId": site_id,
            "collectorRunToken": collector_run_token,
            "runId": _display_run_id(latest_record, collector_run_token=collector_run_token),
            "replayBatchId": _latest_text(record.replay_batch_id for record in ordered_records),
            "enqueueSource": _latest_text(record.enqueue_source for record in ordered_records),
            "lifecycleStatus": _lifecycle_status(queue_status_counts),
            "latestStage": latest_record.status,
            "latestQueueStatus": latest_record.status,
            "queueJobCount": len(ordered_records),
            "queueStatusCounts": queue_status_counts,
            "attemptCount": len(ordered_records),
            "sourceTruth": _source_truth_summary(merged_trace_rows),
            "childTaskSummary": _child_task_rollup(merged_trace_rows),
            "downstream": _downstream_summary(merged_trace_rows),
            "jobSummaries": [
                _job_summary(record=record, trace_rows=traces_by_job_id.get(record.job_id, ()))
                for record in ordered_records
            ],
            "timeline": _timeline(merged_trace_rows, fallback_records=ordered_records),
            "lastErrorCode": _latest_error_code(latest_record, merged_trace_rows),
            "lastErrorMessage": _latest_error_message(latest_record, merged_trace_rows),
            "firstObservedAt": _first_observed_at(ordered_records, merged_trace_rows),
            "lastObservedAt": _last_observed_at(ordered_records, merged_trace_rows) or projected_at,
            "projectedAt": projected_at,
            "producerVersion": producer_version,
            "redactionVersion": REDACTION_VERSION,
        }
        snapshots.append(_sanitize_value(snapshot))
    return tuple(snapshots)


def _trace_rows_by_job_id(
    trace_rows: Sequence[Mapping[str, Any]],
) -> dict[str, tuple[Mapping[str, Any], ...]]:
    grouped: dict[str, list[Mapping[str, Any]]] = {}
    for row in trace_rows:
        job_id = _optional_text(row.get("job_id") or row.get("jobId"))
        if job_id:
            grouped.setdefault(job_id, []).append(row)
    return {key: tuple(sorted(value, key=_trace_sort_key)) for key, value in grouped.items()}


def _site_id(record: NoticeIngestQueueRecord) -> str:
    site_id = _optional_text(record.job.site_id)
    if site_id:
        return site_id
    if ":" in record.run_id:
        return record.run_id.split(":", 1)[0]
    if ":" in record.source_identity:
        return record.source_identity.split(":", 1)[0]
    return "unknown_site"


def _collector_run_token(record: NoticeIngestQueueRecord) -> str:
    run_id = _optional_text(record.run_id) or "unknown_run"
    parts = run_id.split(":")
    if len(parts) >= 3 and parts[1] == record.source_surface:
        return parts[2]
    match = re.search(r"(\d{8}T\d{9}Z)", run_id)
    if match:
        return match.group(1)
    return run_id


def _display_run_id(record: NoticeIngestQueueRecord, *, collector_run_token: str) -> str:
    parts = record.run_id.split(":")
    if len(parts) >= 3 and parts[2] == collector_run_token:
        return ":".join(parts[:3])
    return record.run_id


def _lifecycle_status(queue_status_counts: Mapping[str, int]) -> str:
    statuses = {status for status, count in queue_status_counts.items() if count > 0}
    if not statuses:
        return "unknown"
    if statuses <= {"succeeded"}:
        return "succeeded"
    if statuses & _ACTIVE_STATUSES:
        return "active"
    if "manual_review" in statuses:
        return "manual_review"
    if "cancelled" in statuses and len(statuses) == 1:
        return "cancelled"
    if statuses & _FAILED_STATUSES and "succeeded" in statuses:
        return "mixed_terminal"
    if statuses & _FAILED_STATUSES:
        return "failed_terminal"
    if statuses <= _TERMINAL_STATUSES:
        return "mixed_terminal"
    return "observed"


def _source_truth_summary(trace_rows: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    notice_ids: set[str] = set()
    titles: dict[str, str] = {}
    for row in trace_rows:
        import_result = _mapping(row.get("import_result"))
        for item in _list_of_mappings(import_result.get("selected_notices")):
            notice_id = _optional_text(item.get("notice_id") or item.get("noticeId"))
            if not notice_id:
                continue
            notice_ids.add(notice_id)
            title = _optional_text(item.get("title"))
            if title:
                titles[notice_id] = title
        notice_ids.update(_string_list(import_result.get("selected_notice_ids")))
    return {
        "selectedNoticeCount": len(notice_ids),
        "selectedNoticeIds": sorted(notice_ids),
        "titleSamples": [titles[key] for key in sorted(titles)[:5]],
    }


def _child_task_rollup(trace_rows: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    by_kind: Counter[str] = Counter()
    by_state: Counter[str] = Counter()
    total = 0
    highest_severity: str | None = None
    for row in trace_rows:
        summary = _mapping(row.get("child_task_summary") or row.get("childTaskSummary"))
        for key, value in _mapping(summary.get("by_kind") or summary.get("byKind")).items():
            by_kind[_camel_case(str(key))] += _optional_int(value) or 0
        for key, value in _mapping(summary.get("by_state") or summary.get("byState")).items():
            by_state[_camel_case(str(key))] += _optional_int(value) or 0
        total += _optional_int(summary.get("task_count") or summary.get("total")) or 0
        severity = _optional_text(summary.get("highest_severity") or summary.get("highestSeverity"))
        if severity and (highest_severity is None or severity > highest_severity):
            highest_severity = severity
    return {
        "byKind": dict(sorted(by_kind.items())),
        "byState": dict(sorted(by_state.items())),
        "highestSeverity": highest_severity,
        "total": total,
    }


def _downstream_summary(trace_rows: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    release_ids: set[str] = set()
    candidate_kinds: set[str] = set()
    target_surfaces: set[str] = set()
    statuses: set[str] = set()
    for row in trace_rows:
        downstream = _mapping(row.get("downstream_materialization"))
        status = _optional_text(downstream.get("status"))
        if status:
            statuses.add(status)
        typed = _mapping(downstream.get("typed_materialization"))
        typed_status = _optional_text(typed.get("status"))
        if typed_status:
            statuses.add(typed_status)
        for release in _list_of_mappings(typed.get("materialized_releases")):
            release_id = _optional_text(release.get("release_id") or release.get("releaseId"))
            if release_id:
                release_ids.add(release_id)
            candidate_kind = _optional_text(
                release.get("candidate_kind") or release.get("candidateKind")
            )
            if candidate_kind:
                candidate_kinds.add(candidate_kind)
                target_surfaces.add(_target_surface(candidate_kind, release=release))
    return {
        "candidateKinds": sorted(candidate_kinds),
        "materializedReleaseCount": len(release_ids),
        "statuses": sorted(statuses),
        "targetSurfaces": sorted(target_surfaces),
    }


def _target_surface(candidate_kind: str, *, release: Mapping[str, Any]) -> str:
    if candidate_kind in {"transport_schedule", "service_status"}:
        return "campus_services"
    if candidate_kind == "regulation":
        collection = _optional_text(release.get("collection")) or "scoped_rules"
        return f"regulations/{collection}"
    collection = _optional_text(release.get("collection"))
    return collection or candidate_kind


def _job_summary(
    *,
    record: NoticeIngestQueueRecord,
    trace_rows: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    return {
        "attemptCount": record.attempt_count + 1,
        "jobId": record.job_id,
        "lastErrorCode": record.last_error_code,
        "lastErrorMessage": record.last_error_message,
        "queueStatus": record.status,
        "runId": record.run_id,
        "selectedNoticeCount": _source_truth_summary(trace_rows)["selectedNoticeCount"],
        "updatedAt": _datetime_iso(record.updated_at),
    }


def _timeline(
    trace_rows: Sequence[Mapping[str, Any]],
    *,
    fallback_records: Sequence[NoticeIngestQueueRecord],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for trace_row in sorted(trace_rows, key=_trace_sort_key):
        for event in _list_of_mappings(trace_row.get("progress_events")):
            stage = _optional_text(event.get("stage"))
            transition = _optional_text(event.get("transition") or event.get("status"))
            generated_at = _optional_text(event.get("generated_at") or event.get("occurredAt"))
            message = _optional_text(event.get("message") or event.get("summary"))
            if not (stage and transition and generated_at and message):
                continue
            payload: dict[str, Any] = {}
            reason_code = _optional_text(event.get("reason_code") or event.get("reasonCode"))
            if reason_code:
                payload["reasonCode"] = reason_code
            rows.append(
                {
                    "eventId": _optional_text(event.get("event_id") or event.get("eventId")),
                    "occurredAt": generated_at,
                    "payload": payload,
                    "stage": stage,
                    "status": transition,
                    "summary": message,
                }
            )
    if rows:
        return rows
    return [
        {
            "occurredAt": _datetime_iso(record.updated_at),
            "stage": record.status,
            "status": record.status,
            "summary": f"queue job observed: {record.status}",
        }
        for record in fallback_records
    ]


def _latest_error_code(
    latest_record: NoticeIngestQueueRecord,
    trace_rows: Sequence[Mapping[str, Any]],
) -> str | None:
    for row in reversed(sorted(trace_rows, key=_trace_sort_key)):
        value = _optional_text(row.get("error_code") or row.get("errorCode"))
        if value:
            return value
    return latest_record.last_error_code


def _latest_error_message(
    latest_record: NoticeIngestQueueRecord,
    trace_rows: Sequence[Mapping[str, Any]],
) -> str | None:
    for row in reversed(sorted(trace_rows, key=_trace_sort_key)):
        value = _optional_text(row.get("error_message") or row.get("errorMessage"))
        if value:
            return value
    return latest_record.last_error_message


def _first_observed_at(
    records: Sequence[NoticeIngestQueueRecord],
    trace_rows: Sequence[Mapping[str, Any]],
) -> str:
    candidates = [
        value
        for value in (
            [_datetime_iso(record.created_at) for record in records]
            + [_trace_sort_key(row) for row in trace_rows]
        )
        if value
    ]
    return min(candidates) if candidates else ""


def _last_observed_at(
    records: Sequence[NoticeIngestQueueRecord],
    trace_rows: Sequence[Mapping[str, Any]],
) -> str:
    candidates = [
        value
        for value in (
            [_datetime_iso(record.updated_at) for record in records]
            + [_trace_sort_key(row) for row in trace_rows]
        )
        if value
    ]
    return max(candidates) if candidates else ""


def _trace_sort_key(row: Mapping[str, Any]) -> str:
    generated_at = _optional_text(row.get("generated_at") or row.get("occurredAt"))
    if generated_at:
        return generated_at
    for event in _list_of_mappings(row.get("progress_events")):
        event_time = _optional_text(event.get("generated_at") or event.get("occurredAt"))
        if event_time:
            return event_time
    return ""


def _record_sort_key(record: NoticeIngestQueueRecord) -> tuple[str, str]:
    return (_datetime_iso(record.updated_at), record.job_id)


def _latest_text(values: Sequence[str] | Any) -> str | None:
    if not isinstance(values, Sequence):
        values = tuple(values)
    for value in reversed(tuple(values)):
        text = _optional_text(value)
        if text:
            return text
    return None


def _mapping(value: object) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _list_of_mappings(value: object) -> tuple[Mapping[str, Any], ...]:
    if isinstance(value, Sequence) and not isinstance(value, str | bytes):
        return tuple(item for item in value if isinstance(item, Mapping))
    return ()


def _string_list(value: object) -> tuple[str, ...]:
    if isinstance(value, Sequence) and not isinstance(value, str | bytes):
        return tuple(text for item in value if (text := _optional_text(item)))
    return ()


def _optional_text(value: object) -> str | None:
    text = str(value or "").strip()
    return text or None


def _optional_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _datetime_iso(value: object) -> str:
    if hasattr(value, "isoformat"):
        return value.isoformat().replace("+00:00", "Z")
    return _optional_text(value) or ""


def _camel_case(value: str) -> str:
    parts = [part for part in value.strip().split("_") if part]
    if not parts:
        return value
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


def _sanitize_value(value: Any) -> Any:
    if isinstance(value, Mapping):
        sanitized = {}
        for key, item in value.items():
            if str(key) in _FORBIDDEN_KEYS:
                continue
            sanitized[key] = _sanitize_value(item)
        return sanitized
    if isinstance(value, Sequence) and not isinstance(value, str | bytes):
        return [_sanitize_value(item) for item in value]
    return value


__all__ = [
    "DEFAULT_PRODUCER_VERSION",
    "REDACTION_VERSION",
    "AuthenticatedNoticeRunProcessingProjectionReporter",
    "build_authenticated_notice_run_processing_snapshots",
]
