from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from dataclasses import asdict
from pathlib import Path

from campus_ingestion_core import (
    ObjectStoreSettings,
    build_document_registry_from_env,
    publish_document_reader_assets,
)
from campus_ingestion_core.campusrag_ingestion_support import utc_now
from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.models import DocumentRegistryRecord

from campus_ingestion_worker.env_bootstrap import load_worker_env

DEFAULT_SCOPES = ("regulations/student_rules", "curriculum/curriculum_plan")


class DryRunObjectStore:
    def __init__(self, inner: S3ObjectStoreAdmin) -> None:
        self.inner = inner

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.inner.get_bytes(bucket=bucket, key=key)

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        return None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Publish canonical document reader assets and docs read-model manifest.",
    )
    parser.add_argument(
        "--scope",
        action="append",
        default=[],
        help="Scope in <corpus>/<collection> form. Defaults to public docs first-launch scopes.",
    )
    parser.add_argument("--manifest-path")
    parser.add_argument("--manifest-object-key")
    parser.add_argument("--dry-run", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    settings = ObjectStoreSettings.from_env()
    registry = build_document_registry_from_env(prefer_operator=False)
    object_store = S3ObjectStoreAdmin(settings)
    runtime_store = DryRunObjectStore(object_store) if args.dry_run else object_store
    records = _select_records(registry=registry, scopes=tuple(args.scope or DEFAULT_SCOPES))
    report = publish_document_reader_assets(
        bucket_derived=settings.bucket_derived,
        generated_at=utc_now(),
        object_store=runtime_store,
        records=records,
    )
    manifest_bytes = (
        json.dumps(report.manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    ).encode("utf-8")

    if args.manifest_path:
        path = Path(args.manifest_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(manifest_bytes)
    if args.manifest_object_key and not args.dry_run:
        object_store.put_bytes(
            bucket=settings.bucket_derived,
            key=args.manifest_object_key,
            data=manifest_bytes,
            content_type="application/json",
        )

    print(json.dumps(asdict(report), ensure_ascii=False, indent=2, default=str))


def _select_records(*, registry, scopes: tuple[str, ...]) -> tuple[DocumentRegistryRecord, ...]:
    records: list[DocumentRegistryRecord] = []
    for scope in scopes:
        corpus, collection = _parse_scope(scope)
        records.extend(
            record
            for record in registry.list_by_scope(corpus, collection)
            if record.status == "active" and record.is_current
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
