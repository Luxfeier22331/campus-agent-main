from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core.authenticated_notice_legacy_export import (
    load_authenticated_notice_selection_notice_ids,
)
from campus_ingestion_core.internal_notice_consumption_admission import (
    build_internal_notice_consumption_admission_store_from_env,
    record_internal_notice_consumption_admission,
)
from campus_ingestion_core.internal_notice_legacy_manual_migration import (
    migrate_legacy_manual_review_projection_entries,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Migrate selected legacy internal_notice manual-review projection rows"
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--selection-path")
    parser.add_argument("--apply", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    notice_ids = _merge_notice_ids(args.notice_ids, args.selection_path)
    if not notice_ids:
        parser.error(
            "refusing implicit full-scope legacy manual migration; pass --notice-id "
            "or --selection-path for notices selected by the consumer layer"
        )
    report = migrate_legacy_manual_review_projection_entries(
        source_corpus=args.corpus,
        source_collection=args.collection,
        notice_ids=notice_ids,
        apply=args.apply,
    )
    payload = asdict(report)
    if args.apply:
        admission_store = build_internal_notice_consumption_admission_store_from_env()
        payload["batch_id"] = record_internal_notice_consumption_admission(
            source_corpus=args.corpus,
            source_collection=args.collection,
            command="legacy_manual_migration",
            notice_ids=notice_ids,
            result_counts={
                "legacy_manual_review_count": report.legacy_manual_review_count,
                "pending_multimodal_count": report.pending_multimodal_count,
                "no_adoption_count": report.no_adoption_count,
            },
            store=admission_store,
        )
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


def _merge_notice_ids(
    explicit_notice_ids: Sequence[str],
    selection_path: str | None,
) -> tuple[str, ...]:
    selected_notice_ids = (
        load_authenticated_notice_selection_notice_ids(Path(selection_path))
        if selection_path
        else ()
    )
    return tuple(
        dict.fromkeys(
            notice_id
            for notice_id in (
                *(str(item).strip() for item in explicit_notice_ids),
                *selected_notice_ids,
            )
            if notice_id
        )
    )


__all__ = [
    "build_parser",
    "main",
    "migrate_legacy_manual_review_projection_entries",
]


if __name__ == "__main__":
    main()
