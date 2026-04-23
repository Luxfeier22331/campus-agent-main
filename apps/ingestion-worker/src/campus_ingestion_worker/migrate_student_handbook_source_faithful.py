from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict

from campus_ingestion_core import (
    StudentHandbookMigrationReport,
    StudentHandbookSourceAssetRequest,
    migrate_student_handbook_source_faithful,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run a typed student handbook source-faithful migration"
    )
    parser.add_argument("--raw-version-id", required=True)
    parser.add_argument("--raw-asset-id")
    parser.add_argument("--canonical-raw-filename")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    request_kwargs: dict[str, str] = {"raw_version_id": args.raw_version_id}
    if args.raw_asset_id is not None:
        request_kwargs["raw_asset_id"] = args.raw_asset_id
    if args.canonical_raw_filename is not None:
        request_kwargs["canonical_raw_filename"] = args.canonical_raw_filename
    report = migrate_student_handbook_source_faithful(
        request=StudentHandbookSourceAssetRequest(**request_kwargs),
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = [
    "StudentHandbookMigrationReport",
    "StudentHandbookSourceAssetRequest",
    "build_parser",
    "main",
    "migrate_student_handbook_source_faithful",
]


if __name__ == "__main__":
    main()
