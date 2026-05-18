from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core import (
    ObjectStoreSettings,
    build_document_registry_from_env,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.document_artifact_restore import (
    restore_document_units_artifacts_from_local_evidence,
)
from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.registry_scope_common import select_releasable_registry_records

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Restore missing canonical document-units objects from local evidence "
            "without mutating document registry rows."
        )
    )
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument(
        "--evidence-root",
        action="append",
        default=[],
        help="Local directory to scan recursively for document-units.jsonl evidence.",
    )
    parser.add_argument("--execute", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    if not args.evidence_root:
        raise ValueError("--evidence-root is required")

    settings = ObjectStoreSettings.from_env()
    object_store = S3ObjectStoreAdmin(settings)
    registry = build_document_registry_from_env(prefer_operator=True)
    runtime_profile = load_runtime_profile(args.corpus, args.collection)
    records = select_releasable_registry_records(
        records=registry.list_by_scope(args.corpus, args.collection),
        runtime_profile=runtime_profile,
    )
    report = restore_document_units_artifacts_from_local_evidence(
        bucket=settings.bucket_derived,
        evidence_roots=tuple(Path(root) for root in args.evidence_root),
        object_store=object_store,
        records=records,
        execute=args.execute,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
