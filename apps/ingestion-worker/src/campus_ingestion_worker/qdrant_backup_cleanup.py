from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.qdrant_backup import QdrantSnapshotAdmin
from campus_ingestion_core.qdrant_backup_cleanup import (
    QdrantBackupCleanupPlanRequest,
    build_qdrant_backup_cleanup_plan,
    execute_qdrant_backup_cleanup_plan,
)
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_retrieval_core.settings import RetrievalSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Plan or execute exact-key Qdrant backup cleanup.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    plan = subparsers.add_parser("plan")
    plan.add_argument("--output-dir", required=True)
    plan.add_argument("--current-alias", action="append", default=[])
    plan.add_argument("--obsolete-family", action="append", default=[])
    plan.add_argument("--protected-physical-collection-name", action="append", default=[])
    delete = subparsers.add_parser("delete")
    delete.add_argument("--plan-path", required=True)
    delete.add_argument("--output-dir")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    object_store = S3ObjectStoreAdmin(ObjectStoreSettings.from_env())
    if args.command == "plan":
        report = build_qdrant_backup_cleanup_plan(
            request=QdrantBackupCleanupPlanRequest(
                output_dir=Path(args.output_dir),
                current_aliases=_parse_aliases(args.current_alias),
                obsolete_families=tuple(args.obsolete_family),
                protected_physical_collection_names=tuple(args.protected_physical_collection_name),
            ),
            object_store=object_store,
            qdrant_admin=QdrantSnapshotAdmin(RetrievalSettings.from_env()),
        )
    else:
        report = execute_qdrant_backup_cleanup_plan(
            plan_path=Path(args.plan_path),
            output_dir=Path(args.output_dir) if args.output_dir else None,
            object_store=object_store,
        )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2, sort_keys=True))


def _parse_aliases(values: Sequence[str]) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for value in values:
        if "=" not in value:
            raise ValueError("--current-alias must be alias=physical_collection")
        alias, collection = value.split("=", 1)
        if not alias.strip() or not collection.strip():
            raise ValueError("--current-alias must be alias=physical_collection")
        aliases[alias.strip()] = collection.strip()
    return aliases


if __name__ == "__main__":
    main()
