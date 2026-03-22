from __future__ import annotations

from dataclasses import dataclass, replace
import os
from pathlib import Path
from typing import Protocol

from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.object_store import S3ObjectStoreClientFactory, build_object_key
from campus_ingestion_core.registry import DocumentRegistry, FileDocumentRegistry
from campus_ingestion_core.settings import ObjectStoreSettings


@dataclass(frozen=True, slots=True)
class ObjectKeyMigrationReport:
    migrated_count: int
    skipped_count: int
    failed_count: int
    errors: tuple[str, ...]


class ObjectKeyMigrationStore(Protocol):
    def has_object(self, *, bucket: str, key: str) -> bool: ...

    def copy_object(
        self,
        *,
        source_bucket: str,
        source_key: str,
        target_bucket: str,
        target_key: str,
    ) -> None: ...

    def delete_object(self, *, bucket: str, key: str) -> None: ...


class S3ObjectKeyMigrationStore:
    def __init__(self, settings: ObjectStoreSettings) -> None:
        self._client = S3ObjectStoreClientFactory(settings).create()

    def has_object(self, *, bucket: str, key: str) -> bool:
        try:
            self._client.head_object(Bucket=bucket, Key=key)
        except self._client.exceptions.NoSuchKey:
            return False
        except Exception as exc:
            error_code = getattr(exc, "response", {}).get("Error", {}).get("Code")
            if error_code in {"404", "NoSuchKey", "NotFound"}:
                return False
            raise
        return True

    def copy_object(
        self,
        *,
        source_bucket: str,
        source_key: str,
        target_bucket: str,
        target_key: str,
    ) -> None:
        self._client.copy_object(
            Bucket=target_bucket,
            Key=target_key,
            CopySource={"Bucket": source_bucket, "Key": source_key},
        )

    def delete_object(self, *, bucket: str, key: str) -> None:
        self._client.delete_object(Bucket=bucket, Key=key)


def migrate_registry_object_keys(
    *,
    registry: DocumentRegistry,
    object_store: ObjectKeyMigrationStore,
    bucket_raw: str = "campus-rag-raw",
    bucket_processed: str = "campus-rag-processed",
) -> ObjectKeyMigrationReport:
    records = registry.list_by_corpus("student_handbook")
    migrated_count = 0
    skipped_count = 0
    failed_count = 0
    errors: list[str] = []
    migrated_pairs: list[tuple[DocumentRegistryRecord, DocumentRegistryRecord]] = []

    for record in records:
        target_record = build_migrated_record(record)
        if target_record == record:
            skipped_count += 1
            continue
        try:
            _migrate_record_objects(
                source=record,
                target=target_record,
                object_store=object_store,
                bucket_raw=bucket_raw,
                bucket_processed=bucket_processed,
                records=records,
            )
            registry.upsert(target_record)
            migrated_pairs.append((record, target_record))
        except Exception as exc:
            failed_count += 1
            errors.append(f"{record.document_id}::{record.version_id}: {exc}")
            continue
        migrated_count += 1

    _delete_unreferenced_legacy_objects(
        registry=registry,
        migrated_pairs=tuple(migrated_pairs),
        object_store=object_store,
        bucket_raw=bucket_raw,
        bucket_processed=bucket_processed,
    )

    return ObjectKeyMigrationReport(
        migrated_count=migrated_count,
        skipped_count=skipped_count,
        failed_count=failed_count,
        errors=tuple(errors),
    )


def migrate_registry_object_keys_from_env(
    env: dict[str, str] | None = None,
) -> ObjectKeyMigrationReport:
    source = env if env is not None else os.environ
    registry = FileDocumentRegistry(
        Path((source.get("DOCUMENT_REGISTRY_PATH") or "./var/registry/student_handbook.json").strip())
    )
    settings = ObjectStoreSettings.from_env(source)
    object_store = S3ObjectKeyMigrationStore(settings)
    return migrate_registry_object_keys(
        registry=registry,
        object_store=object_store,
        bucket_raw=settings.bucket_raw,
        bucket_processed=settings.bucket_processed,
    )


def build_migrated_record(record: DocumentRegistryRecord) -> DocumentRegistryRecord:
    raw_object_key = None
    if record.raw_object_key is not None:
        filename = record.raw_source_filename or Path(record.raw_object_key).name
        raw_object_key = build_object_key(
            corpus=record.corpus,
            document_id=record.document_id,
            version_id=record.version_id,
            filename=filename,
        )

    provider_result_object_key = (
        build_object_key(
            corpus=record.corpus,
            document_id=record.document_id,
            version_id=record.version_id,
            filename="provider-result.jsonl",
        )
        if record.provider_result_object_key is not None
        else None
    )
    structured_object_key = (
        build_object_key(
            corpus=record.corpus,
            document_id=record.document_id,
            version_id=record.version_id,
            filename="structured.jsonl",
        )
        if record.structured_object_key is not None
        else None
    )
    processed_object_keys = tuple(
        key for key in (provider_result_object_key, structured_object_key) if key is not None
    )
    return replace(
        record,
        raw_object_key=raw_object_key,
        provider_result_object_key=provider_result_object_key,
        structured_object_key=structured_object_key,
        processed_object_keys=processed_object_keys,
    )


def _migrate_record_objects(
    *,
    source: DocumentRegistryRecord,
    target: DocumentRegistryRecord,
    object_store: ObjectKeyMigrationStore,
    bucket_raw: str,
    bucket_processed: str,
    records: tuple[DocumentRegistryRecord, ...],
) -> None:
    _copy_if_needed(
        object_store=object_store,
        bucket=bucket_raw,
        source_key=_resolve_source_key(
            bucket=bucket_raw,
            source_key=source.raw_object_key,
            target_key=target.raw_object_key,
            object_store=object_store,
            fallback_keys=_candidate_raw_source_keys(source=source, records=records),
        ),
        target_key=target.raw_object_key,
    )
    _copy_if_needed(
        object_store=object_store,
        bucket=bucket_processed,
        source_key=source.provider_result_object_key,
        target_key=target.provider_result_object_key,
    )
    _copy_if_needed(
        object_store=object_store,
        bucket=bucket_processed,
        source_key=source.structured_object_key,
        target_key=target.structured_object_key,
    )


def _delete_unreferenced_legacy_objects(
    *,
    registry: DocumentRegistry,
    migrated_pairs: tuple[tuple[DocumentRegistryRecord, DocumentRegistryRecord], ...],
    object_store: ObjectKeyMigrationStore,
    bucket_raw: str,
    bucket_processed: str,
) -> None:
    referenced_keys = _current_registry_key_refs(registry)
    for source, target in migrated_pairs:
        _delete_if_unreferenced(
            object_store=object_store,
            bucket=bucket_raw,
            source_key=source.raw_object_key,
            target_key=target.raw_object_key,
            referenced_keys=referenced_keys,
        )
        _delete_if_unreferenced(
            object_store=object_store,
            bucket=bucket_processed,
            source_key=source.provider_result_object_key,
            target_key=target.provider_result_object_key,
            referenced_keys=referenced_keys,
        )
        _delete_if_unreferenced(
            object_store=object_store,
            bucket=bucket_processed,
            source_key=source.structured_object_key,
            target_key=target.structured_object_key,
            referenced_keys=referenced_keys,
        )


def _current_registry_key_refs(registry: DocumentRegistry) -> set[str]:
    refs: set[str] = set()
    for record in registry.list_by_corpus("student_handbook"):
        for key in (
            record.raw_object_key,
            record.provider_result_object_key,
            record.structured_object_key,
            *record.processed_object_keys,
        ):
            if key is not None:
                refs.add(key)
    return refs


def _copy_if_needed(
    *,
    object_store: ObjectKeyMigrationStore,
    bucket: str,
    source_key: str | None,
    target_key: str | None,
) -> None:
    if source_key is None or target_key is None or source_key == target_key:
        return
    if not object_store.has_object(bucket=bucket, key=target_key):
        object_store.copy_object(
            source_bucket=bucket,
            source_key=source_key,
            target_bucket=bucket,
            target_key=target_key,
        )
    if not object_store.has_object(bucket=bucket, key=target_key):
        raise FileNotFoundError(f"missing migrated object: {bucket}/{target_key}")


def _delete_if_unreferenced(
    *,
    object_store: ObjectKeyMigrationStore,
    bucket: str,
    source_key: str | None,
    target_key: str | None,
    referenced_keys: set[str],
) -> None:
    if source_key is None or source_key == target_key:
        return
    if source_key in referenced_keys:
        return
    if object_store.has_object(bucket=bucket, key=source_key):
        object_store.delete_object(bucket=bucket, key=source_key)


def _resolve_source_key(
    *,
    bucket: str,
    source_key: str | None,
    target_key: str | None,
    object_store: ObjectKeyMigrationStore,
    fallback_keys: tuple[str, ...] = (),
) -> str | None:
    if source_key is None or target_key is None or source_key == target_key:
        return source_key
    if object_store.has_object(bucket=bucket, key=source_key):
        return source_key
    for candidate in fallback_keys:
        if candidate != target_key and object_store.has_object(bucket=bucket, key=candidate):
            return candidate
    raise FileNotFoundError(f"missing source object: {bucket}/{source_key}")


def _candidate_raw_source_keys(
    *,
    source: DocumentRegistryRecord,
    records: tuple[DocumentRegistryRecord, ...],
) -> tuple[str, ...]:
    candidates: list[str] = []
    for record in records:
        if record.document_id == source.document_id and record.version_id == source.version_id:
            continue
        if record.raw_content_hash != source.raw_content_hash:
            continue
        if record.raw_source_filename != source.raw_source_filename:
            continue
        if record.raw_object_key is None:
            continue
        candidates.append(record.raw_object_key)
    return tuple(dict.fromkeys(candidates))
