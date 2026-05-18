from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.authenticated_notice_closeout_operations_retention import (
    AuthenticatedNoticeCloseoutOperationsCleanupRequest,
    cleanup_authenticated_notice_closeout_operations,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Delete audited authenticated notice closeout operations delete candidates"
    )
    parser.add_argument("--candidate-objects-path", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    if not args.dry_run and not args.yes:
        parser.error("pass --yes to execute authenticated notice closeout operations cleanup")
    result = cleanup_authenticated_notice_closeout_operations(
        request=AuthenticatedNoticeCloseoutOperationsCleanupRequest(
            candidate_objects_path=Path(args.candidate_objects_path),
            output_dir=Path(args.output_dir),
            dry_run=bool(args.dry_run),
        )
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


__all__ = [
    "AuthenticatedNoticeCloseoutOperationsCleanupRequest",
    "build_parser",
    "cleanup_authenticated_notice_closeout_operations",
    "main",
]


if __name__ == "__main__":
    main()
