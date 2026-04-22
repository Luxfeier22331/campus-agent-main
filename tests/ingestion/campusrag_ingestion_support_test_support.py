from __future__ import annotations

import hashlib
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION
from campus_ingestion_core.campusrag_ingestion_artifacts import (
    ResolvedDocumentArtifactKeys,
    build_document_processed_object_keys,
    parse_document_import_stub,
    resolve_document_artifact_keys,
    serialize_document_import_stub,
)
from campus_ingestion_core.campusrag_ingestion_authorization import (
    apply_authorization_projection_metadata,
    load_metadata_from_bytes,
)
from campus_ingestion_core.campusrag_ingestion_metadata import (
    derive_document_title,
    derive_document_year,
    derive_source_uri,
    resolved_raw_asset,
)
from campus_ingestion_core.campusrag_ingestion_refresh import (
    artifact_bucket_for_key,
    registry_record_needs_refresh,
)
from campus_ingestion_core.campusrag_ingestion_registry_state import (
    apply_current_promotion,
)
from campus_ingestion_core.campusrag_ingestion_sources import (
    build_source_observation,
    document_semantic_hash,
    merge_equivalent_source_record,
)
from campus_ingestion_core.campusrag_ingestion_stage_payload import (
    build_registry_record_from_stage_payload,
)
from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    S3ObjectStoreWriter,
    collect_import_document_stats,
    persist_import_documents,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.object_store import build_source_truth_artifact_key
from campus_ingestion_core.settings import ObjectStoreSettings


def _metadata(document_id: str, version_id: str) -> dict[str, object]:
    return {
        "document_id": document_id,
        "version_id": version_id,
        "entitlement_groups": [],
    }


def _document_input(
    *,
    document_id: str,
    version_id: str,
    body: str,
    revision_track: str = "source-faithful",
    is_current: bool = False,
    source_channel: str = "pdf_ocr",
    source_url: str | None = None,
    import_source: str = "provider_response_replay",
) -> DocumentImportInput:
    metadata = _metadata(document_id, version_id)
    if source_url is not None:
        metadata["source_url"] = source_url
    return DocumentImportInput(
        source_label=f"{document_id}.jsonl",
        document_units_bytes=body.encode("utf-8"),
        provider_response_bytes=None,
        canonical_markdown_bytes=None,
        metadata=metadata,
        import_source=import_source,
        revision_track=revision_track,
        source_channel=source_channel,
        is_current=is_current,
        corpus="regulations",
        collection="student_rules",
        title=document_id.split(":")[-1],
        year="2026",
    )


def _record(
    *,
    document_id: str,
    version_id: str,
    content_hash: str,
    ingestion_timestamp: str = "2026-03-25T00:00:00+00:00",
    revision_track: str = "source-faithful",
    is_current: bool = False,
    status: str = "active",
    source_channel: str = "pdf_ocr",
    source_uri: str | None = None,
    import_source: str = "provider_response_replay",
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track=revision_track,
        version_id=version_id,
        source_uri=source_uri or f"campusrag://import/{document_id}/{version_id}",
        content_hash=content_hash,
        corpus="regulations",
        collection="student_rules",
        cleaning_policy_version="student_rules_cleaning_v1",
        entitlement_groups=(),
        visibility_scope=None,
        status=status,
        ingestion_timestamp=ingestion_timestamp,
        parser_version="campusrag-import-v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel=source_channel,
        is_current=is_current,
        document_units_object_key=f"regulations/documents/student_rules/{document_id}/{version_id}/document-units.jsonl",
        processed_object_keys=(
            f"regulations/documents/student_rules/{document_id}/{version_id}/document-units.jsonl",
        ),
        import_source=import_source,
    )


class _FakeWriter:
    def __init__(self, *, existing_objects: tuple[tuple[str, str], ...] = ()) -> None:
        self.puts: list[tuple[str, str]] = []
        self.objects = {key: b"" for key in existing_objects}

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.puts.append((bucket, key))
        self.objects[(bucket, key)] = data

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        try:
            return self.objects[(bucket, key)]
        except KeyError as exc:
            raise FileNotFoundError(key) from exc


class _FakeRawAssetRegistry:
    def get(self, raw_asset_id: str, raw_version_id: str) -> None:
        return None

    def upsert(self, record: object) -> None:
        raise AssertionError("raw asset upsert should not be called in this test")


class _SpyDocumentRegistry:
    def __init__(self, records: tuple[DocumentRegistryRecord, ...]) -> None:
        self.records = records
        self.list_by_scope_calls: list[tuple[str, str | None]] = []
        self.upsert_calls: list[DocumentRegistryRecord] = []
        self.upsert_many_calls: list[tuple[DocumentRegistryRecord, ...]] = []
        self.replace_scope_calls: list[tuple[str, str, tuple[DocumentRegistryRecord, ...]]] = []

    def list_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]:
        self.list_by_scope_calls.append((corpus, collection))
        return self.records

    def upsert(self, record: DocumentRegistryRecord) -> None:
        self.upsert_calls.append(record)

    def upsert_many(self, records: tuple[DocumentRegistryRecord, ...]) -> None:
        self.upsert_many_calls.append(records)

    def replace_scope(
        self,
        corpus: str,
        collection: str,
        records: tuple[DocumentRegistryRecord, ...],
    ) -> None:
        self.replace_scope_calls.append((corpus, collection, records))


class _LegacyProjectionBlockedScopeRefreshRegistry(_SpyDocumentRegistry):
    def list_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]:
        self.list_by_scope_calls.append((corpus, collection))
        raise ValueError(
            "registry payload contains unsupported authorization projection keys: acl_groups, campus_scope"
        )

    def list_processed_object_keys_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[str, ...]:
        return ()


class _ImportablePrefetchRegistry(_SpyDocumentRegistry):
    def __init__(self, records: tuple[DocumentRegistryRecord, ...] = ()) -> None:
        super().__init__(records=records)
        self.importable_scope_calls: list[tuple[str, str | None]] = []

    def list_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]:
        self.list_by_scope_calls.append((corpus, collection))
        raise AssertionError(
            "list_by_scope should not be used when importable scope prefetch is available"
        )

    def list_importable_scope_records_by_scope(
        self,
        corpus: str,
        collection: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]:
        self.importable_scope_calls.append((corpus, collection))
        return self.records


class _FakeS3Client:
    def __init__(self, name: str) -> None:
        self.name = name
        self.put_calls: list[dict[str, object]] = []
        self.get_calls: list[dict[str, object]] = []
        self.closed = False
        self.objects: dict[tuple[str, str], bytes] = {}

    def put_object(self, **kwargs: object) -> None:
        self.put_calls.append(kwargs)
        bucket = str(kwargs["Bucket"])
        key = str(kwargs["Key"])
        body = kwargs["Body"]
        assert isinstance(body, bytes)
        self.objects[(bucket, key)] = body

    def get_object(self, **kwargs: object) -> dict[str, object]:
        self.get_calls.append(kwargs)
        bucket = str(kwargs["Bucket"])
        key = str(kwargs["Key"])
        payload = self.objects[(bucket, key)]

        class _Body:
            def __init__(self, data: bytes) -> None:
                self._data = data

            def read(self) -> bytes:
                return self._data

        return {"Body": _Body(payload)}

    def close(self) -> None:
        self.closed = True


class _CampusragIngestionSupportBase(unittest.TestCase):
    def setUp(self) -> None:
        self.object_store = ObjectStoreSettings(
            endpoint="http://localhost:9000",
            access_key="minioadmin",
            secret_key="minioadmin",
        )


__all__ = [
    "DEFAULT_POLICY_PROJECTION_VERSION",
    "DocumentImportInput",
    "DocumentRegistryRecord",
    "Mock",
    "ObjectStoreSettings",
    "Path",
    "ResolvedDocumentArtifactKeys",
    "S3ObjectStoreWriter",
    "TemporaryDirectory",
    "_CampusragIngestionSupportBase",
    "_FakeRawAssetRegistry",
    "_FakeS3Client",
    "_FakeWriter",
    "_ImportablePrefetchRegistry",
    "_LegacyProjectionBlockedScopeRefreshRegistry",
    "_SpyDocumentRegistry",
    "_document_input",
    "_metadata",
    "_record",
    "apply_authorization_projection_metadata",
    "apply_current_promotion",
    "artifact_bucket_for_key",
    "build_document_processed_object_keys",
    "build_registry_record_from_stage_payload",
    "build_source_observation",
    "build_source_truth_artifact_key",
    "collect_import_document_stats",
    "derive_document_title",
    "derive_document_year",
    "derive_source_uri",
    "document_semantic_hash",
    "hashlib",
    "load_metadata_from_bytes",
    "merge_equivalent_source_record",
    "parse_document_import_stub",
    "patch",
    "persist_import_documents",
    "registry_record_needs_refresh",
    "resolve_document_artifact_keys",
    "resolved_raw_asset",
    "serialize_document_import_stub",
    "unittest",
]
