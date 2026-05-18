from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict

from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.document_canonical_markdown_backfill import (
    backfill_missing_canonical_markdown_from_document_units,
)
from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.registry import build_document_registry_from_env
from campus_ingestion_core.registry_scope_common import select_releasable_registry_records
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_SCOPES = ("regulations/institutional_rules",)
ALLOWED_SCOPES = frozenset({("regulations", "institutional_rules")})


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Backfill missing canonical.md artifacts from existing document-units.jsonl "
            "for releasable registry records."
        ),
    )
    parser.add_argument(
        "--scope",
        action="append",
        default=[],
        help="Scope in <corpus>/<collection> form. Defaults to institutional regulations.",
    )
    parser.add_argument("--bucket")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    settings = ObjectStoreSettings.from_env()
    object_store = S3ObjectStoreAdmin(settings)
    registry = build_document_registry_from_env(prefer_operator=False)
    records = _select_records(registry=registry, scopes=tuple(args.scope or DEFAULT_SCOPES))
    report = backfill_missing_canonical_markdown_from_document_units(
        bucket=args.bucket or settings.bucket_derived,
        object_store=object_store,
        records=records,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


def _select_records(*, registry, scopes: tuple[str, ...]):
    records = []
    for scope in scopes:
        corpus, collection = _parse_scope(scope)
        if (corpus, collection) not in ALLOWED_SCOPES:
            raise ValueError(
                "missing canonical markdown backfill only supports regulations/institutional_rules"
            )
        runtime_profile = load_runtime_profile(corpus, collection)
        records.extend(
            select_releasable_registry_records(
                records=registry.list_by_scope(corpus, collection),
                runtime_profile=runtime_profile,
            )
        )
    return tuple(records)


def _parse_scope(scope: str) -> tuple[str, str]:
    parts = [part.strip() for part in scope.split("/", 1)]
    if len(parts) != 2 or not all(parts):
        raise ValueError(f"scope must be <corpus>/<collection>: {scope}")
    return parts[0], parts[1]


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
