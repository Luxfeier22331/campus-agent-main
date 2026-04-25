from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol

from campus_ingestion_core import ObjectStoreSettings
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.service_guide_projection import (
    SERVICE_GUIDE_COLLECTION,
    SERVICE_GUIDE_CORPUS,
    SERVICE_GUIDE_MANUAL_REVIEW_FILENAME,
    assert_service_guide_projection_release_ready,
    build_service_guide_projection_bundle_from_curated_handbook_flow_graph,
    build_service_guide_projection_bundle_from_curated_service_guide,
    merge_service_guide_projection_build_results,
    write_service_guide_projection_release,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


class _DerivedObjectStore(Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build campus_services service_guide projection from curated source truth.",
    )
    parser.add_argument("--curated-flow-graph", action="append", default=[])
    parser.add_argument("--curated-service-guide", action="append", default=[])
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--generated-at")
    parser.add_argument("--effective-from", required=True)
    parser.add_argument("--effective-until", required=True)
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
    )


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
    report = build_service_guide_projection_release_from_curated_sources(
        curated_flow_graph_paths=[Path(path).resolve() for path in args.curated_flow_graph],
        curated_service_guide_paths=[Path(path).resolve() for path in args.curated_service_guide],
        work_dir=Path(args.work_dir).resolve(),
        release_id=args.release_id,
        generated_at=args.generated_at or _default_generated_at(),
        effective_from=args.effective_from,
        effective_until=args.effective_until,
        object_store=object_store,
        derived_bucket=args.derived_bucket or settings.bucket_derived,
        expected_ready_records=args.expected_ready_records,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


def _read_json(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, Mapping):
        raise ValueError(f"{path} must contain a JSON object")
    return dict(payload)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _default_generated_at() -> str:
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


__all__ = [
    "build_parser",
    "build_service_guide_projection_release_from_curated_handbook_flow_graph",
    "build_service_guide_projection_release_from_curated_sources",
    "main",
]


if __name__ == "__main__":
    main()
