from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE,
    AuthenticatedNoticeCollectorRunObjectRefs,
    resolve_authenticated_notice_collector_run_refs,
)
from campus_ingestion_core.authenticated_notice_defaults import (
    DEFAULT_AUTHENTICATED_NOTICE_COLLECTION,
    DEFAULT_AUTHENTICATED_NOTICE_CORPUS,
    DEFAULT_AUTHENTICATED_NOTICE_ENTITLEMENT_GROUPS,
    DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE,
)
from campus_ingestion_core.authenticated_notice_import import (
    AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE,
    AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN,
    AuthenticatedNoticeImportRequest,
    import_authenticated_notice_export,
)
from campus_ingestion_core.authenticated_notice_import_sources import (
    AuthenticatedNoticeImportObjectStoreReader,
    get_verified_authenticated_notice_object_bytes,
)
from campus_ingestion_core.authenticated_notice_media_gate_evidence import (
    build_authenticated_notice_media_gate_evidence_manifest,
    validate_authenticated_notice_media_gate_evidence_manifest,
)
from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.collected_notice_ingest_queue import (
    AUTHENTICATED_NOTICE_INGEST_JOB_KIND,
    AUTHENTICATED_NOTICE_INGEST_JOB_SCHEMA_VERSION,
)
from campus_ingestion_core.collected_notice_ingest_queue_store import (
    DEFAULT_NOTICE_INGEST_QUEUE_LEASE_SECONDS,
    NoticeIngestQueueRecord,
    NoticeIngestQueueStore,
)

AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_SCHEMA_VERSION = (
    "authenticated_notice_run_queue_consume.v1"
)
AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_TRACE_SCHEMA_VERSION = (
    "authenticated_notice_run_queue_consume_trace.v1"
)
AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_FAILED_REPORT_SCHEMA_VERSION = (
    "authenticated_notice_run_queue_consume_failed_report.v1"
)
DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_WORKER_ID = (
    "authenticated-notice-run-queue-consumer"
)
DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_LIMIT = 10
DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_RETRY_AFTER_SECONDS = 300


class AuthenticatedNoticeRunQueueImportCallable(Protocol):
    def __call__(
        self,
        *,
        request: AuthenticatedNoticeImportRequest,
        env: dict[str, str] | None = None,
        object_store: object | None = None,
    ) -> Mapping[str, Any]: ...


AuthenticatedNoticeRunRefResolver = Callable[
    ...,
    AuthenticatedNoticeCollectorRunObjectRefs,
]


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeRunQueueConsumeResult:
    queue_consume: dict[str, Any]
    trace: dict[str, Any]
    failed_report: dict[str, Any]

    def to_output_files(self) -> dict[str, dict[str, Any]]:
        main_filename = (
            "authenticated-notice-run-queue-consume.execute.json"
            if self.queue_consume.get("mode") == "execute"
            else "authenticated-notice-run-queue-consume.dry-run.json"
        )
        return {
            main_filename: self.queue_consume,
            "authenticated-notice-run-queue-consume.trace.json": self.trace,
            "authenticated-notice-run-queue-consume-failed-report.json": self.failed_report,
        }


class _RunQueueConsumeFailure(RuntimeError):
    def __init__(self, *, error_code: str, message: str, failure_class: str) -> None:
        super().__init__(message)
        if failure_class not in {"retryable", "terminal", "manual_review"}:
            raise ValueError("unsupported failure_class")
        self.error_code = error_code
        self.failure_class = failure_class


def consume_authenticated_notice_ingest_queue(
    *,
    queue_store: NoticeIngestQueueStore,
    object_store: AuthenticatedNoticeImportObjectStoreReader | object,
    mode: str = "dry_run",
    worker_id: str = DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_WORKER_ID,
    lease_seconds: int = DEFAULT_NOTICE_INGEST_QUEUE_LEASE_SECONDS,
    limit: int = DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_LIMIT,
    replay_batch_id: str | None = None,
    run_id: str | None = None,
    site_id: str,
    source_home_url: str,
    source_surface: str = "notice",
    collector_run_ledger_table: str = DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE,
    env: Mapping[str, str] | None = None,
    importer: AuthenticatedNoticeRunQueueImportCallable = import_authenticated_notice_export,
    run_ref_resolver: AuthenticatedNoticeRunRefResolver = (
        resolve_authenticated_notice_collector_run_refs
    ),
    retry_after_seconds: int = DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_RETRY_AFTER_SECONDS,
    source_truth_only: bool = True,
    require_media_gate: bool = False,
    media_gate_evidence_dir: Path | None = None,
    consumer_admission_manifest_path: Path | None = None,
    corpus: str = DEFAULT_AUTHENTICATED_NOTICE_CORPUS,
    collection: str = DEFAULT_AUTHENTICATED_NOTICE_COLLECTION,
    default_entitlement_groups: Sequence[str] = DEFAULT_AUTHENTICATED_NOTICE_ENTITLEMENT_GROUPS,
    visibility_scope: str | None = DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE,
    generated_by: str = "campus_ingestion_worker.consume_authenticated_notice_ingest_queue",
) -> AuthenticatedNoticeRunQueueConsumeResult:
    normalized_mode = _normalize_mode(mode)
    normalized_worker_id = _required_text(worker_id, "worker_id")
    normalized_limit = _positive_int(limit, "limit")
    normalized_lease_seconds = _positive_int(lease_seconds, "lease_seconds")
    normalized_retry_after_seconds = _non_negative_int(
        retry_after_seconds,
        "retry_after_seconds",
    )
    normalized_run_id = str(run_id or "").strip() or None
    normalized_replay_batch_id = str(replay_batch_id or "").strip() or None
    normalized_site_id = _required_text(site_id, "site_id")
    normalized_source_home_url = _required_text(source_home_url, "source_home_url")
    normalized_source_surface = _required_text(source_surface, "source_surface")
    source = dict(env or {})
    generated_at = utc_now()
    trace_rows: list[dict[str, Any]] = []
    failed_items: list[dict[str, Any]] = []
    completed_count = 0
    imported_count = 0

    while len(trace_rows) < normalized_limit:
        record = queue_store.lease_next(
            worker_id=normalized_worker_id,
            lease_seconds=normalized_lease_seconds,
            replay_batch_id=normalized_replay_batch_id,
            run_id=normalized_run_id,
        )
        if record is None:
            break
        trace_row = _base_trace_row(record)
        try:
            _assert_authenticated_notice_run_job(record)
            if record.source_surface != normalized_source_surface:
                raise _RunQueueConsumeFailure(
                    error_code="source_surface_mismatch",
                    message=(
                        "queue job source_surface mismatch: "
                        f"expected {normalized_source_surface}, got {record.source_surface}"
                    ),
                    failure_class="terminal",
                )
            refs = _resolve_and_verify_run_refs(
                record=record,
                env=source,
                collector_run_ledger_table=collector_run_ledger_table,
                run_ref_resolver=run_ref_resolver,
            )
            _verify_source_objects(object_store=object_store, refs=refs)
            import_result = importer(
                request=AuthenticatedNoticeImportRequest(
                    site_id=normalized_site_id,
                    source_home_url=normalized_source_home_url,
                    source_bucket=refs.source_bucket,
                    bundle_object_key=refs.bundle_object_key,
                    manifest_object_key=refs.manifest_object_key,
                    bundle_content_sha256=refs.bundle_content_sha256,
                    bundle_byte_size=refs.bundle_byte_size,
                    manifest_content_sha256=refs.manifest_content_sha256,
                    manifest_byte_size=refs.manifest_byte_size,
                    consumer_admission_manifest_path=consumer_admission_manifest_path,
                    corpus=corpus,
                    collection=collection,
                    default_entitlement_groups=tuple(default_entitlement_groups),
                    visibility_scope=visibility_scope,
                    mode=(
                        AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE
                        if normalized_mode == "execute"
                        else AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN
                    ),
                    source_truth_only=source_truth_only,
                ),
                env=source,
                object_store=object_store,
            )
            media_gate_verdict = None
            if require_media_gate:
                media_gate_verdict = _validate_required_media_gate(
                    run_id=record.run_id,
                    media_gate_evidence_dir=media_gate_evidence_dir,
                )
            imported_count += 1
            trace_row.update(
                {
                    "status": "imported",
                    "import_result": _import_result_summary(import_result),
                }
            )
            if media_gate_verdict is not None:
                trace_row["media_gate"] = media_gate_verdict
            if normalized_mode == "execute":
                queue_store.complete(record.job_id, worker_id=normalized_worker_id)
                completed_count += 1
                trace_row["status"] = "completed"
            else:
                queue_store.release(record.job_id, worker_id=normalized_worker_id)
        except _RunQueueConsumeFailure as exc:
            _apply_failure_transition(
                queue_store=queue_store,
                record=record,
                worker_id=normalized_worker_id,
                mode=normalized_mode,
                exc=exc,
                retry_after_seconds=normalized_retry_after_seconds,
            )
            failed_items.append(_failure_payload(record, exc))
            trace_row.update(
                {
                    "status": f"failed_{exc.failure_class}",
                    "error_code": exc.error_code,
                    "error_message": str(exc),
                    "failure_class": exc.failure_class,
                }
            )
            if normalized_mode != "execute":
                queue_store.release(record.job_id, worker_id=normalized_worker_id)
        except ValueError as exc:
            failure = _classify_value_error(exc)
            _apply_failure_transition(
                queue_store=queue_store,
                record=record,
                worker_id=normalized_worker_id,
                mode=normalized_mode,
                exc=failure,
                retry_after_seconds=normalized_retry_after_seconds,
            )
            failed_items.append(_failure_payload(record, failure))
            trace_row.update(
                {
                    "status": f"failed_{failure.failure_class}",
                    "error_code": failure.error_code,
                    "error_message": str(failure),
                    "failure_class": failure.failure_class,
                }
            )
            if normalized_mode != "execute":
                queue_store.release(record.job_id, worker_id=normalized_worker_id)
        except Exception as exc:
            failure = _RunQueueConsumeFailure(
                error_code="import_failed_retryable",
                message=f"authenticated notice import failed: {exc}",
                failure_class="retryable",
            )
            _apply_failure_transition(
                queue_store=queue_store,
                record=record,
                worker_id=normalized_worker_id,
                mode=normalized_mode,
                exc=failure,
                retry_after_seconds=normalized_retry_after_seconds,
            )
            failed_items.append(_failure_payload(record, failure))
            trace_row.update(
                {
                    "status": "failed_retryable",
                    "error_code": failure.error_code,
                    "error_message": str(failure),
                    "failure_class": failure.failure_class,
                }
            )
            if normalized_mode != "execute":
                queue_store.release(record.job_id, worker_id=normalized_worker_id)
        trace_rows.append(trace_row)

    counts = {
        "leased_count": len(trace_rows),
        "imported_count": imported_count,
        "completed_count": completed_count,
        "failed_count": len(failed_items),
        "retryable_count": sum(
            1 for item in failed_items if item.get("failure_class") == "retryable"
        ),
        "terminal_count": sum(
            1 for item in failed_items if item.get("failure_class") == "terminal"
        ),
        "manual_review_count": sum(
            1 for item in failed_items if item.get("failure_class") == "manual_review"
        ),
        "by_source_surface": dict(Counter(row["source_surface"] for row in trace_rows)),
    }
    return AuthenticatedNoticeRunQueueConsumeResult(
        queue_consume={
            "schema_version": AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_SCHEMA_VERSION,
            "generated_at": generated_at,
            "generated_by": generated_by,
            "mode": normalized_mode,
            "write_enabled": normalized_mode == "execute",
            "worker_id": normalized_worker_id,
            "lease_seconds": normalized_lease_seconds,
            "limit": normalized_limit,
            "run_id": normalized_run_id,
            "replay_batch_id": normalized_replay_batch_id,
            "source_truth_only": source_truth_only,
            "require_media_gate": require_media_gate,
            "media_gate_evidence_dir": (
                str(media_gate_evidence_dir) if media_gate_evidence_dir else None
            ),
            "planned_writes": {
                "queue_completion_rows": completed_count,
                "queue_failure_rows": len(failed_items) if normalized_mode == "execute" else 0,
            },
            "counts": counts,
        },
        trace={
            "schema_version": AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_TRACE_SCHEMA_VERSION,
            "generated_at": generated_at,
            "generated_by": generated_by,
            "mode": normalized_mode,
            "trace_rows": trace_rows,
        },
        failed_report=_failed_report(
            generated_at=generated_at,
            generated_by=generated_by,
            mode=normalized_mode,
            failed_items=tuple(failed_items),
        ),
    )


def _assert_authenticated_notice_run_job(record: NoticeIngestQueueRecord) -> None:
    if (
        record.job.schema_version != AUTHENTICATED_NOTICE_INGEST_JOB_SCHEMA_VERSION
        or record.job_kind != AUTHENTICATED_NOTICE_INGEST_JOB_KIND
    ):
        raise _RunQueueConsumeFailure(
            error_code="unsupported_queue_job_kind",
            message=(
                "authenticated notice run consumer only accepts "
                f"{AUTHENTICATED_NOTICE_INGEST_JOB_SCHEMA_VERSION}/"
                f"{AUTHENTICATED_NOTICE_INGEST_JOB_KIND}"
            ),
            failure_class="terminal",
        )


def _validate_required_media_gate(
    *,
    run_id: str,
    media_gate_evidence_dir: Path | None,
) -> dict[str, Any]:
    if media_gate_evidence_dir is None:
        raise _RunQueueConsumeFailure(
            error_code="media_gate_requires_manual_review",
            message="media gate evidence directory is required before queue completion",
            failure_class="manual_review",
        )
    try:
        manifest = build_authenticated_notice_media_gate_evidence_manifest(
            run_id=run_id,
            operations_dir=media_gate_evidence_dir,
        )
        return validate_authenticated_notice_media_gate_evidence_manifest(manifest)
    except Exception as exc:
        if isinstance(exc, _RunQueueConsumeFailure):
            raise
        raise _RunQueueConsumeFailure(
            error_code="media_gate_requires_manual_review",
            message=f"media gate evidence did not pass: {exc}",
            failure_class="manual_review",
        ) from exc


def _resolve_and_verify_run_refs(
    *,
    record: NoticeIngestQueueRecord,
    env: dict[str, str],
    collector_run_ledger_table: str,
    run_ref_resolver: AuthenticatedNoticeRunRefResolver,
) -> AuthenticatedNoticeCollectorRunObjectRefs:
    try:
        refs = run_ref_resolver(
            env=env,
            run_id=record.run_id,
            expected_source_surface=record.source_surface,
            table_name=collector_run_ledger_table,
        )
    except ValueError:
        raise
    except Exception as exc:
        raise _RunQueueConsumeFailure(
            error_code="collector_run_ledger_unavailable",
            message=f"collector run ledger unavailable for run_id {record.run_id}: {exc}",
            failure_class="retryable",
        ) from exc
    mismatches = []
    expected_pairs = (
        ("source_bucket", record.job.source_bucket, refs.source_bucket),
        ("bundle_object_key", record.job.bundle_object_key, refs.bundle_object_key),
        ("manifest_object_key", record.job.manifest_object_key, refs.manifest_object_key),
        ("bundle_content_sha256", record.job.bundle_content_sha256, refs.bundle_content_sha256),
        (
            "manifest_content_sha256",
            record.job.manifest_content_sha256,
            refs.manifest_content_sha256,
        ),
        ("bundle_byte_size", record.job.bundle_byte_size, refs.bundle_byte_size),
        ("manifest_byte_size", record.job.manifest_byte_size, refs.manifest_byte_size),
    )
    for field_name, job_value, ledger_value in expected_pairs:
        if job_value != ledger_value:
            mismatches.append(field_name)
    if mismatches:
        raise _RunQueueConsumeFailure(
            error_code="collector_run_ledger_mismatch",
            message=(
                "queue job object refs do not match verified collector run ledger: "
                + ", ".join(mismatches)
            ),
            failure_class="terminal",
        )
    return refs


def _verify_source_objects(
    *,
    object_store: AuthenticatedNoticeImportObjectStoreReader | object,
    refs: AuthenticatedNoticeCollectorRunObjectRefs,
) -> None:
    get_bytes = getattr(object_store, "get_bytes", None)
    if not callable(get_bytes):
        raise _RunQueueConsumeFailure(
            error_code="object_store_reader_unavailable",
            message="object_store must support get_bytes for authenticated notice run consume",
            failure_class="retryable",
        )
    for key, sha, size, label, missing_code in (
        (
            refs.bundle_object_key,
            refs.bundle_content_sha256,
            refs.bundle_byte_size,
            "authenticated notice bundle",
            "missing_bundle_object",
        ),
        (
            refs.manifest_object_key,
            refs.manifest_content_sha256,
            refs.manifest_byte_size,
            "authenticated notice export manifest",
            "missing_manifest_object",
        ),
    ):
        try:
            get_verified_authenticated_notice_object_bytes(
                reader=object_store,  # type: ignore[arg-type]
                bucket=refs.source_bucket,
                key=key,
                expected_sha256=sha,
                expected_byte_size=size,
                label=label,
                missing_reason_code=missing_code,
            )
        except ValueError as exc:
            raise _classify_value_error(exc) from exc
        except Exception as exc:
            raise _RunQueueConsumeFailure(
                error_code="source_object_read_failed",
                message=f"{label} source object read failed: {refs.source_bucket}/{key}: {exc}",
                failure_class="retryable",
            ) from exc


def _apply_failure_transition(
    *,
    queue_store: NoticeIngestQueueStore,
    record: NoticeIngestQueueRecord,
    worker_id: str,
    mode: str,
    exc: _RunQueueConsumeFailure,
    retry_after_seconds: int,
) -> None:
    if mode != "execute":
        return
    if exc.failure_class == "retryable":
        queue_store.fail_retryable(
            record.job_id,
            worker_id=worker_id,
            error_code=exc.error_code,
            error_message=str(exc),
            retry_after_seconds=retry_after_seconds,
        )
    elif exc.failure_class == "manual_review":
        queue_store.manual_review(
            record.job_id,
            worker_id=worker_id,
            error_code=exc.error_code,
            error_message=str(exc),
        )
    else:
        queue_store.fail_terminal(
            record.job_id,
            worker_id=worker_id,
            error_code=exc.error_code,
            error_message=str(exc),
        )


def _classify_value_error(exc: ValueError) -> _RunQueueConsumeFailure:
    message = str(exc)
    if "missing_bundle_object" in message or "missing_manifest_object" in message:
        return _RunQueueConsumeFailure(
            error_code="source_object_unavailable",
            message=message,
            failure_class="retryable",
        )
    if "size_mismatch" in message or "checksum_mismatch" in message:
        return _RunQueueConsumeFailure(
            error_code="source_object_integrity_mismatch",
            message=message,
            failure_class="terminal",
        )
    if "consumer admission manifest" in message or "strict audit" in message:
        return _RunQueueConsumeFailure(
            error_code="consumer_gate_requires_manual_review",
            message=message,
            failure_class="manual_review",
        )
    if "collector run ledger" in message:
        return _RunQueueConsumeFailure(
            error_code="collector_run_ledger_contract_violation",
            message=message,
            failure_class="terminal",
        )
    return _RunQueueConsumeFailure(
        error_code="import_contract_violation",
        message=message,
        failure_class="terminal",
    )


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


def _failure_payload(
    record: NoticeIngestQueueRecord,
    exc: _RunQueueConsumeFailure,
) -> dict[str, Any]:
    return {
        "job_id": record.job_id,
        "source_surface": record.source_surface,
        "source_identity": record.source_identity,
        "run_id": record.run_id,
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
        "schema_version": AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_FAILED_REPORT_SCHEMA_VERSION,
        "generated_at": generated_at,
        "generated_by": generated_by,
        "mode": mode,
        "failed_count": len(failed_items),
        "retryable_count": sum(
            1 for item in failed_items if item.get("failure_class") == "retryable"
        ),
        "terminal_count": sum(
            1 for item in failed_items if item.get("failure_class") == "terminal"
        ),
        "manual_review_count": sum(
            1 for item in failed_items if item.get("failure_class") == "manual_review"
        ),
        "reason_counts": dict(sorted(reason_counts.items())),
        "failed_items": [dict(item) for item in failed_items],
    }


def _import_result_summary(result: Mapping[str, Any]) -> dict[str, Any]:
    return {
        key: result[key]
        for key in (
            "mode",
            "source_truth_only",
            "notice_count",
            "raw_uploaded_count",
            "raw_reused_count",
            "consumption_projection_entry_count",
            "internal_notice_read_model_entry_count",
            "attachment_fetch_status_record_count",
        )
        if key in result
    }


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


def _non_negative_int(value: object, label: str) -> int:
    parsed = int(value)  # type: ignore[arg-type]
    if parsed < 0:
        raise ValueError(f"{label} must be non-negative")
    return parsed


__all__ = [
    "AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_FAILED_REPORT_SCHEMA_VERSION",
    "AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_SCHEMA_VERSION",
    "AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_TRACE_SCHEMA_VERSION",
    "DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_LIMIT",
    "DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_WORKER_ID",
    "DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_RETRY_AFTER_SECONDS",
    "AuthenticatedNoticeRunQueueConsumeResult",
    "AuthenticatedNoticeRunQueueImportCallable",
    "consume_authenticated_notice_ingest_queue",
]
