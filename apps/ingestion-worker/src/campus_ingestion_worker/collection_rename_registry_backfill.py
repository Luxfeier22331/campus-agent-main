from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict

from campus_ingestion_core.collection_rename_registry_backfill import (
    apply_registry_collection_rename_backfill,
    audit_registry_collection_rename_backfill,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Audit or backfill legacy collection names in ingestion registry tables"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser(
        "audit", help="Show legacy registry rows that still use renamed collections"
    )
    subparsers.add_parser(
        "apply", help="Rewrite legacy registry rows to canonical collection names"
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    if args.command == "audit":
        report = audit_registry_collection_rename_backfill()
    else:
        report = apply_registry_collection_rename_backfill()
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


__all__ = [
    "apply_registry_collection_rename_backfill",
    "audit_registry_collection_rename_backfill",
    "build_parser",
    "main",
]


if __name__ == "__main__":
    main()
