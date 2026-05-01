from __future__ import annotations

import json
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

from campus_ingestion_core.internal_notice_consumer_admission_gate import (
    CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION,
    ConsumerAdmissionGateRequest,
    check_internal_notice_consumer_admission_gate,
)
from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    load_internal_notice_consumer_admission_manifest,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NoticeConsumptionProjectionEntry,
    build_notice_consumption_projection_store_from_env,
    normalize_notice_ids,
)
from campus_ingestion_core.notice_derived_transport_schedule_materialization import (
    build_notice_derived_transport_schedule_projection_bundle,
)
from campus_ingestion_core.registry import build_document_registry_from_env
from campus_ingestion_core.service_status_projection import SERVICE_STATUS_COLLECTION
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.structured_projection_postgres import (
    build_structured_projection_publisher_from_env,
)
from campus_ingestion_core.transport_schedule_projection import (
    DEFAULT_TRANSPORT_SCHEDULE_HORIZON_DAYS,
    TRANSPORT_SCHEDULE_COLLECTION,
    TRANSPORT_SCHEDULE_REJECTED_SOURCE_REPORT_FILENAME,
)

from campus_ingestion_worker.build_service_status_projection import (
    build_service_status_projection_release_from_consumption_projection,
)
from campus_ingestion_worker.build_transport_schedule_projection import (
    build_transport_schedule_projection_release_from_consumption_projection,
)
from campus_ingestion_worker.schedule_transport_preview_gate import (
    build_schedule_transport_preview_gate_report,
)

SCHEMA_VERSION = "authenticated_notice_typed_downstream_materialization.v1"
_PUBLISH_MODE = "promote"


def materialize_authenticated_notice_typed_downstream(
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
) -> dict[str, Any]:
    selected_notice_ids = _selected_notice_ids(import_result)
    if not selected_notice_ids:
        return _write_report(
            operations_dir,
            {
                "schema_version": SCHEMA_VERSION,
                "status": "skipped_no_selected_notice_ids",
                "run_id": run_id,
                "job_id": job_id,
                "candidate_count": 0,
                "completed_count": 0,
                "failed_count": 0,
                "materialized_releases": [],
                "findings": [],
            },
        )

    projection_store = build_notice_consumption_projection_store_from_env(env)
    entries = projection_store.list_by_scope(
        source_corpus,
        source_collection,
        notice_ids=selected_notice_ids,
    )
    candidates = _ready_typed_candidates(entries)
    grouped = _group_candidates(candidates)
    registry = build_document_registry_from_env(env)
    structured_projection_publisher = build_structured_projection_publisher_from_env(env)
    object_store_settings = ObjectStoreSettings.from_env(env)
    consumer_manifest = load_internal_notice_consumer_admission_manifest(
        consumer_admission_manifest_path
    )

    materialized_releases: list[dict[str, Any]] = []
    findings: list[dict[str, Any]] = []
    if grouped.get("transport_schedule"):
        transport_entries = grouped["transport_schedule"]
        _assert_gate_allows(
            consumer_manifest=consumer_manifest,
            source_corpus=source_corpus,
            source_collection=source_collection,
            notice_ids=tuple(entry.source_notice_id for entry in transport_entries),
        )
        release_id = _release_id("transport-schedule", run_id=run_id, job_id=job_id)
        transport_work_dir = operations_dir / "typed-materialization" / "transport_schedule"
        preview_gate_report = _build_transport_preview_gate_report(
            projection_entries=transport_entries,
            registry=registry,
            object_store=object_store,
            derived_bucket=object_store_settings.bucket_derived,
            generated_at=generated_at,
            run_id=run_id,
            work_dir=transport_work_dir,
        )
        preview_failed_notice_ids = _preview_failed_notice_ids(preview_gate_report)
        if preview_failed_notice_ids:
            findings.append(
                _transport_preview_failed_finding(
                    preview_gate_report=preview_gate_report,
                    failed_notice_ids=preview_failed_notice_ids,
                )
            )
        else:
            report = build_transport_schedule_projection_release_from_consumption_projection(
                projection_entries=transport_entries,
                registry=registry,
                work_dir=transport_work_dir / "release",
                release_id=release_id,
                generated_at=generated_at,
                service_horizon_days=DEFAULT_TRANSPORT_SCHEDULE_HORIZON_DAYS,
                object_store=object_store,
                derived_bucket=object_store_settings.bucket_derived,
                structured_projection_publisher=structured_projection_publisher,
                publish_mode=_PUBLISH_MODE,
                admitted_at=str(getattr(consumer_manifest, "created_at", "") or ""),
                selected_notice_ids=tuple(entry.source_notice_id for entry in transport_entries),
                transport_preview_gate_report=preview_gate_report,
            )
            materialized_releases.append(
                _release_payload(
                    collection=TRANSPORT_SCHEDULE_COLLECTION,
                    candidate_kind="transport_schedule",
                    report=report,
                    current=True,
                    notice_ids=tuple(entry.source_notice_id for entry in transport_entries),
                )
            )

    if grouped.get("service_status"):
        service_entries = grouped["service_status"]
        _assert_gate_allows(
            consumer_manifest=consumer_manifest,
            source_corpus=source_corpus,
            source_collection=source_collection,
            notice_ids=tuple(entry.source_notice_id for entry in service_entries),
        )
        release_id = _release_id("service-status", run_id=run_id, job_id=job_id)
        report = build_service_status_projection_release_from_consumption_projection(
            projection_entries=service_entries,
            registry=registry,
            work_dir=operations_dir / "typed-materialization" / "service_status" / "release",
            release_id=release_id,
            generated_at=generated_at,
            object_store=object_store,
            derived_bucket=object_store_settings.bucket_derived,
            structured_projection_publisher=structured_projection_publisher,
            selected_notice_ids=tuple(entry.source_notice_id for entry in service_entries),
            consumer_admission_gate_report={},
            publish_mode=_PUBLISH_MODE,
        )
        materialized_releases.append(
            _release_payload(
                collection=SERVICE_STATUS_COLLECTION,
                candidate_kind="service_status",
                report=report,
                current=True,
                notice_ids=tuple(entry.source_notice_id for entry in service_entries),
            )
        )

    unsupported_kind_counts = {
        kind: len(entries)
        for kind, entries in grouped.items()
        if kind not in {"transport_schedule", "service_status"}
    }
    for kind, count in sorted(unsupported_kind_counts.items()):
        findings.append(
            {
                "severity": "medium",
                "code": "unsupported_typed_materialization_candidate_kind",
                "candidate_kind": kind,
                "candidate_count": count,
            }
        )

    failed_count = len(findings)
    status = "completed" if candidates and not findings else "missing"
    return _write_report(
        operations_dir,
        {
            "schema_version": SCHEMA_VERSION,
            "status": status,
            "run_id": run_id,
            "job_id": job_id,
            "generated_at": generated_at,
            "source_corpus": source_corpus,
            "source_collection": source_collection,
            "selected_notice_ids": list(selected_notice_ids),
            "candidate_count": len(candidates),
            "candidate_kind_counts": dict(
                sorted(Counter(_candidate_kind(entry) for entry in candidates).items())
            ),
            "completed_count": len(materialized_releases),
            "failed_count": failed_count,
            "materialized_releases": materialized_releases,
            "findings": findings,
        },
    )


def _ready_typed_candidates(
    entries: Sequence[NoticeConsumptionProjectionEntry],
) -> tuple[NoticeConsumptionProjectionEntry, ...]:
    return tuple(
        entry
        for entry in entries
        if entry.target_surface == NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE
        and entry.consumption_status == NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
    )


def _group_candidates(
    entries: Sequence[NoticeConsumptionProjectionEntry],
) -> dict[str, tuple[NoticeConsumptionProjectionEntry, ...]]:
    grouped: dict[str, list[NoticeConsumptionProjectionEntry]] = {}
    for entry in entries:
        grouped.setdefault(_candidate_kind(entry), []).append(entry)
    return {kind: tuple(rows) for kind, rows in sorted(grouped.items())}


def _candidate_kind(entry: NoticeConsumptionProjectionEntry) -> str:
    metadata = dict(entry.role_metadata or {})
    return str(metadata.get("service_status_candidate_kind") or "service_status").strip()


def _build_transport_preview_gate_report(
    *,
    projection_entries: Sequence[NoticeConsumptionProjectionEntry],
    registry: object,
    object_store: object,
    derived_bucket: str,
    generated_at: str,
    run_id: str,
    work_dir: Path,
) -> dict[str, Any]:
    preview_result = build_notice_derived_transport_schedule_projection_bundle(
        projection_entries=projection_entries,
        registry=registry,  # type: ignore[arg-type]
        object_store=object_store,  # type: ignore[arg-type]
        derived_bucket=derived_bucket,
        generated_at=generated_at,
        service_horizon_days=DEFAULT_TRANSPORT_SCHEDULE_HORIZON_DAYS,
    )
    work_dir.mkdir(parents=True, exist_ok=True)
    bundle_path = work_dir / "preview-projection-bundle.json"
    validation_path = work_dir / "preview-validation-summary.json"
    rejected_path = work_dir / TRANSPORT_SCHEDULE_REJECTED_SOURCE_REPORT_FILENAME
    _write_json(bundle_path, preview_result.bundle)
    _write_json(validation_path, _dataclass_payload(preview_result.validation_report))
    _write_json(rejected_path, preview_result.rejected_source_records)
    candidate_gate_report = {
        "schema_version": "schedule_batch_preview_gate.v1",
        "buckets": {
            "auto_stage_candidate": [entry.source_notice_id for entry in projection_entries],
        },
        "items": [
            {
                "notice_id": entry.source_notice_id,
                "title": str((entry.role_metadata or {}).get("notice_title") or ""),
            }
            for entry in projection_entries
        ],
    }
    preview_gate_report = build_schedule_transport_preview_gate_report(
        candidate_gate_report=candidate_gate_report,
        projection_bundle=preview_result.bundle,
        validation_summary=_dataclass_payload(preview_result.validation_report),
        rejected_sources=tuple(
            dict(item)
            for item in preview_result.rejected_source_records
            if isinstance(item, Mapping)
        ),
        run_id=run_id,
        generated_at=generated_at,
        candidate_gate_report_path="generated_from_projection_candidates",
        projection_bundle_path=str(bundle_path),
        validation_summary_path=str(validation_path),
        rejected_source_report_path=str(rejected_path),
    )
    _write_json(work_dir / "schedule-transport-preview-gate.json", preview_gate_report)
    return preview_gate_report


def _preview_failed_notice_ids(preview_gate_report: Mapping[str, Any]) -> tuple[str, ...]:
    buckets = dict(preview_gate_report.get("buckets") or {})
    return normalize_notice_ids(tuple(str(item) for item in buckets.get("preview_failed") or ()))


def _transport_preview_failed_finding(
    *,
    preview_gate_report: Mapping[str, Any],
    failed_notice_ids: Sequence[str],
) -> dict[str, Any]:
    normalized_failed_notice_ids = normalize_notice_ids(failed_notice_ids)
    rejected_sources: list[dict[str, Any]] = []
    reason_codes: list[str] = []
    for item in _preview_gate_items_for_notice_ids(
        preview_gate_report=preview_gate_report,
        notice_ids=normalized_failed_notice_ids,
    ):
        rejected_source = item.get("rejected_source")
        if isinstance(rejected_source, Mapping) and rejected_source:
            rejected_sources.append(dict(rejected_source))
        for reason_code in item.get("reason_codes") or ():
            reason = str(reason_code).strip()
            if reason and reason not in reason_codes:
                reason_codes.append(reason)
    return {
        "severity": "medium",
        "code": "transport_preview_failed",
        "candidate_kind": "transport_schedule",
        "candidate_count": len(normalized_failed_notice_ids),
        "notice_ids": list(normalized_failed_notice_ids),
        "reason_codes": reason_codes,
        "rejected_sources": rejected_sources,
        "preview_gate": dict(preview_gate_report),
    }


def _preview_gate_items_for_notice_ids(
    *,
    preview_gate_report: Mapping[str, Any],
    notice_ids: Sequence[str],
) -> tuple[Mapping[str, Any], ...]:
    selected = set(normalize_notice_ids(notice_ids))
    items = preview_gate_report.get("items") or ()
    if not isinstance(items, Sequence):
        return ()
    return tuple(
        item
        for item in items
        if isinstance(item, Mapping) and str(item.get("notice_id") or "").strip() in selected
    )


def _assert_gate_allows(
    *,
    consumer_manifest: object,
    source_corpus: str,
    source_collection: str,
    notice_ids: Sequence[str],
) -> None:
    report = check_internal_notice_consumer_admission_gate(
        manifest=consumer_manifest,  # type: ignore[arg-type]
        request=ConsumerAdmissionGateRequest(
            operation=CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION,
            source_corpus=source_corpus,
            source_collection=source_collection,
            selected_notice_ids=normalize_notice_ids(notice_ids),
            scope_write_mode="upsert_selected",
            target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
            max_empty_body_count=0,
            max_unsupported_binary_count=0,
        ),
    )
    if not report.allowed:
        raise ValueError(
            "consumer admission manifest gate blocked typed materialization: "
            + ", ".join(report.reason_codes)
        )


def _selected_notice_ids(import_result: Mapping[str, Any]) -> tuple[str, ...]:
    values = import_result.get("selected_notice_ids")
    if not isinstance(values, Sequence) or isinstance(values, str | bytes):
        return ()
    return normalize_notice_ids(tuple(str(item) for item in values))


def _release_id(prefix: str, *, run_id: str, job_id: str) -> str:
    return "-".join(
        _safe_segment(segment) for segment in (prefix, run_id, job_id) if _safe_segment(segment)
    )


def _safe_segment(value: str) -> str:
    normalized = "".join(
        char if char.isalnum() or char in {"-", "_"} else "-" for char in str(value).strip()
    )
    while "--" in normalized:
        normalized = normalized.replace("--", "-")
    return normalized.strip("-")


def _release_payload(
    *,
    collection: str,
    candidate_kind: str,
    report: object,
    current: bool,
    notice_ids: Sequence[str],
) -> dict[str, Any]:
    return {
        "collection": collection,
        "candidate_kind": candidate_kind,
        "release_id": str(getattr(report, "release_id", "")),
        "release_object_key": str(getattr(report, "release_object_key", "")),
        "current_object_key": str(getattr(report, "current_object_key", "")),
        "current": current,
        "notice_ids": list(normalize_notice_ids(notice_ids)),
    }


def _dataclass_payload(value: object) -> dict[str, Any]:
    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, Mapping):
        return dict(value)
    return dict(vars(value))


def _write_report(operations_dir: Path, payload: dict[str, Any]) -> dict[str, Any]:
    _write_json(operations_dir / "typed-downstream-materialization.json", payload)
    return payload


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


__all__ = [
    "SCHEMA_VERSION",
    "materialize_authenticated_notice_typed_downstream",
]
