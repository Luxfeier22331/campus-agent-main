from __future__ import annotations

import argparse
import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from campus_ingestion_core import ObjectStoreSettings
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.notice_consumption_projection import (
    NoticeConsumptionProjectionEntry,
    build_notice_consumption_projection_store_from_env,
    normalize_notice_ids,
)
from campus_ingestion_core.notice_derived_transport_schedule_materialization import (
    build_notice_derived_transport_schedule_projection_bundle,
)
from campus_ingestion_core.object_store import build_index_release_artifact_key
from campus_ingestion_core.registry import DocumentRegistry, build_document_registry_from_env
from campus_ingestion_core.structured_projection_postgres import (
    build_structured_projection_publisher_from_env,
)
from campus_ingestion_core.transport_schedule_projection import (
    DEFAULT_TRANSPORT_SCHEDULE_HORIZON_DAYS,
    TRANSPORT_SCHEDULE_COLLECTION,
    TRANSPORT_SCHEDULE_CORPUS,
    TRANSPORT_SCHEDULE_PROJECTION_FILENAME,
    TRANSPORT_SCHEDULE_REJECTED_SOURCE_REPORT_FILENAME,
    build_transport_schedule_projection_bundle,
    write_transport_schedule_projection_release,
)

from campus_ingestion_worker.build_transport_schedule_projection_contracts import (
    _DerivedObjectStore,
    _SourceObjectStore,
    _StructuredProjectionPublisher,
    _TransportProjectionObjectStore,
)
from campus_ingestion_worker.build_transport_schedule_projection_gate import (
    _assert_transport_bundle_matches_preview_gate_report,
    _assert_transport_consumer_admission_gate_allows,
    _assert_transport_preview_gate_allows,
    _assert_transport_release_scope_allows,
    _load_consumer_admission_manifest_for_transport,
    _ready_transport_projection_entries,
)
from campus_ingestion_worker.build_transport_schedule_projection_io import _write_json
from campus_ingestion_worker.build_transport_schedule_projection_provenance import (
    _transport_release_notice_provenance_records,
)
from campus_ingestion_worker.build_transport_schedule_projection_publish import (
    _PUBLISH_MODE_PREVIEW,
    _PUBLISH_MODES,
    _normalize_publish_mode,
    _promotes_current,
    _publish_structured_projection_release,
    _writes_structured_projection,
    _writes_versioned_artifacts,
)
from campus_ingestion_worker.build_transport_schedule_projection_source import (
    _load_source_truth_parents,
)
from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.internal_notice_selection import (
    build_internal_notice_selection_provenance,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build campus_services transport_schedule projection from authenticated notice source truth.",
    )
    parser.add_argument("--source-truth-inventory")
    parser.add_argument("--source-truth-root")
    parser.add_argument(
        "--from-consumption-projection",
        action="store_true",
        help="Build from ready internal_notice consumption projection transport candidates.",
    )
    parser.add_argument(
        "--notice-id",
        action="append",
        default=[],
        help="Selected notice id for consumption-projection mode. Repeatable.",
    )
    parser.add_argument(
        "--selection-path",
        help="Selection manifest/path containing notice ids for consumption-projection mode.",
    )
    parser.add_argument(
        "--all-ready-transport-candidates",
        action="store_true",
        help=(
            "Build from all ready transport schedule candidates already present in "
            "notice_consumption_projection."
        ),
    )
    parser.add_argument(
        "--allow-multi-notice-release",
        action="store_true",
        help=(
            "Allow stage/promote from more than one transport notice or from the all-ready "
            "transport candidate selector. Preview mode is unaffected."
        ),
    )
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--generated-at")
    parser.add_argument(
        "--service-horizon-days",
        type=int,
        default=DEFAULT_TRANSPORT_SCHEDULE_HORIZON_DAYS,
    )
    parser.add_argument("--source-bucket")
    parser.add_argument("--derived-bucket")
    parser.add_argument(
        "--publish-mode",
        default=_PUBLISH_MODE_PREVIEW,
        choices=sorted(_PUBLISH_MODES),
        help=(
            "preview writes local artifacts only; stage writes versioned artifact/read model "
            "without current; promote updates current. Defaults to preview."
        ),
    )
    parser.add_argument("--consumer-admission-manifest-path")
    parser.add_argument(
        "--transport-preview-gate-report-path",
        help=(
            "Required for notice-derived stage/promote. Must be the no-write "
            "schedule transport preview gate report that passed the selected notices."
        ),
    )
    return parser


def build_transport_schedule_projection_release_from_inventory(
    *,
    source_truth_inventory_path: Path,
    source_truth_root: Path | None,
    work_dir: Path,
    release_id: str,
    generated_at: str,
    service_horizon_days: int,
    object_store: _DerivedObjectStore,
    derived_bucket: str,
    source_object_store: _SourceObjectStore | None = None,
    source_bucket: str | None = None,
    structured_projection_publisher: _StructuredProjectionPublisher | None = None,
    publish_mode: str = _PUBLISH_MODE_PREVIEW,
):
    normalized_publish_mode = _normalize_publish_mode(publish_mode)
    parents = _load_source_truth_parents(
        inventory_path=source_truth_inventory_path,
        source_truth_root=source_truth_root,
        source_object_store=source_object_store,
        source_bucket=source_bucket,
    )
    build_result = build_transport_schedule_projection_bundle(
        source_truth_parents=parents,
        generated_at=generated_at,
        service_horizon_days=service_horizon_days,
    )
    if not build_result.validation_report.valid:
        _write_json(work_dir / "validation-summary.json", asdict(build_result.validation_report))
        raise ValueError("transport schedule projection validation failed")
    if not build_result.bundle["transport_schedule_snapshots"]:
        _write_json(
            work_dir / TRANSPORT_SCHEDULE_REJECTED_SOURCE_REPORT_FILENAME,
            build_result.rejected_source_records,
        )
        raise ValueError("transport schedule projection produced no schedule snapshots")

    work_dir.mkdir(parents=True, exist_ok=True)
    rejected_source_path = work_dir / TRANSPORT_SCHEDULE_REJECTED_SOURCE_REPORT_FILENAME
    _write_json(rejected_source_path, build_result.rejected_source_records)
    report = write_transport_schedule_projection_release(
        bundle=build_result.bundle,
        output_dir=work_dir,
        release_id=release_id,
        generated_at=generated_at,
        object_store=object_store if _writes_versioned_artifacts(normalized_publish_mode) else None,
        bucket=derived_bucket,
        write_current=_promotes_current(normalized_publish_mode),
    )
    if _writes_versioned_artifacts(normalized_publish_mode):
        object_store.put_bytes(
            bucket=derived_bucket,
            key=build_index_release_artifact_key(
                corpus=TRANSPORT_SCHEDULE_CORPUS,
                collection=TRANSPORT_SCHEDULE_COLLECTION,
                release_id=release_id,
                filename=TRANSPORT_SCHEDULE_REJECTED_SOURCE_REPORT_FILENAME,
            ),
            data=rejected_source_path.read_bytes(),
            content_type="application/json",
        )
    _publish_structured_projection_release(
        structured_projection_publisher=structured_projection_publisher,
        bundle=build_result.bundle,
        report=report,
        generated_at=generated_at,
        promote_current=_promotes_current(normalized_publish_mode),
        enabled=_writes_structured_projection(normalized_publish_mode),
    )
    _write_json(work_dir / "build-report.json", asdict(report))
    return report


def build_transport_schedule_projection_release_from_consumption_projection(
    *,
    projection_entries: Sequence[NoticeConsumptionProjectionEntry],
    registry: DocumentRegistry,
    work_dir: Path,
    release_id: str,
    generated_at: str,
    service_horizon_days: int,
    object_store: _TransportProjectionObjectStore,
    derived_bucket: str,
    structured_projection_publisher: _StructuredProjectionPublisher | None = None,
    publish_mode: str = _PUBLISH_MODE_PREVIEW,
    admitted_at: str = "",
    selected_notice_ids: Sequence[str] = (),
    transport_preview_gate_report: Mapping[str, Any] | None = None,
):
    normalized_publish_mode = _normalize_publish_mode(publish_mode)
    build_result = build_notice_derived_transport_schedule_projection_bundle(
        projection_entries=projection_entries,
        registry=registry,
        object_store=object_store,
        derived_bucket=derived_bucket,
        generated_at=generated_at,
        service_horizon_days=service_horizon_days,
    )
    if not build_result.validation_report.valid:
        _write_json(work_dir / "validation-summary.json", asdict(build_result.validation_report))
        raise ValueError("notice-derived transport schedule projection validation failed")
    if not build_result.bundle["transport_schedule_snapshots"]:
        _write_json(
            work_dir / TRANSPORT_SCHEDULE_REJECTED_SOURCE_REPORT_FILENAME,
            build_result.rejected_source_records,
        )
        raise ValueError("notice-derived transport schedule projection produced no snapshots")
    _assert_transport_bundle_matches_preview_gate_report(
        publish_mode=normalized_publish_mode,
        bundle=build_result.bundle,
        preview_gate_report=transport_preview_gate_report,
        selected_notice_ids=selected_notice_ids,
    )

    work_dir.mkdir(parents=True, exist_ok=True)
    build_result.bundle["transport_release_notices"] = _transport_release_notice_provenance_records(
        projection_entries=projection_entries,
        admitted_at=admitted_at,
        materialized_at=generated_at,
    )
    rejected_source_path = work_dir / TRANSPORT_SCHEDULE_REJECTED_SOURCE_REPORT_FILENAME
    _write_json(rejected_source_path, build_result.rejected_source_records)
    report = write_transport_schedule_projection_release(
        bundle=build_result.bundle,
        output_dir=work_dir,
        release_id=release_id,
        generated_at=generated_at,
        object_store=object_store if _writes_versioned_artifacts(normalized_publish_mode) else None,
        bucket=derived_bucket,
        write_current=_promotes_current(normalized_publish_mode),
    )
    if _writes_versioned_artifacts(normalized_publish_mode):
        object_store.put_bytes(
            bucket=derived_bucket,
            key=build_index_release_artifact_key(
                corpus=TRANSPORT_SCHEDULE_CORPUS,
                collection=TRANSPORT_SCHEDULE_COLLECTION,
                release_id=release_id,
                filename=TRANSPORT_SCHEDULE_REJECTED_SOURCE_REPORT_FILENAME,
            ),
            data=rejected_source_path.read_bytes(),
            content_type="application/json",
        )
    _publish_structured_projection_release(
        structured_projection_publisher=structured_projection_publisher,
        bundle=build_result.bundle,
        report=report,
        generated_at=generated_at,
        promote_current=_promotes_current(normalized_publish_mode),
        enabled=_writes_structured_projection(normalized_publish_mode),
    )
    _write_json(work_dir / "build-report.json", asdict(report))
    return report


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    settings = ObjectStoreSettings.from_env()
    object_store = S3ObjectStoreAdmin(settings)
    generated_at = args.generated_at or _default_generated_at()
    source = dict(os.environ)
    structured_projection_publisher = build_structured_projection_publisher_from_env(source)
    publish_mode = _normalize_publish_mode(args.publish_mode)
    if args.from_consumption_projection:
        selection = build_internal_notice_selection_provenance(
            explicit_notice_ids=args.notice_id or (),
            selection_path=args.selection_path,
            extra_command_args={
                "all_ready_transport_candidates": bool(args.all_ready_transport_candidates),
            },
        )
        notice_ids = normalize_notice_ids(selection.notice_ids)
        if not notice_ids and not args.all_ready_transport_candidates:
            raise ValueError(
                "--notice-id, --selection-path, or --all-ready-transport-candidates is "
                "required with --from-consumption-projection"
            )
        projection_store = build_notice_consumption_projection_store_from_env(source)
        projection_entries = projection_store.list_by_scope(
            "campus_notices",
            "internal_notice",
            notice_ids=notice_ids,
        )
        if args.all_ready_transport_candidates:
            projection_entries = _ready_transport_projection_entries(projection_entries)
        _assert_transport_release_scope_allows(
            publish_mode=publish_mode,
            projection_entries=projection_entries,
            selected_notice_ids=notice_ids,
            all_ready_transport_candidates=bool(args.all_ready_transport_candidates),
            allow_multi_notice_release=bool(args.allow_multi_notice_release),
        )
        consumer_admission_manifest = _load_consumer_admission_manifest_for_transport(
            manifest_path=args.consumer_admission_manifest_path,
        )
        _assert_transport_consumer_admission_gate_allows(
            manifest=consumer_admission_manifest,
            notice_ids=notice_ids or tuple(entry.source_notice_id for entry in projection_entries),
        )
        transport_preview_gate_report = _assert_transport_preview_gate_allows(
            publish_mode=publish_mode,
            report_path=args.transport_preview_gate_report_path,
            selected_notice_ids=notice_ids
            or tuple(entry.source_notice_id for entry in projection_entries),
        )
        report = build_transport_schedule_projection_release_from_consumption_projection(
            projection_entries=projection_entries,
            registry=build_document_registry_from_env(source),
            work_dir=Path(args.work_dir).resolve(),
            release_id=args.release_id,
            generated_at=generated_at,
            service_horizon_days=args.service_horizon_days,
            object_store=object_store,
            derived_bucket=args.derived_bucket or settings.bucket_derived,
            structured_projection_publisher=structured_projection_publisher,
            publish_mode=publish_mode,
            admitted_at=consumer_admission_manifest.created_at,
            selected_notice_ids=notice_ids
            or tuple(entry.source_notice_id for entry in projection_entries),
            transport_preview_gate_report=transport_preview_gate_report,
        )
    else:
        if not args.source_truth_inventory:
            raise ValueError("--source-truth-inventory is required without consumption mode")
        source_truth_root = (
            Path(args.source_truth_root).resolve() if args.source_truth_root else None
        )
        source_object_store = None if source_truth_root is not None else object_store
        report = build_transport_schedule_projection_release_from_inventory(
            source_truth_inventory_path=Path(args.source_truth_inventory).resolve(),
            source_truth_root=source_truth_root,
            work_dir=Path(args.work_dir).resolve(),
            release_id=args.release_id,
            generated_at=generated_at,
            service_horizon_days=args.service_horizon_days,
            object_store=object_store,
            derived_bucket=args.derived_bucket or settings.bucket_derived,
            source_object_store=source_object_store,
            source_bucket=args.source_bucket or settings.bucket_source,
            structured_projection_publisher=structured_projection_publisher,
            publish_mode=publish_mode,
        )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


def _default_generated_at() -> str:
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


__all__ = [
    "TRANSPORT_SCHEDULE_PROJECTION_FILENAME",
    "build_parser",
    "build_transport_schedule_projection_release_from_consumption_projection",
    "build_transport_schedule_projection_release_from_inventory",
    "main",
]


if __name__ == "__main__":
    main()
