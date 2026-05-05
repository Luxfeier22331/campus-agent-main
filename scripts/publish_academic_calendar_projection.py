from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Protocol

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from campus_ingestion_core.academic_calendar_projection import (
    ACADEMIC_CALENDAR_COLLECTION,
    ACADEMIC_CALENDAR_CORPUS,
    ACADEMIC_CALENDAR_PROJECTION_SCHEMA_VERSION,
    build_academic_calendar_projection_bundle_from_source_truth_manifest,
    write_academic_calendar_projection_release_from_source_truth_manifest,
)
from campus_ingestion_core.settings import DEFAULT_BUCKET_DERIVED, ObjectStoreSettings
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.structured_projection_postgres import (
    DEFAULT_STRUCTURED_PROJECTION_DATABASE_ENV_KEY,
    PostgresStructuredProjectionPublisher,
    projection_artifact_checksum,
)
from campus_shared.env_bootstrap import load_repo_env


class AcademicCalendarProjectionPublisher(Protocol):
    def publish_release(self, **kwargs: object) -> object: ...


def publish_academic_calendar_projection_from_manifest(
    *,
    source_truth_manifest_path: Path,
    output_dir: Path,
    generated_at: str,
    object_store: object,
    bucket: str,
    structured_projection_publisher: AcademicCalendarProjectionPublisher | None,
    release_id: str | None = None,
    promote_current: bool = False,
) -> dict[str, object]:
    release_report = write_academic_calendar_projection_release_from_source_truth_manifest(
        source_truth_manifest_path=source_truth_manifest_path,
        output_dir=output_dir,
        generated_at=generated_at,
        object_store=object_store,
        bucket=bucket,
        release_id=release_id,
    )
    build_result = build_academic_calendar_projection_bundle_from_source_truth_manifest(
        source_truth_manifest_path=source_truth_manifest_path,
        generated_at=generated_at,
    )
    bundle = build_result.bundle
    publish_report: object | None = None
    if structured_projection_publisher is not None:
        publish_report = structured_projection_publisher.publish_release(
            corpus=ACADEMIC_CALENDAR_CORPUS,
            collection=ACADEMIC_CALENDAR_COLLECTION,
            release_id=release_report.release_id,
            generated_at=generated_at,
            schema_version=ACADEMIC_CALENDAR_PROJECTION_SCHEMA_VERSION,
            artifact_object_key=release_report.release_object_key,
            artifact_checksum=projection_artifact_checksum(bundle),
            bundle=bundle,
            validation_status="valid",
            promote_current=promote_current,
        )
    return {
        "schema_version": "academic_calendar_projection_publish_report.v1",
        "published": publish_report is not None,
        "promote_current": bool(promote_current),
        "release_id": release_report.release_id,
        "projection_path": release_report.projection_path,
        "current_projection_path": release_report.current_projection_path,
        "release_object_key": release_report.release_object_key,
        "current_object_key": release_report.current_object_key,
        "record_count": len(_records(bundle)),
        "publish_report": _jsonable_publish_report(publish_report),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Build the curated calendar/academic_calendar projection release from source-truth "
            "manifest and optionally publish it into the structured Postgres read model."
        )
    )
    parser.add_argument(
        "--source-truth-manifest",
        default="configs/ingestion/calendar/academic_calendar/source-truth.v1.json",
    )
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--generated-at", required=True)
    parser.add_argument("--release-id")
    parser.add_argument("--bucket")
    parser.add_argument("--database-url")
    parser.add_argument("--promote-current", action="store_true")
    parser.add_argument("--report-path")
    return parser


def main(argv: list[str] | None = None) -> int:
    load_repo_env(repo_root=Path(__file__).resolve().parents[1])
    args = build_parser().parse_args(argv)
    object_store_settings = ObjectStoreSettings.from_env()
    object_store = S3ObjectStoreAdmin(object_store_settings)
    bucket = args.bucket or object_store_settings.bucket_derived or DEFAULT_BUCKET_DERIVED
    database_url = str(
        args.database_url or os.getenv(DEFAULT_STRUCTURED_PROJECTION_DATABASE_ENV_KEY, "")
    ).strip()
    structured_publisher = (
        PostgresStructuredProjectionPublisher(database_url)
        if database_url
        else None
    )
    report = publish_academic_calendar_projection_from_manifest(
        source_truth_manifest_path=Path(args.source_truth_manifest),
        output_dir=Path(args.output_dir),
        generated_at=args.generated_at,
        object_store=object_store,
        bucket=bucket,
        structured_projection_publisher=structured_publisher,
        release_id=args.release_id,
        promote_current=bool(args.promote_current),
    )
    report_json = json.dumps(report, ensure_ascii=False, indent=2, default=str) + "\n"
    if args.report_path:
        Path(args.report_path).write_text(report_json, encoding="utf-8")
    else:
        print(report_json, end="")
    return 0


def _records(bundle: Mapping[str, Any]) -> list[dict[str, Any]]:
    records = bundle.get("academic_calendar_records")
    if not isinstance(records, list):
        return []
    return [dict(item) for item in records if isinstance(item, dict)]


def _jsonable_publish_report(publish_report: object | None) -> object:
    if publish_report is None:
        return None
    if isinstance(publish_report, dict):
        return publish_report
    if hasattr(publish_report, "__dict__"):
        return dict(vars(publish_report))
    return str(publish_report)


if __name__ == "__main__":
    raise SystemExit(main())
