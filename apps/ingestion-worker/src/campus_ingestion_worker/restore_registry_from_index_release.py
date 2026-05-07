from __future__ import annotations

import argparse
import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict

from campus_retrieval_core.settings import RetrievalSettings

from campus_ingestion_core import ObjectStoreSettings, build_document_registry_from_env
from campus_ingestion_core.index_release_registry_restore import (
    restore_registry_scope_from_index_release_payloads,
)
from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.registry_scope_release_support import build_qdrant_client

from campus_ingestion_worker.env_bootstrap import load_worker_env


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Restore missing document registry records from an already-published "
            "index release manifest and Qdrant payloads."
        )
    )
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument("--release-manifest-key", required=True)
    parser.add_argument("--physical-collection-name", required=True)
    parser.add_argument("--execute", action="store_true")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    settings = ObjectStoreSettings.from_env()
    object_store = S3ObjectStoreAdmin(settings)
    release_manifest_payload = json.loads(
        object_store.get_bytes(
            bucket=settings.bucket_derived,
            key=args.release_manifest_key,
        ).decode("utf-8")
    )
    release_payloads = _read_release_payloads(
        physical_collection_name=args.physical_collection_name,
    )
    registry = build_document_registry_from_env(prefer_operator=True)
    report = restore_registry_scope_from_index_release_payloads(
        corpus=args.corpus,
        collection=args.collection,
        release_manifest_payload=release_manifest_payload,
        release_payloads=release_payloads,
        registry=registry,
        execute=args.execute,
    )
    print(json.dumps(asdict(report), ensure_ascii=False, indent=2))


def _read_release_payloads(*, physical_collection_name: str) -> tuple[Mapping[str, object], ...]:
    qdrant_client = build_qdrant_client(RetrievalSettings.from_env(), source=None)
    payloads: list[Mapping[str, object]] = []
    offset = None
    while True:
        points, offset = qdrant_client.scroll(
            collection_name=physical_collection_name,
            limit=256,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )
        for point in points:
            payload = point.payload
            if isinstance(payload, Mapping):
                payloads.append(payload)
        if offset is None:
            break
    return tuple(payloads)


__all__ = ["build_parser", "main"]


if __name__ == "__main__":
    main()
