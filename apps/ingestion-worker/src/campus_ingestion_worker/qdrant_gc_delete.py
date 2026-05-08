from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from dataclasses import asdict

from campus_ingestion_core.qdrant_backup import (
    CollectionGcDeleteRequest,
    delete_gc_eligible_collection,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Delete a Qdrant archive collection only when GC eligibility proof passes"
    )
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--operator")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = delete_gc_eligible_collection(
        request=CollectionGcDeleteRequest(
            corpus=args.corpus,
            collection=args.collection,
            release_id=args.release_id,
            operator=(args.operator or os.environ.get("USER") or "unknown").strip() or "unknown",
        )
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
