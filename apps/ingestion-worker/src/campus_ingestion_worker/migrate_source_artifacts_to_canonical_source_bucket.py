from __future__ import annotations

import argparse
from dataclasses import asdict
import json
from typing import Sequence

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_core import (
    SourceArtifactsMigrationReport,
    SourceArtifactsMigrationRequest,
    migrate_source_artifacts_to_canonical_source_bucket,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Move legacy source-level artifacts from derived bucket paths into the canonical source bucket."
    )
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument("--raw-version-id", required=True)
    parser.add_argument("--raw-asset-id")
    parser.add_argument("--source-pdf")
    parser.add_argument("--year")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = migrate_source_artifacts_to_canonical_source_bucket(
        request=SourceArtifactsMigrationRequest(
            corpus=args.corpus,
            collection=args.collection,
            raw_version_id=args.raw_version_id,
            raw_asset_id=args.raw_asset_id,
            source_pdf=args.source_pdf,
            year=args.year,
        )
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = [
    "SourceArtifactsMigrationReport",
    "SourceArtifactsMigrationRequest",
    "build_parser",
    "main",
    "migrate_source_artifacts_to_canonical_source_bucket",
]


if __name__ == "__main__":
    main()
