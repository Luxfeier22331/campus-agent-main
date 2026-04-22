from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from campus_ingestion_core.campusrag_ingestion_artifacts import ProcessedArtifactInput
from campus_ingestion_core.collection_config import resolve_collection_truth_config
from campus_ingestion_core.handbook_source_migration import (
    StudentHandbookSourceAssetRequest,
    migrate_student_handbook_source_faithful,
)
from campus_ingestion_core.local_rebuild import (
    RebuildRequest,
    _build_qdrant_client,
    _resolve_ingestion_qdrant_timeout_seconds,
    _resolve_rebuild_target_qdrant_aliases,
    rebuild_local_data,
    rematerialize_curriculum_program_semester_facts_from_local_rebuild,
    replay_provider_response_rebuild,
)
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord
from campus_ingestion_core.object_store import (
    build_processed_artifact_key,
    build_source_ocr_artifact_key,
    build_source_projection_artifact_key,
    build_source_truth_artifact_key,
)
from campus_retrieval_core.settings import RetrievalSettings

from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry

SOURCE_BUCKET = "campus-rag-source"
DERIVED_BUCKET = "campus-rag-derived"


class _FakeObjectStoreAdmin:
    def __init__(self) -> None:
        self.cleared_prefixes: list[tuple[str, str, tuple[str, ...]]] = []
        self.objects: dict[tuple[str, str], bytes] = {}
        self.puts: list[tuple[str, str]] = []

    def delete_prefix(
        self, *, bucket: str, prefix: str, exclude_keys: tuple[str, ...] = ()
    ) -> None:
        self.cleared_prefixes.append((bucket, prefix, exclude_keys))
        for bucket_key in list(self.objects):
            if bucket_key[0] != bucket:
                continue
            if not bucket_key[1].startswith(prefix):
                continue
            if bucket_key[1] in exclude_keys:
                continue
            del self.objects[bucket_key]

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.objects[(bucket, key)] = data
        self.puts.append((bucket, key))


class _FakeQdrantAdmin:
    def __init__(self) -> None:
        self.reset_aliases: list[str] = []

    def reset_index_binding(self, binding) -> tuple[str, ...]:
        self.reset_aliases.append(binding.alias_name)
        return ()


class _FakeDocumentRegistry:
    def __init__(self) -> None:
        self.deleted_scopes: list[tuple[str, str | None]] = []

    def list_by_corpus(self, corpus: str) -> tuple[object, ...]:
        return ()

    def delete_by_corpus(self, corpus: str) -> None:
        self.deleted_scopes.append((corpus, None))

    def list_by_scope(self, corpus: str, collection: str | None = None) -> tuple[object, ...]:
        return ()

    def delete_by_scope(self, corpus: str, collection: str | None = None) -> None:
        self.deleted_scopes.append((corpus, collection))


class _FakeRawAssetRegistry:
    def __init__(self) -> None:
        self.deleted_scopes: list[tuple[str, str | None]] = []
        self.records: dict[tuple[str, str], RawAssetRecord] = {}

    def delete_by_corpus(self, corpus: str) -> None:
        self.deleted_scopes.append((corpus, None))

    def delete_by_scope(self, corpus: str, collection: str | None = None) -> None:
        self.deleted_scopes.append((corpus, collection))

    def get(self, raw_asset_id: str, raw_version_id: str) -> RawAssetRecord | None:
        return self.records.get((raw_asset_id, raw_version_id))

    def upsert(self, record: RawAssetRecord) -> None:
        self.records[(record.raw_asset_id, record.raw_version_id)] = record

    def list_by_corpus(self, corpus: str) -> tuple[RawAssetRecord, ...]:
        return tuple(record for record in self.records.values() if record.corpus == corpus)

    def list_by_scope(
        self, corpus: str, collection: str | None = None
    ) -> tuple[RawAssetRecord, ...]:
        return tuple(
            record
            for record in self.records.values()
            if record.corpus == corpus and (collection is None or record.collection == collection)
        )


class _FakeDocumentRecord:
    def __init__(
        self, *, corpus: str, collection: str, processed_object_keys: tuple[str, ...]
    ) -> None:
        self.corpus = corpus
        self.collection = collection
        self.processed_object_keys = processed_object_keys


class _FakeDocumentRegistryWithRecords(_FakeDocumentRegistry):
    def __init__(self, *records: _FakeDocumentRecord) -> None:
        super().__init__()
        self.records = records

    def list_by_corpus(self, corpus: str) -> tuple[_FakeDocumentRecord, ...]:
        return tuple(record for record in self.records if record.corpus == corpus)

    def list_by_scope(
        self, corpus: str, collection: str | None = None
    ) -> tuple[_FakeDocumentRecord, ...]:
        return tuple(
            record
            for record in self.records
            if record.corpus == corpus and (collection is None or record.collection == collection)
        )


class _LegacyProjectionBlockedDocumentRegistry(_FakeDocumentRegistry):
    def __init__(self, *, scope_keys: dict[tuple[str, str], tuple[str, ...]]) -> None:
        super().__init__()
        self.scope_keys = scope_keys

    def list_by_scope(self, corpus: str, collection: str | None = None) -> tuple[object, ...]:
        raise ValueError(
            "registry payload contains unsupported authorization projection keys: acl_groups, campus_scope"
        )

    def list_processed_object_keys_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[str, ...]:
        if collection is None:
            keys: list[str] = []
            for (scope_corpus, _), scope_keys in self.scope_keys.items():
                if scope_corpus == corpus:
                    keys.extend(scope_keys)
            return tuple(keys)
        return self.scope_keys.get((corpus, collection), ())


class _MutableFakeDocumentRegistry(_FakeDocumentRegistry):
    def __init__(self, *records: DocumentRegistryRecord) -> None:
        super().__init__()
        self.records: dict[tuple[str, str, str], DocumentRegistryRecord] = {
            (record.document_id, record.revision_track, record.version_id): record
            for record in records
        }

    def list_by_corpus(self, corpus: str) -> tuple[DocumentRegistryRecord, ...]:
        return tuple(record for record in self.records.values() if record.corpus == corpus)

    def list_by_scope(
        self, corpus: str, collection: str | None = None
    ) -> tuple[DocumentRegistryRecord, ...]:
        return tuple(
            record
            for record in self.records.values()
            if record.corpus == corpus and (collection is None or record.collection == collection)
        )

    def upsert(self, record: DocumentRegistryRecord) -> None:
        self.records[(record.document_id, record.revision_track, record.version_id)] = record

    def upsert_many(self, records: tuple[DocumentRegistryRecord, ...]) -> None:
        for record in records:
            self.upsert(record)


__all__ = [name for name in globals() if not name.startswith("__")]
