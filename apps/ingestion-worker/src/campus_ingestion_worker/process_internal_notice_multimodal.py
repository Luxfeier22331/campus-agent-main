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
from campus_ingestion_core.internal_notice_multimodal_processing import (
    process_internal_notice_pending_multimodal_entries,
)
from campus_ingestion_core.internal_notice_read_model import rebuild_internal_notice_read_model

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Process selected internal_notice pending multimodal entries"
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--selection-path")
    parser.add_argument("--skip-read-model-rebuild", action="store_true")
    parser.add_argument("--max-attempts", type=int, default=3)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    notice_ids = _merge_notice_ids(args.notice_ids, args.selection_path)
    if not notice_ids:
        parser.error(
            "refusing implicit full-scope multimodal processing; pass --notice-id "
            "or --selection-path for notices selected by the consumer layer"
        )
    report = process_internal_notice_pending_multimodal_entries(
        source_corpus=args.corpus,
        source_collection=args.collection,
        notice_ids=notice_ids,
        max_attempts=args.max_attempts,
    )
    payload = asdict(report)
    admission_store = build_internal_notice_consumption_admission_store_from_env()
    payload["batch_id"] = record_internal_notice_consumption_admission(
        source_corpus=args.corpus,
        source_collection=args.collection,
        command="multimodal_process",
        notice_ids=notice_ids,
        result_counts={
            "pending_entry_count": report.pending_entry_count,
            "processed_count": report.processed_count,
            "failed_count": report.failed_count,
        },
        store=admission_store,
    )
    if args.skip_read_model_rebuild:
        payload["read_model_rebuilt_count"] = 0
    else:
        rows = rebuild_internal_notice_read_model(
            source_corpus=args.corpus,
            source_collection=args.collection,
            notice_ids=notice_ids,
        )
        payload["read_model_rebuilt_count"] = len(rows)
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
    "process_internal_notice_pending_multimodal_entries",
    "rebuild_internal_notice_read_model",
]


if __name__ == "__main__":
    main()
