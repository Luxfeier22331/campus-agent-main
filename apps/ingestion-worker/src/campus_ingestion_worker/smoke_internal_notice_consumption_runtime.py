from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict

from campus_ingestion_core.internal_notice_consumption_runtime_smoke import (
    run_internal_notice_consumption_runtime_smoke,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.internal_notice_selection import (
    build_internal_notice_selection_provenance,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Smoke check internal_notice consumption runtime state"
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--notice-id", action="append", dest="notice_ids", default=[])
    parser.add_argument("--selection-path")
    parser.add_argument("--allow-unattempted-pending", action="store_true")
    parser.add_argument("--check-chat-endpoint", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    selection = build_internal_notice_selection_provenance(
        explicit_notice_ids=args.notice_ids,
        selection_path=args.selection_path,
    )
    if not selection.notice_ids:
        parser.error("pass --notice-id or --selection-path for runtime smoke")
    report = run_internal_notice_consumption_runtime_smoke(
        source_corpus=args.corpus,
        source_collection=args.collection,
        notice_ids=selection.notice_ids,
        allow_unattempted_pending=args.allow_unattempted_pending,
        check_chat_endpoint=args.check_chat_endpoint,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2, sort_keys=True))


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
