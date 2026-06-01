from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.qdrant_backup import QdrantSnapshotAdmin
from campus_ingestion_core.qdrant_filesystem_backup import (
    FilesystemSnapshotBackupRequest,
    create_filesystem_snapshot_backup,
)
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_retrieval_core.settings import RetrievalSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Create a Qdrant snapshot backup bundle on the local filesystem."
    )
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--operator", required=True)
    parser.add_argument("--backup-reason", default="post-publish-protection")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = create_filesystem_snapshot_backup(
        request=FilesystemSnapshotBackupRequest(
            corpus=args.corpus,
            collection=args.collection,
            release_id=args.release_id,
            output_root=Path(args.output_root),
            operator=args.operator,
            backup_reason=args.backup_reason,
        ),
        object_store=S3ObjectStoreAdmin(ObjectStoreSettings.from_env()),
        qdrant_admin=QdrantSnapshotAdmin(RetrievalSettings.from_env()),
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
