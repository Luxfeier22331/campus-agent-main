from __future__ import annotations

import argparse
import json
from collections import defaultdict
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core import (
    ObjectStoreSettings,
    build_document_registry_from_env,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.registry_scope_chunk_preparation import (
    load_chunk_preparation_manifest,
    prepare_registry_scope_chunks,
)
from campus_ingestion_core.regulation_rag_release_admission import (
    build_regulation_rag_release_admission_manifest,
    write_regulation_rag_release_admission_manifest,
)
from campus_ingestion_core.regulation_rag_release_lane import (
    build_registry_scope_rag_release_executor,
    build_regulation_rag_release_candidate_store_from_env,
    enqueue_regulation_rag_release_candidates_for_registry_delta,
    process_pending_regulation_rag_release_candidates,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env

REGULATION_COLLECTION_ORDER = ("institutional_rules", "student_rules", "scoped_rules")
RAG_RELEASE_ELIGIBLE_COLLECTIONS = frozenset({"institutional_rules", "student_rules"})


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Close out one-time official-web regulation materialization into the regulation "
            "RAG release lane."
        )
    )
    parser.add_argument("--corpus", default="regulations")
    parser.add_argument(
        "--from-materialization-report",
        action="append",
        type=Path,
        required=True,
        help="Official-web regulation materialization report path.",
    )
    parser.add_argument("--preparation-run-id", required=True)
    parser.add_argument("--admission-run-id", required=True)
    parser.add_argument("--collection", choices=REGULATION_COLLECTION_ORDER, default=None)
    parser.add_argument("--admitted-at")
    parser.add_argument("--note", action="append", default=[])
    parser.add_argument("--acceptance-case-path")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--closeout-run-id")
    parser.add_argument("--output", type=Path)
    publish_group = parser.add_mutually_exclusive_group()
    publish_group.add_argument("--publish-alias", dest="publish_alias", action="store_true")
    publish_group.add_argument("--no-publish-alias", dest="publish_alias", action="store_false")
    parser.set_defaults(publish_alias=True)
    parser.add_argument("--reset-index", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)

    selected_by_collection = _collect_selected_documents(
        report_paths=tuple(args.from_materialization_report),
        selected_collection=args.collection,
    )
    target_collections = tuple(
        collection
        for collection, document_ids in _ordered_collection_items(selected_by_collection)
        if document_ids and collection in RAG_RELEASE_ELIGIBLE_COLLECTIONS
    )
    if not target_collections:
        raise ValueError(
            "no query-enabled official-web regulation targets selected for RAG closeout"
        )
    if len(target_collections) != 1:
        raise ValueError(
            "official-web regulation RAG closeout currently supports exactly one query-enabled "
            f"collection, got {', '.join(target_collections)}"
        )
    collection = target_collections[0]
    changed_document_ids = selected_by_collection[collection]

    settings = ObjectStoreSettings.from_env()
    object_store = S3ObjectStoreAdmin(settings)
    registry = build_document_registry_from_env(prefer_operator=True)
    candidate_store = build_regulation_rag_release_candidate_store_from_env(prefer_operator=True)
    runtime_profile = load_runtime_profile(args.corpus, collection)

    preparation_report = prepare_registry_scope_chunks(
        corpus=args.corpus,
        collection=collection,
        preparation_run_id=args.preparation_run_id,
        closeout_run_id=args.closeout_run_id,
    )
    preparation_manifest = load_chunk_preparation_manifest(
        reader=object_store,
        bucket=settings.bucket_derived,
        corpus=args.corpus,
        collection=collection,
        preparation_run_id=preparation_report.preparation_run_id,
    )
    records = tuple(
        record
        for document_id in changed_document_ids
        if (
            record := registry.current_version(
                document_id,
                preferred_revision_tracks=runtime_profile.serving_revision_tracks,
            )
        )
        is not None
        and record.corpus == args.corpus
        and record.collection == collection
    )
    if not records:
        raise ValueError(
            "no current registry documents found for selected official-web regulation targets"
        )
    admission_manifest = build_regulation_rag_release_admission_manifest(
        admission_run_id=args.admission_run_id,
        corpus=args.corpus,
        collection=collection,
        records=records,
        runtime_profile=runtime_profile,
        preparation_manifest=preparation_manifest,
        admitted_at=args.admitted_at,
        notes=tuple(args.note or ()),
    )
    admission_manifest_key = write_regulation_rag_release_admission_manifest(
        writer=object_store,
        bucket=settings.bucket_derived,
        manifest=admission_manifest,
    )

    enqueue_report = enqueue_regulation_rag_release_candidates_for_registry_delta(
        store=candidate_store,
        registry=registry,
        corpus=args.corpus,
        collection=collection,
        changed_document_ids=changed_document_ids,
        runtime_profile=runtime_profile,
        force=args.force,
    )
    release_executor = build_registry_scope_rag_release_executor(
        acceptance_case_path=args.acceptance_case_path,
        release_admission_manifest_key=admission_manifest_key,
        publish_alias=args.publish_alias,
        reset_index=args.reset_index,
    )
    process_report = process_pending_regulation_rag_release_candidates(
        store=candidate_store,
        release_executor=release_executor,
        candidate_ids=enqueue_report.candidate_ids,
    )

    payload = {
        "schema_version": "official_web_regulation_rag_closeout.v1",
        "corpus": args.corpus,
        "collection": collection,
        "selected_document_ids": list(changed_document_ids),
        "preparation_run_id": preparation_report.preparation_run_id,
        "preparation_manifest_object_key": preparation_report.manifest_object_key,
        "admission_run_id": args.admission_run_id,
        "release_admission_manifest_key": admission_manifest_key,
        "acceptance_case_path": args.acceptance_case_path,
        "publish_alias": args.publish_alias,
        "reset_index": args.reset_index,
        "enqueue_report": {
            "created_count": enqueue_report.created_count,
            "skipped_unchanged_count": enqueue_report.skipped_unchanged_count,
            "forced_reenqueue_count": enqueue_report.forced_reenqueue_count,
            "candidate_ids": list(enqueue_report.candidate_ids),
        },
        "processed_count": process_report.processed_count,
        "candidate_ids": list(process_report.candidate_ids),
        "status_counts": dict(process_report.status_counts),
        "admission_blocked_count": process_report.admission_blocked_count,
    }
    output = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output + "\n", encoding="utf-8")
    print(output)


def _collect_selected_documents(
    *,
    report_paths: Sequence[Path],
    selected_collection: str | None,
) -> dict[str, tuple[str, ...]]:
    selected: dict[str, list[str]] = defaultdict(list)
    for report_path in report_paths:
        payload = _read_json(report_path)
        for item in payload.get("materialized_documents") or ():
            if not isinstance(item, Mapping):
                continue
            collection = str(item.get("target_collection") or "").strip()
            document_id = str(item.get("target_document_id") or "").strip()
            if not collection or not document_id:
                continue
            if selected_collection and collection != selected_collection:
                continue
            selected[collection].append(document_id)
    return {
        collection: _dedupe(document_ids)
        for collection, document_ids in selected.items()
        if _dedupe(document_ids)
    }


def _ordered_collection_items(
    selected_by_collection: Mapping[str, Sequence[str]],
) -> tuple[tuple[str, tuple[str, ...]], ...]:
    known = [
        (collection, tuple(selected_by_collection[collection]))
        for collection in REGULATION_COLLECTION_ORDER
        if collection in selected_by_collection
    ]
    other = [
        (collection, tuple(document_ids))
        for collection, document_ids in sorted(selected_by_collection.items())
        if collection not in REGULATION_COLLECTION_ORDER
    ]
    return tuple(known + other)


def _dedupe(values: Sequence[object]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(str(value).strip() for value in values if str(value).strip()))


def _read_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object report at {path}")
    return payload


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
