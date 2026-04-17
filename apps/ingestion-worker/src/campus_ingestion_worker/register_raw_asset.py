from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
import os
import argparse
from pathlib import Path
from typing import Sequence

from campus_ingestion_core import (
    ObjectStoreSettings,
    RawAssetRecord,
    RawAssetRegistry,
    build_raw_asset_key,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.campusrag_ingestion_support import (
    ObjectStoreWriter,
    S3ObjectStoreWriter,
    build_raw_asset_id,
    utc_now,
)
from campus_ingestion_core.raw_asset_typing import infer_raw_asset_typed_metadata
from campus_ingestion_core.scope_catalog import assert_known_scope

from campus_ingestion_worker.env_bootstrap import load_worker_env


@dataclass(frozen=True, slots=True)
class RawAssetRegistrationResult:
    raw_asset_id: str
    raw_version_id: str
    object_key: str
    uploaded: bool
    record: RawAssetRecord


def register_raw_asset(
    *,
    file_path: Path,
    raw_source_uri: str,
    corpus: str,
    collection: str,
    env: dict[str, str] | None = None,
    raw_asset_id: str | None = None,
    object_store: ObjectStoreWriter | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
) -> RawAssetRegistrationResult:
    source = env if env is not None else os.environ
    source_path = Path(file_path)
    if not source_path.exists() or not source_path.is_file():
        raise ValueError(f"raw source file not found: {source_path}")
    normalized_source_uri = raw_source_uri.strip()
    if not normalized_source_uri:
        raise ValueError("raw_source_uri is required")

    assert_known_scope(corpus, collection)
    object_store_settings = ObjectStoreSettings.from_env(source)
    raw_asset_registry = raw_asset_registry or build_raw_asset_registry_from_env(source)
    writer = object_store or S3ObjectStoreWriter(object_store_settings)

    file_bytes = source_path.read_bytes()
    typed_metadata = infer_raw_asset_typed_metadata(source_path=source_path, file_bytes=file_bytes)
    content_hash = hashlib.sha256(file_bytes).hexdigest()
    raw_version_id = f"sha256:{content_hash}"
    source_filename = source_path.name
    canonical_raw_asset_id = raw_asset_id or build_raw_asset_id(source_filename)
    object_key = build_raw_asset_key(
        corpus=corpus,
        raw_asset_id=canonical_raw_asset_id,
        raw_version_id=raw_version_id,
        filename=source_filename,
    )
    existing = raw_asset_registry.get(canonical_raw_asset_id, raw_version_id)
    if existing is not None:
        return RawAssetRegistrationResult(
            raw_asset_id=existing.raw_asset_id,
            raw_version_id=existing.raw_version_id,
            object_key=existing.object_key,
            uploaded=False,
            record=existing,
        )

    writer.put_bytes(
        bucket=object_store_settings.bucket_source,
        key=object_key,
        data=file_bytes,
        content_type=typed_metadata.content_type or "application/octet-stream",
    )
    record = RawAssetRecord(
        raw_asset_id=canonical_raw_asset_id,
        raw_version_id=raw_version_id,
        corpus=corpus,
        collection=collection,
        raw_source_uri=normalized_source_uri,
        content_hash=content_hash,
        source_filename=source_filename,
        object_key=object_key,
        content_type=typed_metadata.content_type,
        file_extension=typed_metadata.file_extension,
        byte_size=typed_metadata.byte_size,
        page_count=typed_metadata.page_count,
        image_width=typed_metadata.image_width,
        image_height=typed_metadata.image_height,
        asset_kind=typed_metadata.asset_kind,
        asset_subkind=typed_metadata.asset_subkind,
        classification_confidence=typed_metadata.classification_confidence,
        ingestion_timestamp=utc_now(),
        import_source="raw_online_ocr",
    )
    raw_asset_registry.upsert(record)
    return RawAssetRegistrationResult(
        raw_asset_id=record.raw_asset_id,
        raw_version_id=record.raw_version_id,
        object_key=record.object_key,
        uploaded=True,
        record=record,
    )


def main() -> None:
    load_worker_env()
    args = build_parser().parse_args()
    result = register_raw_asset(
        file_path=Path(args.file_path),
        raw_source_uri=args.raw_source_uri,
        corpus=args.corpus,
        collection=args.collection,
        raw_asset_id=args.raw_asset_id,
    )
    print(json.dumps(asdict(result), ensure_ascii=False, indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Register a raw asset with an explicit corpus/collection scope")
    parser.add_argument("--file-path", required=True)
    parser.add_argument("--raw-source-uri", required=True)
    parser.add_argument("--corpus", required=True)
    parser.add_argument("--collection", required=True)
    parser.add_argument("--raw-asset-id")
    return parser


__all__ = ["RawAssetRegistrationResult", "build_parser", "register_raw_asset", "main"]


if __name__ == "__main__":
    main()
