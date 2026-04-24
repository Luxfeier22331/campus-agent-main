from __future__ import annotations

import argparse
import json
from collections import Counter
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_legacy_export import (
    load_authenticated_notice_selection_notice_ids,
)
from campus_ingestion_core.internal_notice_read_model import (
    DEFAULT_INTERNAL_NOTICE_BODY_EXCERPT_MAX_CHARS,
    DEFAULT_INTERNAL_NOTICE_SEARCH_TEXT_MAX_CHARS,
    InternalNoticeReadModelEntry,
    rebuild_internal_notice_read_model,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Rebuild internal_notice query read model metadata"
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--selection-path")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    notice_ids = _merge_notice_ids(args.notice_ids, args.selection_path)
    if not notice_ids:
        parser.error(
            "refusing implicit full-scope read model rebuild; pass --notice-id "
            "or --selection-path for notices selected by the consumer layer"
        )
    rows = rebuild_internal_notice_read_model(
        source_corpus=args.corpus,
        source_collection=args.collection,
        notice_ids=notice_ids,
    )
    print(json.dumps(_build_report(rows), ensure_ascii=False, indent=2, sort_keys=True))


def _build_report(rows: Sequence[InternalNoticeReadModelEntry]) -> dict[str, Any]:
    target_surface_counts = Counter(row.target_surface for row in rows)
    consumption_status_counts = Counter(row.consumption_status for row in rows)
    primary_role_counts = Counter(row.primary_role for row in rows)
    return {
        "read_model_entry_count": len(rows),
        "notice_count": len({row.source_notice_id for row in rows}),
        "queryable_count": sum(1 for row in rows if row.queryable),
        "body_excerpt_max_chars": DEFAULT_INTERNAL_NOTICE_BODY_EXCERPT_MAX_CHARS,
        "search_text_max_chars": DEFAULT_INTERNAL_NOTICE_SEARCH_TEXT_MAX_CHARS,
        "observed_max_body_excerpt_chars": max(
            (len(row.body_excerpt) for row in rows),
            default=0,
        ),
        "observed_max_search_text_chars": max(
            (len(row.search_text) for row in rows),
            default=0,
        ),
        "total_body_excerpt_chars": sum(len(row.body_excerpt) for row in rows),
        "total_search_text_chars": sum(len(row.search_text) for row in rows),
        "target_surface_counts": dict(sorted(target_surface_counts.items())),
        "consumption_status_counts": dict(sorted(consumption_status_counts.items())),
        "primary_role_counts": dict(sorted(primary_role_counts.items())),
        "entries": [asdict(row) for row in rows],
    }


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
    "rebuild_internal_notice_read_model",
]


if __name__ == "__main__":
    main()
