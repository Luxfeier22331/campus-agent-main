from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol

from campus_ingestion_core import ObjectStoreSettings
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.service_catalog_projection import (
    SERVICE_CATALOG_COLLECTION,
    SERVICE_CATALOG_CORPUS,
    write_service_catalog_projection_release_from_current_projections,
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
        description=(
            "Build campus_services service_catalog projection from service_guide and "
            "optional contact_directory current projections."
        ),
    )
    parser.add_argument("--service-guide-projection", required=True)
    parser.add_argument("--contact-directory-projection")
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--release-id")
    parser.add_argument("--generated-at")
    parser.add_argument("--derived-bucket")
    parser.add_argument("--expected-ready-records", type=int)
    return parser


def build_service_catalog_projection_release_from_current_projections(
    *,
    service_guide_projection_path: Path,
    work_dir: Path,
    generated_at: str,
    object_store: _DerivedObjectStore,
    derived_bucket: str,
    contact_directory_projection_path: Path | None = None,
    release_id: str | None = None,
    expected_ready_records: int | None = None,
):
    work_dir.mkdir(parents=True, exist_ok=True)
    report = write_service_catalog_projection_release_from_current_projections(
        service_guide_projection_path=service_guide_projection_path,
        contact_directory_projection_path=contact_directory_projection_path,
        output_dir=work_dir,
        generated_at=generated_at,
        object_store=object_store,
        bucket=derived_bucket,
        release_id=release_id,
        expected_ready_records=expected_ready_records,
    )
    _write_json(
        work_dir / "build-report.json",
        {
            **asdict(report),
            "corpus": SERVICE_CATALOG_CORPUS,
            "collection": SERVICE_CATALOG_COLLECTION,
        },
    )
    return report


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    settings = ObjectStoreSettings.from_env()
    object_store = S3ObjectStoreAdmin(settings)
    report = build_service_catalog_projection_release_from_current_projections(
        service_guide_projection_path=Path(args.service_guide_projection).resolve(),
        contact_directory_projection_path=(
            Path(args.contact_directory_projection).resolve()
            if args.contact_directory_projection
            else None
        ),
        work_dir=Path(args.work_dir).resolve(),
        release_id=args.release_id,
        expected_ready_records=args.expected_ready_records,
        generated_at=args.generated_at or _default_generated_at(),
        object_store=object_store,
        derived_bucket=args.derived_bucket or settings.bucket_derived,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _default_generated_at() -> str:
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


__all__ = [
    "build_parser",
    "build_service_catalog_projection_release_from_current_projections",
    "main",
]


if __name__ == "__main__":
    main()
