from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE,
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
)
from campus_ingestion_core.authenticated_notice_processing_projection import (
    DEFAULT_PRODUCER_VERSION as DEFAULT_AUTHENTICATED_NOTICE_PROCESSING_PROJECTION_PRODUCER_VERSION,
)
from campus_ingestion_core.authenticated_notice_processing_projection import (
    AuthenticatedNoticeProcessingProjectionReporter,
    build_authenticated_notice_processing_snapshots,
)
from campus_ingestion_core.authenticated_notice_processor_profiles import (
    get_processor_profile,
    profile_retry_budget,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_FAILED_REPORT_SCHEMA_VERSION,
    AuthenticatedNoticeRunRefResolver,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    LeaseHeartbeatMonitor as _LeaseHeartbeatMonitor,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    RunQueueConsumeFailure as _RunQueueConsumeFailure,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    append_child_task as _append_child_task,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    append_failure_child_task as _append_failure_child_task,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    apply_failure_transition as _apply_failure_transition,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    assert_authenticated_notice_run_job as _assert_authenticated_notice_run_job,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    attach_child_task_evidence as _attach_child_task_evidence,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    base_trace_row as _base_trace_row,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    classify_value_error as _classify_value_error,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    cleanup_summary as _cleanup_summary,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    default_cleanup_report_path as _default_cleanup_report_path,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    downstream_materialization_summary as _downstream_materialization_summary,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    fail_canonical_execution as _fail_canonical_execution,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    failed_report as _failed_report,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    failure_payload as _failure_payload,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    import_result_summary as _import_result_summary,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    mark_canonical_step_passed as _mark_canonical_step_passed,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    non_negative_int as _non_negative_int,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    normalize_heartbeat_interval_seconds as _normalize_heartbeat_interval_seconds,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    normalize_mode as _normalize_mode,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    positive_int as _positive_int,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    project_canonical_child_tasks as _project_canonical_child_tasks,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    raise_if_heartbeat_failed as _raise_if_heartbeat_failed,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    record_operations_dir as _record_operations_dir,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    required_text as _required_text,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    resolve_and_verify_run_refs as _resolve_and_verify_run_refs,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    typed_materialization_candidate_count as _typed_materialization_candidate_count,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    validate_required_media_gate as _validate_required_media_gate,
)
from campus_ingestion_core.authenticated_notice_run_queue_consumer_support import (
    verify_source_objects as _verify_source_objects,
)
from campus_ingestion_core.authenticated_notice_source_handoff_adapter import (
    AuthenticatedNoticeCanonicalExecutionContext,
    complete_authenticated_notice_canonical_execution,
    prepare_authenticated_notice_canonical_execution,
)
from campus_ingestion_core.campusrag_ingestion_reporting import utc_now
from campus_ingestion_core.collected_notice_ingest_queue_store import (
    DEFAULT_NOTICE_INGEST_QUEUE_LEASE_SECONDS,
    NoticeIngestQueueStore,
)
from campus_ingestion_core.source_handoff_store import SourceHandoffStore

AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_SCHEMA_VERSION = "authenticated_notice_run_queue_consume.v1"
AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_TRACE_SCHEMA_VERSION = (
    "authenticated_notice_run_queue_consume_trace.v1"
)
DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_WORKER_ID = "authenticated-notice-run-queue-consumer"
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


class AuthenticatedNoticeTypedDownstreamMaterializer(Protocol):
    def __call__(
        self,
        *,
        import_result: Mapping[str, Any],
        env: dict[str, str],
        object_store: object,
        operations_dir: Path,
        consumer_admission_manifest_path: Path,
        source_corpus: str,
        source_collection: str,
        run_id: str,
        job_id: str,
        generated_at: str,
    ) -> Mapping[str, Any]: ...


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


def consume_authenticated_notice_ingest_queue(
    *,
    queue_store: NoticeIngestQueueStore,
    object_store: AuthenticatedNoticeImportObjectStoreReader | object,
    mode: str = "dry_run",
    worker_id: str = DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_WORKER_ID,
    lease_seconds: int = DEFAULT_NOTICE_INGEST_QUEUE_LEASE_SECONDS,
    heartbeat_interval_seconds: float | None = None,
    limit: int = DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_LIMIT,
    replay_batch_id: str | None = None,
    run_id: str | None = None,
    site_id: str,
    source_home_url: str,
    source_surface: str = "notice",
    collector_run_ledger_table: str = DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE,
    env: Mapping[str, str] | None = None,
    importer: AuthenticatedNoticeRunQueueImportCallable = import_authenticated_notice_export,
    typed_downstream_materializer: AuthenticatedNoticeTypedDownstreamMaterializer | None = None,
    run_ref_resolver: AuthenticatedNoticeRunRefResolver = (
        resolve_authenticated_notice_collector_run_refs
    ),
    retry_after_seconds: int = DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_RETRY_AFTER_SECONDS,
    source_truth_only: bool = True,
    require_media_gate: bool = False,
    media_gate_evidence_dir: Path | None = None,
    operations_dir: Path | None = None,
    cleanup_report_path: Path | None = None,
    destructive_cleanup_enabled: bool = False,
    consumer_admission_manifest_path: Path | None = None,
    corpus: str = DEFAULT_AUTHENTICATED_NOTICE_CORPUS,
    collection: str = DEFAULT_AUTHENTICATED_NOTICE_COLLECTION,
    default_entitlement_groups: Sequence[str] = DEFAULT_AUTHENTICATED_NOTICE_ENTITLEMENT_GROUPS,
    visibility_scope: str | None = DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE,
    source_handoff_store: SourceHandoffStore | None = None,
    processing_projection_reporter: AuthenticatedNoticeProcessingProjectionReporter | None = None,
    processing_projection_producer_version: str = (
        DEFAULT_AUTHENTICATED_NOTICE_PROCESSING_PROJECTION_PRODUCER_VERSION
    ),
    generated_by: str = "campus_ingestion_worker.consume_authenticated_notice_ingest_queue",
) -> AuthenticatedNoticeRunQueueConsumeResult:
    normalized_mode = _normalize_mode(mode)
    normalized_worker_id = _required_text(worker_id, "worker_id")
    normalized_limit = _positive_int(limit, "limit")
    normalized_lease_seconds = _positive_int(lease_seconds, "lease_seconds")
    normalized_heartbeat_interval_seconds = _normalize_heartbeat_interval_seconds(
        lease_seconds=normalized_lease_seconds,
        heartbeat_interval_seconds=heartbeat_interval_seconds,
    )
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
        record_operations_dir = _record_operations_dir(
            root=operations_dir,
            record=record,
        )
        processor_profile = get_processor_profile("mixed_notice")
        canonical_context: AuthenticatedNoticeCanonicalExecutionContext | None = None
        child_tasks: list[dict[str, Any]] = []
        progress_events: list[dict[str, Any]] = []
        trace_row["operations_dir"] = str(record_operations_dir)
        heartbeat = _LeaseHeartbeatMonitor(
            queue_store=queue_store,
            record=record,
            worker_id=normalized_worker_id,
            lease_seconds=normalized_lease_seconds,
            interval_seconds=normalized_heartbeat_interval_seconds,
        ).start()
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
            if source_handoff_store is not None and normalized_mode == "execute":
                canonical_context = prepare_authenticated_notice_canonical_execution(
                    run_refs=refs,
                    site_id=normalized_site_id,
                    object_store=object_store,
                    source_handoff_store=source_handoff_store,
                    worker_id=normalized_worker_id,
                    lease_seconds=normalized_lease_seconds,
                    processor_profile=str(processor_profile["profile_id"]),
                )
                trace_row.update(
                    {
                        "source_handoff_id": canonical_context.handoff_id,
                        "ingestion_execution_id": canonical_context.execution_id,
                    }
                )
            else:
                _verify_source_objects(object_store=object_store, refs=refs)
            if not source_truth_only and consumer_admission_manifest_path is None:
                raise _RunQueueConsumeFailure(
                    error_code="consumer_admission_manifest_required",
                    message=(
                        "consumer admission manifest is required before downstream materialization"
                    ),
                    failure_class="manual_review",
                )
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
            _append_child_task(
                child_tasks=child_tasks,
                progress_events=progress_events,
                record=record,
                task_kind="source_unit_import",
                processor_profile_id=str(processor_profile["profile_id"]),
                state="completed",
                reason_code="source_truth_imported",
                output_refs=[
                    {
                        "role": "import_result_summary",
                        "schema_version": str(import_result.get("schema_version") or ""),
                    }
                ],
            )
            _mark_canonical_step_passed(
                source_handoff_store=source_handoff_store,
                canonical_context=canonical_context,
                step_name="source_truth_import",
                output_refs=[
                    {
                        "role": "import_result_summary",
                        "schema_version": str(import_result.get("schema_version") or ""),
                    }
                ],
            )
            media_gate_verdict = None
            if require_media_gate:
                media_gate_verdict = _validate_required_media_gate(
                    run_id=record.run_id,
                    media_gate_evidence_dir=media_gate_evidence_dir or record_operations_dir,
                )
            _append_child_task(
                child_tasks=child_tasks,
                progress_events=progress_events,
                record=record,
                task_kind="media_candidate_evaluation",
                processor_profile_id=str(processor_profile["profile_id"]),
                state="completed",
                reason_code=(
                    "strict_media_gate_passed"
                    if media_gate_verdict is not None
                    else "media_candidates_evaluated"
                ),
                output_refs=[
                    {
                        "role": "media_gate_verdict",
                        "artifact_path": str(
                            (media_gate_evidence_dir or record_operations_dir)
                            / "authenticated-notice-media-gate-evidence-verdict.json"
                        )
                        if media_gate_verdict is not None
                        else "",
                    }
                ],
            )
            _mark_canonical_step_passed(
                source_handoff_store=source_handoff_store,
                canonical_context=canonical_context,
                step_name="media_gate",
                output_refs=[
                    {
                        "role": "media_gate_verdict",
                        "schema_version": str(media_gate_verdict.get("schema_version") or "")
                        if media_gate_verdict is not None
                        else "",
                    }
                ],
            )
            typed_materialization = None
            if (
                not source_truth_only
                and _should_invoke_typed_materializer(import_result)
                and typed_downstream_materializer is not None
            ):
                typed_materialization = typed_downstream_materializer(
                    import_result=import_result,
                    env=source,
                    object_store=object_store,
                    operations_dir=record_operations_dir,
                    consumer_admission_manifest_path=consumer_admission_manifest_path,  # type: ignore[arg-type]
                    source_corpus=corpus,
                    source_collection=collection,
                    run_id=record.run_id,
                    job_id=record.job_id,
                    generated_at=generated_at,
                )
            cleanup = _cleanup_summary(
                cleanup_report_path=cleanup_report_path
                or _default_cleanup_report_path(record_operations_dir),
                destructive_cleanup_enabled=destructive_cleanup_enabled,
                media_gate_verdict=media_gate_verdict,
            )
            downstream_materialization = _downstream_materialization_summary(
                import_result,
                source_truth_only=source_truth_only,
                typed_materialization=typed_materialization,
            )
            if not source_truth_only:
                downstream_state = (
                    "completed"
                    if downstream_materialization["status"] == "completed"
                    else "manual_review"
                )
                downstream_reason = (
                    "downstream_materialization_completed"
                    if downstream_state == "completed"
                    else "downstream_materialization_missing"
                )
                _append_child_task(
                    child_tasks=child_tasks,
                    progress_events=progress_events,
                    record=record,
                    task_kind="downstream_materialization",
                    processor_profile_id=str(processor_profile["profile_id"]),
                    state=downstream_state,
                    reason_code=downstream_reason,
                    retry_budget=profile_retry_budget(
                        processor_profile,
                        "downstream_materialization",
                    ),
                    output_refs=[
                        {
                            "role": "downstream_materialization_summary",
                            "schema_version": str(
                                downstream_materialization.get("schema_version") or ""
                            ),
                        }
                    ],
                )
                if downstream_state == "completed":
                    _mark_canonical_step_passed(
                        source_handoff_store=source_handoff_store,
                        canonical_context=canonical_context,
                        step_name="downstream_materialization",
                        output_refs=[
                            {
                                "role": "downstream_materialization_summary",
                                "schema_version": str(
                                    downstream_materialization.get("schema_version") or ""
                                ),
                            }
                        ],
                    )
            cleanup_state = "manual_review" if cleanup["status"] == "blocked" else "completed"
            _append_child_task(
                child_tasks=child_tasks,
                progress_events=progress_events,
                record=record,
                task_kind="cleanup_evaluation",
                processor_profile_id=str(processor_profile["profile_id"]),
                state=cleanup_state,
                reason_code=(
                    "cleanup_requires_media_gate"
                    if cleanup_state == "manual_review"
                    else str(cleanup["status"])
                ),
                retry_budget=profile_retry_budget(processor_profile, "cleanup_evaluation"),
                output_refs=[
                    {
                        "role": "cleanup_report",
                        "artifact_path": str(cleanup.get("report_path") or ""),
                    }
                ],
            )
            if cleanup_state == "completed":
                _mark_canonical_step_passed(
                    source_handoff_store=source_handoff_store,
                    canonical_context=canonical_context,
                    step_name="cleanup_guard",
                    output_refs=[
                        {
                            "role": "cleanup_report",
                            "schema_version": str(cleanup.get("schema_version") or ""),
                        }
                    ],
                )
            imported_count += 1
            trace_row.update(
                {
                    "status": "imported",
                    "import_result": _import_result_summary(import_result),
                    "cleanup": cleanup,
                    "downstream_materialization": downstream_materialization,
                }
            )
            if media_gate_verdict is not None:
                trace_row["media_gate"] = media_gate_verdict
            _attach_child_task_evidence(trace_row, child_tasks, progress_events)
            _project_canonical_child_tasks(
                source_handoff_store=source_handoff_store,
                canonical_context=canonical_context,
                child_tasks=child_tasks,
            )
            if not source_truth_only and downstream_materialization["status"] != "completed":
                raise _RunQueueConsumeFailure(
                    error_code="downstream_materialization_missing",
                    message=(
                        "downstream materialization was requested but importer did not "
                        "report projection/read-model materialization evidence"
                    ),
                    failure_class="manual_review",
                )
            if cleanup["status"] == "blocked":
                raise _RunQueueConsumeFailure(
                    error_code="cleanup_requires_media_gate",
                    message=str(cleanup["reason"]),
                    failure_class="manual_review",
                )
            _raise_if_heartbeat_failed(heartbeat)
            if source_handoff_store is not None and canonical_context is not None:
                complete_authenticated_notice_canonical_execution(
                    source_handoff_store=source_handoff_store,
                    context=canonical_context,
                    result_kind="materialized",
                )
            if normalized_mode == "execute":
                queue_store.complete(record.job_id, worker_id=normalized_worker_id)
                completed_count += 1
                trace_row["status"] = "completed"
            else:
                queue_store.release(record.job_id, worker_id=normalized_worker_id)
        except _RunQueueConsumeFailure as exc:
            if not child_tasks:
                _append_failure_child_task(
                    child_tasks=child_tasks,
                    progress_events=progress_events,
                    record=record,
                    processor_profile_id=str(processor_profile["profile_id"]),
                    exc=exc,
                )
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
            _attach_child_task_evidence(trace_row, child_tasks, progress_events)
            _project_canonical_child_tasks(
                source_handoff_store=source_handoff_store,
                canonical_context=canonical_context,
                child_tasks=child_tasks,
            )
            _fail_canonical_execution(
                source_handoff_store=source_handoff_store,
                canonical_context=canonical_context,
                trace_row=trace_row,
                exc=exc,
                retry_after_seconds=normalized_retry_after_seconds,
            )
            if normalized_mode != "execute":
                queue_store.release(record.job_id, worker_id=normalized_worker_id)
        except ValueError as exc:
            failure = _classify_value_error(exc)
            if not child_tasks:
                _append_failure_child_task(
                    child_tasks=child_tasks,
                    progress_events=progress_events,
                    record=record,
                    processor_profile_id=str(processor_profile["profile_id"]),
                    exc=failure,
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
                    "status": f"failed_{failure.failure_class}",
                    "error_code": failure.error_code,
                    "error_message": str(failure),
                    "failure_class": failure.failure_class,
                }
            )
            _attach_child_task_evidence(trace_row, child_tasks, progress_events)
            _project_canonical_child_tasks(
                source_handoff_store=source_handoff_store,
                canonical_context=canonical_context,
                child_tasks=child_tasks,
            )
            _fail_canonical_execution(
                source_handoff_store=source_handoff_store,
                canonical_context=canonical_context,
                trace_row=trace_row,
                exc=failure,
                retry_after_seconds=normalized_retry_after_seconds,
            )
            if normalized_mode != "execute":
                queue_store.release(record.job_id, worker_id=normalized_worker_id)
        except Exception as exc:
            failure = _RunQueueConsumeFailure(
                error_code="import_failed_retryable",
                message=f"authenticated notice import failed: {exc}",
                failure_class="retryable",
            )
            if not child_tasks:
                _append_failure_child_task(
                    child_tasks=child_tasks,
                    progress_events=progress_events,
                    record=record,
                    processor_profile_id=str(processor_profile["profile_id"]),
                    exc=failure,
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
            _attach_child_task_evidence(trace_row, child_tasks, progress_events)
            _project_canonical_child_tasks(
                source_handoff_store=source_handoff_store,
                canonical_context=canonical_context,
                child_tasks=child_tasks,
            )
            _fail_canonical_execution(
                source_handoff_store=source_handoff_store,
                canonical_context=canonical_context,
                trace_row=trace_row,
                exc=failure,
                retry_after_seconds=normalized_retry_after_seconds,
            )
            if normalized_mode != "execute":
                queue_store.release(record.job_id, worker_id=normalized_worker_id)
        finally:
            trace_row["lease_heartbeat"] = heartbeat.stop()
        _report_processing_projection(
            reporter=processing_projection_reporter,
            record=record,
            trace_row=trace_row,
            producer_version=processing_projection_producer_version,
        )
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
            "heartbeat_interval_seconds": normalized_heartbeat_interval_seconds,
            "limit": normalized_limit,
            "run_id": normalized_run_id,
            "replay_batch_id": normalized_replay_batch_id,
            "source_truth_only": source_truth_only,
            "require_media_gate": require_media_gate,
            "media_gate_evidence_dir": (
                str(media_gate_evidence_dir) if media_gate_evidence_dir else None
            ),
            "operations_dir": str(operations_dir) if operations_dir else None,
            "cleanup_report_path": str(cleanup_report_path) if cleanup_report_path else None,
            "destructive_cleanup_enabled": destructive_cleanup_enabled,
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


__all__ = [
    "AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_FAILED_REPORT_SCHEMA_VERSION",
    "AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_SCHEMA_VERSION",
    "AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_TRACE_SCHEMA_VERSION",
    "DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_LIMIT",
    "DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_WORKER_ID",
    "DEFAULT_AUTHENTICATED_NOTICE_RUN_QUEUE_RETRY_AFTER_SECONDS",
    "AuthenticatedNoticeProcessingProjectionReporter",
    "AuthenticatedNoticeRunQueueConsumeResult",
    "AuthenticatedNoticeRunQueueImportCallable",
    "AuthenticatedNoticeTypedDownstreamMaterializer",
    "consume_authenticated_notice_ingest_queue",
]
