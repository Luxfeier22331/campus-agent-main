from __future__ import annotations

import argparse
import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core import ObjectStoreSettings
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
):
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
    if not build_result.bundle["service_status_records"]:
        raise ValueError("notice-derived service status projection produced no records")
    report = write_service_status_projection_release(
        bundle=build_result.bundle,
        output_dir=work_dir,
        release_id=release_id,
        generated_at=generated_at,
        object_store=object_store,
        bucket=derived_bucket,
    )
    _publish_structured_projection_release(
        structured_projection_publisher=structured_projection_publisher,
        bundle=build_result.bundle,
        report=report,
        generated_at=generated_at,
    )
    _write_json(
        work_dir / "build-report.json",
        {
            **asdict(report),
            "corpus": SERVICE_STATUS_CORPUS,
            "collection": SERVICE_STATUS_COLLECTION,
        },
    )
    return report


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    if not args.from_consumption_projection:
        raise ValueError("--from-consumption-projection is required")
    generated_at = args.generated_at or _default_generated_at()
    source = dict(os.environ)
    selection = build_internal_notice_selection_provenance(
        explicit_notice_ids=args.notice_id or (),
        selection_path=args.selection_path,
        extra_command_args={
            "all_ready_service_status_candidates": bool(args.all_ready_service_status_candidates),
        },
    )
    notice_ids = normalize_notice_ids(selection.notice_ids)
    if not notice_ids and not args.all_ready_service_status_candidates:
        raise ValueError(
            "--notice-id, --selection-path, or --all-ready-service-status-candidates is "
            "required with --from-consumption-projection"
        )
    settings = ObjectStoreSettings.from_env()
    object_store = S3ObjectStoreAdmin(settings)
    projection_store = build_notice_consumption_projection_store_from_env(source)
    projection_entries = projection_store.list_by_scope(
        "campus_notices",
        "internal_notice",
        notice_ids=notice_ids,
    )
    if args.all_ready_service_status_candidates:
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
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


def _publish_structured_projection_release(
    *,
    structured_projection_publisher: _StructuredProjectionPublisher | None,
    bundle: Mapping[str, Any],
    report: _ProjectionReleaseReport,
    generated_at: str,
) -> None:
    if structured_projection_publisher is None:
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
    )


def _ready_service_status_projection_entries(
    entries: Sequence[NoticeConsumptionProjectionEntry],
) -> tuple[NoticeConsumptionProjectionEntry, ...]:
    return tuple(
        entry
        for entry in entries
        if entry.target_surface == NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE
        and entry.consumption_status == NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
    )


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
