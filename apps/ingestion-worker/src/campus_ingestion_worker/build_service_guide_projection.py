from __future__ import annotations

import argparse
import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol

from campus_ingestion_core import ObjectStoreSettings
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.notice_consumption_projection import (
    NoticeConsumptionProjectionEntry,
    build_notice_consumption_projection_store_from_env,
)
from campus_ingestion_core.notice_derived_service_guide_materialization import (
    build_notice_derived_service_guide_projection_bundle,
)
from campus_ingestion_core.registry import DocumentRegistry, build_document_registry_from_env
from campus_ingestion_core.service_guide_projection import (
    SERVICE_GUIDE_COLLECTION,
    SERVICE_GUIDE_CORPUS,
    SERVICE_GUIDE_MANUAL_REVIEW_FILENAME,
    assert_service_guide_projection_release_ready,
    build_service_guide_projection_bundle_from_curated_handbook_flow_graph,
    build_service_guide_projection_bundle_from_curated_service_guide,
    build_service_guide_projection_bundle_from_source_truth_manifest,
    merge_service_guide_projection_build_results,
    write_service_guide_projection_release,
    write_service_guide_projection_release_from_source_truth_manifest,
)
from campus_ingestion_core.service_guide_projection_models import (
    ServiceGuideProjectionBuildResult,
)
from campus_ingestion_core.structured_projection_postgres import (
    build_structured_projection_publisher_from_env,
    projection_artifact_checksum,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.internal_notice_selection import (
    build_internal_notice_selection_provenance,
)


class _DerivedObjectStore(Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


class _ServiceGuideProjectionObjectStore(_DerivedObjectStore, Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


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
        bundle: Mapping[str, object],
        validation_status: str,
    ) -> object: ...


class _ProjectionReleaseReport(Protocol):
    release_id: str
    release_object_key: str


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build campus_services service_guide projection from curated source truth.",
    )
    parser.add_argument("--curated-flow-graph", action="append", default=[])
    parser.add_argument("--curated-service-guide", action="append", default=[])
    parser.add_argument("--source-truth-manifest")
    parser.add_argument(
        "--from-notice-consumption-projection",
        action="store_true",
        help="Build notice-derived service guide records from ready consumption projection candidates.",
    )
    parser.add_argument(
        "--notice-id",
        action="append",
        dest="notice_ids",
        default=[],
        help="Selected notice id for notice-consumption-projection mode. Repeatable.",
    )
    parser.add_argument("--selection-path")
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--release-id")
    parser.add_argument("--generated-at")
    parser.add_argument("--effective-from")
    parser.add_argument("--effective-until")
    parser.add_argument("--expected-ready-records", type=int)
    parser.add_argument("--derived-bucket")
    return parser


def build_service_guide_projection_release_from_curated_handbook_flow_graph(
    *,
    curated_flow_graph_path: Path,
    work_dir: Path,
    release_id: str,
    generated_at: str,
    effective_from: str,
    effective_until: str,
    object_store: _DerivedObjectStore,
    derived_bucket: str,
    expected_ready_records: int | None = None,
    structured_projection_publisher: _StructuredProjectionPublisher | None = None,
):
    return build_service_guide_projection_release_from_curated_sources(
        curated_flow_graph_paths=[curated_flow_graph_path],
        curated_service_guide_paths=[],
        work_dir=work_dir,
        release_id=release_id,
        generated_at=generated_at,
        effective_from=effective_from,
        effective_until=effective_until,
        object_store=object_store,
        derived_bucket=derived_bucket,
        expected_ready_records=expected_ready_records,
        structured_projection_publisher=structured_projection_publisher,
    )


def build_service_guide_projection_release_from_source_truth_manifest(
    *,
    source_truth_manifest_path: Path,
    work_dir: Path,
    generated_at: str,
    object_store: _DerivedObjectStore,
    derived_bucket: str,
    release_id: str | None = None,
    structured_projection_publisher: _StructuredProjectionPublisher | None = None,
):
    work_dir.mkdir(parents=True, exist_ok=True)
    report = write_service_guide_projection_release_from_source_truth_manifest(
        source_truth_manifest_path=source_truth_manifest_path,
        output_dir=work_dir,
        generated_at=generated_at,
        object_store=object_store,
        bucket=derived_bucket,
        release_id=release_id,
    )
    bundle = _read_json(Path(report.projection_path))
    _publish_structured_projection_release(
        structured_projection_publisher=structured_projection_publisher,
        bundle=bundle,
        report=report,
        generated_at=generated_at,
    )
    _write_json(
        work_dir / "build-report.json",
        {
            **asdict(report),
            "corpus": SERVICE_GUIDE_CORPUS,
            "collection": SERVICE_GUIDE_COLLECTION,
        },
    )
    return report


def build_service_guide_projection_release_from_notice_consumption_projection(
    *,
    projection_entries: Sequence[NoticeConsumptionProjectionEntry],
    registry: DocumentRegistry,
    work_dir: Path,
    release_id: str,
    generated_at: str,
    object_store: _ServiceGuideProjectionObjectStore,
    derived_bucket: str,
    expected_ready_records: int | None = None,
    extra_build_results: Sequence[ServiceGuideProjectionBuildResult] = (),
    structured_projection_publisher: _StructuredProjectionPublisher | None = None,
):
    notice_build_result = build_notice_derived_service_guide_projection_bundle(
        projection_entries=projection_entries,
        registry=registry,
        object_store=object_store,
        derived_bucket=derived_bucket,
        generated_at=generated_at,
    )
    build_results = [
        *extra_build_results,
        notice_build_result,
    ]
    build_result = (
        build_results[0]
        if len(build_results) == 1
        else merge_service_guide_projection_build_results(
            build_results=list(build_results),
            generated_at=generated_at,
        )
    )
    work_dir.mkdir(parents=True, exist_ok=True)
    _write_json(work_dir / "validation-summary.json", asdict(build_result.validation_report))
    _write_json(work_dir / SERVICE_GUIDE_MANUAL_REVIEW_FILENAME, build_result.manual_review_sources)
    assert_service_guide_projection_release_ready(
        build_result.bundle,
        expected_ready_records=expected_ready_records,
    )
    report = write_service_guide_projection_release(
        bundle=build_result.bundle,
        output_dir=work_dir,
        release_id=release_id,
        generated_at=generated_at,
        manual_review_sources=build_result.manual_review_sources,
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
            "corpus": SERVICE_GUIDE_CORPUS,
            "collection": SERVICE_GUIDE_COLLECTION,
        },
    )
    return report


def build_service_guide_projection_release_from_curated_sources(
    *,
    curated_flow_graph_paths: Sequence[Path],
    curated_service_guide_paths: Sequence[Path],
    work_dir: Path,
    release_id: str,
    generated_at: str,
    effective_from: str,
    effective_until: str,
    object_store: _DerivedObjectStore,
    derived_bucket: str,
    expected_ready_records: int | None = None,
    structured_projection_publisher: _StructuredProjectionPublisher | None = None,
):
    build_results = []
    for curated_flow_graph_path in curated_flow_graph_paths:
        curated_artifact = _read_json(curated_flow_graph_path)
        build_results.append(
            build_service_guide_projection_bundle_from_curated_handbook_flow_graph(
                curated_flow_graph_artifact=curated_artifact,
                generated_at=generated_at,
                effective_from=effective_from,
                effective_until=effective_until,
            )
        )
    for curated_service_guide_path in curated_service_guide_paths:
        curated_artifact = _read_json(curated_service_guide_path)
        build_results.append(
            build_service_guide_projection_bundle_from_curated_service_guide(
                curated_service_guide_artifact=curated_artifact,
                generated_at=generated_at,
                effective_from=effective_from,
                effective_until=effective_until,
            )
        )
    if not build_results:
        raise ValueError("at least one curated source path is required")
    build_result = (
        build_results[0]
        if len(build_results) == 1
        else merge_service_guide_projection_build_results(
            build_results=build_results,
            generated_at=generated_at,
        )
    )
    work_dir.mkdir(parents=True, exist_ok=True)
    _write_json(work_dir / "validation-summary.json", asdict(build_result.validation_report))
    _write_json(work_dir / SERVICE_GUIDE_MANUAL_REVIEW_FILENAME, build_result.manual_review_sources)
    assert_service_guide_projection_release_ready(
        build_result.bundle,
        expected_ready_records=expected_ready_records,
    )
    report = write_service_guide_projection_release(
        bundle=build_result.bundle,
        output_dir=work_dir,
        release_id=release_id,
        generated_at=generated_at,
        manual_review_sources=build_result.manual_review_sources,
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
            "corpus": SERVICE_GUIDE_CORPUS,
            "collection": SERVICE_GUIDE_COLLECTION,
        },
    )
    return report


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    settings = ObjectStoreSettings.from_env()
    object_store = S3ObjectStoreAdmin(settings)
    generated_at = args.generated_at or _default_generated_at()
    source = dict(os.environ)
    structured_projection_publisher = build_structured_projection_publisher_from_env(source)
    if args.from_notice_consumption_projection:
        if not args.release_id:
            raise ValueError("--release-id is required with --from-notice-consumption-projection")
        selection = build_internal_notice_selection_provenance(
            explicit_notice_ids=args.notice_ids,
            selection_path=args.selection_path,
        )
        if not selection.notice_ids:
            raise ValueError(
                "--notice-id or --selection-path is required with "
                "--from-notice-consumption-projection"
            )
        projection_store = build_notice_consumption_projection_store_from_env(source)
        projection_entries = projection_store.list_by_scope(
            "campus_notices",
            "internal_notice",
            notice_ids=selection.notice_ids,
        )
        extra_build_results = _build_extra_service_guide_results_from_args(
            args=args,
            generated_at=generated_at,
        )
        report = build_service_guide_projection_release_from_notice_consumption_projection(
            projection_entries=projection_entries,
            registry=build_document_registry_from_env(source),
            work_dir=Path(args.work_dir).resolve(),
            release_id=args.release_id,
            generated_at=generated_at,
            object_store=object_store,
            derived_bucket=args.derived_bucket or settings.bucket_derived,
            expected_ready_records=args.expected_ready_records,
            extra_build_results=extra_build_results,
            structured_projection_publisher=structured_projection_publisher,
        )
    elif args.source_truth_manifest:
        report = build_service_guide_projection_release_from_source_truth_manifest(
            source_truth_manifest_path=Path(args.source_truth_manifest).resolve(),
            work_dir=Path(args.work_dir).resolve(),
            release_id=args.release_id,
            generated_at=generated_at,
            object_store=object_store,
            derived_bucket=args.derived_bucket or settings.bucket_derived,
            structured_projection_publisher=structured_projection_publisher,
        )
    else:
        if not args.release_id:
            raise ValueError("--release-id is required when not using --source-truth-manifest")
        if not args.effective_from or not args.effective_until:
            raise ValueError(
                "--effective-from and --effective-until are required when not using "
                "--source-truth-manifest"
            )
        report = build_service_guide_projection_release_from_curated_sources(
            curated_flow_graph_paths=[Path(path).resolve() for path in args.curated_flow_graph],
            curated_service_guide_paths=[
                Path(path).resolve() for path in args.curated_service_guide
            ],
            work_dir=Path(args.work_dir).resolve(),
            release_id=args.release_id,
            generated_at=generated_at,
            effective_from=args.effective_from,
            effective_until=args.effective_until,
            object_store=object_store,
            derived_bucket=args.derived_bucket or settings.bucket_derived,
            expected_ready_records=args.expected_ready_records,
            structured_projection_publisher=structured_projection_publisher,
        )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


def _publish_structured_projection_release(
    *,
    structured_projection_publisher: _StructuredProjectionPublisher | None,
    bundle: Mapping[str, object],
    report: _ProjectionReleaseReport,
    generated_at: str,
) -> None:
    if structured_projection_publisher is None:
        return
    schema_version = str(bundle.get("schema_version") or "").strip()
    if not schema_version:
        raise ValueError("service guide projection bundle schema_version is required")
    structured_projection_publisher.publish_release(
        corpus=SERVICE_GUIDE_CORPUS,
        collection=SERVICE_GUIDE_COLLECTION,
        release_id=report.release_id,
        generated_at=generated_at,
        schema_version=schema_version,
        artifact_object_key=report.release_object_key,
        artifact_checksum=projection_artifact_checksum(bundle),
        bundle=bundle,
        validation_status="valid",
    )


def _read_json(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, Mapping):
        raise ValueError(f"{path} must contain a JSON object")
    return dict(payload)


def _build_extra_service_guide_results_from_args(
    *,
    args: argparse.Namespace,
    generated_at: str,
) -> tuple[ServiceGuideProjectionBuildResult, ...]:
    if args.source_truth_manifest:
        return (
            build_service_guide_projection_bundle_from_source_truth_manifest(
                source_truth_manifest_path=Path(args.source_truth_manifest).resolve(),
                generated_at=generated_at,
            ),
        )
    if not args.curated_flow_graph and not args.curated_service_guide:
        return ()
    if not args.effective_from or not args.effective_until:
        raise ValueError(
            "--effective-from and --effective-until are required when merging curated "
            "sources with --from-notice-consumption-projection"
        )
    build_results: list[ServiceGuideProjectionBuildResult] = []
    for curated_flow_graph_path in [Path(path).resolve() for path in args.curated_flow_graph]:
        build_results.append(
            build_service_guide_projection_bundle_from_curated_handbook_flow_graph(
                curated_flow_graph_artifact=_read_json(curated_flow_graph_path),
                generated_at=generated_at,
                effective_from=args.effective_from,
                effective_until=args.effective_until,
            )
        )
    for curated_service_guide_path in [Path(path).resolve() for path in args.curated_service_guide]:
        build_results.append(
            build_service_guide_projection_bundle_from_curated_service_guide(
                curated_service_guide_artifact=_read_json(curated_service_guide_path),
                generated_at=generated_at,
                effective_from=args.effective_from,
                effective_until=args.effective_until,
            )
        )
    return tuple(build_results)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _default_generated_at() -> str:
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


__all__ = [
    "build_parser",
    "build_service_guide_projection_release_from_curated_handbook_flow_graph",
    "build_service_guide_projection_release_from_curated_sources",
    "build_service_guide_projection_release_from_notice_consumption_projection",
    "build_service_guide_projection_release_from_source_truth_manifest",
    "main",
]


if __name__ == "__main__":
    main()
