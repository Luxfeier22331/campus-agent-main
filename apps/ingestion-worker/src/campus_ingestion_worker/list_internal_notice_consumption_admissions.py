from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict

from campus_ingestion_core.internal_notice_consumption_admission import (
    build_internal_notice_consumption_admission_store_from_env,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.internal_notice_selection import (
    build_internal_notice_selection_provenance,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="List internal_notice consumer admission batches")
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--selection-path")
    parser.add_argument("--command", action="append", dest="commands", default=[])
    parser.add_argument("--status", action="append", dest="statuses", default=[])
    parser.add_argument("--limit", type=int, default=50)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    selection = build_internal_notice_selection_provenance(
        explicit_notice_ids=args.notice_ids,
        selection_path=args.selection_path,
    )
    commands = _normalize_filters(args.commands)
    statuses = _normalize_filters(args.statuses)
    store = build_internal_notice_consumption_admission_store_from_env(prefer_operator=True)
    records = store.list_records(
        source_corpus=args.corpus,
        source_collection=args.collection,
        notice_ids=selection.notice_ids,
        commands=commands,
        statuses=statuses,
        limit=args.limit,
    )
    payload = {
        "source_corpus": args.corpus,
        "source_collection": args.collection,
        "selected_notice_ids": selection.notice_ids,
        "selection_source": selection.selection_source,
        "selection_path": selection.selection_path,
        "selection_sha256": selection.selection_sha256,
        "commands": commands,
        "statuses": statuses,
        "record_count": len(records),
        "records": [asdict(record) for record in records],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))


def _normalize_filters(values: Sequence[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(str(item).strip() for item in values if str(item).strip()))


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
