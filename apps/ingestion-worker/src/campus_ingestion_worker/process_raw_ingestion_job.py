from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from pathlib import Path
from typing import Sequence

from campus_ingestion_core import (
    ImportReport,
    OnlineOcrClient,
    OnlineOcrProviderResult,
    RawIngestionRequest,
    process_raw_ingestion_job,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Process a raw ingestion job with an explicit corpus/collection scope"
    )
    parser.add_argument("--raw-asset-id", required=True)
    parser.add_argument("--raw-version-id", required=True)
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument(
        "--artifact-mode", default="normalized", choices=("normalized", "source_truth_only")
    )
    parser.add_argument("--split-manifest-path")
    parser.add_argument("--report-dir", default="./var/import-reports")
    parser.add_argument("--default-visibility-scope")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = process_raw_ingestion_job(
        request=RawIngestionRequest(
            raw_asset_id=args.raw_asset_id,
            raw_version_id=args.raw_version_id,
            corpus=args.corpus,
            collection=args.collection,
            artifact_mode=args.artifact_mode,
            split_manifest_path=(
                Path(args.split_manifest_path).resolve() if args.split_manifest_path else None
            ),
            report_dir=Path(args.report_dir),
            default_visibility_scope=args.default_visibility_scope,
        )
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = [
    "ImportReport",
    "OnlineOcrClient",
    "OnlineOcrProviderResult",
    "RawIngestionRequest",
    "build_parser",
    "process_raw_ingestion_job",
    "main",
]


if __name__ == "__main__":
    main()
