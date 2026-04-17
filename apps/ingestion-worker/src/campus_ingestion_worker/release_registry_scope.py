from __future__ import annotations

import argparse
from dataclasses import asdict
import json
from typing import Sequence

from campus_ingestion_core import release_registry_scope
from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run a release-managed registry scope indexing flow"
    )
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument("--preparation-run-id")
    parser.add_argument("--reset-index", action="store_true")
    publish_group = parser.add_mutually_exclusive_group()
    publish_group.add_argument("--publish-alias", dest="publish_alias", action="store_true")
    publish_group.add_argument("--no-publish-alias", dest="publish_alias", action="store_false")
    parser.set_defaults(publish_alias=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = release_registry_scope(
        corpus=args.corpus,
        collection=args.collection,
        preparation_run_id=args.preparation_run_id,
        reset_index=args.reset_index,
        publish_alias=args.publish_alias,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = ["build_parser", "main", "release_registry_scope"]


if __name__ == "__main__":
    main()
