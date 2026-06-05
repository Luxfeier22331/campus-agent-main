from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.qdrant_backup import (
    CollectionGcCheckRequest,
    check_snapshot_gc_eligibility,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Check whether one release-managed physical collection is eligible for GC"
    )
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument(
        "--backup-root",
        required=True,
        help="Filesystem root for qdrant-native snapshot bundles.",
    )
    parser.add_argument(
        "--protected-physical-collection-name",
        action="append",
        dest="protected_physical_collection_names",
        default=[],
    )
    parser.add_argument(
        "--manual-blocker",
        action="append",
        dest="manual_blockers",
        default=[],
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = check_snapshot_gc_eligibility(
        request=CollectionGcCheckRequest(
            corpus=args.corpus,
            collection=args.collection,
            release_id=args.release_id,
            backup_root=Path(args.backup_root),
            protected_physical_collection_names=tuple(args.protected_physical_collection_names),
            manual_blockers=tuple(args.manual_blockers),
        )
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
