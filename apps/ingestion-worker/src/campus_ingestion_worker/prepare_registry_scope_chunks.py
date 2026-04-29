from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict

from campus_ingestion_core import prepare_registry_scope_chunks

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Prepare and validate registry scope chunks without embeddings or indexing"
    )
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument("--preparation-run-id", required=True)
    parser.add_argument("--closeout-run-id")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = prepare_registry_scope_chunks(
        corpus=args.corpus,
        collection=args.collection,
        preparation_run_id=args.preparation_run_id,
        closeout_run_id=args.closeout_run_id,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = ["build_parser", "main", "prepare_registry_scope_chunks"]


if __name__ == "__main__":
    main()
