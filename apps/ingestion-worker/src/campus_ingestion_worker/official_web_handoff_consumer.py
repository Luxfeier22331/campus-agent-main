from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
from typing import Iterable, Literal, Protocol, Sequence
from urllib import error as urllib_error
from urllib import request as urllib_request

from campus_ingestion_core import (
    DEFAULT_BUCKET_DERIVED,
    DEFAULT_BUCKET_SOURCE,
    ObjectStoreSettings,
    audit_official_web_projection_chunking,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
    replay_official_web_source_truth_local,
    validate_official_web_projection_output,
)
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.registry import DocumentRegistry, RawAssetRegistry

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.official_web_projection_import import import_projection_output


OFFICIAL_WEB_HANDOFF_CONSUME_REPORT_SCHEMA_VERSION = "official_web_handoff_consume_report.v1"
_DEFAULT_MINIMUM_PROMOTE_PAGES = 2
_DEFAULT_MINIMUM_SEED_COVERAGE_RATIO = 0.5
_DEFAULT_MINIMUM_HOST_COVERAGE_RATIO = 0.5
_PROMOTION_DISALLOWED_PAGE_FAMILIES = frozenset(
    {"listing_page", "generic_content_page", "dynamic_shell_page", "structural_shell_page"}
)


class OfficialWebSourceObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class OfficialWebDerivedObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None: ...


class OfficialWebExecutionStatusReporter(Protocol):
    def report(self, *, run_id: str, payload: dict[str, object]) -> None: ...


class OfficialWebHandoffConsumeError(RuntimeError):
    def __init__(self, *, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class OfficialWebHandoffConsumerSettings:
    app_name: str = "campus-ingestion-worker"
    inbox_dir: Path = Path("./var/official-web-handoffs")
    execution_root_dir: Path = Path("./var/official-web-handoff-executions")
    source_bucket: str = DEFAULT_BUCKET_SOURCE
    promote_import: bool = False
    minimum_promote_pages: int = _DEFAULT_MINIMUM_PROMOTE_PAGES
    minimum_seed_coverage_ratio: float = _DEFAULT_MINIMUM_SEED_COVERAGE_RATIO
    minimum_host_coverage_ratio: float = _DEFAULT_MINIMUM_HOST_COVERAGE_RATIO

    @classmethod
    def from_env(cls) -> "OfficialWebHandoffConsumerSettings":
        object_store_settings = ObjectStoreSettings.from_env()
        inbox_dir = os.getenv(
            "INGESTION_WORKER_OFFICIAL_WEB_HANDOFF_INBOX_DIR",
            "./var/official-web-handoffs",
        ).strip()
        execution_root_dir = os.getenv(
            "INGESTION_WORKER_OFFICIAL_WEB_HANDOFF_EXECUTION_ROOT_DIR",
            "./var/official-web-handoff-executions",
        ).strip()
        return cls(
            app_name=os.getenv("CAMPUS_AGENT_APP_NAME", "campus-ingestion-worker").strip()
            or "campus-ingestion-worker",
            inbox_dir=Path(inbox_dir or "./var/official-web-handoffs"),
            execution_root_dir=Path(execution_root_dir or "./var/official-web-handoff-executions"),
            source_bucket=object_store_settings.bucket_source,
            promote_import=_read_bool_env("INGESTION_WORKER_OFFICIAL_WEB_PROMOTE_IMPORT"),
            minimum_promote_pages=_read_positive_int_env(
                "INGESTION_WORKER_OFFICIAL_WEB_MINIMUM_PROMOTE_PAGES",
                default=_DEFAULT_MINIMUM_PROMOTE_PAGES,
            ),
            minimum_seed_coverage_ratio=_read_ratio_env(
                "INGESTION_WORKER_OFFICIAL_WEB_MINIMUM_SEED_COVERAGE_RATIO",
                default=_DEFAULT_MINIMUM_SEED_COVERAGE_RATIO,
            ),
            minimum_host_coverage_ratio=_read_ratio_env(
                "INGESTION_WORKER_OFFICIAL_WEB_MINIMUM_HOST_COVERAGE_RATIO",
                default=_DEFAULT_MINIMUM_HOST_COVERAGE_RATIO,
            ),
        )


@dataclass(frozen=True, slots=True)
class OfficialWebHandoffConsumeResult:
    event_id: str
    status: Literal["staged", "promoted", "failed", "skipped"]
    attempt_count: int
    record_path: str
    execution_report_path: str | None
    projection_output_dir: str | None
    replay_input_dir: str | None
    error: dict[str, object] | None = None


class HttpOfficialWebExecutionStatusReporter:
    def __init__(self, *, base_url: str, internal_shared_secret: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._internal_shared_secret = internal_shared_secret

    def report(self, *, run_id: str, payload: dict[str, object]) -> None:
        request = urllib_request.Request(
            f"{self._base_url}/api/internal/official-web/runs/{run_id}/ingestion-execution",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "content-type": "application/json",
                "x-app-internal-auth": self._internal_shared_secret,
            },
            method="POST",
        )
        try:
            with urllib_request.urlopen(request) as response:
                if response.status < 200 or response.status >= 300:
                    raise OfficialWebHandoffConsumeError(
                        code="execution_status_update_failed",
                        message=(
                            "official_web execution status callback returned "
                            f"unexpected status {response.status}."
                        ),
                    )
        except urllib_error.HTTPError as exc:
            raise OfficialWebHandoffConsumeError(
                code="execution_status_update_failed",
                message=f"official_web execution status callback failed: {exc.code}",
            ) from exc
        except urllib_error.URLError as exc:
            raise OfficialWebHandoffConsumeError(
                code="execution_status_update_failed",
                message=f"official_web execution status callback failed: {exc.reason}",
            ) from exc


@dataclass(frozen=True, slots=True)
class OfficialWebHandoffConsumeBatchReport:
    schema_version: str
    generated_at: str
    app_name: str
    inbox_dir: str
    execution_root_dir: str
    results: list[OfficialWebHandoffConsumeResult]
    counts: dict[str, int]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Consume official_web handoff inbox records and replay source-truth projection.",
    )
    parser.add_argument("--event-id")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--promote", action="store_true", default=None)
    parser.add_argument("--declarations-path")
    return parser


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
    status_reporter: OfficialWebExecutionStatusReporter | None = None,
) -> OfficialWebHandoffConsumeBatchReport:
    runtime_settings = _resolve_runtime_settings(settings=settings, promote_import=promote_import)
    runtime_object_store = object_store or S3ObjectStoreAdmin(ObjectStoreSettings.from_env())
    runtime_derived_object_store = derived_object_store or _resolve_derived_object_store(
        runtime_object_store
    )
    runtime_document_registry = document_registry or build_document_registry_from_env()
    runtime_raw_asset_registry = raw_asset_registry or build_raw_asset_registry_from_env()
    runtime_status_reporter = status_reporter or _build_status_reporter_from_env()
    record_paths = _resolve_record_paths(
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
            status_reporter=runtime_status_reporter,
        )
        for record_path in record_paths
    ]
    return OfficialWebHandoffConsumeBatchReport(
        schema_version=OFFICIAL_WEB_HANDOFF_CONSUME_REPORT_SCHEMA_VERSION,
        generated_at=_utcnow(),
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
    status_reporter: OfficialWebExecutionStatusReporter | None = None,
) -> OfficialWebHandoffConsumeResult:
    record = _read_json(record_path)
    event_id = _require_text(record.get("eventId"), "eventId")
    attempt_count = _parse_attempt_count(record.get("processingAttemptCount"))
    existing_status = _parse_processing_status(record.get("processingStatus"))

    if _should_skip_existing_record(
        existing_status=existing_status,
        promote_import=settings.promote_import,
        force=force,
    ):
        return OfficialWebHandoffConsumeResult(
            event_id=event_id,
            status="skipped",
            attempt_count=attempt_count,
            record_path=str(record_path.resolve()),
            execution_report_path=_optional_text(record.get("executionReportPath")),
            projection_output_dir=_optional_text(record.get("projectionOutputDir")),
            replay_input_dir=_optional_text(record.get("replayInputDir")),
            error=_as_error_dict(record.get("lastError")),
        )

    payload = _require_object(record.get("payload"), "payload")
    run_id = _require_text(payload.get("runId"), "payload.runId")
    site_id = _require_text(payload.get("siteId"), "payload.siteId")
    execution_paths = _build_execution_paths(
        execution_root_dir=settings.execution_root_dir,
        event_id=event_id,
    )

    attempt_count += 1
    record.update(
        {
            "processingStatus": "running",
            "processingAttemptCount": attempt_count,
            "processingStartedAt": _utcnow(),
            "processedAt": None,
            "lastError": None,
            "executionReportPath": str(execution_paths["execution_report_path"]),
            "projectionOutputDir": str(execution_paths["projection_output_dir"]),
            "replayInputDir": str(execution_paths["replay_input_dir"]),
        }
    )
    _write_json(record_path, record)

    execution_report: dict[str, object] = {
        "schemaVersion": OFFICIAL_WEB_HANDOFF_CONSUME_REPORT_SCHEMA_VERSION,
        "generatedAt": _utcnow(),
        "status": "running",
        "eventId": event_id,
        "dispatchRef": _optional_text(record.get("dispatchRef")),
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

    try:
        _report_execution_status(
            reporter=status_reporter,
            run_id=run_id,
            payload={
                "executionRef": event_id,
                "status": "running",
                "updatedAt": _utcnow(),
            },
        )
        _reset_execution_dirs(
            replay_input_dir=execution_paths["replay_input_dir"],
            projection_output_dir=execution_paths["projection_output_dir"],
        )
        bundle_key = _resolve_source_truth_bundle_key(payload)
        execution_report["bundleObjectKey"] = bundle_key
        bundle_payload = _download_source_truth_bundle(
            object_store=object_store,
            bucket=settings.source_bucket,
            key=bundle_key,
            expected_site_id=site_id,
            expected_run_id=run_id,
        )
        _materialize_replay_input(
            replay_input_dir=execution_paths["replay_input_dir"],
            bundle_payload=bundle_payload,
            object_store=object_store,
            bucket=settings.source_bucket,
        )
        replay_report = replay_official_web_source_truth_local(
            output_dir=execution_paths["replay_input_dir"],
            projection_output_dir=execution_paths["projection_output_dir"],
            declarations_path=declarations_path,
        )
        validation_report = validate_official_web_projection_output(
            execution_paths["projection_output_dir"],
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
        coverage_report = _build_stage_quality_report(
            settings=settings,
            payload=payload,
            replay_input_dir=execution_paths["replay_input_dir"],
            replay_report=asdict(replay_report),
            chunk_audit_report=asdict(chunk_audit_report),
        )
        promotion_report = _build_promotion_report(
            promote_import=settings.promote_import,
            coverage_report=coverage_report,
        )
        execution_report["chunkAudit"] = asdict(chunk_audit_report)
        execution_report["coverage"] = coverage_report
        execution_report["promotion"] = promotion_report
        if not settings.promote_import or not promotion_report["eligible"]:
            staged_error = None
            if settings.promote_import and not promotion_report["eligible"]:
                staged_error = {
                    "code": "promotion_blocked",
                    "message": _build_promotion_blocked_message(promotion_report["blockedChecks"]),
                }
            _report_execution_status(
                reporter=status_reporter,
                run_id=run_id,
                payload={
                    "errorCode": staged_error["code"] if staged_error is not None else None,
                    "errorMessage": staged_error["message"] if staged_error is not None else None,
                    "executionRef": event_id,
                    "status": "staged",
                    "updatedAt": _utcnow(),
                },
            )
            execution_report["status"] = "staged"
            _write_json(execution_paths["execution_report_path"], execution_report)
            record.update(
                {
                    "processingStatus": "staged",
                    "processedAt": _utcnow(),
                    "lastError": None,
                }
            )
            _write_json(record_path, record)
            return OfficialWebHandoffConsumeResult(
                event_id=event_id,
                status="staged",
                attempt_count=attempt_count,
                record_path=str(record_path.resolve()),
                execution_report_path=str(execution_paths["execution_report_path"]),
                projection_output_dir=str(execution_paths["projection_output_dir"]),
                replay_input_dir=str(execution_paths["replay_input_dir"]),
            )

        import_report = _persist_projection_output(
            work_dir=execution_paths["work_dir"],
            projection_output_dir=execution_paths["projection_output_dir"],
            replay_input_dir=execution_paths["replay_input_dir"],
            bundle_payload=bundle_payload,
            source_object_store=object_store,
            derived_object_store=derived_object_store or _resolve_derived_object_store(object_store),
            document_registry=document_registry or build_document_registry_from_env(),
            raw_asset_registry=raw_asset_registry or build_raw_asset_registry_from_env(),
            object_store_settings=_resolve_persist_object_store_settings(
                source_bucket=settings.source_bucket,
                require_env=(
                    derived_object_store is None
                    or document_registry is None
                    or raw_asset_registry is None
                ),
            ),
        )
        execution_report["import"] = asdict(import_report)
        _report_execution_status(
            reporter=status_reporter,
            run_id=run_id,
            payload={
                "executionRef": event_id,
                "status": "promoted",
                "updatedAt": _utcnow(),
            },
        )

        execution_report["status"] = "promoted"
        _write_json(execution_paths["execution_report_path"], execution_report)
        record.update(
            {
                "processingStatus": "promoted",
                "processedAt": _utcnow(),
                "lastError": None,
            }
        )
        _write_json(record_path, record)
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
        error_payload = _normalize_error(exc)
        _report_execution_status(
            reporter=status_reporter,
            run_id=run_id,
            payload={
                "errorCode": error_payload.get("code"),
                "errorMessage": error_payload.get("message"),
                "executionRef": event_id,
                "status": "failed",
                "updatedAt": _utcnow(),
            },
            suppress_errors=True,
        )
        execution_report["status"] = "failed"
        execution_report["error"] = error_payload
        _write_json(execution_paths["execution_report_path"], execution_report)
        record.update(
            {
                "processingStatus": "failed",
                "processedAt": _utcnow(),
                "lastError": error_payload,
            }
        )
        _write_json(record_path, record)
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


def _resolve_record_paths(
    *,
    inbox_dir: Path,
    event_id: str | None,
    limit: int,
) -> list[Path]:
    if limit <= 0:
        raise ValueError("--limit must be a positive integer.")
    if event_id:
        record_path = inbox_dir / f"{_safe_event_id(event_id)}.json"
        if not record_path.exists():
            raise FileNotFoundError(f"official_web handoff record not found: {record_path}")
        return [record_path]
    return sorted(inbox_dir.glob("*.json"))[:limit]


def _resolve_runtime_settings(
    *,
    settings: OfficialWebHandoffConsumerSettings | None,
    promote_import: bool | None,
) -> OfficialWebHandoffConsumerSettings:
    runtime_settings = settings or OfficialWebHandoffConsumerSettings.from_env()
    if promote_import is None:
        return runtime_settings
    return replace(runtime_settings, promote_import=promote_import)


def _build_execution_paths(*, execution_root_dir: Path, event_id: str) -> dict[str, Path]:
    safe_event_id = _safe_event_id(event_id)
    work_dir = execution_root_dir / safe_event_id
    return {
        "work_dir": work_dir,
        "replay_input_dir": work_dir / "replay-input",
        "projection_output_dir": work_dir / "projection-output",
        "execution_report_path": work_dir / "execution-report.json",
    }


def _reset_execution_dirs(*, replay_input_dir: Path, projection_output_dir: Path) -> None:
    if replay_input_dir.exists():
        shutil.rmtree(replay_input_dir)
    if projection_output_dir.exists():
        shutil.rmtree(projection_output_dir)
    replay_input_dir.mkdir(parents=True, exist_ok=True)
    projection_output_dir.mkdir(parents=True, exist_ok=True)


def _download_source_truth_bundle(
    *,
    object_store: OfficialWebSourceObjectStore,
    bucket: str,
    key: str,
    expected_site_id: str,
    expected_run_id: str,
) -> dict[str, object]:
    payload = _download_json_object(
        object_store=object_store,
        bucket=bucket,
        key=key,
        missing_code="missing_source_truth_bundle",
        invalid_code="invalid_source_truth_bundle",
    )
    site_id = _require_text(payload.get("siteId") or payload.get("site_id"), "siteId")
    crawl_run_id = _require_text(payload.get("crawlRunId") or payload.get("crawl_run_id"), "crawlRunId")
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


def _materialize_replay_input(
    *,
    replay_input_dir: Path,
    bundle_payload: dict[str, object],
    object_store: OfficialWebSourceObjectStore,
    bucket: str,
) -> None:
    _write_json(replay_input_dir / "source-truth-bundle.json", bundle_payload)
    pages = bundle_payload.get("pages")
    if not isinstance(pages, list):
        raise OfficialWebHandoffConsumeError(
            code="invalid_source_truth_bundle",
            message="bundle pages must be an array.",
        )
    for page in pages:
        page_payload = _require_object(page, "pages[]")
        raw_asset_id = _require_text(page_payload.get("rawAssetId") or page_payload.get("raw_asset_id"), "rawAssetId")
        raw_version_id = _require_text(
            page_payload.get("rawVersionId") or page_payload.get("raw_version_id"),
            "rawVersionId",
        )
        manifest_key = _require_text(
            page_payload.get("pageManifestObjectKey") or page_payload.get("page_manifest_object_key"),
            "pageManifestObjectKey",
        )
        blocks_key = _require_text(
            page_payload.get("contentBlocksObjectKey") or page_payload.get("content_blocks_object_key"),
            "contentBlocksObjectKey",
        )
        manifest_bytes = _download_bytes(
            object_store=object_store,
            bucket=bucket,
            key=manifest_key,
            missing_code="missing_page_manifest",
        )
        blocks_bytes = _download_bytes(
            object_store=object_store,
            bucket=bucket,
            key=blocks_key,
            missing_code="missing_content_blocks",
        )
        base_dir = replay_input_dir / "source-assets" / raw_asset_id / raw_version_id / "source-truth"
        base_dir.mkdir(parents=True, exist_ok=True)
        (base_dir / "page-manifest.json").write_bytes(manifest_bytes)
        (base_dir / "content-blocks.jsonl").write_bytes(blocks_bytes)


def _resolve_source_truth_bundle_key(payload: dict[str, object]) -> str:
    artifacts = payload.get("artifacts")
    if isinstance(artifacts, list):
        for item in artifacts:
            if not isinstance(item, dict):
                continue
            artifact_type = str(item.get("artifactType") or "").strip()
            object_key = str(item.get("objectKey") or "").strip()
            if artifact_type == "source_truth_bundle" and object_key:
                return object_key
    site_id = _require_text(payload.get("siteId"), "payload.siteId")
    run_id = _require_text(payload.get("runId"), "payload.runId")
    return f"official_web/{site_id}/runs/{run_id}/source-truth-bundle.json"


def _build_stage_quality_report(
    *,
    settings: OfficialWebHandoffConsumerSettings,
    payload: dict[str, object],
    replay_input_dir: Path,
    replay_report: dict[str, object],
    chunk_audit_report: dict[str, object],
) -> dict[str, object]:
    seed_set = _normalize_string_list(payload.get("seedSet"))
    expected_host_set = _normalize_string_list(payload.get("hostSet"))
    actual_host_set = sorted(_load_manifest_hosts(replay_input_dir))
    replay_counts = replay_report.get("counts") if isinstance(replay_report.get("counts"), dict) else {}
    pages_seen = _coerce_non_negative_int(replay_counts.get("pages_seen"))
    emitted_documents = _coerce_non_negative_int(replay_counts.get("emitted_documents"))
    manual_review_pages = _coerce_non_negative_int(replay_counts.get("manual_review_pages"))
    chunk_audit_passed = bool(chunk_audit_report.get("passed"))
    replay_documents = _require_object_list(replay_report.get("documents"), "documents")
    document_page_family_counts = _count_by_value(
        _require_text(document.get("page_family"), "page_family")
        for document in replay_documents
    )
    document_serving_intent_counts = _count_by_value(
        _require_text(document.get("serving_intent") or "unknown", "serving_intent")
        for document in replay_documents
    )
    manual_review_page_family_counts = _count_by_value(
        _require_text(page.get("page_family"), "page_family")
        for page in _require_object_list(replay_report.get("manual_review_pages"), "manual_review_pages")
    )
    seed_coverage_ratio = round(pages_seen / len(seed_set), 4) if seed_set else 1.0
    host_coverage_ratio = round(len(actual_host_set) / len(expected_host_set), 4) if expected_host_set else 1.0
    blocked_checks: list[dict[str, object]] = []
    checks: list[dict[str, object]] = []

    def record_check(
        *,
        code: str,
        passed: bool,
        message: str,
        actual: object,
        expected: object,
    ) -> None:
        check = {
            "code": code,
            "passed": passed,
            "message": message,
            "actual": actual,
            "expected": expected,
        }
        checks.append(check)
        if not passed:
            blocked_checks.append(check)

    record_check(
        code="minimum_promote_pages",
        passed=pages_seen >= settings.minimum_promote_pages,
        message="source-truth bundle must contain enough pages before promotion",
        actual=pages_seen,
        expected={"min": settings.minimum_promote_pages},
    )
    record_check(
        code="seed_coverage_ratio",
        passed=seed_coverage_ratio >= settings.minimum_seed_coverage_ratio,
        message="seed coverage ratio is below the promotion threshold",
        actual=seed_coverage_ratio,
        expected={"min": settings.minimum_seed_coverage_ratio},
    )
    record_check(
        code="host_coverage_ratio",
        passed=host_coverage_ratio >= settings.minimum_host_coverage_ratio,
        message="host coverage ratio is below the promotion threshold",
        actual=host_coverage_ratio,
        expected={"min": settings.minimum_host_coverage_ratio},
    )
    record_check(
        code="emitted_documents_present",
        passed=emitted_documents > 0,
        message="projection replay emitted no promotable documents",
        actual=emitted_documents,
        expected={"min": 1},
    )
    promotable_document_count = sum(
        1
        for document in replay_documents
        if _require_text(document.get("serving_intent") or "unknown", "serving_intent") == "promotable"
    )
    record_check(
        code="promotable_documents_present",
        passed=promotable_document_count > 0,
        message="projection replay emitted no promotable documents after staged-only filtering",
        actual=promotable_document_count,
        expected={"min": 1},
    )
    record_check(
        code="chunk_audit_passed",
        passed=chunk_audit_passed,
        message="chunk audit reported quality issues",
        actual=chunk_audit_report.get("issue_counts") or {},
        expected={"passed": True},
    )
    disallowed_document_page_families = _count_by_value(
        _require_text(document.get("page_family"), "page_family")
        for document in replay_documents
        if _require_text(document.get("serving_intent") or "unknown", "serving_intent") == "promotable"
        and _require_text(document.get("page_family"), "page_family") in _PROMOTION_DISALLOWED_PAGE_FAMILIES
    )
    unknown_document_serving_intents = {
        serving_intent: count
        for serving_intent, count in document_serving_intent_counts.items()
        if serving_intent not in {"promotable", "audit_only"} and count > 0
    }
    record_check(
        code="promotable_page_families",
        passed=not disallowed_document_page_families,
        message="projection replay emitted promotable documents with page families that must stay staged-only",
        actual=disallowed_document_page_families,
        expected={"disallowed": sorted(_PROMOTION_DISALLOWED_PAGE_FAMILIES)},
    )
    record_check(
        code="recognized_serving_intent",
        passed=not unknown_document_serving_intents,
        message="projection replay emitted documents with unknown serving_intent values",
        actual=document_serving_intent_counts,
        expected={"allowed": ["promotable", "audit_only"]},
    )

    return {
        "passed": len(blocked_checks) == 0,
        "counts": {
            "expected_host_count": len(expected_host_set),
            "actual_host_count": len(actual_host_set),
            "seed_count": len(seed_set),
            "pages_seen": pages_seen,
            "emitted_documents": emitted_documents,
            "manual_review_pages": manual_review_pages,
        },
        "ratios": {
            "seed_coverage_ratio": seed_coverage_ratio,
            "host_coverage_ratio": host_coverage_ratio,
        },
        "actualHosts": actual_host_set,
        "documentPageFamilyCounts": document_page_family_counts,
        "documentServingIntentCounts": document_serving_intent_counts,
        "manualReviewPageFamilyCounts": manual_review_page_family_counts,
        "checks": checks,
        "blockedChecks": blocked_checks,
    }


def _build_promotion_report(
    *,
    promote_import: bool,
    coverage_report: dict[str, object],
) -> dict[str, object]:
    blocked_checks = coverage_report.get("blockedChecks")
    if not isinstance(blocked_checks, list):
        blocked_checks = []
    if not promote_import:
        return {
            "mode": "stage",
            "eligible": bool(coverage_report.get("passed")),
            "decision": "staged",
            "blockedChecks": blocked_checks,
        }
    if blocked_checks:
        return {
            "mode": "promote",
            "eligible": False,
            "decision": "blocked",
            "blockedChecks": blocked_checks,
        }
    return {
        "mode": "promote",
        "eligible": True,
        "decision": "promoted",
        "blockedChecks": [],
    }


def _persist_projection_output(
    *,
    work_dir: Path,
    projection_output_dir: Path,
    replay_input_dir: Path,
    bundle_payload: dict[str, object],
    source_object_store: OfficialWebSourceObjectStore,
    derived_object_store: OfficialWebDerivedObjectStore,
    document_registry: DocumentRegistry,
    raw_asset_registry: RawAssetRegistry,
    object_store_settings: ObjectStoreSettings,
):
    if not isinstance(bundle_payload.get("pages"), list):
        raise OfficialWebHandoffConsumeError(
            code="invalid_source_truth_bundle",
            message="bundle pages must be an array.",
        )
    return import_projection_output(
        work_dir=work_dir,
        projection_output_dir=projection_output_dir,
        replay_input_dir=replay_input_dir,
        source_object_store=source_object_store,
        derived_object_store=derived_object_store,
        document_registry=document_registry,
        raw_asset_registry=raw_asset_registry,
        object_store_settings=object_store_settings,
        scope_refresh=("official_web", "muc_public_pages"),
        require_promotable=True,
    )


def _resolve_derived_object_store(
    object_store: OfficialWebSourceObjectStore,
) -> OfficialWebDerivedObjectStore:
    if hasattr(object_store, "put_bytes"):
        return object_store  # type: ignore[return-value]
    return S3ObjectStoreAdmin(ObjectStoreSettings.from_env())


def _resolve_persist_object_store_settings(
    *,
    source_bucket: str,
    require_env: bool,
) -> ObjectStoreSettings:
    if require_env:
        return ObjectStoreSettings.from_env()

    try:
        env_settings = ObjectStoreSettings.from_env()
    except ValueError:
        return ObjectStoreSettings(
            endpoint="http://localhost",
            access_key="official-web-placeholder",
            secret_key="official-web-placeholder",
            bucket_source=source_bucket,
            bucket_derived=DEFAULT_BUCKET_DERIVED,
            secure=False,
        )

    return ObjectStoreSettings(
        endpoint=env_settings.endpoint,
        access_key=env_settings.access_key,
        secret_key=env_settings.secret_key,
        region=env_settings.region,
        bucket_source=source_bucket,
        bucket_derived=env_settings.bucket_derived,
        secure=env_settings.secure,
    )


def _build_status_reporter_from_env() -> OfficialWebExecutionStatusReporter | None:
    base_url = os.getenv("INGESTION_WORKER_APP_API_BASE_URL", "").strip()
    shared_secret = os.getenv("INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET", "").strip()
    if not base_url or not shared_secret:
        return None
    return HttpOfficialWebExecutionStatusReporter(
        base_url=base_url,
        internal_shared_secret=shared_secret,
    )


def _report_execution_status(
    *,
    reporter: OfficialWebExecutionStatusReporter | None,
    run_id: str,
    payload: dict[str, object],
    suppress_errors: bool = False,
) -> None:
    if reporter is None:
        return
    try:
        reporter.report(run_id=run_id, payload=payload)
    except Exception:
        if not suppress_errors:
            raise


def _download_json_object(
    *,
    object_store: OfficialWebSourceObjectStore,
    bucket: str,
    key: str,
    missing_code: str,
    invalid_code: str,
) -> dict[str, object]:
    payload_bytes = _download_bytes(
        object_store=object_store,
        bucket=bucket,
        key=key,
        missing_code=missing_code,
    )
    try:
        payload = json.loads(payload_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OfficialWebHandoffConsumeError(
            code=invalid_code,
            message=f"invalid JSON payload for {key}: {exc}",
        ) from exc
    if not isinstance(payload, dict):
        raise OfficialWebHandoffConsumeError(
            code=invalid_code,
            message=f"JSON payload for {key} must be an object.",
        )
    return payload


def _download_bytes(
    *,
    object_store: OfficialWebSourceObjectStore,
    bucket: str,
    key: str,
    missing_code: str,
) -> bytes:
    try:
        return object_store.get_bytes(bucket=bucket, key=key)
    except Exception as exc:
        raise OfficialWebHandoffConsumeError(
            code=missing_code,
            message=f"required object not found: {bucket}/{key}",
        ) from exc


def _read_json(path: Path) -> dict[str, object]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid JSON file: {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"JSON file must be an object: {path}")
    return payload


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_suffix(path.suffix + ".tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(path)


def _require_object(value: object, field_name: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object.")
    return value


def _require_text(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be a non-empty string.")
    return value.strip()


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _parse_attempt_count(value: object) -> int:
    if value is None:
        return 0
    if not isinstance(value, int) or value < 0:
        raise ValueError("processingAttemptCount must be a non-negative integer.")
    return value


def _parse_processing_status(value: object) -> str:
    if value is None:
        return "pending"
    if not isinstance(value, str):
        raise ValueError("processingStatus must be a string.")
    normalized = value.strip()
    if normalized not in {"pending", "running", "staged", "promoted", "succeeded", "failed"}:
        raise ValueError(f"unsupported processingStatus: {normalized!r}")
    return normalized


def _should_skip_existing_record(
    *,
    existing_status: str,
    promote_import: bool,
    force: bool,
) -> bool:
    if force:
        return False
    if existing_status in {"promoted", "succeeded"}:
        return True
    return existing_status == "staged" and not promote_import


def _as_error_dict(value: object) -> dict[str, object] | None:
    if not isinstance(value, dict):
        return None
    code = _optional_text(value.get("code"))
    message = _optional_text(value.get("message"))
    occurred_at = _optional_text(value.get("occurredAt"))
    if code is None or message is None:
        return None
    result: dict[str, object] = {"code": code, "message": message}
    if occurred_at is not None:
        result["occurredAt"] = occurred_at
    return result


def _normalize_error(error: Exception) -> dict[str, object]:
    if isinstance(error, OfficialWebHandoffConsumeError):
        code = error.code
        message = str(error)
    else:
        code = "handoff_execution_failed"
        message = str(error) or error.__class__.__name__
    return {
        "code": code,
        "message": message,
        "occurredAt": _utcnow(),
    }


def _safe_event_id(event_id: str) -> str:
    sanitized = "".join(
        character
        for character in event_id
        if character.isalnum() or character in {"-", "_"}
    )
    if not sanitized:
        raise ValueError("eventId must contain at least one safe filename character.")
    return sanitized


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _build_promotion_blocked_message(blocked_checks: object) -> str:
    if not isinstance(blocked_checks, list) or not blocked_checks:
        return "promotion blocked by quality gates"
    labels = [
        _optional_text(item.get("code"))
        for item in blocked_checks
        if isinstance(item, dict)
    ]
    normalized = [label for label in labels if label is not None]
    if not normalized:
        return "promotion blocked by quality gates"
    return "promotion blocked by quality gates: " + ", ".join(normalized)


def _load_manifest_hosts(replay_input_dir: Path) -> set[str]:
    hosts: set[str] = set()
    for path in replay_input_dir.glob("source-assets/*/*/source-truth/page-manifest.json"):
        payload = _read_json(path)
        host = _optional_text(payload.get("host"))
        if host is not None:
            hosts.add(host)
    return hosts


def _count_by_value(values: Iterable[object]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        normalized = str(value or "").strip() or "unknown"
        counts[normalized] = counts.get(normalized, 0) + 1
    return counts


def _normalize_string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [normalized for item in value if (normalized := _optional_text(item)) is not None]


def _require_object_list(value: object, field_name: str) -> list[dict[str, object]]:
    if not isinstance(value, list):
        raise ValueError(f"{field_name} must be an array.")
    result: list[dict[str, object]] = []
    for item in value:
        result.append(_require_object(item, f"{field_name}[]"))
    return result


def _coerce_non_negative_int(value: object) -> int:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return max(value, 0)
    if isinstance(value, float):
        return max(int(value), 0)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return 0


def _read_bool_env(name: str) -> bool:
    value = os.getenv(name, "").strip().lower()
    return value in {"1", "true", "yes", "on"}


def _read_positive_int_env(name: str, *, default: int) -> int:
    value = os.getenv(name, "").strip()
    if not value:
        return default
    parsed = int(value)
    if parsed <= 0:
        raise ValueError(f"{name} must be a positive integer.")
    return parsed


def _read_ratio_env(name: str, *, default: float) -> float:
    value = os.getenv(name, "").strip()
    if not value:
        return default
    parsed = float(value)
    if parsed < 0 or parsed > 1:
        raise ValueError(f"{name} must be between 0 and 1.")
    return parsed


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = consume_official_web_handoffs(
        event_id=args.event_id,
        limit=args.limit,
        force=args.force,
        promote_import=args.promote,
        declarations_path=Path(args.declarations_path).resolve() if args.declarations_path else None,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))
    if report.counts["failed"] > 0:
        raise SystemExit(1)


__all__ = [
    "OFFICIAL_WEB_HANDOFF_CONSUME_REPORT_SCHEMA_VERSION",
    "OfficialWebHandoffConsumeBatchReport",
    "OfficialWebHandoffConsumeError",
    "OfficialWebHandoffConsumeResult",
    "OfficialWebHandoffConsumerSettings",
    "OfficialWebSourceObjectStore",
    "build_parser",
    "consume_handoff_record",
    "consume_official_web_handoffs",
    "main",
]


if __name__ == "__main__":
    main()
