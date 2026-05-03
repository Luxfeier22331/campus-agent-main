from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict

from campus_ingestion_core import (
    ObjectStoreSettings,
    build_document_registry_from_env,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.registry_scope_chunk_preparation import (
    load_chunk_preparation_manifest,
)
from campus_ingestion_core.registry_scope_release import select_releasable_registry_records
from campus_ingestion_core.regulation_rag_release_admission import (
    build_regulation_rag_release_admission_manifest,
    write_regulation_rag_release_admission_manifest,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Write a regulation RAG release admission manifest for a prepared scope."
    )
    parser.add_argument("--corpus", default="regulations")
    parser.add_argument("--collection", required=True)
    parser.add_argument("--preparation-run-id", required=True)
    parser.add_argument("--admission-run-id", required=True)
    parser.add_argument("--admitted-at")
    parser.add_argument("--note", action="append", default=[])
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    settings = ObjectStoreSettings.from_env()
    object_store = S3ObjectStoreAdmin(settings)
    registry = build_document_registry_from_env(prefer_operator=True)
    runtime_profile = load_runtime_profile(args.corpus, args.collection)
    records = select_releasable_registry_records(
        records=registry.list_by_scope(args.corpus, args.collection),
        runtime_profile=runtime_profile,
    )
    if not records:
        raise ValueError(f"no releasable registry records found for {args.corpus}/{args.collection}")
    preparation_manifest = load_chunk_preparation_manifest(
        reader=object_store,
        bucket=settings.bucket_derived,
        corpus=args.corpus,
        collection=args.collection,
        preparation_run_id=args.preparation_run_id,
    )
    admission_manifest = build_regulation_rag_release_admission_manifest(
        admission_run_id=args.admission_run_id,
        corpus=args.corpus,
        collection=args.collection,
        records=records,
        runtime_profile=runtime_profile,
        preparation_manifest=preparation_manifest,
        admitted_at=args.admitted_at,
        notes=tuple(args.note or ()),
    )
    admission_manifest_object_key = write_regulation_rag_release_admission_manifest(
        writer=object_store,
        bucket=settings.bucket_derived,
        manifest=admission_manifest,
    )
    payload = {
        "schema_version": "regulation_rag_release_admission_worker_report.v1",
        "corpus": args.corpus,
        "collection": args.collection,
        "preparation_run_id": args.preparation_run_id,
        "admission_run_id": args.admission_run_id,
        "admission_manifest_object_key": admission_manifest_object_key,
        "document_count": len(records),
        "document_ids": [record.document_id for record in records],
        "version_ids": [record.version_id for record in records],
        "admission_manifest": asdict(admission_manifest),
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
