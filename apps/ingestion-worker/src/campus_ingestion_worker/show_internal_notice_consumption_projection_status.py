from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from dataclasses import asdict

from campus_ingestion_core.internal_notice_consumption_projection import (
    read_notice_consumption_projection_status,
)
from campus_ingestion_core.notice_consumption_projection import (
    build_notice_consumption_projection_store_from_env,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Show internal_notice notice consumption projection status"
    )
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="internal_notice")
    parser.add_argument("--notice-id", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    store = build_notice_consumption_projection_store_from_env(
        dict(os.environ),
        prefer_operator=True,
    )
    status = read_notice_consumption_projection_status(
        store,
        source_corpus=args.corpus,
        source_collection=args.collection,
        source_notice_id=args.notice_id,
    )
    print(json.dumps(asdict(status), ensure_ascii=False, indent=2, sort_keys=True))


__all__ = [
    "build_notice_consumption_projection_store_from_env",
    "build_parser",
    "main",
    "read_notice_consumption_projection_status",
]


if __name__ == "__main__":
    main()
