from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any, Protocol

from campus_ingestion_core.collected_notice_ingest_queue_store import NoticeIngestQueueRecord

REDACTION_VERSION = "authenticated_notice_processing_redaction.v1"
DEFAULT_PRODUCER_VERSION = "campus_ingestion_core.authenticated_notice_processing_projection.v1"

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


class AuthenticatedNoticeProcessingProjectionReporter(Protocol):
    def report(self, *, snapshots: Sequence[Mapping[str, Any]]) -> None: ...


def build_authenticated_notice_processing_snapshots(
    *,
    record: NoticeIngestQueueRecord,
    trace_row: Mapping[str, Any],
    projected_at: str,
    producer_version: str = DEFAULT_PRODUCER_VERSION,
) -> tuple[dict[str, Any], ...]:
    import_result = _mapping(trace_row.get("import_result"))
    downstream = _mapping(trace_row.get("downstream_materialization"))
    typed_materialization = _mapping(downstream.get("typed_materialization"))
    releases = _list_of_mappings(typed_materialization.get("materialized_releases"))
    notices = _selected_notices(import_result=import_result, releases=releases)
    if not notices:
        return ()
    snapshots: list[dict[str, Any]] = []
    for notice_id, title in notices.items():
        release = _release_for_notice(releases, notice_id)
        candidate_kind = _candidate_kind(import_result=import_result, release=release)
        counts = _read_model_counts_for_notice(release=release, notice_id=notice_id)
        lifecycle_status = _lifecycle_status(
            queue_status=_queue_status(trace_row=trace_row, record=record),
            candidate_kind=candidate_kind,
            current=_bool(release.get("current")) if release else False,
            downstream_status=str(downstream.get("status") or "").strip(),
            typed_status=str(typed_materialization.get("status") or "").strip(),
            trace_status=str(trace_row.get("status") or "").strip(),
            counts=counts,
        )
        notice_key = _notice_key(record=record, notice_id=notice_id)
        snapshot = {
            "id": _processing_id(record=record, notice_key=notice_key),
            "noticeKey": notice_key,
            "sourceChannel": record.source_channel,
            "sourceSurface": record.source_surface,
            "siteId": _site_id(record),
            "noticeId": notice_id,
            "title": title or f"notice:{notice_id}",
            "runId": record.run_id or None,
            "jobId": record.job_id or None,
            "replayBatchId": record.replay_batch_id or None,
            "enqueueSource": record.enqueue_source or None,
            "queueStatus": _queue_status(trace_row=trace_row, record=record),
            "lifecycleStatus": lifecycle_status,
            "latestStage": lifecycle_status,
            "targetSurface": _target_surface(candidate_kind),
            "candidateKind": candidate_kind,
            "materializationStatus": _materialization_status(
                lifecycle_status=lifecycle_status,
                downstream_status=str(downstream.get("status") or "").strip(),
                typed_status=str(typed_materialization.get("status") or "").strip(),
            ),
            "releaseId": _optional_text(release.get("release_id")) if release else None,
            "current": _bool(release.get("current")) if release else False,
            "toolReady": _tool_ready(candidate_kind=candidate_kind, release=release, counts=counts),
            "readModelCounts": counts,
            "childTaskSummary": _sanitize_value(trace_row.get("child_task_summary") or {}),
            "timeline": _timeline(trace_row=trace_row),
            "downstream": _downstream_summary(
                release=release,
                candidate_kind=candidate_kind,
                counts=counts,
            ),
            "lastErrorCode": _optional_text(trace_row.get("error_code") or record.last_error_code),
            "lastErrorMessage": _optional_text(
                trace_row.get("error_message") or record.last_error_message
            ),
            "attemptCount": int(record.attempt_count) + 1,
            "lastObservedAt": projected_at,
            "sourceUpdatedAt": _datetime_iso(record.updated_at),
            "projectedAt": projected_at,
            "producerVersion": producer_version,
            "redactionVersion": REDACTION_VERSION,
        }
        snapshots.append(_sanitize_value(snapshot))
    return tuple(snapshots)


def _selected_notices(
    *,
    import_result: Mapping[str, Any],
    releases: Sequence[Mapping[str, Any]],
) -> dict[str, str]:
    notices: dict[str, str] = {}
    for item in _list_of_mappings(import_result.get("selected_notices")):
        notice_id = _optional_text(item.get("notice_id") or item.get("noticeId"))
        if notice_id:
            notices[notice_id] = _optional_text(item.get("title")) or notices.get(notice_id, "")
    for notice_id in _string_list(import_result.get("selected_notice_ids")):
        notices.setdefault(notice_id, "")
    for release in releases:
        title_by_notice = _mapping(release.get("notice_titles") or release.get("noticeTitles"))
        for notice_id in _string_list(release.get("notice_ids") or release.get("noticeIds")):
            notices[notice_id] = _optional_text(title_by_notice.get(notice_id)) or notices.get(
                notice_id,
                "",
            )
    return notices


def _release_for_notice(
    releases: Sequence[Mapping[str, Any]],
    notice_id: str,
) -> Mapping[str, Any]:
    for release in releases:
        if notice_id in set(_string_list(release.get("notice_ids") or release.get("noticeIds"))):
            return release
    return {}


def _read_model_counts_for_notice(
    *,
    release: Mapping[str, Any],
    notice_id: str,
) -> dict[str, int]:
    per_notice = _mapping(
        release.get("notice_read_model_counts") or release.get("noticeReadModelCounts")
    )
    raw_counts = _mapping(per_notice.get(notice_id))
    counts: dict[str, int] = {}
    for key, value in raw_counts.items():
        if isinstance(value, bool):
            continue
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            continue
        if parsed >= 0:
            counts[_camel_case(str(key))] = parsed
    counts.setdefault("rejectedSources", 0)
    return counts


def _timeline(*, trace_row: Mapping[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for event in _list_of_mappings(trace_row.get("progress_events")):
        stage = _optional_text(event.get("stage"))
        transition = _optional_text(event.get("transition"))
        generated_at = _optional_text(event.get("generated_at") or event.get("occurredAt"))
        message = _optional_text(event.get("message"))
        if not (stage and transition and generated_at and message):
            continue
        payload = {}
        reason_code = _optional_text(event.get("reason_code") or event.get("reasonCode"))
        if reason_code:
            payload["reasonCode"] = reason_code
        rows.append(
            {
                "eventId": _optional_text(event.get("event_id") or event.get("eventId")),
                "stage": stage,
                "status": transition,
                "occurredAt": generated_at,
                "summary": message,
                "payload": payload,
            }
        )
    if rows:
        return rows
    status = _optional_text(trace_row.get("status")) or "observed"
    return [
        {
            "stage": status,
            "status": status,
            "occurredAt": _optional_text(trace_row.get("generated_at")) or "",
            "summary": f"authenticated notice processing observed: {status}",
        }
    ]


def _downstream_summary(
    *,
    release: Mapping[str, Any],
    candidate_kind: str | None,
    counts: Mapping[str, int],
) -> dict[str, Any] | None:
    if not release and not candidate_kind:
        return None
    return {
        "targetSurface": _target_surface(candidate_kind),
        "candidateKind": candidate_kind,
        "releaseId": _optional_text(release.get("release_id")) if release else None,
        "current": _bool(release.get("current")) if release else False,
        "toolReady": _tool_ready(candidate_kind=candidate_kind, release=release, counts=counts),
        "readModelCounts": dict(counts),
    }


def _lifecycle_status(
    *,
    queue_status: str,
    candidate_kind: str | None,
    current: bool,
    downstream_status: str,
    typed_status: str,
    trace_status: str,
    counts: Mapping[str, int],
) -> str:
    if queue_status in {"failed_retryable", "failed_terminal", "dead_letter", "manual_review"}:
        return queue_status
    if _tool_ready(candidate_kind=candidate_kind, release={"current": current}, counts=counts):
        return "tool_ready"
    if typed_status == "completed" or downstream_status == "completed":
        return "materialized"
    if trace_status in {"completed", "imported"}:
        return "imported"
    return trace_status or queue_status


def _materialization_status(
    *,
    lifecycle_status: str,
    downstream_status: str,
    typed_status: str,
) -> str | None:
    if lifecycle_status == "tool_ready":
        return "completed"
    if typed_status:
        return typed_status
    return downstream_status or None


def _tool_ready(
    *,
    candidate_kind: str | None,
    release: Mapping[str, Any],
    counts: Mapping[str, int],
) -> bool:
    if not _bool(release.get("current")):
        return False
    if candidate_kind == "transport_schedule":
        return (
            int(counts.get("scheduledDepartures") or 0) > 0
            and int(counts.get("rejectedSources") or 0) == 0
        )
    return bool(candidate_kind)


def _candidate_kind(
    *,
    import_result: Mapping[str, Any],
    release: Mapping[str, Any],
) -> str | None:
    candidate = _optional_text(release.get("candidate_kind") or release.get("candidateKind"))
    if candidate:
        return candidate
    kind_counts = _mapping(import_result.get("typed_materialization_candidate_kind_counts"))
    if len(kind_counts) == 1:
        return next(iter(kind_counts))
    return None


def _target_surface(candidate_kind: str | None) -> str | None:
    if candidate_kind in {"transport_schedule", "service_status"}:
        return "campus_services"
    return None


def _queue_status(*, trace_row: Mapping[str, Any], record: NoticeIngestQueueRecord) -> str:
    trace_status = str(trace_row.get("status") or "").strip()
    if trace_status == "completed":
        return "succeeded"
    if trace_status == "failed_manual_review":
        return "manual_review"
    if trace_status in {"failed_retryable", "failed_terminal"}:
        return trace_status
    return record.status


def _notice_key(*, record: NoticeIngestQueueRecord, notice_id: str) -> str:
    return f"{record.source_channel}:{record.source_surface}:{_site_id(record)}:{notice_id}"


def _processing_id(*, record: NoticeIngestQueueRecord, notice_key: str) -> str:
    return f"{notice_key}:{record.run_id}:{record.job_id}"


def _site_id(record: NoticeIngestQueueRecord) -> str:
    site_id = str(getattr(record.job, "site_id", "") or "").strip()
    if site_id:
        return site_id
    source_identity = str(record.source_identity or "")
    return source_identity.split(":", 1)[0] if ":" in source_identity else "unknown"


def _sanitize_value(value: object) -> Any:
    if isinstance(value, Mapping):
        sanitized: dict[str, Any] = {}
        for key, item in value.items():
            key_text = str(key)
            if key_text in _FORBIDDEN_KEYS:
                continue
            sanitized[key_text] = _sanitize_value(item)
        return sanitized
    if isinstance(value, Sequence) and not isinstance(value, str | bytes):
        return [_sanitize_value(item) for item in value]
    return value


def _mapping(value: object) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _list_of_mappings(value: object) -> tuple[Mapping[str, Any], ...]:
    if isinstance(value, Sequence) and not isinstance(value, str | bytes):
        return tuple(item for item in value if isinstance(item, Mapping))
    return ()


def _string_list(value: object) -> tuple[str, ...]:
    if isinstance(value, str | bytes) or not isinstance(value, Sequence):
        return ()
    return tuple(dict.fromkeys(str(item).strip() for item in value if str(item).strip()))


def _optional_text(value: object) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _bool(value: object) -> bool:
    return value is True


def _datetime_iso(value: object) -> str | None:
    isoformat = getattr(value, "isoformat", None)
    if callable(isoformat):
        return str(isoformat())
    return None


def _camel_case(value: str) -> str:
    normalized = value.strip()
    if not re.search(r"[_\-\s]", normalized):
        return normalized
    parts = [part for part in re.split(r"[_\-\s]+", normalized) if part]
    if not parts:
        return value
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])


__all__ = [
    "DEFAULT_PRODUCER_VERSION",
    "REDACTION_VERSION",
    "AuthenticatedNoticeProcessingProjectionReporter",
    "build_authenticated_notice_processing_snapshots",
]
