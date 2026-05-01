from __future__ import annotations

import json
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from threading import Event, Lock, Thread
from typing import Any

from campus_ingestion_core.authenticated_notice_child_tasks import (
    build_child_task,
    build_progress_event,
    summarize_child_tasks,
)
from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    AuthenticatedNoticeCollectorRunObjectRefs,
)
from campus_ingestion_core.authenticated_notice_import_sources import (
    AuthenticatedNoticeImportObjectStoreReader,
    get_verified_authenticated_notice_object_bytes,
)
from campus_ingestion_core.authenticated_notice_media_gate_evidence import (
    build_authenticated_notice_media_gate_evidence_manifest,
    validate_authenticated_notice_media_gate_evidence_manifest,
)
from campus_ingestion_core.authenticated_notice_source_handoff_adapter import (
    AuthenticatedNoticeCanonicalExecutionContext,
    fail_authenticated_notice_canonical_execution,
    mark_authenticated_notice_canonical_step_passed,
    project_authenticated_notice_canonical_child_tasks,
)
from campus_ingestion_core.collected_notice_ingest_queue import (
    AUTHENTICATED_NOTICE_INGEST_JOB_KIND,
    AUTHENTICATED_NOTICE_INGEST_JOB_SCHEMA_VERSION,
)
from campus_ingestion_core.collected_notice_ingest_queue_store import (
    NoticeIngestQueueRecord,
    NoticeIngestQueueStore,
)
from campus_ingestion_core.source_handoff_store import SourceHandoffStore

AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_FAILED_REPORT_SCHEMA_VERSION = (
    "authenticated_notice_run_queue_consume_failed_report.v1"
)

AuthenticatedNoticeRunRefResolver = Callable[
    ...,
    AuthenticatedNoticeCollectorRunObjectRefs,
]


class RunQueueConsumeFailure(RuntimeError):
    def __init__(self, *, error_code: str, message: str, failure_class: str) -> None:
        super().__init__(message)
        if failure_class not in {"retryable", "terminal", "manual_review"}:
            raise ValueError("unsupported failure_class")
        self.error_code = error_code
        self.failure_class = failure_class


class LeaseHeartbeatMonitor:
    def __init__(
        self,
        *,
        queue_store: NoticeIngestQueueStore,
        record: NoticeIngestQueueRecord,
        worker_id: str,
        lease_seconds: int,
        interval_seconds: float,
    ) -> None:
        self._queue_store = queue_store
        self._record = record
        self._worker_id = worker_id
        self._lease_seconds = int(lease_seconds)
        self._interval_seconds = float(interval_seconds)
        self._stop = Event()
        self._lock = Lock()
        self._thread: Thread | None = None
        self._heartbeat_count = 0
        self._heartbeat_failed = False
        self._last_error_message = ""

    def start(self) -> LeaseHeartbeatMonitor:
        self._thread = Thread(
            target=self._run,
            name=f"authenticated-notice-lease-heartbeat:{self._record.job_id}",
            daemon=True,
        )
        self._thread.start()
        return self

    def stop(self) -> dict[str, Any]:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)
        return self.summary()

    def summary(self) -> dict[str, Any]:
        with self._lock:
            return {
                "enabled": True,
                "lease_seconds": self._lease_seconds,
                "interval_seconds": self._interval_seconds,
                "heartbeat_count": self._heartbeat_count,
                "heartbeat_failed": self._heartbeat_failed,
                "last_error_message": self._last_error_message,
            }

    def failure_message(self) -> str:
        with self._lock:
            return self._last_error_message if self._heartbeat_failed else ""

    def _run(self) -> None:
        while not self._stop.wait(self._interval_seconds):
            try:
                self._queue_store.heartbeat(
                    self._record.job_id,
                    worker_id=self._worker_id,
                    lease_seconds=self._lease_seconds,
                )
            except Exception as exc:
                with self._lock:
                    self._heartbeat_failed = True
                    self._last_error_message = str(exc)
                self._stop.set()
                return
            with self._lock:
                self._heartbeat_count += 1


def assert_authenticated_notice_run_job(record: NoticeIngestQueueRecord) -> None:
    if (
        record.job.schema_version != AUTHENTICATED_NOTICE_INGEST_JOB_SCHEMA_VERSION
        or record.job_kind != AUTHENTICATED_NOTICE_INGEST_JOB_KIND
    ):
        raise RunQueueConsumeFailure(
            error_code="unsupported_queue_job_kind",
            message=(
                "authenticated notice run consumer only accepts "
                f"{AUTHENTICATED_NOTICE_INGEST_JOB_SCHEMA_VERSION}/"
                f"{AUTHENTICATED_NOTICE_INGEST_JOB_KIND}"
            ),
            failure_class="terminal",
        )


def raise_if_heartbeat_failed(heartbeat: LeaseHeartbeatMonitor) -> None:
    message = heartbeat.failure_message()
    if not message:
        return
    raise RunQueueConsumeFailure(
        error_code="lease_heartbeat_failed",
        message=f"notice ingest queue lease heartbeat failed: {message}",
        failure_class="retryable",
    )


def validate_required_media_gate(
    *,
    run_id: str,
    media_gate_evidence_dir: Path | None,
) -> dict[str, Any]:
    if media_gate_evidence_dir is None:
        raise RunQueueConsumeFailure(
            error_code="media_gate_requires_manual_review",
            message="media gate evidence directory is required before queue completion",
            failure_class="manual_review",
        )
    try:
        manifest = build_authenticated_notice_media_gate_evidence_manifest(
            run_id=run_id,
            operations_dir=media_gate_evidence_dir,
        )
        verdict = validate_authenticated_notice_media_gate_evidence_manifest(manifest)
        write_json(
            media_gate_evidence_dir / "authenticated-notice-media-gate-evidence.json",
            manifest,
        )
        write_json(
            media_gate_evidence_dir / "authenticated-notice-media-gate-evidence-verdict.json",
            verdict,
        )
        return verdict
    except Exception as exc:
        if isinstance(exc, RunQueueConsumeFailure):
            raise
        raise RunQueueConsumeFailure(
            error_code="media_gate_requires_manual_review",
            message=f"media gate evidence did not pass: {exc}",
            failure_class="manual_review",
        ) from exc


def resolve_and_verify_run_refs(
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
        raise RunQueueConsumeFailure(
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
        raise RunQueueConsumeFailure(
            error_code="collector_run_ledger_mismatch",
            message=(
                "queue job object refs do not match verified collector run ledger: "
                + ", ".join(mismatches)
            ),
            failure_class="terminal",
        )
    return refs


def verify_source_objects(
    *,
    object_store: AuthenticatedNoticeImportObjectStoreReader | object,
    refs: AuthenticatedNoticeCollectorRunObjectRefs,
) -> None:
    get_bytes = getattr(object_store, "get_bytes", None)
    if not callable(get_bytes):
        raise RunQueueConsumeFailure(
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
            raise classify_value_error(exc) from exc
        except Exception as exc:
            raise RunQueueConsumeFailure(
                error_code="source_object_read_failed",
                message=f"{label} source object read failed: {refs.source_bucket}/{key}: {exc}",
                failure_class="retryable",
            ) from exc


def apply_failure_transition(
    *,
    queue_store: NoticeIngestQueueStore,
    record: NoticeIngestQueueRecord,
    worker_id: str,
    mode: str,
    exc: RunQueueConsumeFailure,
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


def classify_value_error(exc: ValueError) -> RunQueueConsumeFailure:
    message = str(exc)
    if "missing_bundle_object" in message or "missing_manifest_object" in message:
        return RunQueueConsumeFailure(
            error_code="source_object_unavailable",
            message=message,
            failure_class="retryable",
        )
    if "size_mismatch" in message or "checksum_mismatch" in message:
        return RunQueueConsumeFailure(
            error_code="source_object_integrity_mismatch",
            message=message,
            failure_class="terminal",
        )
    if "consumer admission manifest" in message or "strict audit" in message:
        return RunQueueConsumeFailure(
            error_code="consumer_gate_requires_manual_review",
            message=message,
            failure_class="manual_review",
        )
    if "collector run ledger" in message:
        return RunQueueConsumeFailure(
            error_code="collector_run_ledger_contract_violation",
            message=message,
            failure_class="terminal",
        )
    return RunQueueConsumeFailure(
        error_code="import_contract_violation",
        message=message,
        failure_class="terminal",
    )


def base_trace_row(record: NoticeIngestQueueRecord) -> dict[str, Any]:
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


def append_child_task(
    *,
    child_tasks: list[dict[str, Any]],
    progress_events: list[dict[str, Any]],
    record: NoticeIngestQueueRecord,
    task_kind: str,
    processor_profile_id: str,
    state: str,
    reason_code: str,
    retry_budget: Mapping[str, Any] | None = None,
    output_refs: Sequence[Mapping[str, Any]] | None = None,
) -> None:
    task = build_child_task(
        parent_job_id=record.job_id,
        run_id=record.run_id,
        task_kind=task_kind,
        processor_profile_id=processor_profile_id,
        state=state,
        source_unit_id=record.source_identity,
        attempt_ordinal=int(record.attempt_count) + 1,
        reason_code=reason_code,
        retry_budget=retry_budget,
        input_refs=[ref.to_payload() for ref in record.source_object_refs],
        output_refs=output_refs or (),
    )
    event = build_progress_event(
        parent_job_id=record.job_id,
        run_id=record.run_id,
        child_task_id=str(task["task_id"]),
        stage=task_kind,
        transition=state,
        reason_code=reason_code,
        message=f"{task_kind} transitioned to {state}: {reason_code}",
        input_refs=[ref.to_payload() for ref in record.source_object_refs],
        output_refs=output_refs or (),
    )
    task["progress_event_refs"] = [
        {
            "role": "progress_event",
            "key": str(event["event_id"]),
            "schema_version": str(event["schema_version"]),
        }
    ]
    child_tasks.append(task)
    progress_events.append(event)


def append_failure_child_task(
    *,
    child_tasks: list[dict[str, Any]],
    progress_events: list[dict[str, Any]],
    record: NoticeIngestQueueRecord,
    processor_profile_id: str,
    exc: RunQueueConsumeFailure,
) -> None:
    state = {
        "retryable": "failed_retryable",
        "terminal": "failed_terminal",
        "manual_review": "manual_review",
    }[exc.failure_class]
    append_child_task(
        child_tasks=child_tasks,
        progress_events=progress_events,
        record=record,
        task_kind="source_unit_import",
        processor_profile_id=processor_profile_id,
        state=state,
        reason_code=exc.error_code,
    )


def attach_child_task_evidence(
    trace_row: dict[str, Any],
    child_tasks: Sequence[Mapping[str, Any]],
    progress_events: Sequence[Mapping[str, Any]],
) -> None:
    trace_row["child_tasks"] = [dict(task) for task in child_tasks]
    trace_row["progress_events"] = [dict(event) for event in progress_events]
    trace_row["child_task_summary"] = summarize_child_tasks(child_tasks)


def mark_canonical_step_passed(
    *,
    source_handoff_store: SourceHandoffStore | None,
    canonical_context: AuthenticatedNoticeCanonicalExecutionContext | None,
    step_name: str,
    output_refs: Sequence[Mapping[str, object]] = (),
) -> None:
    if source_handoff_store is None or canonical_context is None:
        return
    mark_authenticated_notice_canonical_step_passed(
        source_handoff_store=source_handoff_store,
        context=canonical_context,
        step_name=step_name,
        output_refs=output_refs,
    )


def project_canonical_child_tasks(
    *,
    source_handoff_store: SourceHandoffStore | None,
    canonical_context: AuthenticatedNoticeCanonicalExecutionContext | None,
    child_tasks: Sequence[Mapping[str, object]],
) -> None:
    if source_handoff_store is None or canonical_context is None:
        return
    project_authenticated_notice_canonical_child_tasks(
        source_handoff_store=source_handoff_store,
        context=canonical_context,
        child_tasks=child_tasks,
    )


def fail_canonical_execution(
    *,
    source_handoff_store: SourceHandoffStore | None,
    canonical_context: AuthenticatedNoticeCanonicalExecutionContext | None,
    trace_row: dict[str, Any],
    exc: RunQueueConsumeFailure,
    retry_after_seconds: int,
) -> None:
    if source_handoff_store is None or canonical_context is None:
        return
    try:
        fail_authenticated_notice_canonical_execution(
            source_handoff_store=source_handoff_store,
            context=canonical_context,
            error_code=exc.error_code,
            error_message=str(exc),
            failure_class=exc.failure_class,
            retry_after_seconds=retry_after_seconds,
        )
    except Exception as canonical_exc:
        trace_row["canonical_execution_failure_error"] = str(canonical_exc)


def failure_payload(
    record: NoticeIngestQueueRecord,
    exc: RunQueueConsumeFailure,
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


def failed_report(
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


def import_result_summary(result: Mapping[str, Any]) -> dict[str, Any]:
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
            "typed_materialization_candidate_count",
            "typed_materialization_candidate_kind_counts",
            "attachment_fetch_status_record_count",
        )
        if key in result
    }


def downstream_materialization_summary(
    result: Mapping[str, Any],
    *,
    source_truth_only: bool,
    typed_materialization: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    projection_count = int(result.get("consumption_projection_entry_count") or 0)
    read_model_count = int(result.get("internal_notice_read_model_entry_count") or 0)
    typed_candidate_count = typed_materialization_candidate_count(result)
    typed_status = str((typed_materialization or {}).get("status") or "").strip()
    if source_truth_only:
        status = "skipped_source_truth_only"
    elif typed_status == "completed":
        status = "completed"
    elif typed_candidate_count > 0:
        status = "missing"
    elif projection_count > 0 or read_model_count > 0:
        status = "completed"
    else:
        status = "missing"
    payload = {
        "status": status,
        "source_truth_only": source_truth_only,
        "consumption_projection_entry_count": projection_count,
        "internal_notice_read_model_entry_count": read_model_count,
        "typed_materialization_candidate_count": typed_candidate_count,
        "typed_materialization_candidate_kind_counts": dict(
            result.get("typed_materialization_candidate_kind_counts") or {}
        ),
        "consumer_admission_projection_gate": result.get("consumer_admission_projection_gate"),
        "consumer_admission_read_model_gate": result.get("consumer_admission_read_model_gate"),
    }
    if typed_materialization is not None:
        payload["typed_materialization"] = dict(typed_materialization)
    return payload


def typed_materialization_candidate_count(result: Mapping[str, Any]) -> int:
    return int(result.get("typed_materialization_candidate_count") or 0)


def cleanup_summary(
    *,
    cleanup_report_path: Path | None,
    destructive_cleanup_enabled: bool,
    media_gate_verdict: Mapping[str, Any] | None,
) -> dict[str, Any]:
    report: dict[str, Any] = {}
    if cleanup_report_path is not None:
        report = load_json_object(cleanup_report_path)
    destructive_allowed = (
        destructive_cleanup_enabled
        and media_gate_verdict is not None
        and str(media_gate_verdict.get("verdict") or "") == "passed"
    )
    if destructive_cleanup_enabled and not destructive_allowed:
        status = "blocked"
        reason = "destructive cleanup requires fresh passed media gate evidence"
    else:
        status = "ready" if destructive_allowed else "dry_run_recorded"
        reason = ""
    return {
        "status": status,
        "reason": reason,
        "mode": str(report.get("mode") or ("execute" if destructive_allowed else "dry_run")),
        "write_enabled": bool(report.get("write_enabled") or destructive_allowed),
        "destructive_cleanup_enabled": destructive_cleanup_enabled,
        "destructive_cleanup_allowed": destructive_allowed,
        "report_path": str(cleanup_report_path) if cleanup_report_path else None,
        "candidate_count": int(report.get("candidate_count") or 0),
        "eligible_delete_count": int(report.get("eligible_delete_count") or 0),
    }


def record_operations_dir(*, root: Path | None, record: NoticeIngestQueueRecord) -> Path:
    base = root or Path(
        ".planning/workstreams/authenticated-notice-ingest-queue-e2e-automation/"
        "evidence/consumer-operations"
    )
    attempt_ordinal = int(record.attempt_count) + 1
    return Path(base) / record.run_id / record.job_id / f"attempt-{attempt_ordinal:03d}"


def default_cleanup_report_path(record_operations_dir: Path) -> Path | None:
    path = record_operations_dir / "cleanup.dry-run.json"
    return path if path.exists() else None


def load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"JSON object expected at {path}")
    return dict(payload)


def write_json(path: Path, payload: Mapping[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def normalize_mode(mode: str) -> str:
    normalized = str(mode or "").strip().lower().replace("-", "_")
    if normalized in {"dryrun", "preview"}:
        normalized = "dry_run"
    if normalized not in {"dry_run", "execute"}:
        raise ValueError("mode must be dry_run or execute")
    return normalized


def required_text(value: object, label: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{label} is required")
    return normalized


def positive_int(value: object, label: str) -> int:
    parsed = int(value)  # type: ignore[arg-type]
    if parsed <= 0:
        raise ValueError(f"{label} must be positive")
    return parsed


def positive_float(value: object, label: str) -> float:
    parsed = float(value)  # type: ignore[arg-type]
    if parsed <= 0:
        raise ValueError(f"{label} must be positive")
    return parsed


def non_negative_int(value: object, label: str) -> int:
    parsed = int(value)  # type: ignore[arg-type]
    if parsed < 0:
        raise ValueError(f"{label} must be non-negative")
    return parsed


def normalize_heartbeat_interval_seconds(
    *,
    lease_seconds: int,
    heartbeat_interval_seconds: float | None,
) -> float:
    if heartbeat_interval_seconds is not None:
        return positive_float(heartbeat_interval_seconds, "heartbeat_interval_seconds")
    return min(float(lease_seconds) / 3.0, 60.0)


__all__ = [
    "AUTHENTICATED_NOTICE_RUN_QUEUE_CONSUME_FAILED_REPORT_SCHEMA_VERSION",
    "AuthenticatedNoticeRunRefResolver",
    "LeaseHeartbeatMonitor",
    "RunQueueConsumeFailure",
    "append_child_task",
    "append_failure_child_task",
    "apply_failure_transition",
    "assert_authenticated_notice_run_job",
    "attach_child_task_evidence",
    "base_trace_row",
    "classify_value_error",
    "cleanup_summary",
    "default_cleanup_report_path",
    "downstream_materialization_summary",
    "fail_canonical_execution",
    "failed_report",
    "failure_payload",
    "import_result_summary",
    "load_json_object",
    "mark_canonical_step_passed",
    "non_negative_int",
    "normalize_heartbeat_interval_seconds",
    "normalize_mode",
    "positive_int",
    "project_canonical_child_tasks",
    "raise_if_heartbeat_failed",
    "record_operations_dir",
    "required_text",
    "resolve_and_verify_run_refs",
    "typed_materialization_candidate_count",
    "validate_required_media_gate",
    "verify_source_objects",
    "write_json",
]
