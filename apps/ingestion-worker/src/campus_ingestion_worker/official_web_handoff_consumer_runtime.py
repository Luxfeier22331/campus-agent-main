from __future__ import annotations

from dataclasses import asdict, replace
from pathlib import Path

from campus_ingestion_core import (
    ObjectStoreSettings,
    audit_official_web_projection_chunking,
    build_document_registry_from_env,
    build_official_web_run_artifact_key,
    build_raw_asset_registry_from_env,
    replay_official_web_source_truth_local,
    validate_official_web_projection_output,
)
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.official_web_release_task_admission import (
    admit_selected_write_release_tasks_from_review,
)
from campus_ingestion_core.official_web_release_task_store import OfficialWebReleaseTaskStore
from campus_ingestion_core.registry import DocumentRegistry, RawAssetRegistry
from campus_ingestion_core.source_handoff_store import SourceHandoffStore

from campus_ingestion_worker.official_web_handoff_consumer_io import (
    as_error_dict,
    build_execution_paths,
    download_bytes,
    download_json_object,
    normalize_error,
    optional_text,
    parse_attempt_count,
    parse_processing_status,
    read_json,
    require_object,
    require_text,
    reset_execution_dirs,
    safe_event_id_for_path,
    should_skip_existing_record,
    utcnow,
    write_json,
)
from campus_ingestion_worker.official_web_handoff_consumer_models import (
    OFFICIAL_WEB_HANDOFF_CONSUME_REPORT_SCHEMA_VERSION,
    OfficialWebDerivedObjectStore,
    OfficialWebExecutionStatusReporter,
    OfficialWebHandoffConsumeBatchReport,
    OfficialWebHandoffConsumeError,
    OfficialWebHandoffConsumeResult,
    OfficialWebHandoffConsumerSettings,
    OfficialWebSourceObjectStore,
)
from campus_ingestion_worker.official_web_handoff_consumer_persistence import (
    persist_projection_output,
)
from campus_ingestion_worker.official_web_handoff_consumer_reporting import (
    build_consumer_candidate_review_report,
    build_promotion_blocked_message,
    build_promotion_report,
    build_stage_quality_report,
    build_status_reporter_from_env,
    report_execution_status,
)
from campus_ingestion_worker.official_web_source_handoff_adapter import (
    OfficialWebCanonicalExecutionContext,
    complete_official_web_canonical_execution,
    fail_official_web_canonical_execution,
    mark_official_web_canonical_step_passed,
    prepare_official_web_canonical_execution,
)


def consume_official_web_handoffs(
    *,
    settings: OfficialWebHandoffConsumerSettings | None = None,
    object_store: OfficialWebSourceObjectStore | None = None,
    derived_object_store: OfficialWebDerivedObjectStore | None = None,
    document_registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
    declarations_path: Path | None = None,
    event_id: str | None = None,
    limit: int = 20,
    force: bool = False,
    promote_import: bool | None = None,
    consumer_review_manifest_path: Path | None = None,
    status_reporter: OfficialWebExecutionStatusReporter | None = None,
    source_handoff_store: SourceHandoffStore | None = None,
    release_task_store: OfficialWebReleaseTaskStore | None = None,
) -> OfficialWebHandoffConsumeBatchReport:
    runtime_settings = resolve_runtime_settings(settings=settings, promote_import=promote_import)
    runtime_object_store = object_store or S3ObjectStoreAdmin(ObjectStoreSettings.from_env())
    runtime_derived_object_store = derived_object_store or resolve_derived_object_store(
        runtime_object_store
    )
    runtime_document_registry = document_registry or build_document_registry_from_env(
        prefer_operator=True
    )
    runtime_raw_asset_registry = raw_asset_registry or build_raw_asset_registry_from_env(
        prefer_operator=True
    )
    runtime_status_reporter = status_reporter or build_status_reporter_from_env()
    record_paths = resolve_record_paths(
        inbox_dir=runtime_settings.inbox_dir,
        event_id=event_id,
        limit=limit,
    )
    results = [
        consume_handoff_record(
            record_path=record_path,
            settings=runtime_settings,
            object_store=runtime_object_store,
            derived_object_store=runtime_derived_object_store,
            document_registry=runtime_document_registry,
            raw_asset_registry=runtime_raw_asset_registry,
            declarations_path=declarations_path,
            force=force,
            consumer_review_manifest_path=consumer_review_manifest_path,
            status_reporter=runtime_status_reporter,
            source_handoff_store=source_handoff_store,
            release_task_store=release_task_store,
        )
        for record_path in record_paths
    ]
    return OfficialWebHandoffConsumeBatchReport(
        schema_version=OFFICIAL_WEB_HANDOFF_CONSUME_REPORT_SCHEMA_VERSION,
        generated_at=utcnow(),
        app_name=runtime_settings.app_name,
        inbox_dir=str(runtime_settings.inbox_dir.resolve()),
        execution_root_dir=str(runtime_settings.execution_root_dir.resolve()),
        results=results,
        counts={
            "records_seen": len(record_paths),
            "staged": sum(1 for result in results if result.status == "staged"),
            "promoted": sum(1 for result in results if result.status == "promoted"),
            "failed": sum(1 for result in results if result.status == "failed"),
            "skipped": sum(1 for result in results if result.status == "skipped"),
        },
    )


def consume_handoff_record(
    *,
    record_path: Path,
    settings: OfficialWebHandoffConsumerSettings,
    object_store: OfficialWebSourceObjectStore,
    derived_object_store: OfficialWebDerivedObjectStore | None = None,
    document_registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
    declarations_path: Path | None = None,
    force: bool = False,
    consumer_review_manifest_path: Path | None = None,
    status_reporter: OfficialWebExecutionStatusReporter | None = None,
    source_handoff_store: SourceHandoffStore | None = None,
    release_task_store: OfficialWebReleaseTaskStore | None = None,
) -> OfficialWebHandoffConsumeResult:
    record = read_json(record_path)
    event_id = require_text(record.get("eventId"), "eventId")
    attempt_count = parse_attempt_count(record.get("processingAttemptCount"))
    existing_status = parse_processing_status(record.get("processingStatus"))

    if should_skip_existing_record(
        existing_status=existing_status,
        promote_import=settings.promote_import,
        force=force,
    ):
        return OfficialWebHandoffConsumeResult(
            event_id=event_id,
            status="skipped",
            attempt_count=attempt_count,
            record_path=str(record_path.resolve()),
            execution_report_path=optional_text(record.get("executionReportPath")),
            projection_output_dir=optional_text(record.get("projectionOutputDir")),
            replay_input_dir=optional_text(record.get("replayInputDir")),
            error=as_error_dict(record.get("lastError")),
        )

    payload = require_object(record.get("payload"), "payload")
    run_id = require_text(payload.get("runId"), "payload.runId")
    site_id = require_text(payload.get("siteId"), "payload.siteId")
    execution_paths = build_execution_paths(
        execution_root_dir=settings.execution_root_dir,
        event_id=event_id,
    )

    attempt_count += 1
    record.update(
        {
            "processingStatus": "running",
            "processingAttemptCount": attempt_count,
            "processingStartedAt": utcnow(),
            "processedAt": None,
            "lastError": None,
            "executionReportPath": str(execution_paths["execution_report_path"]),
            "projectionOutputDir": str(execution_paths["projection_output_dir"]),
            "replayInputDir": str(execution_paths["replay_input_dir"]),
        }
    )
    write_json(record_path, record)

    execution_report: dict[str, object] = {
        "schemaVersion": OFFICIAL_WEB_HANDOFF_CONSUME_REPORT_SCHEMA_VERSION,
        "generatedAt": utcnow(),
        "status": "running",
        "eventId": event_id,
        "dispatchRef": optional_text(record.get("dispatchRef")),
        "runId": run_id,
        "siteId": site_id,
        "recordPath": str(record_path.resolve()),
        "replayInputDir": str(execution_paths["replay_input_dir"]),
        "projectionOutputDir": str(execution_paths["projection_output_dir"]),
        "bundleObjectKey": None,
        "replay": None,
        "validation": None,
        "chunkAudit": None,
        "coverage": None,
        "promotion": None,
        "import": None,
        "error": None,
    }
    canonical_context: OfficialWebCanonicalExecutionContext | None = None

    try:
        if source_handoff_store is not None:
            canonical_context = prepare_official_web_canonical_execution(
                payload=payload,
                settings=settings,
                object_store=object_store,
                source_handoff_store=source_handoff_store,
            )
            record.update(
                {
                    "sourceHandoffId": canonical_context.handoff_id,
                    "ingestionExecutionId": canonical_context.execution_id,
                }
            )
            write_json(record_path, record)
        report_execution_status(
            reporter=status_reporter,
            run_id=run_id,
            payload={
                "executionRef": _execution_ref(event_id, canonical_context),
                "status": "running",
                "updatedAt": utcnow(),
            },
        )
        reset_execution_dirs(
            replay_input_dir=execution_paths["replay_input_dir"],
            projection_output_dir=execution_paths["projection_output_dir"],
        )
        bundle_key = resolve_source_truth_bundle_key(payload)
        execution_report["bundleObjectKey"] = bundle_key
        bundle_payload = download_source_truth_bundle(
            object_store=object_store,
            bucket=settings.source_bucket,
            key=bundle_key,
            expected_site_id=site_id,
            expected_run_id=run_id,
        )
        materialize_replay_input(
            replay_input_dir=execution_paths["replay_input_dir"],
            bundle_payload=bundle_payload,
            object_store=object_store,
            bucket=settings.source_bucket,
        )
        _mark_canonical_step_passed(
            source_handoff_store=source_handoff_store,
            context=canonical_context,
            step_name="materialize_replay_input",
        )
        replay_report = replay_official_web_source_truth_local(
            output_dir=execution_paths["replay_input_dir"],
            projection_output_dir=execution_paths["projection_output_dir"],
            declarations_path=declarations_path,
        )
        _mark_canonical_step_passed(
            source_handoff_store=source_handoff_store,
            context=canonical_context,
            step_name="source_truth_import",
        )
        validation_report = validate_official_web_projection_output(
            execution_paths["projection_output_dir"],
        )
        _mark_canonical_step_passed(
            source_handoff_store=source_handoff_store,
            context=canonical_context,
            step_name="projection_validation",
        )
        execution_report["replay"] = asdict(replay_report)
        execution_report["validation"] = asdict(validation_report)
        if not validation_report.valid:
            raise OfficialWebHandoffConsumeError(
                code="projection_validation_failed",
                message=(
                    "official_web projection validation failed with "
                    f"{validation_report.counts['errors']} errors."
                ),
            )
        chunk_audit_report = audit_official_web_projection_chunking(
            execution_paths["projection_output_dir"],
        )
        _mark_canonical_step_passed(
            source_handoff_store=source_handoff_store,
            context=canonical_context,
            step_name="chunk_audit",
        )
        coverage_report = build_stage_quality_report(
            settings=settings,
            payload=payload,
            replay_input_dir=execution_paths["replay_input_dir"],
            replay_report=asdict(replay_report),
            chunk_audit_report=asdict(chunk_audit_report),
        )
        consumer_candidate_review_report = build_consumer_candidate_review_report(
            replay_report=asdict(replay_report),
            consumer_review_manifest=read_json(consumer_review_manifest_path)
            if consumer_review_manifest_path is not None
            else None,
            run_admission_decision=_run_admission_decision_from_payload(payload),
            target_inventory_manifest=_read_target_inventory_manifest_if_present(site_id),
        )
        promotion_report = build_promotion_report(
            promote_import=settings.promote_import,
            coverage_report=coverage_report,
        )
        execution_report["chunkAudit"] = asdict(chunk_audit_report)
        execution_report["coverage"] = coverage_report
        execution_report["consumerCandidateReview"] = consumer_candidate_review_report
        execution_report["releaseTasks"] = _admit_selected_write_release_tasks(
            release_task_store=release_task_store,
            review_report=consumer_candidate_review_report,
            run_id=run_id,
            source_object_keys=[bundle_key],
        )
        execution_report["promotion"] = promotion_report
        if not settings.promote_import or not promotion_report["eligible"]:
            staged_error = None
            if settings.promote_import and not promotion_report["eligible"]:
                staged_error = {
                    "code": "promotion_blocked",
                    "message": build_promotion_blocked_message(promotion_report["blockedChecks"]),
                }
            if source_handoff_store is not None and canonical_context is not None:
                complete_official_web_canonical_execution(
                    source_handoff_store=source_handoff_store,
                    context=canonical_context,
                    result_kind="staged",
                )
            report_execution_status(
                reporter=status_reporter,
                run_id=run_id,
                payload={
                    "errorCode": staged_error["code"] if staged_error is not None else None,
                    "errorMessage": staged_error["message"] if staged_error is not None else None,
                    "executionRef": _execution_ref(event_id, canonical_context),
                    "status": "staged",
                    "targetFieldReviews": consumer_candidate_review_report.get("targetFieldReviews")
                    or [],
                    "updatedAt": utcnow(),
                },
            )
            execution_report["status"] = "staged"
            write_json(execution_paths["execution_report_path"], execution_report)
            record.update(
                {
                    "processingStatus": "staged",
                    "processedAt": utcnow(),
                    "lastError": None,
                }
            )
            write_json(record_path, record)
            return OfficialWebHandoffConsumeResult(
                event_id=event_id,
                status="staged",
                attempt_count=attempt_count,
                record_path=str(record_path.resolve()),
                execution_report_path=str(execution_paths["execution_report_path"]),
                projection_output_dir=str(execution_paths["projection_output_dir"]),
                replay_input_dir=str(execution_paths["replay_input_dir"]),
            )

        import_report = persist_projection_output(
            work_dir=execution_paths["work_dir"],
            projection_output_dir=execution_paths["projection_output_dir"],
            replay_input_dir=execution_paths["replay_input_dir"],
            bundle_payload=bundle_payload,
            source_object_store=object_store,
            derived_object_store=derived_object_store or resolve_derived_object_store(object_store),
            document_registry=document_registry
            or build_document_registry_from_env(prefer_operator=True),
            raw_asset_registry=raw_asset_registry
            or build_raw_asset_registry_from_env(prefer_operator=True),
            object_store_settings=resolve_persist_object_store_settings(
                source_bucket=settings.source_bucket,
                require_env=(
                    derived_object_store is None
                    or document_registry is None
                    or raw_asset_registry is None
                ),
            ),
        )
        execution_report["import"] = asdict(import_report)
        _mark_canonical_step_passed(
            source_handoff_store=source_handoff_store,
            context=canonical_context,
            step_name="downstream_materialization",
        )
        if source_handoff_store is not None and canonical_context is not None:
            complete_official_web_canonical_execution(
                source_handoff_store=source_handoff_store,
                context=canonical_context,
                result_kind="promoted",
            )
        report_execution_status(
            reporter=status_reporter,
            run_id=run_id,
            payload={
                "executionRef": _execution_ref(event_id, canonical_context),
                "status": "promoted",
                "targetFieldReviews": consumer_candidate_review_report.get("targetFieldReviews")
                or [],
                "updatedAt": utcnow(),
            },
        )

        execution_report["status"] = "promoted"
        write_json(execution_paths["execution_report_path"], execution_report)
        record.update(
            {
                "processingStatus": "promoted",
                "processedAt": utcnow(),
                "lastError": None,
            }
        )
        write_json(record_path, record)
        return OfficialWebHandoffConsumeResult(
            event_id=event_id,
            status="promoted",
            attempt_count=attempt_count,
            record_path=str(record_path.resolve()),
            execution_report_path=str(execution_paths["execution_report_path"]),
            projection_output_dir=str(execution_paths["projection_output_dir"]),
            replay_input_dir=str(execution_paths["replay_input_dir"]),
        )
    except Exception as exc:
        error_payload = normalize_error(exc)
        if source_handoff_store is not None and canonical_context is not None:
            fail_official_web_canonical_execution(
                source_handoff_store=source_handoff_store,
                context=canonical_context,
                error_payload=error_payload,
            )
        report_execution_status(
            reporter=status_reporter,
            run_id=run_id,
            payload={
                "errorCode": error_payload.get("code"),
                "errorMessage": error_payload.get("message"),
                "executionRef": _execution_ref(event_id, canonical_context),
                "status": "failed",
                "updatedAt": utcnow(),
            },
            suppress_errors=True,
        )
        execution_report["status"] = "failed"
        execution_report["error"] = error_payload
        write_json(execution_paths["execution_report_path"], execution_report)
        record.update(
            {
                "processingStatus": "failed",
                "processedAt": utcnow(),
                "lastError": error_payload,
            }
        )
        write_json(record_path, record)
        return OfficialWebHandoffConsumeResult(
            event_id=event_id,
            status="failed",
            attempt_count=attempt_count,
            record_path=str(record_path.resolve()),
            execution_report_path=str(execution_paths["execution_report_path"]),
            projection_output_dir=str(execution_paths["projection_output_dir"]),
            replay_input_dir=str(execution_paths["replay_input_dir"]),
            error=error_payload,
        )


def _execution_ref(
    event_id: str,
    canonical_context: OfficialWebCanonicalExecutionContext | None,
) -> str:
    if canonical_context is None:
        return event_id
    return canonical_context.execution_id


def _run_admission_decision_from_payload(payload: dict[str, object]) -> dict[str, object] | None:
    decision = payload.get("runAdmissionDecision") or payload.get("run_admission_decision")
    return decision if isinstance(decision, dict) else None


def _admit_selected_write_release_tasks(
    *,
    release_task_store: OfficialWebReleaseTaskStore | None,
    review_report: dict[str, object],
    run_id: str,
    source_object_keys: list[str],
) -> dict[str, object]:
    if release_task_store is None:
        return {
            "admittedCount": 0,
            "enabled": False,
            "reason": "release_task_store_not_configured",
            "taskIds": [],
        }
    admitted = admit_selected_write_release_tasks_from_review(
        release_task_store=release_task_store,
        review_report=review_report,
        run_id=run_id,
        source_object_keys=source_object_keys,
    )
    return {
        "admittedCount": len(admitted),
        "enabled": True,
        "reason": "selected_write_admitted" if admitted else "no_selected_write_ready_records",
        "taskIds": [task.task_id for task in admitted],
    }


def _mark_canonical_step_passed(
    *,
    source_handoff_store: SourceHandoffStore | None,
    context: OfficialWebCanonicalExecutionContext | None,
    step_name: str,
) -> None:
    if source_handoff_store is None or context is None:
        return
    mark_official_web_canonical_step_passed(
        source_handoff_store=source_handoff_store,
        context=context,
        step_name=step_name,
    )


def resolve_record_paths(
    *,
    inbox_dir: Path,
    event_id: str | None,
    limit: int,
) -> list[Path]:
    if limit <= 0:
        raise ValueError("--limit must be a positive integer.")
    if event_id:
        record_path = inbox_dir / f"{safe_event_id_for_path(event_id)}.json"
        if not record_path.exists():
            raise FileNotFoundError(f"official_web handoff record not found: {record_path}")
        return [record_path]
    return sorted(inbox_dir.glob("*.json"))[:limit]


def resolve_runtime_settings(
    *,
    settings: OfficialWebHandoffConsumerSettings | None,
    promote_import: bool | None,
) -> OfficialWebHandoffConsumerSettings:
    runtime_settings = settings or OfficialWebHandoffConsumerSettings.from_env()
    if promote_import is None:
        return runtime_settings
    return replace(runtime_settings, promote_import=promote_import)


def download_source_truth_bundle(
    *,
    object_store: OfficialWebSourceObjectStore,
    bucket: str,
    key: str,
    expected_site_id: str,
    expected_run_id: str,
) -> dict[str, object]:
    payload = download_json_object(
        object_store=object_store,
        bucket=bucket,
        key=key,
        missing_code="missing_source_truth_bundle",
        invalid_code="invalid_source_truth_bundle",
    )
    site_id = require_text(payload.get("siteId") or payload.get("site_id"), "siteId")
    crawl_run_id = require_text(
        payload.get("crawlRunId") or payload.get("crawl_run_id"), "crawlRunId"
    )
    if site_id != expected_site_id:
        raise OfficialWebHandoffConsumeError(
            code="invalid_source_truth_bundle",
            message=f"bundle siteId {site_id!r} does not match handoff siteId {expected_site_id!r}.",
        )
    if crawl_run_id != expected_run_id:
        raise OfficialWebHandoffConsumeError(
            code="invalid_source_truth_bundle",
            message=f"bundle crawlRunId {crawl_run_id!r} does not match handoff runId {expected_run_id!r}.",
        )
    pages = payload.get("pages")
    if not isinstance(pages, list):
        raise OfficialWebHandoffConsumeError(
            code="invalid_source_truth_bundle",
            message="bundle pages must be an array.",
        )
    return payload


def materialize_replay_input(
    *,
    replay_input_dir: Path,
    bundle_payload: dict[str, object],
    object_store: OfficialWebSourceObjectStore,
    bucket: str,
) -> None:
    write_json(replay_input_dir / "source-truth-bundle.json", bundle_payload)
    pages = bundle_payload.get("pages")
    if not isinstance(pages, list):
        raise OfficialWebHandoffConsumeError(
            code="invalid_source_truth_bundle",
            message="bundle pages must be an array.",
        )
    for page in pages:
        page_payload = require_object(page, "pages[]")
        raw_asset_id = require_text(
            page_payload.get("rawAssetId") or page_payload.get("raw_asset_id"), "rawAssetId"
        )
        raw_version_id = require_text(
            page_payload.get("rawVersionId") or page_payload.get("raw_version_id"),
            "rawVersionId",
        )
        manifest_key = require_text(
            page_payload.get("pageManifestObjectKey")
            or page_payload.get("page_manifest_object_key"),
            "pageManifestObjectKey",
        )
        blocks_key = require_text(
            page_payload.get("contentBlocksObjectKey")
            or page_payload.get("content_blocks_object_key"),
            "contentBlocksObjectKey",
        )
        manifest_bytes = download_bytes(
            object_store=object_store,
            bucket=bucket,
            key=manifest_key,
            missing_code="missing_page_manifest",
        )
        blocks_bytes = download_bytes(
            object_store=object_store,
            bucket=bucket,
            key=blocks_key,
            missing_code="missing_content_blocks",
        )
        base_dir = (
            replay_input_dir / "source-assets" / raw_asset_id / raw_version_id / "source-truth"
        )
        base_dir.mkdir(parents=True, exist_ok=True)
        (base_dir / "page-manifest.json").write_bytes(manifest_bytes)
        (base_dir / "content-blocks.jsonl").write_bytes(blocks_bytes)


def resolve_source_truth_bundle_key(payload: dict[str, object]) -> str:
    artifacts = payload.get("artifacts")
    if isinstance(artifacts, list):
        for item in artifacts:
            if not isinstance(item, dict):
                continue
            artifact_type = str(item.get("artifactType") or "").strip()
            object_key = str(item.get("objectKey") or "").strip()
            if artifact_type == "source_truth_bundle" and object_key:
                return object_key
    site_id = require_text(payload.get("siteId"), "payload.siteId")
    run_id = require_text(payload.get("runId"), "payload.runId")
    return build_official_web_run_artifact_key(
        site_id=site_id,
        run_id=run_id,
        artifact_name="source-truth-bundle.json",
    )


def _read_target_inventory_manifest_if_present(site_id: str) -> dict[str, object] | None:
    path = Path("configs") / "sources" / "official_web" / site_id / "target-inventory.json"
    if not path.exists():
        return None
    return read_json(path)


def resolve_derived_object_store(
    object_store: OfficialWebSourceObjectStore,
) -> OfficialWebDerivedObjectStore:
    if hasattr(object_store, "put_bytes"):
        return object_store  # type: ignore[return-value]
    return S3ObjectStoreAdmin(ObjectStoreSettings.from_env())


def resolve_persist_object_store_settings(
    *,
    source_bucket: str,
    require_env: bool,
) -> ObjectStoreSettings:
    del require_env

    env_settings = ObjectStoreSettings.from_env()
    return ObjectStoreSettings(
        endpoint=env_settings.endpoint,
        access_key=env_settings.access_key,
        secret_key=env_settings.secret_key,
        region=env_settings.region,
        bucket_source=source_bucket,
        bucket_derived=env_settings.bucket_derived,
        secure=env_settings.secure,
    )
