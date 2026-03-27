from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import json
import os
from pathlib import Path

from campus_contracts import ALLOWED_CORPORA, DEFAULT_COLLECTION, DEFAULT_CORPUS, KNOWN_COLLECTION_TO_CORPUS
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
    pdf_path: Path,
    raw_source_uri: str,
    env: dict[str, str] | None = None,
    raw_asset_id: str | None = None,
    object_store: ObjectStoreWriter | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
) -> RawAssetRegistrationResult:
    source = env if env is not None else os.environ
    source_path = Path(pdf_path)
    if not source_path.exists() or not source_path.is_file():
        raise ValueError(f"raw source file not found: {source_path}")
    normalized_source_uri = raw_source_uri.strip()
    if not normalized_source_uri:
        raise ValueError("raw_source_uri is required")

    corpus = _read_ingestion_corpus(source)
    collection = _read_ingestion_collection(source, corpus=corpus)
    object_store_settings = ObjectStoreSettings.from_env(source)
    raw_asset_registry = raw_asset_registry or build_raw_asset_registry_from_env(source)
    writer = object_store or S3ObjectStoreWriter(object_store_settings)

    file_bytes = source_path.read_bytes()
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
        content_type="application/pdf",
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
    source_file = (os.environ.get("RAW_SOURCE_FILE") or "").strip()
    raw_source_uri = (os.environ.get("RAW_SOURCE_URI") or "").strip()
    raw_asset_id = (os.environ.get("RAW_ASSET_ID") or "").strip() or None
    if not source_file:
        raise ValueError("RAW_SOURCE_FILE is required")
    if not raw_source_uri:
        raise ValueError("RAW_SOURCE_URI is required")
    result = register_raw_asset(
        pdf_path=Path(source_file),
        raw_source_uri=raw_source_uri,
        raw_asset_id=raw_asset_id,
    )
    print(json.dumps(asdict(result), ensure_ascii=False, indent=2))


def _read_ingestion_corpus(source: dict[str, str]) -> str:
    corpus = (source.get("INGESTION_CORPUS") or DEFAULT_CORPUS).strip() or DEFAULT_CORPUS
    if corpus not in ALLOWED_CORPORA:
        raise ValueError(f"unsupported corpus: {corpus}")
    return corpus


def _read_ingestion_collection(source: dict[str, str], *, corpus: str) -> str:
    collection = (source.get("INGESTION_COLLECTION") or DEFAULT_COLLECTION).strip() or DEFAULT_COLLECTION
    expected_corpus = KNOWN_COLLECTION_TO_CORPUS.get(collection)
    if expected_corpus is not None and expected_corpus != corpus:
        raise ValueError(f"unsupported collection scope: {collection} does not belong to {corpus}")
    return collection


__all__ = ["RawAssetRegistrationResult", "register_raw_asset", "main"]


if __name__ == "__main__":
    main()
