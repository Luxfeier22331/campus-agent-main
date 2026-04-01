from __future__ import annotations

import argparse
from dataclasses import asdict
import json
import os
from typing import Sequence

from campus_ingestion_core.qdrant_backup import SnapshotBackupRequest, create_snapshot_backup
from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Create a Qdrant snapshot backup bundle for one release-managed collection"
    )
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--backup-reason", required=True)
    parser.add_argument("--operator")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    manifest = create_snapshot_backup(
        request=SnapshotBackupRequest(
            corpus=args.corpus,
            collection=args.collection,
            release_id=args.release_id,
            backup_reason=args.backup_reason,
            operator=(args.operator or os.environ.get("USER") or "unknown").strip() or "unknown",
        )
    )
    print(json.dumps(asdict(manifest), ensure_ascii=False, indent=2))


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
