from __future__ import annotations

import argparse
import json
from collections import defaultdict
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.registry import build_document_registry_from_env
from campus_ingestion_core.regulation_rag_release_lane import (
    build_regulation_rag_release_candidate_store_from_env,
    enqueue_regulation_rag_release_candidates_for_registry_delta,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env

REGULATION_COLLECTION_ORDER = ("institutional_rules", "scoped_rules")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Enqueue regulation RAG release candidates from registry deltas."
    )
    parser.add_argument("--corpus", default="regulations")
    parser.add_argument(
        "--collection",
        choices=REGULATION_COLLECTION_ORDER,
        help="Target regulation collection for explicit --document-id input.",
    )
    parser.add_argument(
        "--document-id",
        action="append",
        default=None,
        help="Changed registry document id to enqueue. Requires --collection.",
    )
    parser.add_argument(
        "--from-materialization-report",
        action="append",
        type=Path,
        default=None,
        help=(
            "Read target_document_id/target_collection from a regulation materialization "
            "execute report."
        ),
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Optional path to write the enqueue report JSON.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help=(
            "Reenqueue unchanged serving-published candidates after a release policy "
            "or admission gate change."
        ),
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)

    selected_by_collection = _collect_selected_documents(args, parser)
    registry = build_document_registry_from_env(prefer_operator=True)
    store = build_regulation_rag_release_candidate_store_from_env(prefer_operator=True)

    created_count = 0
    skipped_unchanged_count = 0
    forced_reenqueue_count = 0
    candidate_ids: list[str] = []
    collection_reports: dict[str, dict[str, object]] = {}

    for collection, document_ids in _ordered_collection_items(selected_by_collection):
        report = enqueue_regulation_rag_release_candidates_for_registry_delta(
            store=store,
            registry=registry,
            corpus=args.corpus,
            collection=collection,
            changed_document_ids=tuple(document_ids),
            force=args.force,
        )
        created_count += report.created_count
        skipped_unchanged_count += report.skipped_unchanged_count
        forced_reenqueue_count += report.forced_reenqueue_count
        candidate_ids.extend(report.candidate_ids)
        collection_reports[collection] = {
            "selected_document_ids": list(document_ids),
            "created_count": report.created_count,
            "skipped_unchanged_count": report.skipped_unchanged_count,
            "forced_reenqueue_count": report.forced_reenqueue_count,
            "candidate_ids": list(report.candidate_ids),
        }

    payload = {
        "schema_version": "regulation_rag_release_candidate_enqueue.v1",
        "corpus": args.corpus,
        "created_count": created_count,
        "skipped_unchanged_count": skipped_unchanged_count,
        "forced_reenqueue_count": forced_reenqueue_count,
        "candidate_ids": candidate_ids,
        "selected_documents_by_collection": {
            collection: len(document_ids)
            for collection, document_ids in _ordered_collection_items(selected_by_collection)
        },
        "collections": collection_reports,
    }
    output = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.output is not None:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output + "\n", encoding="utf-8")
    print(output)


def _collect_selected_documents(
    args: argparse.Namespace,
    parser: argparse.ArgumentParser,
) -> dict[str, tuple[str, ...]]:
    selected: dict[str, list[str]] = defaultdict(list)
    explicit_document_ids = _dedupe(args.document_id or ())
    if explicit_document_ids:
        if not args.collection:
            parser.error("--collection is required when --document-id is used")
        selected[args.collection].extend(explicit_document_ids)

    for report_path in args.from_materialization_report or ():
        payload = _read_json(report_path)
        for item in payload.get("materialized_documents") or ():
            if not isinstance(item, Mapping):
                continue
            collection = str(item.get("target_collection") or "").strip()
            document_id = str(item.get("target_document_id") or "").strip()
            if collection and document_id:
                selected[collection].append(document_id)

    deduped = {
        collection: _dedupe(document_ids)
        for collection, document_ids in selected.items()
        if _dedupe(document_ids)
    }
    if not deduped:
        parser.error(
            "at least one --document-id or --from-materialization-report document is required"
        )
    return deduped


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
    return json.loads(path.read_text(encoding="utf-8"))


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
