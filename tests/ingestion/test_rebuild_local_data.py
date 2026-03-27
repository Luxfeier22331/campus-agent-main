from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from campus_ingestion_core.local_rebuild import (
    RebuildRequest,
    SourceArtifactsMigrationRequest,
    StudentHandbookSourceAssetRequest,
    _build_qdrant_client,
    _resolve_ingestion_qdrant_timeout_seconds,
    migrate_source_artifacts_to_canonical_source_bucket,
    migrate_student_handbook_source_faithful,
    rebuild_local_data,
)
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord
from campus_retrieval_core.settings import RetrievalSettings

SOURCE_BUCKET = "campus-rag-source"
DERIVED_BUCKET = "campus-rag-derived"


class _FakeObjectStoreAdmin:
    def __init__(self) -> None:
        self.cleared_prefixes: list[tuple[str, str, tuple[str, ...]]] = []
        self.objects: dict[tuple[str, str], bytes] = {}
        self.puts: list[tuple[str, str]] = []

    def delete_prefix(self, *, bucket: str, prefix: str, exclude_keys: tuple[str, ...] = ()) -> None:
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
        self.reset_collections: list[str] = []

    def reset_collection(self, collection_name: str) -> None:
        self.reset_collections.append(collection_name)


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

    def list_by_scope(self, corpus: str, collection: str | None = None) -> tuple[RawAssetRecord, ...]:
        return tuple(
            record
            for record in self.records.values()
            if record.corpus == corpus and (collection is None or record.collection == collection)
        )


class _FakeDocumentRecord:
    def __init__(self, *, corpus: str, collection: str, processed_object_keys: tuple[str, ...]) -> None:
        self.corpus = corpus
        self.collection = collection
        self.processed_object_keys = processed_object_keys


class _FakeDocumentRegistryWithRecords(_FakeDocumentRegistry):
    def __init__(self, *records: _FakeDocumentRecord) -> None:
        super().__init__()
        self.records = records

    def list_by_corpus(self, corpus: str) -> tuple[_FakeDocumentRecord, ...]:
        return tuple(record for record in self.records if record.corpus == corpus)

    def list_by_scope(self, corpus: str, collection: str | None = None) -> tuple[_FakeDocumentRecord, ...]:
        return tuple(
            record
            for record in self.records
            if record.corpus == corpus and (collection is None or record.collection == collection)
        )


class _MutableFakeDocumentRegistry(_FakeDocumentRegistry):
    def __init__(self, *records: DocumentRegistryRecord) -> None:
        super().__init__()
        self.records: dict[tuple[str, str, str], DocumentRegistryRecord] = {
            (record.document_id, record.revision_track, record.version_id): record
            for record in records
        }

    def list_by_corpus(self, corpus: str) -> tuple[DocumentRegistryRecord, ...]:
        return tuple(record for record in self.records.values() if record.corpus == corpus)

    def list_by_scope(self, corpus: str, collection: str | None = None) -> tuple[DocumentRegistryRecord, ...]:
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


class RebuildLocalDataTest(unittest.TestCase):
    def test_resolve_ingestion_qdrant_timeout_defaults_to_offline_budget(self) -> None:
        self.assertEqual(
            _resolve_ingestion_qdrant_timeout_seconds(source={}, default_timeout_seconds=10.0),
            60.0,
        )
        self.assertEqual(
            _resolve_ingestion_qdrant_timeout_seconds(source={}, default_timeout_seconds=90.0),
            90.0,
        )

    def test_resolve_ingestion_qdrant_timeout_honors_override(self) -> None:
        self.assertEqual(
            _resolve_ingestion_qdrant_timeout_seconds(
                source={"INGESTION_QDRANT_TIMEOUT_SECONDS": "25"},
                default_timeout_seconds=10.0,
            ),
            25.0,
        )
        with self.assertRaisesRegex(ValueError, "INGESTION_QDRANT_TIMEOUT_SECONDS"):
            _resolve_ingestion_qdrant_timeout_seconds(
                source={"INGESTION_QDRANT_TIMEOUT_SECONDS": "0"},
                default_timeout_seconds=10.0,
            )

    @patch("campus_ingestion_core.local_rebuild.QdrantClient")
    def test_build_qdrant_client_uses_ingestion_timeout_budget(self, qdrant_client) -> None:
        settings = RetrievalSettings(
            qdrant_url="https://qdrant.example.com",
            qdrant_api_key="test-key",
            qdrant_timeout_seconds=10.0,
            qdrant_collection="student_handbook",
        )

        client = _build_qdrant_client(settings, source={})

        self.assertIs(client, qdrant_client.return_value)
        qdrant_client.assert_called_once_with(
            url="https://qdrant.example.com",
            api_key="test-key",
            timeout=60.0,
        )

    def test_rebuild_provider_response_replay_accepts_typed_request_without_source_specific_env(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        document_registry = _FakeDocumentRegistry()
        raw_asset_registry = _FakeRawAssetRegistry()
        calls: list[dict[str, str]] = []

        report = rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            },
            request=RebuildRequest(
                corpus="regulations",
                collection="student_handbook",
                import_mode="provider_response_replay",
                raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            ),
            object_store=object_store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            import_runner=lambda **kwargs: calls.append(kwargs["env"]) or {"status": "replay"},
        )

        self.assertEqual(object_store.cleared_prefixes, [])
        self.assertEqual(document_registry.deleted_scopes, [])
        self.assertEqual(raw_asset_registry.deleted_scopes, [])
        self.assertEqual(len(calls), 1)
        self.assertEqual(
            calls[0]["REBUILD_PROVIDER_RESPONSE_KEY"],
            "ocr/pdf_ocr/student-handbook/2018/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider-response.jsonl",
        )
        self.assertEqual(
            report.import_context["REBUILD_PROVIDER_RESPONSE_KEY"],
            "ocr/pdf_ocr/student-handbook/2018/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider-response.jsonl",
        )
        self.assertEqual(
            report.import_context["INGESTION_SPLIT_MANIFEST_PATH"],
            str(Path("configs/ingestion/regulations/student_handbook/split-manifest.v1.json").resolve()),
        )
        self.assertNotIn("OBJECT_STORE_SECRET_KEY", report.import_context)

    def test_rebuild_provider_response_replay_clears_declared_downstream_projection_artifacts(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        projection_config = {
            "schema_version": "student_handbook_source_projections_v1",
            "source_corpus": "regulations",
            "source_collection": "student_handbook",
            "raw_asset_id": "asset:student-handbook-pdf",
            "source_truth_artifacts": [
                "provider-response.jsonl",
                "layout-elements.jsonl",
                "split-manifest.v1.json",
                "per-document source rows",
            ],
            "rebuild_boundary": "source_truth",
            "rebuild_rule": "When canonical source truth exists, downstream rebuild must reuse source truth and must not return to raw.",
            "derived_document_fields": [
                "projection_name",
                "derived_from_raw_asset_id",
                "derived_from_raw_version_id",
                "derived_from",
                "derived_from_document_id",
                "parent_document_id",
                "attachment_kind",
                "attachment_role",
            ],
            "projections": [
                {
                    "projection_name": "student_handbook_primary_documents",
                    "target_corpus": "regulations",
                    "target_collection": "student_handbook",
                    "projection_family": "primary_documents",
                    "replay_from_source_truth": True,
                    "derived_from": "source_truth",
                    "derived_from_document_id": None,
                    "parent_document_id": None,
                    "attachment_kind": None,
                    "attachment_role": None,
                },
                {
                    "projection_name": "handbook_navigation_service_catalog",
                    "target_corpus": "campus_services",
                    "target_collection": "service_catalog",
                    "projection_family": "derived_documents",
                    "replay_from_source_truth": True,
                    "derived_from": "source_truth",
                    "derived_from_document_id": "handbook:66f91543748400ae59b3f9265353a0538088028a",
                    "parent_document_id": "handbook:66f91543748400ae59b3f9265353a0538088028a",
                    "attachment_kind": "navigation_like",
                    "attachment_role": "service_navigation_document",
                    "target_title": "中央民族大学学生公寓管理工作流程",
                    "migration_reason": "handbook_navigation_document",
                },
            ],
        }
        source_key = (
            "ocr/pdf_ocr/student-handbook/undated/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider-response.jsonl"
        )
        with TemporaryDirectory() as temp_dir:
            projection_config_path = Path(temp_dir) / "source-projections.v1.json"
            projection_config_path.write_text(json.dumps(projection_config, ensure_ascii=False, indent=2), encoding="utf-8")

            document_registry = _FakeDocumentRegistryWithRecords(
                _FakeDocumentRecord(
                    corpus="regulations",
                    collection="student_handbook",
                    processed_object_keys=(
                        "regulations/documents/student_handbook/doc-a/source-faithful/2018/canonical.md",
                        "regulations/documents/student_handbook/doc-a/source-faithful/2018/document-units.jsonl",
                    ),
                ),
                _FakeDocumentRecord(
                    corpus="campus_services",
                    collection="service_catalog",
                    processed_object_keys=(
                        "campus_services/documents/service_catalog/"
                        "中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/canonical.md",
                        "campus_services/documents/service_catalog/"
                        "中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/document-units.jsonl",
                    ),
                ),
            )

            rebuild_local_data(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_handbook",
                    "REBUILD_IMPORT_MODE": "provider_response_replay",
                    "REBUILD_PROVIDER_RESPONSE_KEY": source_key,
                    "HANDBOOK_SOURCE_PROJECTIONS_PATH": str(projection_config_path),
                },
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=_FakeRawAssetRegistry(),
                import_runner=lambda **kwargs: {"status": "replay"},
            )

        cleared_prefixes = [prefix for _, prefix, _ in object_store.cleared_prefixes]
        self.assertIn(
            "campus_services/documents/service_catalog/"
            "中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/canonical.md",
            cleared_prefixes,
        )
        self.assertIn(
            "campus_services/documents/service_catalog/"
            "中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/document-units.jsonl",
            cleared_prefixes,
        )

    def test_rebuild_clears_minio_and_registry_without_touching_qdrant_by_default(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        qdrant = _FakeQdrantAdmin()
        document_registry = _FakeDocumentRegistryWithRecords(
            _FakeDocumentRecord(
                corpus="regulations",
                collection="student_handbook",
                processed_object_keys=(
                    "ocr/pdf_ocr/student-handbook/undated/sha256/raw-001/provider-response.jsonl",
                    "source-truth/pdf_ocr/student-handbook/undated/sha256/raw-001/layout-elements.jsonl",
                    "regulations/documents/student_handbook/test-001--test-001/source-faithful/2018/canonical.md",
                    "regulations/documents/student_handbook/test-001--test-001/source-faithful/2018/document-units.jsonl",
                ),
            )
        )
        raw_asset_registry = _FakeRawAssetRegistry()
        raw_asset_registry.upsert(
            RawAssetRecord(
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:raw-001",
                corpus="regulations",
                collection="student_handbook",
                raw_source_uri="s3://upstream/student-handbook.pdf",
                content_hash="raw-001",
                source_filename="student-handbook.pdf",
                object_key="pdf/student-handbook/undated/sha256/raw-001/student-handbook.pdf",
                ingestion_timestamp="2026-03-24T00:00:00+00:00",
                import_source="raw_online_ocr",
            )
        )
        calls: list[dict[str, str]] = []

        report = rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                "OBJECT_STORE_BUCKET_DERIVED": DERIVED_BUCKET,
                "REBUILD_IMPORT_MODE": "raw_online_ocr",
                "QDRANT_COLLECTION": "student_handbook",
            },
            object_store=object_store,
            qdrant_admin=qdrant,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            import_runner=lambda **kwargs: calls.append(kwargs["env"]) or {"status": "ok"},
        )

        self.assertEqual(
            object_store.cleared_prefixes,
            [
                (
                    DERIVED_BUCKET,
                    "regulations/documents/student_handbook/test-001--test-001/source-faithful/2018/canonical.md",
                    (),
                ),
                (
                    DERIVED_BUCKET,
                    "regulations/documents/student_handbook/test-001--test-001/source-faithful/2018/document-units.jsonl",
                    (),
                ),
            ],
        )
        self.assertEqual(qdrant.reset_collections, [])
        self.assertEqual(document_registry.deleted_scopes, [("regulations", "student_handbook")])
        self.assertEqual(raw_asset_registry.deleted_scopes, [])
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["REBUILD_IMPORT_MODE"], "raw_online_ocr")
        self.assertEqual(report.import_result, {"status": "ok"})
        self.assertEqual(report.import_context["REBUILD_IMPORT_MODE"], "raw_online_ocr")
        self.assertNotIn("OBJECT_STORE_SECRET_KEY", report.import_context)

    def test_rebuild_can_optionally_reset_qdrant_collection(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        qdrant = _FakeQdrantAdmin()

        rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "REBUILD_IMPORT_MODE": "raw_online_ocr",
                "QDRANT_COLLECTION": "student_handbook",
                "REBUILD_RESET_QDRANT": "1",
            },
            object_store=object_store,
            qdrant_admin=qdrant,
            document_registry=_FakeDocumentRegistry(),
            raw_asset_registry=_FakeRawAssetRegistry(),
            import_runner=lambda **kwargs: {"status": "ok"},
        )

        self.assertEqual(qdrant.reset_collections, ["student_handbook"])

    def test_rebuild_provider_response_replay_does_not_touch_qdrant_without_explicit_flags(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        qdrant = _FakeQdrantAdmin()
        source_key = (
            "ocr/pdf_ocr/student-handbook/undated/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider-response.jsonl"
        )

        rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "INGESTION_CORPUS": "regulations",
                "INGESTION_COLLECTION": "student_handbook",
                "REBUILD_IMPORT_MODE": "provider_response_replay",
                "REBUILD_PROVIDER_RESPONSE_KEY": source_key,
            },
            object_store=object_store,
            qdrant_admin=qdrant,
            document_registry=_FakeDocumentRegistry(),
            raw_asset_registry=_FakeRawAssetRegistry(),
            import_runner=lambda **kwargs: {"status": "replay"},
        )

        self.assertEqual(qdrant.reset_collections, [])

    def test_rebuild_uses_ingestion_corpus_prefix_for_curriculum_plan(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        document_registry = _FakeDocumentRegistryWithRecords(
            _FakeDocumentRecord(
                corpus="curriculum",
                collection="curriculum_plan",
                processed_object_keys=(
                    "ocr/pdf_ocr/curriculum-plan-master/undated/sha256/raw-001/provider-response.jsonl",
                    "curriculum/documents/curriculum_plan/plan-001--plan-001/source-faithful/undated/document-units.jsonl",
                ),
            )
        )
        raw_asset_registry = _FakeRawAssetRegistry()
        raw_asset_registry.upsert(
            RawAssetRecord(
                raw_asset_id="asset:curriculum-plan-master-pdf",
                raw_version_id="sha256:raw-001",
                corpus="curriculum",
                collection="curriculum_plan",
                raw_source_uri="s3://upstream/curriculum-plan.pdf",
                content_hash="raw-001",
                source_filename="curriculum-plan.pdf",
                object_key="pdf/curriculum-plan-master/undated/sha256/raw-001/curriculum-plan.pdf",
                ingestion_timestamp="2026-03-24T00:00:00+00:00",
                import_source="raw_online_ocr",
            )
        )

        rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "REBUILD_IMPORT_MODE": "raw_online_ocr",
                "INGESTION_CORPUS": "curriculum",
                "INGESTION_COLLECTION": "curriculum_plan",
            },
            object_store=object_store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            import_runner=lambda **kwargs: {"status": "ok"},
        )

        self.assertEqual(
            object_store.cleared_prefixes,
            [
                (
                    DERIVED_BUCKET,
                    "curriculum/documents/curriculum_plan/plan-001--plan-001/source-faithful/undated/document-units.jsonl",
                    (),
                ),
            ],
        )

    def test_rebuild_local_data_requires_explicit_import_mode(self) -> None:
        with self.assertRaisesRegex(ValueError, "REBUILD_IMPORT_MODE"):
            rebuild_local_data(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                },
                object_store=_FakeObjectStoreAdmin(),
                import_runner=lambda **kwargs: {"status": "ok"},
            )

    def test_rebuild_local_data_rejects_removed_existing_ocr_mode(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported REBUILD_IMPORT_MODE: existing_ocr"):
            rebuild_local_data(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "REBUILD_IMPORT_MODE": "existing_ocr",
                },
                object_store=_FakeObjectStoreAdmin(),
                import_runner=lambda **kwargs: {"status": "ok"},
            )

    def test_rebuild_local_data_requires_canonical_registry_env_when_runtime_registries_are_not_injected(self) -> None:
        with self.assertRaisesRegex(ValueError, "DOCUMENT_REGISTRY_DATABASE_URL is required"):
            rebuild_local_data(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "REBUILD_IMPORT_MODE": "raw_online_ocr",
                },
                object_store=_FakeObjectStoreAdmin(),
                import_runner=lambda **kwargs: {"status": "ok"},
            )

    def test_rebuild_local_data_deletes_registry_by_corpus_and_can_dispatch_raw_online_ocr(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        document_registry = _FakeDocumentRegistry()
        raw_asset_registry = _FakeRawAssetRegistry()
        calls: list[dict[str, str]] = []

        report = rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "INGESTION_CORPUS": "curriculum",
                "INGESTION_COLLECTION": "curriculum_plan",
                "REBUILD_IMPORT_MODE": "raw_online_ocr",
            },
            object_store=object_store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            import_runner=lambda **kwargs: calls.append(kwargs["env"]) or {"status": "raw"},
        )

        self.assertEqual(document_registry.deleted_scopes, [("curriculum", "curriculum_plan")])
        self.assertEqual(raw_asset_registry.deleted_scopes, [])
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["REBUILD_IMPORT_MODE"], "raw_online_ocr")
        self.assertEqual(report.import_result, {"status": "raw"})
        self.assertEqual(report.import_context["REBUILD_IMPORT_MODE"], "raw_online_ocr")
        self.assertNotIn("OBJECT_STORE_SECRET_KEY", report.import_context)

    def test_rebuild_provider_response_replay_preserves_source_key_in_processed_bucket(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        document_registry = _FakeDocumentRegistry()
        raw_asset_registry = _FakeRawAssetRegistry()
        calls: list[dict[str, str]] = []
        source_key = (
            "ocr/pdf_ocr/student-handbook/undated/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider-response.jsonl"
        )

        report = rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "INGESTION_CORPUS": "regulations",
                "INGESTION_COLLECTION": "student_handbook",
                "REBUILD_IMPORT_MODE": "provider_response_replay",
                "REBUILD_PROVIDER_RESPONSE_KEY": source_key,
            },
            object_store=object_store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            import_runner=lambda **kwargs: calls.append(kwargs["env"]) or {"status": "replay"},
        )

        self.assertEqual(object_store.cleared_prefixes, [])
        self.assertEqual(document_registry.deleted_scopes, [])
        self.assertEqual(raw_asset_registry.deleted_scopes, [])
        self.assertEqual(len(calls), 1)
        self.assertEqual(
            calls[0]["REBUILD_PROVIDER_RESPONSE_KEY"],
            "ocr/pdf_ocr/student-handbook/2018/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider-response.jsonl",
        )
        self.assertEqual(report.import_result, {"status": "replay"})
        self.assertEqual(
            report.import_context["REBUILD_PROVIDER_RESPONSE_KEY"],
            "ocr/pdf_ocr/student-handbook/2018/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider-response.jsonl",
        )
        self.assertNotIn("OBJECT_STORE_SECRET_KEY", report.import_context)

    def test_migrate_student_handbook_source_faithful_renames_raw_asset_and_dispatches_rebuild(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        raw_asset_registry = _FakeRawAssetRegistry()
        old_raw_key = (
            "pdf/student-handbook/undated/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/student-handbook.pdf"
        )
        provider_response_key = (
            "ocr/pdf_ocr/student-handbook/undated/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider-response.jsonl"
        )
        object_store.objects[(SOURCE_BUCKET, old_raw_key)] = b"%PDF-1.4 handbook"
        raw_asset_registry.upsert(
            RawAssetRecord(
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                corpus="regulations",
                collection="student_handbook",
                raw_source_uri="s3://campus-rag-source/pdf/student-handbook/student-handbook.pdf",
                content_hash="b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                source_filename="student-handbook.pdf",
                object_key=old_raw_key,
                ingestion_timestamp="2026-03-24T00:00:00+00:00",
                import_source="seed",
            )
        )
        calls: list[dict[str, object]] = []

        with patch("campus_ingestion_core.local_rebuild.rebuild_local_data") as rebuild:
            rebuild.side_effect = (
                lambda **kwargs: calls.append(kwargs)
                or {"status": "rebuilt", "source_pdf": kwargs["env"]["REPLAY_SOURCE_PDF"]}
            )
            report = migrate_student_handbook_source_faithful(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                    "OBJECT_STORE_BUCKET_DERIVED": DERIVED_BUCKET,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_handbook",
                    "INGESTION_SPLIT_MANIFEST_PATH": "configs/ingestion/regulations/student_handbook/split-manifest.v1.json",
                    "REBUILD_PROVIDER_RESPONSE_KEY": provider_response_key,
                },
                object_store=object_store,
                raw_asset_registry=raw_asset_registry,
                document_registry=_FakeDocumentRegistry(),
            )

        new_raw_key = (
            "pdf/student-handbook/2018/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/学生手册_2018.pdf"
        )
        self.assertEqual(report.canonical_raw_filename, "学生手册_2018.pdf")
        self.assertEqual(report.previous_raw_object_key, old_raw_key)
        self.assertEqual(report.canonical_raw_object_key, new_raw_key)
        self.assertEqual(raw_asset_registry.get("asset:student-handbook-pdf", "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1").source_filename, "学生手册_2018.pdf")
        self.assertIn((SOURCE_BUCKET, new_raw_key), object_store.puts)
        self.assertEqual(calls[0]["request"].import_mode, "provider_response_replay")
        self.assertEqual(calls[0]["env"]["REPLAY_SOURCE_PDF"], "学生手册_2018.pdf")

    def test_migrate_student_handbook_source_faithful_refreshes_legacy_scope_when_raw_key_is_already_canonical(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        raw_asset_registry = _FakeRawAssetRegistry()
        canonical_raw_key = (
            "pdf/student-handbook/2018/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/学生手册_2018.pdf"
        )
        provider_response_key = (
            "ocr/pdf_ocr/student-handbook/2018/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider-response.jsonl"
        )
        raw_asset_registry.records[
            ("asset:student-handbook-pdf", "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1")
        ] = SimpleNamespace(
            raw_asset_id="asset:student-handbook-pdf",
            raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            corpus="student_handbook",
            collection="student_handbook",
            raw_source_uri="s3://campus-rag-source/pdf/student-handbook/学生手册_2018.pdf",
            content_hash="b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            source_filename="学生手册_2018.pdf",
            object_key=canonical_raw_key,
            ingestion_timestamp="2026-03-24T00:00:00+00:00",
            import_source="seed",
        )
        calls: list[dict[str, object]] = []

        with patch("campus_ingestion_core.local_rebuild.rebuild_local_data") as rebuild:
            rebuild.side_effect = (
                lambda **kwargs: calls.append(kwargs)
                or {"status": "rebuilt", "source_pdf": kwargs["env"]["REPLAY_SOURCE_PDF"]}
            )
            report = migrate_student_handbook_source_faithful(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                    "OBJECT_STORE_BUCKET_DERIVED": DERIVED_BUCKET,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_handbook",
                    "INGESTION_SPLIT_MANIFEST_PATH": "configs/ingestion/regulations/student_handbook/split-manifest.v1.json",
                    "REBUILD_PROVIDER_RESPONSE_KEY": provider_response_key,
                },
                object_store=object_store,
                raw_asset_registry=raw_asset_registry,
                document_registry=_FakeDocumentRegistry(),
            )

        refreshed = raw_asset_registry.get(
            "asset:student-handbook-pdf",
            "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
        )
        self.assertEqual(report.canonical_raw_object_key, canonical_raw_key)
        self.assertIsNotNone(refreshed)
        self.assertEqual(refreshed.corpus, "regulations")
        self.assertEqual(refreshed.collection, "student_handbook")
        self.assertEqual(refreshed.source_filename, "学生手册_2018.pdf")
        self.assertEqual(refreshed.object_key, canonical_raw_key)
        self.assertEqual(object_store.puts, [])
        self.assertEqual(object_store.cleared_prefixes, [])
        self.assertEqual(calls[0]["request"].import_mode, "provider_response_replay")

    def test_migrate_student_handbook_source_faithful_accepts_source_asset_request(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        raw_asset_registry = _FakeRawAssetRegistry()
        canonical_raw_key = (
            "pdf/student-handbook/2018/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/学生手册_2018.pdf"
        )
        raw_asset_registry.records[
            ("asset:student-handbook-pdf", "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1")
        ] = SimpleNamespace(
            raw_asset_id="asset:student-handbook-pdf",
            raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            corpus="regulations",
            collection="student_handbook",
            raw_source_uri="s3://campus-rag-source/pdf/student-handbook/学生手册_2018.pdf",
            content_hash="b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            source_filename="学生手册_2018.pdf",
            object_key=canonical_raw_key,
            ingestion_timestamp="2026-03-24T00:00:00+00:00",
            import_source="seed",
        )
        calls: list[dict[str, object]] = []

        with patch("campus_ingestion_core.local_rebuild.rebuild_local_data") as rebuild:
            rebuild.side_effect = (
                lambda **kwargs: calls.append(kwargs)
                or {"status": "rebuilt", "source_pdf": kwargs["env"]["REPLAY_SOURCE_PDF"]}
            )
            report = migrate_student_handbook_source_faithful(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                    "OBJECT_STORE_BUCKET_DERIVED": DERIVED_BUCKET,
                },
                request=StudentHandbookSourceAssetRequest(
                    raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                ),
                object_store=object_store,
                raw_asset_registry=raw_asset_registry,
                document_registry=_FakeDocumentRegistry(),
            )

        self.assertEqual(report.canonical_raw_object_key, canonical_raw_key)
        self.assertEqual(calls[0]["request"].import_mode, "provider_response_replay")
        self.assertEqual(
            calls[0]["request"].raw_version_id,
            "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
        )
        self.assertEqual(
            calls[0]["request"].source_pdf,
            "学生手册_2018.pdf",
        )
        self.assertEqual(
            rebuild.call_args.kwargs["request"].raw_version_id,
            "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
        )
        self.assertEqual(
            rebuild.call_args.kwargs["env"]["REPLAY_SOURCE_PDF"],
            "学生手册_2018.pdf",
        )
        self.assertEqual(
            calls[0]["request"].raw_asset_id,
            "asset:student-handbook-pdf",
        )

    def test_migrate_student_handbook_source_faithful_uses_runtime_manifest_override_when_building_request_from_env(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        raw_asset_registry = _FakeRawAssetRegistry()
        override_raw_asset_id = "asset:override-handbook-pdf"
        raw_version_id = "sha256:overridehash001"
        canonical_raw_key = "pdf/override-handbook/2020/sha256/overridehash001/学生手册_2020.pdf"
        raw_asset_registry.records[(override_raw_asset_id, raw_version_id)] = SimpleNamespace(
            raw_asset_id=override_raw_asset_id,
            raw_version_id=raw_version_id,
            corpus="regulations",
            collection="student_handbook",
            raw_source_uri="s3://campus-rag-source/pdf/override-handbook/学生手册_2020.pdf",
            content_hash="overridehash001",
            source_filename="学生手册_2020.pdf",
            object_key=canonical_raw_key,
            ingestion_timestamp="2026-03-24T00:00:00+00:00",
            import_source="seed",
        )
        calls: list[dict[str, object]] = []

        with TemporaryDirectory() as temp_dir:
            split_manifest_path = Path(temp_dir) / "split-manifest.v1.json"
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": override_raw_asset_id,
                        "documents": [
                            {
                                "document_id": "handbook:test-override",
                                "title": "测试文档",
                                "handbook_section": "测试分组",
                                "page_start": 1,
                                "page_end": 1,
                                "source_uri": "campus-agent://regulations/student_handbook/docs/handbook:test-override",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            provider_response_key = (
                "ocr/pdf_ocr/override-handbook/2020/sha256/overridehash001/"
                "provider-response.jsonl"
            )

            with patch("campus_ingestion_core.local_rebuild.rebuild_local_data") as rebuild:
                rebuild.side_effect = (
                    lambda **kwargs: calls.append(kwargs)
                    or {"status": "rebuilt", "source_pdf": kwargs["env"]["REPLAY_SOURCE_PDF"]}
                )
                report = migrate_student_handbook_source_faithful(
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                        "OBJECT_STORE_BUCKET_DERIVED": DERIVED_BUCKET,
                        "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                        "REBUILD_PROVIDER_RESPONSE_KEY": provider_response_key,
                        "HANDBOOK_CANONICAL_RAW_FILENAME": "学生手册_2020.pdf",
                    },
                    object_store=object_store,
                    raw_asset_registry=raw_asset_registry,
                    document_registry=_FakeDocumentRegistry(),
                )

        self.assertEqual(report.canonical_raw_object_key, canonical_raw_key)
        self.assertEqual(calls[0]["request"].raw_asset_id, override_raw_asset_id)
        self.assertEqual(calls[0]["request"].raw_version_id, raw_version_id)
        self.assertEqual(calls[0]["env"]["REPLAY_SOURCE_PDF"], "学生手册_2020.pdf")

    def test_migrate_source_artifacts_to_canonical_source_bucket_moves_curriculum_legacy_source_objects(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        legacy_provider_key = (
            "curriculum/sources/pdf_ocr/curriculum-plan/2022/sha256/"
            "0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67/provider-response.jsonl"
        )
        legacy_layout_key = (
            "curriculum/sources/pdf_ocr/curriculum-plan/2022/sha256/"
            "0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67/layout-elements.jsonl"
        )
        object_store.objects[(DERIVED_BUCKET, legacy_provider_key)] = b'{"provider":true}\n'
        object_store.objects[(DERIVED_BUCKET, legacy_layout_key)] = b'{"layout":true}\n'
        record = DocumentRegistryRecord(
            document_id="plan:test-001",
            revision_track="source-faithful",
            version_id="sha256:test-001:split:test-001:abcd1234",
            source_uri="campus-agent://curriculum/curriculum_plan/docs/plan:test-001",
            content_hash="sha256:test-001",
            corpus="curriculum",
            collection="curriculum_plan",
            cleaning_policy_version="curriculum_plan_cleaning_v1",
            acl_groups=(),
            campus_scope=None,
            status="active",
            ingestion_timestamp="2026-03-27T00:00:00+00:00",
            parser_version="campusrag-import-v1",
            embedding_model="Qwen3-Embedding-4B",
            source_channel="pdf_ocr",
            provider_response_object_key=legacy_provider_key,
            document_units_object_key=(
                "curriculum/documents/curriculum_plan/test-001--test-001/source-faithful/2022/document-units.jsonl"
            ),
            processed_object_keys=(
                legacy_provider_key,
                legacy_layout_key,
                "curriculum/documents/curriculum_plan/test-001--test-001/source-faithful/2022/document-units.jsonl",
            ),
            import_source="provider_response_replay",
        )
        document_registry = _MutableFakeDocumentRegistry(record)

        report = migrate_source_artifacts_to_canonical_source_bucket(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                "OBJECT_STORE_BUCKET_DERIVED": DERIVED_BUCKET,
                "INGESTION_SPLIT_MANIFEST_PATH": "configs/ingestion/curriculum/curriculum_plan/split-manifest.v1.json",
            },
            request=SourceArtifactsMigrationRequest(
                corpus="curriculum",
                collection="curriculum_plan",
                raw_version_id="sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67",
            ),
            object_store=object_store,
            document_registry=document_registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
        )

        canonical_provider_key = (
            "ocr/pdf_ocr/curriculum-plan/2022/sha256/"
            "0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67/provider-response.jsonl"
        )
        canonical_layout_key = (
            "source-truth/pdf_ocr/curriculum-plan/2022/sha256/"
            "0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67/layout-elements.jsonl"
        )
        self.assertEqual(report.raw_asset_id, "asset:curriculum-plan-2022")
        self.assertTrue(report.provider_response_migrated)
        self.assertTrue(report.layout_elements_migrated)
        self.assertEqual(report.updated_document_record_count, 1)
        self.assertIn((SOURCE_BUCKET, canonical_provider_key), object_store.puts)
        self.assertIn((SOURCE_BUCKET, canonical_layout_key), object_store.puts)
        self.assertIn((SOURCE_BUCKET, canonical_provider_key), object_store.objects)
        self.assertIn((SOURCE_BUCKET, canonical_layout_key), object_store.objects)
        self.assertNotIn((DERIVED_BUCKET, legacy_provider_key), object_store.objects)
        self.assertNotIn((DERIVED_BUCKET, legacy_layout_key), object_store.objects)
        updated = next(iter(document_registry.records.values()))
        self.assertEqual(updated.provider_response_object_key, canonical_provider_key)
        self.assertEqual(
            updated.processed_object_keys,
            (
                canonical_provider_key,
                canonical_layout_key,
                "curriculum/documents/curriculum_plan/test-001--test-001/source-faithful/2022/document-units.jsonl",
            ),
        )


if __name__ == "__main__":
    unittest.main()
