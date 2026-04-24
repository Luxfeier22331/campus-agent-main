from __future__ import annotations

import argparse
import json
from collections import Counter
from collections.abc import Sequence
from dataclasses import asdict
from typing import Any

from campus_ingestion_core.internal_notice_read_model import (
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
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    rows = rebuild_internal_notice_read_model(
        source_corpus=args.corpus,
        source_collection=args.collection,
        notice_ids=tuple(args.notice_ids),
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
        "target_surface_counts": dict(sorted(target_surface_counts.items())),
        "consumption_status_counts": dict(sorted(consumption_status_counts.items())),
        "primary_role_counts": dict(sorted(primary_role_counts.items())),
        "entries": [asdict(row) for row in rows],
    }


__all__ = [
    "build_parser",
    "main",
    "rebuild_internal_notice_read_model",
]


if __name__ == "__main__":
    main()
