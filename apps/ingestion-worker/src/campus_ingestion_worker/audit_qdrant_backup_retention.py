from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.qdrant_backup import QdrantSnapshotAdmin
from campus_ingestion_core.qdrant_backup_retention_audit import (
    QdrantBackupRetentionAuditRequest,
    audit_qdrant_backup_retention,
)
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_retrieval_core.settings import RetrievalSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Audit Qdrant backup retention roles.")
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--protected-physical-collection-name", action="append", default=[])
    parser.add_argument("--manual-blocker", action="append", default=[])
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    summary = audit_qdrant_backup_retention(
        request=QdrantBackupRetentionAuditRequest(
            corpus=args.corpus,
            collection=args.collection,
            output_dir=Path(args.output_dir),
            protected_physical_collection_names=tuple(args.protected_physical_collection_name),
            manual_blockers=tuple(args.manual_blocker),
        ),
        object_store=S3ObjectStoreAdmin(ObjectStoreSettings.from_env()),
        qdrant_admin=QdrantSnapshotAdmin(RetrievalSettings.from_env()),
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
