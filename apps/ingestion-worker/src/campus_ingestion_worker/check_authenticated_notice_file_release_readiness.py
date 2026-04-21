from __future__ import annotations

import argparse
from dataclasses import asdict, is_dataclass
import json
from typing import Any, Sequence

from campus_ingestion_core.authenticated_notice_file_release_inventory import (
    build_authenticated_notice_file_release_inventory_store_from_env,
)
from campus_ingestion_core.authenticated_notice_file_release_owner_recovery import (
    resolve_file_release_owner_recovery_readiness_from_inventory_store,
)

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Check authenticated notice file-release owner-recovery readiness from PG ledger"
    )
    parser.add_argument("--owner-title-hint", required=True)
    parser.add_argument("--corpus", default="campus_notices")
    parser.add_argument("--collection", default="file_release_capture")
    parser.add_argument("--owner-kind", default="file_release_document")
    parser.add_argument("--relation-type", default="file_release_ref")
    parser.add_argument("--file-release-id", action="append", dest="file_release_ids", default=[])
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    inventory_store = build_authenticated_notice_file_release_inventory_store_from_env(
        prefer_operator=True
    )
    result = resolve_file_release_owner_recovery_readiness_from_inventory_store(
        owner_title_hint=args.owner_title_hint,
        inventory_store=inventory_store,
        corpus=args.corpus,
        collection=args.collection,
        owner_kind=args.owner_kind,
        relation_type=args.relation_type,
        file_release_ids=tuple(args.file_release_ids),
    )
    payload = asdict(result) if is_dataclass(result) else _normalize_payload(result)
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def _normalize_payload(result: Any) -> Any:
    if isinstance(result, dict):
        return result
    raise TypeError("worker result must be a dataclass or dict")


__all__ = [
    "build_authenticated_notice_file_release_inventory_store_from_env",
    "build_parser",
    "main",
    "resolve_file_release_owner_recovery_readiness_from_inventory_store",
]


if __name__ == "__main__":
    main()
