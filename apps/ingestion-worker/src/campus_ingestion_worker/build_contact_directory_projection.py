from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol

from campus_ingestion_core import ObjectStoreSettings
from campus_ingestion_core.contact_directory_projection import (
    CONTACT_DIRECTORY_COLLECTION,
    CONTACT_DIRECTORY_CORPUS,
    CONTACT_DIRECTORY_MANUAL_REVIEW_FILENAME,
    assert_contact_directory_projection_release_ready,
    build_contact_directory_projection_bundle_from_handbook_document_units,
    write_contact_directory_projection_release,
)
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin

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
        description="Build campus_services contact_directory projection from handbook document units.",
    )
    parser.add_argument("--document-units", required=True)
    parser.add_argument("--work-dir", required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--generated-at")
    parser.add_argument("--source-title", default="中央民族大学校内常用电话")
    parser.add_argument("--source-page-start", type=int, default=261)
    parser.add_argument("--source-page-end", type=int, default=261)
    parser.add_argument("--expected-ready-records", type=int)
    parser.add_argument("--derived-bucket")
    return parser


def build_contact_directory_projection_release_from_document_units(
    *,
    document_units_path: Path,
    work_dir: Path,
    release_id: str,
    generated_at: str,
    source_title: str,
    source_page_start: int,
    source_page_end: int,
    object_store: _DerivedObjectStore,
    derived_bucket: str,
    expected_ready_records: int | None = None,
):
    document_units = _read_jsonl(document_units_path)
    build_result = build_contact_directory_projection_bundle_from_handbook_document_units(
        document_units=document_units,
        generated_at=generated_at,
        source_title=source_title,
        source_page_start=source_page_start,
        source_page_end=source_page_end,
    )
    work_dir.mkdir(parents=True, exist_ok=True)
    _write_json(work_dir / "validation-summary.json", asdict(build_result.validation_report))
    _write_json(
        work_dir / CONTACT_DIRECTORY_MANUAL_REVIEW_FILENAME, build_result.manual_review_sources
    )
    assert_contact_directory_projection_release_ready(
        build_result.bundle,
        expected_ready_records=expected_ready_records,
    )
    report = write_contact_directory_projection_release(
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
            "corpus": CONTACT_DIRECTORY_CORPUS,
            "collection": CONTACT_DIRECTORY_COLLECTION,
        },
    )
    return report


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    settings = ObjectStoreSettings.from_env()
    object_store = S3ObjectStoreAdmin(settings)
    report = build_contact_directory_projection_release_from_document_units(
        document_units_path=Path(args.document_units).resolve(),
        work_dir=Path(args.work_dir).resolve(),
        release_id=args.release_id,
        generated_at=args.generated_at or _default_generated_at(),
        source_title=args.source_title,
        source_page_start=args.source_page_start,
        source_page_end=args.source_page_end,
        object_store=object_store,
        derived_bucket=args.derived_bucket or settings.bucket_derived,
        expected_ready_records=args.expected_ready_records,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


def _read_jsonl(path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        payload = json.loads(line)
        if not isinstance(payload, Mapping):
            raise ValueError(f"{path}:{line_number} must contain a JSON object")
        rows.append(dict(payload))
    return rows


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _default_generated_at() -> str:
    return datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


__all__ = [
    "build_contact_directory_projection_release_from_document_units",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
