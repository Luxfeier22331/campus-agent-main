from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.collected_notice_ingest_queue import NoticeIngestObjectRef
from campus_ingestion_core.collected_notice_ingest_queue_store import (
    DEFAULT_NOTICE_INGEST_QUEUE_LEASE_SECONDS,
    NoticeIngestQueueRecord,
    NoticeIngestQueueStore,
)
from campus_ingestion_core.collected_notice_reimport_preview import (
    CollectedNoticeCapturedRunRef,
    build_collected_notice_reimport_preview,
)

PHASE_04_8_ID = "phase-04-8-queue-consumer-reimport-path"
QUEUE_CONSUME_SCHEMA_VERSION = "collected_notice_queue_consume.v1"
QUEUE_CONSUME_TRACE_SCHEMA_VERSION = "collected_notice_queue_consume_trace.v1"
QUEUE_CONSUME_FAILED_REPORT_SCHEMA_VERSION = "collected_notice_queue_consume_failed_report.v1"
QUEUE_CONSUME_SEARCHABLE_COVERAGE_SCHEMA_VERSION = (
    "collected_notice_queue_consume_searchable_coverage.v1"
)
DEFAULT_QUEUE_CONSUME_WORKER_ID = "collected-notice-queue-consumer"
DEFAULT_QUEUE_CONSUME_LIMIT = 25

_COLLECTOR_BUNDLE_ROLES = frozenset(("collector_bundle", "collector-run/bundle.json"))
_COLLECTOR_MANIFEST_ROLES = frozenset(("collector_manifest", "collector-run/manifest.json"))


class CollectedNoticeQueueConsumeWriter(Protocol):
    def write_consumed_job(
        self,
        *,
        job_id: str,
        source_truth_candidates: tuple[Mapping[str, Any], ...],
        searchable_units: tuple[Mapping[str, Any], ...],
    ) -> Mapping[str, Any]: ...


class QueueConsumeObjectReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class CollectedNoticeQueueConsumeResult:
    queue_consume: dict[str, Any]
    trace: dict[str, Any]
    failed_report: dict[str, Any]
    searchable_coverage: dict[str, Any]

    def to_output_files(self) -> dict[str, dict[str, Any]]:
        main_filename = (
            "queue-consume.execute.json"
            if self.queue_consume.get("mode") == "execute"
            else "queue-consume.dry-run.json"
        )
        return {
            main_filename: self.queue_consume,
            "queue-consume.trace.json": self.trace,
            "queue-consume-failed-report.json": self.failed_report,
            "searchable-coverage-after-queue-consume.json": self.searchable_coverage,
        }


@dataclass(frozen=True, slots=True)
class _Projection:
    source_truth_candidates: tuple[Mapping[str, Any], ...]
    searchable_units: tuple[Mapping[str, Any], ...]


class _QueueConsumeFailure(RuntimeError):
    def __init__(self, *, error_code: str, message: str, retryable: bool) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.retryable = retryable

    @property
    def failure_class(self) -> str:
        return "retryable" if self.retryable else "terminal"


def consume_collected_notice_ingest_queue(
    *,
    queue_store: NoticeIngestQueueStore,
    object_store: QueueConsumeObjectReader,
    mode: str = "dry_run",
    worker_id: str = DEFAULT_QUEUE_CONSUME_WORKER_ID,
    lease_seconds: int = DEFAULT_NOTICE_INGEST_QUEUE_LEASE_SECONDS,
    limit: int = DEFAULT_QUEUE_CONSUME_LIMIT,
    replay_batch_id: str | None = None,
    writer: CollectedNoticeQueueConsumeWriter | None = None,
    env: Mapping[str, str] | None = None,
    generated_by: str = "campus_ingestion_worker.consume_collected_notice_ingest_queue",
    default_site_id: str = "muc_internal_portal",
    default_source_home_url: str = "https://my.muc.edu.cn",
) -> CollectedNoticeQueueConsumeResult:
    normalized_mode = _normalize_mode(mode)
    if normalized_mode == "execute" and writer is None:
        raise ValueError("queue consume execute mode requires a configured writer")
    normalized_worker_id = _required_text(worker_id, "worker_id")
    normalized_limit = _positive_int(limit, "limit")
    normalized_lease_seconds = _positive_int(lease_seconds, "lease_seconds")
    normalized_replay_batch_id = str(replay_batch_id or "").strip() or None
    generated_at = utc_now()
    trace_rows: list[dict[str, Any]] = []
    failed_items: list[dict[str, Any]] = []
    consumed_items: list[dict[str, Any]] = []
    completed_count = 0
    failed_count = 0
    write_counts: Counter[str] = Counter()

    while len(trace_rows) < normalized_limit:
        record = queue_store.lease_next(
            worker_id=normalized_worker_id,
            lease_seconds=normalized_lease_seconds,
            replay_batch_id=normalized_replay_batch_id,
        )
        if record is None:
            break
        trace_row = _base_trace_row(record)
        try:
            projection = _project_record(
                record=record,
                object_store=object_store,
                env=env or {},
                generated_by=generated_by,
                default_site_id=default_site_id,
                default_source_home_url=default_source_home_url,
            )
            trace_row.update(
                {
                    "status": "projected",
                    "source_truth_candidate_refs": [
                        _source_truth_candidate_ref(candidate)
                        for candidate in projection.source_truth_candidates
                    ],
                    "searchable_unit_refs": [
                        str(unit.get("unit_id") or "") for unit in projection.searchable_units
                    ],
                }
            )
            if normalized_mode == "execute":
                assert writer is not None
                write_result = dict(
                    writer.write_consumed_job(
                        job_id=record.job_id,
                        source_truth_candidates=projection.source_truth_candidates,
                        searchable_units=projection.searchable_units,
                    )
                )
                queue_store.complete(record.job_id, worker_id=normalized_worker_id)
                completed_count += 1
                for key, value in write_result.items():
                    if key.endswith("_count"):
                        write_counts[key] += int(value or 0)
                trace_row["status"] = "completed"
                trace_row["write_result"] = write_result
            consumed_items.append(
                {
                    "job_id": record.job_id,
                    "source_surface": record.source_surface,
                    "source_identity": record.source_identity,
                    "replay_batch_id": record.replay_batch_id,
                    "searchable_unit_refs": trace_row["searchable_unit_refs"],
                }
            )
        except _QueueConsumeFailure as exc:
            failed_count += 1
            failure = _failure_payload(record, exc)
            failed_items.append(failure)
            trace_row.update(
                {
                    "status": f"failed_{exc.failure_class}",
                    "error_code": exc.error_code,
                    "error_message": str(exc),
                    "failure_class": exc.failure_class,
                    "searchable_unit_refs": [],
                    "source_truth_candidate_refs": [],
                }
            )
            if normalized_mode == "execute":
                if exc.retryable:
                    queue_store.fail_retryable(
                        record.job_id,
                        worker_id=normalized_worker_id,
                        error_code=exc.error_code,
                        error_message=str(exc),
                    )
                else:
                    queue_store.fail_terminal(
                        record.job_id,
                        worker_id=normalized_worker_id,
                        error_code=exc.error_code,
                        error_message=str(exc),
                    )
        trace_rows.append(trace_row)

    coverage = _coverage_report(
        generated_at=generated_at,
        generated_by=generated_by,
        trace_rows=tuple(trace_rows),
        failed_items=tuple(failed_items),
    )
    counts = {
        "leased_count": len(trace_rows),
        "projected_count": len(consumed_items),
        "completed_count": completed_count,
        "failed_count": failed_count,
        "searchable_unit_count": coverage["searchable_unit_count"],
        "source_truth_candidate_count": sum(
            len(row.get("source_truth_candidate_refs") or ()) for row in trace_rows
        ),
        "by_source_surface": dict(Counter(row["source_surface"] for row in trace_rows)),
        **dict(sorted(write_counts.items())),
    }
    queue_consume = {
        "schema_version": QUEUE_CONSUME_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": normalized_mode,
        "write_enabled": normalized_mode == "execute",
        "phase": PHASE_04_8_ID,
        "worker_id": normalized_worker_id,
        "lease_seconds": normalized_lease_seconds,
        "limit": normalized_limit,
        "replay_batch_id": normalized_replay_batch_id,
        "planned_writes": {
            "queue_completion_rows": completed_count,
            "queue_failure_rows": failed_count if normalized_mode == "execute" else 0,
            "downstream_admission_rows": 0,
        },
        "counts": counts,
        "consumed_items": consumed_items,
    }
    trace = {
        "schema_version": QUEUE_CONSUME_TRACE_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": normalized_mode,
        "phase": PHASE_04_8_ID,
        "trace_rows": trace_rows,
    }
    failed_report = _failed_report(
        generated_at=generated_at,
        generated_by=generated_by,
        mode=normalized_mode,
        failed_items=tuple(failed_items),
    )
    return CollectedNoticeQueueConsumeResult(
        queue_consume=queue_consume,
        trace=trace,
        failed_report=failed_report,
        searchable_coverage=coverage,
    )


def _project_record(
    *,
    record: NoticeIngestQueueRecord,
    object_store: QueueConsumeObjectReader,
    env: Mapping[str, str],
    generated_by: str,
    default_site_id: str,
    default_source_home_url: str,
) -> _Projection:
    bundle_ref = _find_first_ref_by_roles(record.source_object_refs, _COLLECTOR_BUNDLE_ROLES)
    manifest_ref = _find_first_ref_by_roles(record.source_object_refs, _COLLECTOR_MANIFEST_ROLES)
    missing_roles = []
    if bundle_ref is None:
        missing_roles.append("collector_bundle")
    if manifest_ref is None:
        missing_roles.append("collector_manifest")
    if missing_roles:
        raise _QueueConsumeFailure(
            error_code="missing_required_input_object_ref",
            message="missing required input object refs: " + ", ".join(missing_roles),
            retryable=False,
        )
    assert bundle_ref is not None
    assert manifest_ref is not None
    _assert_ref_is_readable(object_store=object_store, ref=bundle_ref, label="collector bundle")
    _assert_ref_is_readable(
        object_store=object_store,
        ref=manifest_ref,
        label="collector manifest",
    )
    run_ref = CollectedNoticeCapturedRunRef(
        run_id=record.run_id,
        source_surface=record.source_surface,
        source_bucket=bundle_ref.bucket,
        bundle_object_key=bundle_ref.key,
        manifest_object_key=manifest_ref.key,
        bundle_content_sha256=bundle_ref.content_sha256 or None,
        bundle_byte_size=bundle_ref.byte_size,
        manifest_content_sha256=manifest_ref.content_sha256 or None,
        manifest_byte_size=manifest_ref.byte_size,
        site_id=_site_id_from_record(record) or default_site_id,
        source_home_url=default_source_home_url,
    )
    preview = build_collected_notice_reimport_preview(
        run_refs=(run_ref,),
        env=dict(env),
        object_store=object_store,
        generated_by=generated_by,
        default_site_id=default_site_id,
        default_source_home_url=default_source_home_url,
    )
    source_identifier = _source_identifier_from_record(record)
    candidates = tuple(
        candidate
        for candidate in preview.reimport_plan["write_manifest_candidate"][
            "source_truth_candidates"
        ]
        if _matches_source(candidate, record=record, source_identifier=source_identifier)
    )
    units = tuple(
        unit
        for unit in preview.searchable_notice_preview["units"]
        if _matches_searchable_unit(unit, record=record, source_identifier=source_identifier)
    )
    if not candidates or not units:
        invalid_captures = preview.invalid_defer_multimodal_report.get("invalid_captures") or ()
        raise _QueueConsumeFailure(
            error_code="projection_not_found_for_job",
            message=(
                "queue job did not produce matching source-truth/searchable projection: "
                f"{record.source_surface} {record.source_identity}; "
                f"invalid_captures={len(tuple(invalid_captures))}"
            ),
            retryable=False,
        )
    return _Projection(
        source_truth_candidates=candidates,
        searchable_units=units,
    )


def _assert_ref_is_readable(
    *,
    object_store: QueueConsumeObjectReader,
    ref: NoticeIngestObjectRef,
    label: str,
) -> None:
    try:
        object_store.get_bytes(bucket=ref.bucket, key=ref.key)
    except Exception as exc:
        if _is_missing_object_error(exc):
            raise _QueueConsumeFailure(
                error_code="source_object_unavailable",
                message=f"{label} source object unavailable: {ref.bucket}/{ref.key}",
                retryable=True,
            ) from exc
        raise _QueueConsumeFailure(
            error_code="source_object_read_failed",
            message=f"{label} source object read failed: {ref.bucket}/{ref.key}: {exc}",
            retryable=True,
        ) from exc


def _base_trace_row(record: NoticeIngestQueueRecord) -> dict[str, Any]:
    return {
        "job_id": record.job_id,
        "source_channel": record.source_channel,
        "source_surface": record.source_surface,
        "source_identity": record.source_identity,
        "capture_id": record.capture_id,
        "run_id": record.run_id,
        "replay_batch_id": record.replay_batch_id,
        "source_object_refs": [ref.to_payload() for ref in record.source_object_refs],
    }


def _failure_payload(record: NoticeIngestQueueRecord, exc: _QueueConsumeFailure) -> dict[str, Any]:
    return {
        "job_id": record.job_id,
        "source_surface": record.source_surface,
        "source_identity": record.source_identity,
        "replay_batch_id": record.replay_batch_id,
        "error_code": exc.error_code,
        "error_message": str(exc),
        "failure_class": exc.failure_class,
    }


def _failed_report(
    *,
    generated_at: str,
    generated_by: str,
    mode: str,
    failed_items: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    reason_counts = Counter(str(item.get("error_code") or "") for item in failed_items)
    return {
        "schema_version": QUEUE_CONSUME_FAILED_REPORT_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": mode,
        "phase": PHASE_04_8_ID,
        "failed_count": len(failed_items),
        "retryable_count": sum(
            1 for item in failed_items if item.get("failure_class") == "retryable"
        ),
        "terminal_count": sum(
            1 for item in failed_items if item.get("failure_class") == "terminal"
        ),
        "reason_counts": dict(sorted(reason_counts.items())),
        "failed_items": [dict(item) for item in failed_items],
    }


def _coverage_report(
    *,
    generated_at: str,
    generated_by: str,
    trace_rows: Sequence[Mapping[str, Any]],
    failed_items: Sequence[Mapping[str, Any]],
) -> dict[str, Any]:
    projected_rows = [row for row in trace_rows if row.get("searchable_unit_refs")]
    searchable_unit_refs = [
        ref for row in projected_rows for ref in tuple(row.get("searchable_unit_refs") or ())
    ]
    missing_rows = [
        row
        for row in trace_rows
        if not row.get("searchable_unit_refs") and row.get("status") in {"projected", "completed"}
    ]
    projected_count = len(projected_rows)
    return {
        "schema_version": QUEUE_CONSUME_SEARCHABLE_COVERAGE_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": "queue_consume",
        "phase": PHASE_04_8_ID,
        "leased_count": len(trace_rows),
        "projected_job_count": projected_count,
        "failed_count": len(failed_items),
        "searchable_unit_count": len(searchable_unit_refs),
        "duplicate_searchable_unit_count": len(searchable_unit_refs)
        - len(set(searchable_unit_refs)),
        "missing_searchable_unit_count": len(missing_rows),
        "searchable_unit_refs": searchable_unit_refs,
        "verdict": "passed" if not failed_items and not missing_rows else "failed",
    }


def _source_truth_candidate_ref(candidate: Mapping[str, Any]) -> dict[str, Any]:
    document = candidate.get("document")
    if not isinstance(document, Mapping):
        document = {}
    return {
        "source_surface": candidate.get("source_surface"),
        "site_id": candidate.get("site_id"),
        "source_identifier": candidate.get("source_identifier"),
        "document_id": document.get("document_id"),
        "version_id": document.get("version_id"),
    }


def _matches_source(
    candidate: Mapping[str, Any],
    *,
    record: NoticeIngestQueueRecord,
    source_identifier: str,
) -> bool:
    return (
        str(candidate.get("source_surface") or "") == record.source_surface
        and str(candidate.get("source_identifier") or "") == source_identifier
    )


def _matches_searchable_unit(
    unit: Mapping[str, Any],
    *,
    record: NoticeIngestQueueRecord,
    source_identifier: str,
) -> bool:
    return (
        str(unit.get("source_surface") or "") == record.source_surface
        and str(unit.get("source_notice_id") or "") == source_identifier
    )


def _find_first_ref_by_roles(
    refs: Sequence[NoticeIngestObjectRef],
    roles: frozenset[str],
) -> NoticeIngestObjectRef | None:
    for ref in refs:
        if ref.role in roles:
            return ref
    return None


def _source_identifier_from_record(record: NoticeIngestQueueRecord) -> str:
    source_identity = str(record.source_identity).strip()
    if record.source_surface == "file_release" and source_identity.startswith("file_release:"):
        return source_identity.split(":", 1)[1]
    if ":" in source_identity:
        return source_identity.rsplit(":", 1)[1]
    return source_identity


def _site_id_from_record(record: NoticeIngestQueueRecord) -> str:
    source_identity = str(record.source_identity).strip()
    if record.source_surface == "notice" and ":" in source_identity:
        return source_identity.rsplit(":", 1)[0]
    return ""


def _normalize_mode(mode: str) -> str:
    normalized = str(mode or "").strip().lower().replace("-", "_")
    if normalized in {"dryrun", "preview"}:
        normalized = "dry_run"
    if normalized not in {"dry_run", "execute"}:
        raise ValueError("mode must be dry_run or execute")
    return normalized


def _required_text(value: object, label: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{label} is required")
    return normalized


def _positive_int(value: object, label: str) -> int:
    parsed = int(value)  # type: ignore[arg-type]
    if parsed <= 0:
        raise ValueError(f"{label} must be positive")
    return parsed


def _is_missing_object_error(exc: BaseException) -> bool:
    if isinstance(exc, KeyError):
        return True
    response = getattr(exc, "response", None)
    if isinstance(response, dict):
        error = response.get("Error")
        metadata = response.get("ResponseMetadata")
        if isinstance(error, dict) and str(error.get("Code") or "") in {
            "NoSuchKey",
            "NoSuchBucket",
            "NotFound",
            "404",
        }:
            return True
        if isinstance(metadata, dict) and str(metadata.get("HTTPStatusCode") or "") == "404":
            return True
    return exc.__class__.__name__ in {"NoSuchKey", "NoSuchBucket", "NotFound"}


__all__ = [
    "DEFAULT_QUEUE_CONSUME_LIMIT",
    "DEFAULT_QUEUE_CONSUME_WORKER_ID",
    "PHASE_04_8_ID",
    "QUEUE_CONSUME_FAILED_REPORT_SCHEMA_VERSION",
    "QUEUE_CONSUME_SCHEMA_VERSION",
    "QUEUE_CONSUME_SEARCHABLE_COVERAGE_SCHEMA_VERSION",
    "QUEUE_CONSUME_TRACE_SCHEMA_VERSION",
    "CollectedNoticeQueueConsumeResult",
    "CollectedNoticeQueueConsumeWriter",
    "QueueConsumeObjectReader",
    "consume_collected_notice_ingest_queue",
]
