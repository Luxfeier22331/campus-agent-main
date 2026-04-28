from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core import ObjectStoreSettings
from campus_ingestion_core.internal_notice_consumer_admission_gate import (
    CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION,
    ConsumerAdmissionGateRequest,
    admitted_notice_ids_for_target_surface,
    check_internal_notice_consumer_admission_gate,
)
from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    CONSUMER_ADMISSION_SCOPE_WRITE_MODE_REPLACE_SCOPE,
    load_internal_notice_consumer_admission_manifest,
)
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NoticeConsumptionProjectionEntry,
    build_notice_consumption_projection_store_from_env,
    normalize_notice_ids,
)
from campus_ingestion_core.notice_derived_service_status_materialization import (
    build_notice_derived_service_status_projection_bundle,
)
from campus_ingestion_core.registry import DocumentRegistry, build_document_registry_from_env
from campus_ingestion_core.service_status_projection import (
    SERVICE_STATUS_COLLECTION,
    SERVICE_STATUS_CORPUS,
    SERVICE_STATUS_PROJECTION_SCHEMA_VERSION,
    write_service_status_projection_release,
)
from campus_ingestion_core.structured_projection_postgres import (
    build_structured_projection_publisher_from_env,
    projection_artifact_checksum,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.internal_notice_selection import (
    build_internal_notice_selection_provenance,
)


class _ServiceStatusProjectionObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


class _StructuredProjectionPublisher(Protocol):
    def publish_release(
        self,
        *,
        corpus: str,
        collection: str,
        release_id: str,
        generated_at: str,
        schema_version: str,
        artifact_object_key: str,
        artifact_checksum: str,
        bundle: Mapping[str, Any],
        validation_status: str,
        promote_current: bool = True,
    ) -> object: ...


class _ProjectionReleaseReport(Protocol):
    release_id: str
    release_object_key: str


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build campus_services service_status projection from notice consumption truth.",
    )
    parser.add_argument(
        "--from-consumption-projection",
        action="store_true",
        help="Build from ready internal_notice consumption projection service status candidates.",
    )
    parser.add_argument(
        "--notice-id",
        action="append",
        default=[],
        help="Selected notice id for consumption-projection mode. Repeatable.",
    )
    parser.add_argument("--selection-path")
    parser.add_argument(
        "--all-ready-service-status-candidates",
        action="store_true",
        help="Build from all ready service status candidates in notice_consumption_projection.",
    )
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--generated-at")
    parser.add_argument("--derived-bucket")
    parser.add_argument("--consumer-admission-manifest-path")
    parser.add_argument(
        "--publish-mode",
        default="promote",
        choices=("preview", "stage", "promote"),
        help=(
            "preview writes local artifacts only; stage writes versioned artifact/read model "
            "without current; promote updates current."
        ),
    )
    return parser


def build_service_status_projection_release_from_consumption_projection(
    *,
    projection_entries: Sequence[NoticeConsumptionProjectionEntry],
    registry: DocumentRegistry,
    work_dir: Path,
    release_id: str,
    generated_at: str,
    object_store: _ServiceStatusProjectionObjectStore,
    derived_bucket: str,
    structured_projection_publisher: _StructuredProjectionPublisher | None = None,
    selected_notice_ids: Sequence[str] = (),
    consumer_admission_gate_report: Mapping[str, Any] | None = None,
    publish_mode: str = "promote",
):
    normalized_publish_mode = _normalize_publish_mode(publish_mode)
    build_result = build_notice_derived_service_status_projection_bundle(
        projection_entries=projection_entries,
        registry=registry,
        object_store=object_store,
        derived_bucket=derived_bucket,
        generated_at=generated_at,
    )
    work_dir.mkdir(parents=True, exist_ok=True)
    _write_json(work_dir / "validation-summary.json", asdict(build_result.validation_report))
    if not build_result.validation_report.valid:
        raise ValueError("notice-derived service status projection validation failed")
    if not build_result.bundle["service_status_records"] and normalized_publish_mode != "preview":
        raise ValueError("notice-derived service status projection produced no records")
    report = write_service_status_projection_release(
        bundle=build_result.bundle,
        output_dir=work_dir,
        release_id=release_id,
        generated_at=generated_at,
        object_store=object_store if _writes_versioned_artifacts(normalized_publish_mode) else None,
        bucket=derived_bucket,
        write_current=_promotes_current(normalized_publish_mode),
    )
    _publish_structured_projection_release(
        structured_projection_publisher=structured_projection_publisher,
        bundle=build_result.bundle,
        report=report,
        generated_at=generated_at,
        promote_current=_promotes_current(normalized_publish_mode),
        enabled=_writes_structured_projection(normalized_publish_mode),
    )
    _write_json(
        work_dir / "build-report.json",
        _build_report_payload(
            **asdict(report),
            corpus=SERVICE_STATUS_CORPUS,
            collection=SERVICE_STATUS_COLLECTION,
            selected_notice_ids=selected_notice_ids,
            projection_entries=projection_entries,
            consumer_admission_gate_report=consumer_admission_gate_report,
            validation_counts=build_result.validation_report.counts,
        ),
    )
    return report


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    if not args.from_consumption_projection:
        raise ValueError("--from-consumption-projection is required")
    if not args.consumer_admission_manifest_path:
        raise ValueError(
            "consumer admission manifest is required before service_status typed materialization"
        )
    generated_at = args.generated_at or _default_generated_at()
    source = dict(os.environ)
    consumer_manifest = load_internal_notice_consumer_admission_manifest(
        Path(args.consumer_admission_manifest_path).resolve()
    )
    selection = build_internal_notice_selection_provenance(
        explicit_notice_ids=args.notice_id or (),
        selection_path=args.selection_path,
        extra_command_args={
            "all_ready_service_status_candidates": bool(args.all_ready_service_status_candidates),
        },
    )
    selected_notice_ids = normalize_notice_ids(selection.notice_ids)
    admitted_notice_ids = admitted_notice_ids_for_target_surface(
        consumer_manifest,
        target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    )
    notice_ids = selected_notice_ids
    if args.all_ready_service_status_candidates:
        if consumer_manifest.scope_write_mode != CONSUMER_ADMISSION_SCOPE_WRITE_MODE_REPLACE_SCOPE:
            raise ValueError(
                "--all-ready-service-status-candidates requires consumer admission manifest "
                "scope_write_mode=replace_scope"
            )
        notice_ids = notice_ids or admitted_notice_ids
    if not notice_ids:
        raise ValueError(
            "--notice-id, --selection-path, or --all-ready-service-status-candidates is "
            "required with --from-consumption-projection"
        )
    consumer_admission_gate_report = check_internal_notice_consumer_admission_gate(
        manifest=consumer_manifest,
        request=ConsumerAdmissionGateRequest(
            operation=CONSUMER_ADMISSION_GATE_OPERATION_TYPED_MATERIALIZATION,
            source_corpus="campus_notices",
            source_collection="internal_notice",
            selected_notice_ids=notice_ids,
            scope_write_mode=(
                "replace_scope" if args.all_ready_service_status_candidates else "upsert_selected"
            ),
            target_surface=NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
        ),
    )
    if not consumer_admission_gate_report.allowed:
        raise ValueError(
            "consumer admission manifest gate blocked service_status materialization: "
            + ", ".join(consumer_admission_gate_report.reason_codes)
        )
    settings = ObjectStoreSettings.from_env()
    object_store = S3ObjectStoreAdmin(settings)
    projection_store = build_notice_consumption_projection_store_from_env(source)
    projection_entries = projection_store.list_by_scope(
        "campus_notices",
        "internal_notice",
        notice_ids=notice_ids,
    )
    projection_entries = _ready_service_status_projection_entries(projection_entries)
    report = build_service_status_projection_release_from_consumption_projection(
        projection_entries=projection_entries,
        registry=build_document_registry_from_env(source),
        work_dir=Path(args.work_dir).resolve(),
        release_id=args.release_id,
        generated_at=generated_at,
        object_store=object_store,
        derived_bucket=args.derived_bucket or settings.bucket_derived,
        structured_projection_publisher=build_structured_projection_publisher_from_env(source),
        selected_notice_ids=notice_ids,
        consumer_admission_gate_report=asdict(consumer_admission_gate_report),
        publish_mode=args.publish_mode,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


def _publish_structured_projection_release(
    *,
    structured_projection_publisher: _StructuredProjectionPublisher | None,
    bundle: Mapping[str, Any],
    report: _ProjectionReleaseReport,
    generated_at: str,
    promote_current: bool = True,
    enabled: bool = True,
) -> None:
    if structured_projection_publisher is None or not enabled:
        return
    schema_version = str(bundle.get("schema_version") or "").strip()
    if schema_version != SERVICE_STATUS_PROJECTION_SCHEMA_VERSION:
        raise ValueError("service status projection bundle schema_version is invalid")
    structured_projection_publisher.publish_release(
        corpus=SERVICE_STATUS_CORPUS,
        collection=SERVICE_STATUS_COLLECTION,
        release_id=report.release_id,
        generated_at=generated_at,
        schema_version=schema_version,
        artifact_object_key=report.release_object_key,
        artifact_checksum=projection_artifact_checksum(bundle),
        bundle=bundle,
        validation_status="valid",
        promote_current=promote_current,
    )


def _normalize_publish_mode(value: str) -> str:
    normalized = str(value or "promote").strip()
    if normalized not in {"preview", "stage", "promote"}:
        raise ValueError(f"unsupported publish mode: {value}")
    return normalized


def _writes_versioned_artifacts(publish_mode: str) -> bool:
    return _normalize_publish_mode(publish_mode) in {"stage", "promote"}


def _writes_structured_projection(publish_mode: str) -> bool:
    return _normalize_publish_mode(publish_mode) in {"stage", "promote"}


def _promotes_current(publish_mode: str) -> bool:
    return _normalize_publish_mode(publish_mode) == "promote"


def _ready_service_status_projection_entries(
    entries: Sequence[NoticeConsumptionProjectionEntry],
) -> tuple[NoticeConsumptionProjectionEntry, ...]:
    return tuple(
        entry
        for entry in entries
        if entry.target_surface == NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE
        and entry.consumption_status == NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
    )


def _build_report_payload(
    *,
    selected_notice_ids: Sequence[str],
    projection_entries: Sequence[NoticeConsumptionProjectionEntry],
    consumer_admission_gate_report: Mapping[str, Any] | None,
    validation_counts: Mapping[str, int],
    **base_payload: object,
) -> dict[str, object]:
    normalized_selected_notice_ids = normalize_notice_ids(selected_notice_ids)
    accepted_notice_ids = normalize_notice_ids(
        tuple(entry.source_notice_id for entry in projection_entries if entry.source_notice_id)
    )
    target_surface_counts = dict(
        sorted(Counter(entry.target_surface for entry in projection_entries).items())
    )
    payload: dict[str, object] = {
        **base_payload,
        "selected_notice_ids": list(normalized_selected_notice_ids),
        "accepted_notice_ids": list(accepted_notice_ids),
        "accepted_count": len(accepted_notice_ids),
        "rejected_count": max(0, len(normalized_selected_notice_ids) - len(accepted_notice_ids)),
        "materialized_record_count": int(validation_counts.get("service_status_records", 0)),
        "rejected_source_count": int(validation_counts.get("rejected_sources", 0)),
        "target_surface_counts": target_surface_counts,
    }
    if consumer_admission_gate_report is not None:
        payload["consumer_admission_gate"] = dict(consumer_admission_gate_report)
    return payload


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _default_generated_at() -> str:
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


__all__ = [
    "build_parser",
    "build_service_status_projection_release_from_consumption_projection",
    "main",
]


if __name__ == "__main__":
    main()
