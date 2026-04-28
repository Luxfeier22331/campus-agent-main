from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.source_bucket_hygiene import (
    SourceBucketPrefixCleanupRequest,
    cleanup_source_bucket_prefix,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Delete an unexpected source bucket prefix after hygiene validation"
    )
    parser.add_argument("--prefix", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    if not args.dry_run and not args.yes:
        parser.error("pass --yes to execute source bucket prefix cleanup")
    payload = cleanup_source_bucket_prefix(
        request=SourceBucketPrefixCleanupRequest(
            prefix=args.prefix,
            output_dir=Path(args.output_dir),
            dry_run=bool(args.dry_run),
        )
    )
    print(json.dumps(payload, ensure_ascii=False, indent=2))


__all__ = [
    "SourceBucketPrefixCleanupRequest",
    "build_parser",
    "cleanup_source_bucket_prefix",
    "main",
]


if __name__ == "__main__":
    main()
