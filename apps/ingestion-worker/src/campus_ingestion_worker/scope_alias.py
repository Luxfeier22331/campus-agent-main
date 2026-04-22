from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict

from campus_ingestion_core.scope_alias import set_scope_release_alias

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Publish or unpublish the serving alias for an existing registry scope release"
    )
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--collection", required=True)
    action_group = parser.add_mutually_exclusive_group(required=True)
    action_group.add_argument(
        "--physical-collection-name",
        help="Existing physical collection name to bind to the runtime serving alias.",
    )
    action_group.add_argument(
        "--unpublish",
        action="store_true",
        help="Remove the runtime serving alias without deleting physical collections.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    report = set_scope_release_alias(
        corpus=args.corpus,
        collection=args.collection,
        physical_collection_name=args.physical_collection_name,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = ["build_parser", "main", "set_scope_release_alias"]


if __name__ == "__main__":
    main()
