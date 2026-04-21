from __future__ import annotations

import json
import unittest
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


class RebuildLocalDataTest(unittest.TestCase):
    def test_rematerialize_curriculum_program_semester_facts_local_rebuild_passes_requested_source_documents(
        self,
    ) -> None:
        with patch(
            "campus_ingestion_core.local_rebuild_support.materialize_curriculum_program_semester_facts_from_canonical_scope"
        ) as materialize:
            materialize.return_value = SimpleNamespace(materialized_document_count=2)

            report = rematerialize_curriculum_program_semester_facts_from_local_rebuild(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                },
                source_document_ids=(
                    "curriculum:法学（民族实验班）本科人才培养方案",
                    "curriculum:历史学（强基计划）本科人才培养方案",
                ),
            )

        materialize.assert_called_once_with(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            },
            object_store=None,
            registry=None,
            raw_asset_registry=None,
            split_manifest_documents=None,
            raw_asset_record=None,
            source_document_units_keys=None,
            source_document_ids=(
                "curriculum:法学（民族实验班）本科人才培养方案",
                "curriculum:历史学（强基计划）本科人才培养方案",
            ),
        )
        self.assertEqual(report.materialized_document_count, 2)

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

    @patch("campus_ingestion_core.local_rebuild_runtime.QdrantClient")
    def test_build_qdrant_client_uses_ingestion_timeout_budget(self, qdrant_client) -> None:
        settings = RetrievalSettings(
            qdrant_url="https://qdrant.example.com",
            qdrant_api_key="test-key",
            qdrant_timeout_seconds=10.0,
        )

        client = _build_qdrant_client(settings, source={})

        self.assertIs(client, qdrant_client.return_value)
        qdrant_client.assert_called_once_with(
            url="https://qdrant.example.com",
            api_key="test-key",
            timeout=60.0,
            cloud_inference=True,
            check_compatibility=False,
            trust_env=False,
        )

    def test_rebuild_provider_response_replay_accepts_typed_request_without_source_specific_env(
        self,
    ) -> None:
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

        cleared_prefixes = [prefix for _, prefix, _ in object_store.cleared_prefixes]
        self.assertIn(
            "campus_services/documents/contact_directory/"
            "中央民族大学校内常用电话--bf03f0bd/source-faithful/2018/canonical.md",
            cleared_prefixes,
        )
        self.assertIn(
            "campus_services/documents/service_catalog/"
            "中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/document-units.jsonl",
            cleared_prefixes,
        )
        self.assertNotIn(
            "campus_services/documents/service_catalog/"
            "中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/flow-graph.json",
            cleared_prefixes,
        )
        self.assertEqual(document_registry.deleted_scopes, [])
        self.assertEqual(raw_asset_registry.deleted_scopes, [])
        self.assertEqual(len(calls), 1)
        self.assertNotIn("REBUILD_PROVIDER_RESPONSE_KEY", calls[0])
        self.assertNotIn("REBUILD_PROVIDER_RESPONSE_KEY", report.import_context)
        self.assertEqual(
            report.import_context["INGESTION_SPLIT_MANIFEST_PATH"],
            str(
                Path(
                    "configs/ingestion/regulations/student_handbook/split-manifest.v1.json"
                ).resolve()
            ),
        )
        self.assertNotIn("OBJECT_STORE_SECRET_KEY", report.import_context)

    def test_rebuild_provider_response_replay_uses_curriculum_raw_asset_source_pdf_when_available(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        document_registry = _FakeDocumentRegistry()
        raw_asset_registry = _FakeRawAssetRegistry()
        raw_asset_registry.upsert(
            RawAssetRecord(
                raw_asset_id="asset:curriculum-plan-2022",
                raw_version_id="sha256:curriculum-replay-001",
                corpus="curriculum",
                collection="curriculum_plan",
                raw_source_uri="s3://upstream/curriculum-plan-2022.pdf",
                content_hash="curriculum-replay-001",
                source_filename="curriculum-plan-2022.pdf",
                object_key="official_pdf/curriculum-plan/2022/sha256/curriculum-replay-001/capture/curriculum-plan-2022.pdf",
                ingestion_timestamp="2026-04-03T00:00:00+00:00",
                import_source="raw_online_ocr",
            )
        )
        calls: list[dict[str, str]] = []

        report = rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            },
            request=RebuildRequest(
                corpus="curriculum",
                collection="curriculum_plan",
                import_mode="provider_response_replay",
                raw_version_id="sha256:curriculum-replay-001",
            ),
            object_store=object_store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            import_runner=lambda **kwargs: calls.append(kwargs["env"]) or {"status": "replay"},
        )

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["REPLAY_SOURCE_PDF"], "curriculum-plan-2022.pdf")
        self.assertEqual(report.import_context["REPLAY_SOURCE_PDF"], "curriculum-plan-2022.pdf")

    def test_rebuild_provider_response_replay_falls_back_to_curriculum_default_source_pdf_without_raw_asset_record(
        self,
    ) -> None:
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
                corpus="curriculum",
                collection="curriculum_plan",
                import_mode="provider_response_replay",
                raw_version_id="sha256:curriculum-replay-001",
            ),
            object_store=object_store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            import_runner=lambda **kwargs: calls.append(kwargs["env"]) or {"status": "replay"},
        )

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["REPLAY_SOURCE_PDF"], "curriculum-plan.pdf")
        self.assertEqual(report.import_context["REPLAY_SOURCE_PDF"], "curriculum-plan.pdf")

    def test_rebuild_typed_request_ignores_stale_split_manifest_override_from_env(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        document_registry = _FakeDocumentRegistry()
        raw_asset_registry = _FakeRawAssetRegistry()
        calls: list[dict[str, str]] = []

        report = rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "INGESTION_SPLIT_MANIFEST_PATH": "configs/ingestion/regulations/student_handbook/split-manifest.v1.json",
            },
            request=RebuildRequest(
                corpus="curriculum",
                collection="curriculum_plan",
                import_mode="provider_response_replay",
                raw_version_id="sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67",
            ),
            object_store=object_store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            import_runner=lambda **kwargs: calls.append(kwargs["env"]) or {"status": "replay"},
        )

        expected_manifest = str(
            Path("configs/ingestion/curriculum/curriculum_plan/split-manifest.v1.json").resolve()
        )
        self.assertEqual(report.import_context["INGESTION_SPLIT_MANIFEST_PATH"], expected_manifest)
        self.assertEqual(calls[0]["INGESTION_SPLIT_MANIFEST_PATH"], expected_manifest)

    def test_rebuild_local_data_writes_trace_events_when_trace_path_is_configured(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        with TemporaryDirectory() as temp_dir:
            trace_path = Path(temp_dir) / "rebuild-trace.jsonl"

            rebuild_local_data(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "REBUILD_TRACE_JSONL_PATH": str(trace_path),
                },
                request=RebuildRequest(
                    corpus="regulations",
                    collection="student_handbook",
                    import_mode="raw_online_ocr",
                ),
                object_store=object_store,
                document_registry=_FakeDocumentRegistry(),
                raw_asset_registry=_FakeRawAssetRegistry(),
                import_runner=lambda **kwargs: {"status": "ok"},
            )

            events = [
                json.loads(line)
                for line in trace_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]

        self.assertTrue(events)
        self.assertEqual(events[0]["stage"], "rebuild.cleanup.collect_processed_keys")
        self.assertEqual(events[0]["event"], "start")
        self.assertEqual(events[-1]["stage"], "rebuild.import_runner")
        self.assertEqual(events[-1]["event"], "end")
        self.assertIn(
            ("rebuild.cleanup.delete_registry_scope", "end"),
            {(event["stage"], event["event"]) for event in events},
        )

    def test_rebuild_provider_response_replay_can_disable_alias_publish_in_import_context(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        calls: list[dict[str, str]] = []

        report = rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            },
            request=RebuildRequest(
                corpus="curriculum",
                collection="curriculum_plan",
                import_mode="provider_response_replay",
                raw_version_id="sha256:curriculum-replay-001",
                index_qdrant=True,
                publish_qdrant_alias=False,
            ),
            object_store=object_store,
            document_registry=_FakeDocumentRegistry(),
            raw_asset_registry=_FakeRawAssetRegistry(),
            import_runner=lambda **kwargs: calls.append(kwargs["env"]) or {"status": "replay"},
        )

        self.assertEqual(calls[0]["REBUILD_INDEX_QDRANT"], "1")
        self.assertEqual(calls[0]["REBUILD_PUBLISH_ALIAS"], "0")
        self.assertEqual(report.import_context["REBUILD_PUBLISH_ALIAS"], "0")

    def test_rebuild_provider_response_replay_uses_raw_processed_keys_when_scope_rows_have_legacy_auth_projection(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        document_registry = _LegacyProjectionBlockedDocumentRegistry(
            scope_keys={
                (
                    "curriculum",
                    "curriculum_plan",
                ): (
                    "curriculum/documents/curriculum_plan/plan-001/source-faithful/2022/canonical.md",
                    "curriculum/documents/curriculum_plan/plan-001/source-faithful/2022/document-units.jsonl",
                )
            }
        )

        rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            },
            request=RebuildRequest(
                corpus="curriculum",
                collection="curriculum_plan",
                import_mode="provider_response_replay",
                raw_version_id="sha256:curriculum-replay-001",
            ),
            object_store=object_store,
            document_registry=document_registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            import_runner=lambda **kwargs: {"status": "replay"},
        )

        self.assertEqual(
            object_store.cleared_prefixes,
            [
                (
                    DERIVED_BUCKET,
                    "curriculum/documents/curriculum_plan/plan-001/source-faithful/2022/canonical.md",
                    (),
                ),
                (
                    DERIVED_BUCKET,
                    "curriculum/documents/curriculum_plan/plan-001/source-faithful/2022/document-units.jsonl",
                    (),
                ),
            ],
        )
        self.assertEqual(document_registry.deleted_scopes, [("curriculum", "curriculum_plan")])

    def test_rebuild_provider_response_replay_clears_declared_downstream_projection_artifacts(
        self,
    ) -> None:
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
                "source_title",
                "source_handbook_section",
                "source_page_start",
                "source_page_end",
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
                    "derived_from_document_id": None,
                    "parent_document_id": None,
                    "source_title": "中央民族大学公寓及公费医疗管理规定",
                    "source_handbook_section": "中央民族大学公寓及公费医疗管理规定",
                    "source_page_start": 252,
                    "source_page_end": 255,
                    "attachment_kind": "navigation_like",
                    "attachment_role": "service_navigation_document",
                    "target_title": "中央民族大学学生公寓管理工作流程",
                    "migration_reason": "handbook_navigation_document",
                },
            ],
        }
        with TemporaryDirectory() as temp_dir:
            projection_config_path = Path(temp_dir) / "source-projections.v1.json"
            projection_config_path.write_text(
                json.dumps(projection_config, ensure_ascii=False, indent=2), encoding="utf-8"
            )

            document_registry = _FakeDocumentRegistryWithRecords(
                _FakeDocumentRecord(
                    corpus="regulations",
                    collection="student_handbook",
                    processed_object_keys=(
                        "regulations/documents/student_handbook/doc-a/source-faithful/2018/canonical.md",
                        "regulations/documents/student_handbook/doc-a/source-faithful/2018/document-units.jsonl",
                    ),
                ),
            )

            rebuild_local_data(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "REBUILD_CORPUS": "regulations",
                    "REBUILD_COLLECTION": "student_handbook",
                    "REBUILD_IMPORT_MODE": "provider_response_replay",
                    "RAW_VERSION_ID": "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
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
        self.assertNotIn(
            "campus_services/documents/service_catalog/"
            "中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/flow-graph.json",
            cleared_prefixes,
        )

    def test_rebuild_provider_response_replay_clears_declared_downstream_projection_artifacts_when_scope_rows_are_legacy(
        self,
    ) -> None:
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
                "source_title",
                "source_handbook_section",
                "source_page_start",
                "source_page_end",
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
                    "derived_from_document_id": None,
                    "parent_document_id": None,
                    "source_title": "中央民族大学公寓及公费医疗管理规定",
                    "source_handbook_section": "中央民族大学公寓及公费医疗管理规定",
                    "source_page_start": 252,
                    "source_page_end": 255,
                    "attachment_kind": "navigation_like",
                    "attachment_role": "service_navigation_document",
                    "target_title": "中央民族大学学生公寓管理工作流程",
                    "migration_reason": "handbook_navigation_document",
                },
            ],
        }
        with TemporaryDirectory() as temp_dir:
            projection_config_path = Path(temp_dir) / "source-projections.v1.json"
            projection_config_path.write_text(
                json.dumps(projection_config, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            document_registry = _LegacyProjectionBlockedDocumentRegistry(
                scope_keys={
                    (
                        "regulations",
                        "student_handbook",
                    ): (
                        "regulations/documents/student_handbook/doc-a/source-faithful/2018/canonical.md",
                        "regulations/documents/student_handbook/doc-a/source-faithful/2018/document-units.jsonl",
                    ),
                    (
                        "campus_services",
                        "service_catalog",
                    ): (
                        "campus_services/documents/service_catalog/中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/canonical.md",
                        "campus_services/documents/service_catalog/中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/document-units.jsonl",
                    ),
                }
            )

            rebuild_local_data(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "REBUILD_CORPUS": "regulations",
                    "REBUILD_COLLECTION": "student_handbook",
                    "REBUILD_IMPORT_MODE": "provider_response_replay",
                    "RAW_VERSION_ID": "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
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
                    "official_pdf/student-handbook/undated/sha256/raw-001/provider/paddleocr-vl-1-5/provider-response.jsonl",
                    "official_pdf/student-handbook/undated/sha256/raw-001/source-truth/layout-elements.jsonl",
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
                object_key="official_pdf/student-handbook/undated/sha256/raw-001/capture/student-handbook.pdf",
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
                "REBUILD_CORPUS": "regulations",
                "REBUILD_COLLECTION": "student_handbook",
                "REBUILD_IMPORT_MODE": "raw_online_ocr",
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
        self.assertEqual(qdrant.reset_aliases, [])
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
                "REBUILD_CORPUS": "regulations",
                "REBUILD_COLLECTION": "student_handbook",
                "REBUILD_IMPORT_MODE": "raw_online_ocr",
                "QDRANT_URL": "https://qdrant.example.com",
                "REBUILD_RESET_QDRANT": "1",
            },
            object_store=object_store,
            qdrant_admin=qdrant,
            document_registry=_FakeDocumentRegistry(),
            raw_asset_registry=_FakeRawAssetRegistry(),
            import_runner=lambda **kwargs: {"status": "ok"},
        )

        self.assertEqual(qdrant.reset_aliases, ["student_handbook"])

    def test_resolve_rebuild_target_qdrant_aliases_defaults_to_request_collection_without_global_scope(
        self,
    ) -> None:
        collections = _resolve_rebuild_target_qdrant_aliases(
            source={},
            request=RebuildRequest(
                corpus="curriculum",
                collection="curriculum_plan",
                import_mode="raw_online_ocr",
            ),
            collection_config=resolve_collection_truth_config("curriculum", "curriculum_plan"),
        )

        self.assertEqual(collections, ("curriculum_plan",))

    def test_rebuild_provider_response_replay_does_not_touch_qdrant_without_explicit_flags(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        qdrant = _FakeQdrantAdmin()

        rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "REBUILD_CORPUS": "regulations",
                "REBUILD_COLLECTION": "student_handbook",
                "REBUILD_IMPORT_MODE": "provider_response_replay",
                "RAW_VERSION_ID": "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            },
            object_store=object_store,
            qdrant_admin=qdrant,
            document_registry=_FakeDocumentRegistry(),
            raw_asset_registry=_FakeRawAssetRegistry(),
            import_runner=lambda **kwargs: {"status": "replay"},
        )

        self.assertEqual(qdrant.reset_aliases, [])

    def test_rebuild_provider_response_replay_resets_all_target_qdrant_collections(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        qdrant = _FakeQdrantAdmin()
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_config_path = root / "configs" / "source-projections.v1.json"
            projection_config_path.parent.mkdir(parents=True)
            projection_config_path.write_text(
                json.dumps(
                    {
                        "schema_version": "student_handbook_source_projections_v1",
                        "source_corpus": "regulations",
                        "source_collection": "student_handbook",
                        "raw_asset_id": "asset:student-handbook-pdf",
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
                                "projection_name": "handbook_phone_directory",
                                "target_corpus": "campus_services",
                                "target_collection": "contact_directory",
                                "projection_family": "derived_documents",
                                "replay_from_source_truth": True,
                                "derived_from": "source_truth",
                                "derived_from_document_id": None,
                                "parent_document_id": None,
                                "source_title": "中央民族大学校内常用电话",
                                "attachment_kind": "navigation_like",
                                "attachment_role": "service_contact_directory",
                                "target_title": "中央民族大学校内常用电话",
                            },
                            {
                                "projection_name": "handbook_navigation_service_catalog",
                                "target_corpus": "campus_services",
                                "target_collection": "service_catalog",
                                "projection_family": "derived_documents",
                                "replay_from_source_truth": True,
                                "derived_from": "source_truth",
                                "derived_from_document_id": None,
                                "parent_document_id": None,
                                "source_title": "中央民族大学公寓及公费医疗管理规定",
                                "attachment_kind": "navigation_like",
                                "attachment_role": "service_navigation_document",
                                "target_title": "中央民族大学学生公寓管理工作流程",
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            rebuild_local_data(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "REBUILD_CORPUS": "regulations",
                    "REBUILD_COLLECTION": "student_handbook",
                    "REBUILD_IMPORT_MODE": "provider_response_replay",
                    "RAW_VERSION_ID": "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                    "QDRANT_URL": "https://qdrant.example.com",
                    "REBUILD_RESET_QDRANT": "1",
                    "HANDBOOK_SOURCE_PROJECTIONS_PATH": str(projection_config_path),
                },
                object_store=object_store,
                qdrant_admin=qdrant,
                document_registry=_FakeDocumentRegistry(),
                raw_asset_registry=_FakeRawAssetRegistry(),
                import_runner=lambda **kwargs: {"status": "replay"},
            )

        self.assertEqual(
            qdrant.reset_aliases,
            ["student_handbook", "contact_directory", "service_catalog"],
        )

    def test_rebuild_provider_response_replay_resets_curriculum_target_qdrant_collection_only(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        qdrant = _FakeQdrantAdmin()

        rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "REBUILD_CORPUS": "curriculum",
                "REBUILD_COLLECTION": "curriculum_plan",
                "REBUILD_IMPORT_MODE": "provider_response_replay",
                "RAW_VERSION_ID": "sha256:curriculum-replay-001",
                "QDRANT_URL": "https://qdrant.example.com",
                "REBUILD_RESET_QDRANT": "1",
            },
            object_store=object_store,
            qdrant_admin=qdrant,
            document_registry=_FakeDocumentRegistry(),
            raw_asset_registry=_FakeRawAssetRegistry(),
            import_runner=lambda **kwargs: {"status": "replay"},
        )

        self.assertEqual(
            qdrant.reset_aliases,
            ["curriculum_plan", "course_facts", "program_family_facts", "program_semester_facts"],
        )

    def test_rebuild_uses_ingestion_corpus_prefix_for_curriculum_plan(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        document_registry = _FakeDocumentRegistryWithRecords(
            _FakeDocumentRecord(
                corpus="curriculum",
                collection="curriculum_plan",
                processed_object_keys=(
                    "official_pdf/curriculum-plan-master/undated/sha256/raw-001/provider/paddleocr-vl-1-5/provider-response.jsonl",
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
                object_key="official_pdf/curriculum-plan-master/undated/sha256/raw-001/capture/curriculum-plan.pdf",
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
                "REBUILD_CORPUS": "curriculum",
                "REBUILD_COLLECTION": "curriculum_plan",
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
                    "REBUILD_CORPUS": "regulations",
                    "REBUILD_COLLECTION": "student_handbook",
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
                    "REBUILD_CORPUS": "regulations",
                    "REBUILD_COLLECTION": "student_handbook",
                    "REBUILD_IMPORT_MODE": "existing_ocr",
                },
                object_store=_FakeObjectStoreAdmin(),
                import_runner=lambda **kwargs: {"status": "ok"},
            )

    def test_rebuild_local_data_requires_canonical_registry_env_when_runtime_registries_are_not_injected(
        self,
    ) -> None:
        with self.assertRaisesRegex(
            ValueError, "DOCUMENT_REGISTRY_DATABASE_URL or CAMPUS_SHARED_POSTGRES_URL is required"
        ):
            rebuild_local_data(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "REBUILD_CORPUS": "regulations",
                    "REBUILD_COLLECTION": "student_handbook",
                    "REBUILD_IMPORT_MODE": "raw_online_ocr",
                },
                object_store=_FakeObjectStoreAdmin(),
                import_runner=lambda **kwargs: {"status": "ok"},
            )

    def test_rebuild_local_data_deletes_registry_by_corpus_and_can_dispatch_raw_online_ocr(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        document_registry = _FakeDocumentRegistry()
        raw_asset_registry = _FakeRawAssetRegistry()
        calls: list[dict[str, str]] = []

        report = rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "REBUILD_CORPUS": "curriculum",
                "REBUILD_COLLECTION": "curriculum_plan",
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

    def test_rebuild_provider_response_replay_preserves_source_key_in_processed_bucket(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        document_registry = _FakeDocumentRegistry()
        raw_asset_registry = _FakeRawAssetRegistry()
        calls: list[dict[str, str]] = []
        source_key = (
            "official_pdf/student-handbook/undated/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider/paddleocr-vl-1-5/provider-response.jsonl"
        )

        report = rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "REBUILD_CORPUS": "regulations",
                "REBUILD_COLLECTION": "student_handbook",
                "REBUILD_IMPORT_MODE": "provider_response_replay",
                "RAW_VERSION_ID": "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            },
            object_store=object_store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            import_runner=lambda **kwargs: calls.append(kwargs["env"]) or {"status": "replay"},
        )

        cleared_prefixes = [prefix for _, prefix, _ in object_store.cleared_prefixes]
        self.assertIn(
            "campus_services/documents/contact_directory/"
            "中央民族大学校内常用电话--bf03f0bd/source-faithful/2018/canonical.md",
            cleared_prefixes,
        )
        self.assertIn(
            "campus_services/documents/service_catalog/"
            "中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/document-units.jsonl",
            cleared_prefixes,
        )
        self.assertNotIn(source_key, cleared_prefixes)
        self.assertEqual(document_registry.deleted_scopes, [])
        self.assertEqual(raw_asset_registry.deleted_scopes, [])
        self.assertEqual(len(calls), 1)
        self.assertEqual(report.import_result, {"status": "replay"})
        self.assertNotIn("REBUILD_PROVIDER_RESPONSE_KEY", calls[0])
        self.assertNotIn("REBUILD_PROVIDER_RESPONSE_KEY", report.import_context)
        self.assertNotIn("OBJECT_STORE_SECRET_KEY", report.import_context)

    def test_replay_provider_response_rebuild_supports_curriculum_plan(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "curriculum_plan_split_manifest_v1",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "raw_asset_id": "asset:curriculum-plan-master-pdf",
                        "documents": [
                            {
                                "document_id": "curriculum:plan-001",
                                "title": "Plan 001",
                                "page_start": 1,
                                "page_end": 1,
                                "entitlement_groups": [],
                                "visibility_scope": "main",
                                "status": "active",
                            }
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            provider_lines = [
                {
                    "pageNumber": 1,
                    "result": {
                        "layoutParsingResults": [
                            {
                                "blockType": "title",
                                "blockId": "p1-title",
                                "readingOrder": 1,
                                "markdown": {"text": "Plan 001"},
                            },
                            {
                                "blockType": "paragraph",
                                "blockId": "p1-body",
                                "readingOrder": 2,
                                "markdown": {"text": "培养具有跨学科能力的复合型人才。"},
                            },
                        ]
                    },
                    "logId": "log-001",
                }
            ]
            provider_bytes = (
                "\n".join(json.dumps(line, ensure_ascii=False) for line in provider_lines) + "\n"
            ).encode("utf-8")
            raw_version_id = "sha256:curriculum-replay-001"
            provider_response_key = build_source_ocr_artifact_key(
                raw_asset_id="asset:curriculum-plan-master-pdf",
                raw_version_id=raw_version_id,
                filename="provider-response.jsonl",
                source_channel="official_pdf",
                model_slug="paddleocr-vl-1-5",
                year="undated",
            )
            object_store = _FakeObjectStoreAdmin()
            object_store.objects[(SOURCE_BUCKET, provider_response_key)] = provider_bytes
            document_registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "curriculum_plan_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "curriculum_plan_raw_assets.json"
            )
            raw_asset_registry.upsert(
                RawAssetRecord(
                    raw_asset_id="asset:curriculum-plan-master-pdf",
                    raw_version_id=raw_version_id,
                    corpus="curriculum",
                    collection="curriculum_plan",
                    raw_source_uri="s3://campus-rag-source/official_pdf/curriculum-plan-master-pdf/curriculum-plan.pdf",
                    content_hash="curriculum-replay-001",
                    source_filename="curriculum-plan.pdf",
                    object_key=(
                        "official_pdf/curriculum-plan-master-pdf/undated/sha256/"
                        "curriculum-replay-001/capture/curriculum-plan.pdf"
                    ),
                    ingestion_timestamp="2026-03-27T00:00:00+00:00",
                    import_source="seed",
                )
            )

            report = replay_provider_response_rebuild(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                    "OBJECT_STORE_BUCKET_DERIVED": DERIVED_BUCKET,
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "REBUILD_CORPUS": "curriculum",
                    "REBUILD_COLLECTION": "curriculum_plan",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                    "RAW_VERSION_ID": raw_version_id,
                    "REPLAY_SOURCE_PDF": "curriculum-plan.pdf",
                },
                object_store=object_store,
                registry=document_registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.document_ids, ("curriculum:plan-001",))
            records = document_registry.list_by_scope("curriculum", "curriculum_plan")
            self.assertEqual(len(records), 1)
            record = records[0]
            self.assertEqual(record.document_id, "curriculum:plan-001")
            self.assertEqual(record.cleaning_policy_version, "curriculum_plan_cleaning_v1")
            layout_elements_key = build_source_truth_artifact_key(
                raw_asset_id="asset:curriculum-plan-master-pdf",
                raw_version_id=raw_version_id,
                filename="layout-elements.jsonl",
                source_channel="official_pdf",
                year="undated",
            )
            self.assertIn((SOURCE_BUCKET, layout_elements_key), object_store.objects)
            document_units_key = build_processed_artifact_key(
                corpus="curriculum",
                collection="curriculum_plan",
                document_id=record.document_id,
                revision_track=record.revision_track,
                version_id=record.version_id,
                title="Plan 001",
                year=None,
                filename="document-units.jsonl",
            )
            self.assertIn((DERIVED_BUCKET, document_units_key), object_store.objects)

    def test_migrate_student_handbook_source_faithful_renames_raw_asset_and_dispatches_rebuild(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        raw_asset_registry = _FakeRawAssetRegistry()
        old_raw_key = (
            "official_pdf/student-handbook/undated/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/capture/student-handbook.pdf"
        )
        object_store.objects[(SOURCE_BUCKET, old_raw_key)] = b"%PDF-1.4 handbook"
        raw_asset_registry.upsert(
            RawAssetRecord(
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                corpus="regulations",
                collection="student_handbook",
                raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/student-handbook.pdf",
                content_hash="b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                source_filename="student-handbook.pdf",
                object_key=old_raw_key,
                ingestion_timestamp="2026-03-24T00:00:00+00:00",
                import_source="seed",
            )
        )
        calls: list[dict[str, object]] = []

        with (
            patch("campus_ingestion_core.handbook_source_migration.rebuild_local_data") as rebuild,
            patch(
                "campus_ingestion_core.handbook_source_migration.materialize_handbook_service_navigation_projection_artifact"
            ) as materialize,
        ):
            rebuild.side_effect = lambda **kwargs: (
                calls.append(kwargs)
                or {"status": "rebuilt", "source_pdf": kwargs["env"]["REPLAY_SOURCE_PDF"]}
            )
            materialize.return_value = ProcessedArtifactInput(
                object_key=build_source_projection_artifact_key(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                    projection_name="handbook_navigation_service_catalog",
                    filename="flow-graph.json",
                    year="2018",
                ),
                data=b'{"schema_version":"handbook_service_navigation_projection_v1","projection_name":"handbook_navigation_service_catalog","raw_asset_id":"asset:student-handbook-pdf","raw_version_id":"sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1","source_document_id":"handbook:source-001","source_uri":"x","source_handbook_section":"x","source_page_start":252,"source_page_end":255,"target_document_id":"campus_services:service_catalog:test","target_title":"x","extractor_runtime":{"kind":"prompt_runtime"},"flow_graph":{"document_title":"x","global_manual_review_required":false,"page_findings":[{"source_page":252,"page_heading":"a","flows":[]},{"source_page":253,"page_heading":"b","flows":[{"flow_heading":"f","audience_scope":"","steps":[{"step_id":"s1","step_text":"t","next_step_ids":[]}],"manual_review_notes":[]}]},{"source_page":254,"page_heading":"c","flows":[]},{"source_page":255,"page_heading":"d","flows":[]}]}}',
                content_type="application/json",
            )
            report = migrate_student_handbook_source_faithful(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                    "OBJECT_STORE_BUCKET_DERIVED": DERIVED_BUCKET,
                    "REBUILD_CORPUS": "regulations",
                    "REBUILD_COLLECTION": "student_handbook",
                    "INGESTION_SPLIT_MANIFEST_PATH": "configs/ingestion/regulations/student_handbook/split-manifest.v1.json",
                    "RAW_VERSION_ID": "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                },
                object_store=object_store,
                raw_asset_registry=raw_asset_registry,
                document_registry=_FakeDocumentRegistry(),
            )

        new_raw_key = (
            "official_pdf/student-handbook/2018/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/capture/学生手册_2018.pdf"
        )
        self.assertEqual(report.canonical_raw_filename, "学生手册_2018.pdf")
        self.assertEqual(report.previous_raw_object_key, old_raw_key)
        self.assertEqual(report.canonical_raw_object_key, new_raw_key)
        self.assertEqual(
            raw_asset_registry.get(
                "asset:student-handbook-pdf",
                "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            ).source_filename,
            "学生手册_2018.pdf",
        )
        self.assertIn((SOURCE_BUCKET, new_raw_key), object_store.puts)
        self.assertEqual(calls[0]["request"].import_mode, "provider_response_replay")
        self.assertEqual(calls[0]["env"]["REPLAY_SOURCE_PDF"], "学生手册_2018.pdf")

    def test_migrate_student_handbook_source_faithful_refreshes_legacy_scope_when_raw_key_is_already_canonical(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        raw_asset_registry = _FakeRawAssetRegistry()
        canonical_raw_key = (
            "official_pdf/student-handbook/2018/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/capture/学生手册_2018.pdf"
        )
        raw_asset_registry.records[
            (
                "asset:student-handbook-pdf",
                "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            )
        ] = SimpleNamespace(
            raw_asset_id="asset:student-handbook-pdf",
            raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            corpus="student_handbook",
            collection="student_handbook",
            raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/学生手册_2018.pdf",
            content_hash="b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            source_filename="学生手册_2018.pdf",
            object_key=canonical_raw_key,
            ingestion_timestamp="2026-03-24T00:00:00+00:00",
            import_source="seed",
        )
        calls: list[dict[str, object]] = []

        with (
            patch("campus_ingestion_core.handbook_source_migration.rebuild_local_data") as rebuild,
            patch(
                "campus_ingestion_core.handbook_source_migration.materialize_handbook_service_navigation_projection_artifact"
            ) as materialize,
        ):
            rebuild.side_effect = lambda **kwargs: (
                calls.append(kwargs)
                or {"status": "rebuilt", "source_pdf": kwargs["env"]["REPLAY_SOURCE_PDF"]}
            )
            materialize.return_value = ProcessedArtifactInput(
                object_key=build_source_projection_artifact_key(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                    projection_name="handbook_navigation_service_catalog",
                    filename="flow-graph.json",
                    year="2018",
                ),
                data=b'{"schema_version":"handbook_service_navigation_projection_v1","projection_name":"handbook_navigation_service_catalog","raw_asset_id":"asset:student-handbook-pdf","raw_version_id":"sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1","source_document_id":"handbook:source-001","source_uri":"x","source_handbook_section":"x","source_page_start":252,"source_page_end":255,"target_document_id":"campus_services:service_catalog:test","target_title":"x","extractor_runtime":{"kind":"prompt_runtime"},"flow_graph":{"document_title":"x","global_manual_review_required":false,"page_findings":[{"source_page":252,"page_heading":"a","flows":[]},{"source_page":253,"page_heading":"b","flows":[{"flow_heading":"f","audience_scope":"","steps":[{"step_id":"s1","step_text":"t","next_step_ids":[]}],"manual_review_notes":[]}]},{"source_page":254,"page_heading":"c","flows":[]},{"source_page":255,"page_heading":"d","flows":[]}]}}',
                content_type="application/json",
            )
            report = migrate_student_handbook_source_faithful(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                    "OBJECT_STORE_BUCKET_DERIVED": DERIVED_BUCKET,
                    "REBUILD_CORPUS": "regulations",
                    "REBUILD_COLLECTION": "student_handbook",
                    "INGESTION_SPLIT_MANIFEST_PATH": "configs/ingestion/regulations/student_handbook/split-manifest.v1.json",
                    "RAW_VERSION_ID": "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
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
        self.assertTrue(
            any(
                bucket == SOURCE_BUCKET
                and "/projection/handbook_navigation_service_catalog/flow-graph.json" in key
                for bucket, key in object_store.puts
            )
        )
        self.assertEqual(object_store.cleared_prefixes, [])
        self.assertEqual(calls[0]["request"].import_mode, "provider_response_replay")

    def test_migrate_student_handbook_source_faithful_accepts_source_asset_request(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        raw_asset_registry = _FakeRawAssetRegistry()
        canonical_raw_key = (
            "official_pdf/student-handbook/2018/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/capture/学生手册_2018.pdf"
        )
        raw_asset_registry.records[
            (
                "asset:student-handbook-pdf",
                "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            )
        ] = SimpleNamespace(
            raw_asset_id="asset:student-handbook-pdf",
            raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            corpus="regulations",
            collection="student_handbook",
            raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/学生手册_2018.pdf",
            content_hash="b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            source_filename="学生手册_2018.pdf",
            object_key=canonical_raw_key,
            ingestion_timestamp="2026-03-24T00:00:00+00:00",
            import_source="seed",
        )
        calls: list[dict[str, object]] = []

        with (
            patch("campus_ingestion_core.handbook_source_migration.rebuild_local_data") as rebuild,
            patch(
                "campus_ingestion_core.handbook_source_migration.materialize_handbook_service_navigation_projection_artifact"
            ) as materialize,
        ):
            rebuild.side_effect = lambda **kwargs: (
                calls.append(kwargs)
                or {"status": "rebuilt", "source_pdf": kwargs["env"]["REPLAY_SOURCE_PDF"]}
            )
            materialize.return_value = ProcessedArtifactInput(
                object_key=build_source_projection_artifact_key(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                    projection_name="handbook_navigation_service_catalog",
                    filename="flow-graph.json",
                    year="2018",
                ),
                data=b'{"schema_version":"handbook_service_navigation_projection_v1","projection_name":"handbook_navigation_service_catalog","raw_asset_id":"asset:student-handbook-pdf","raw_version_id":"sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1","source_document_id":"handbook:source-001","source_uri":"x","source_handbook_section":"x","source_page_start":252,"source_page_end":255,"target_document_id":"campus_services:service_catalog:test","target_title":"x","extractor_runtime":{"kind":"prompt_runtime"},"flow_graph":{"document_title":"x","global_manual_review_required":false,"page_findings":[{"source_page":252,"page_heading":"a","flows":[]},{"source_page":253,"page_heading":"b","flows":[{"flow_heading":"f","audience_scope":"","steps":[{"step_id":"s1","step_text":"t","next_step_ids":[]}],"manual_review_notes":[]}]},{"source_page":254,"page_heading":"c","flows":[]},{"source_page":255,"page_heading":"d","flows":[]}]}}',
                content_type="application/json",
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

    def test_migrate_student_handbook_source_faithful_backfills_projection_artifact_from_legacy_document_artifact(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        raw_asset_registry = _FakeRawAssetRegistry()
        raw_version_id = "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1"
        canonical_raw_key = (
            "official_pdf/student-handbook/2018/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/capture/学生手册_2018.pdf"
        )
        legacy_flow_graph_key = (
            "campus_services/documents/service_catalog/"
            "中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/flow-graph.json"
        )
        projection_artifact_key = build_source_projection_artifact_key(
            raw_asset_id="asset:student-handbook-pdf",
            raw_version_id=raw_version_id,
            projection_name="handbook_navigation_service_catalog",
            filename="flow-graph.json",
            year="2018",
        )
        object_store.objects[(DERIVED_BUCKET, legacy_flow_graph_key)] = (
            b'{"document_title":"\xe4\xb8\xad\xe5\xa4\xae\xe6\xb0\x91\xe6\x97\x8f\xe5\xa4\xa7\xe5\xad\xa6\xe5\xad\xa6\xe7\x94\x9f\xe5\x85\xac\xe5\xaf\x93\xe7\xae\xa1\xe7\x90\x86\xe5\xb7\xa5\xe4\xbd\x9c\xe6\xb5\x81\xe7\xa8\x8b","global_manual_review_required":false,"page_findings":[{"source_page":252,"page_heading":"p252","flows":[]},{"source_page":253,"page_heading":"p253","flows":[{"flow_heading":"f","audience_scope":"","steps":[{"step_id":"s1","step_text":"t","next_step_ids":[]}],"manual_review_notes":[]}]},{"source_page":254,"page_heading":"p254","flows":[]},{"source_page":255,"page_heading":"p255","flows":[]}]}'
        )
        raw_asset_registry.upsert(
            RawAssetRecord(
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id=raw_version_id,
                corpus="regulations",
                collection="student_handbook",
                raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/学生手册_2018.pdf",
                content_hash="b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                source_filename="学生手册_2018.pdf",
                object_key=canonical_raw_key,
                ingestion_timestamp="2026-03-24T00:00:00+00:00",
                import_source="seed",
            )
        )

        with patch("campus_ingestion_core.handbook_source_migration.rebuild_local_data") as rebuild:
            rebuild.return_value = {"status": "rebuilt"}
            with patch(
                "campus_ingestion_core.handbook_source_migration.materialize_handbook_service_navigation_projection_artifact"
            ) as materialize:
                report = migrate_student_handbook_source_faithful(
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                        "OBJECT_STORE_BUCKET_DERIVED": DERIVED_BUCKET,
                        "REBUILD_CORPUS": "regulations",
                        "REBUILD_COLLECTION": "student_handbook",
                        "INGESTION_SPLIT_MANIFEST_PATH": "configs/ingestion/regulations/student_handbook/split-manifest.v1.json",
                        "HANDBOOK_SOURCE_PROJECTIONS_PATH": "configs/ingestion/regulations/student_handbook/source-projections.v1.json",
                        "RAW_VERSION_ID": raw_version_id,
                    },
                    object_store=object_store,
                    raw_asset_registry=raw_asset_registry,
                    document_registry=_FakeDocumentRegistry(),
                )

        self.assertEqual(report.canonical_raw_object_key, canonical_raw_key)
        self.assertIn((SOURCE_BUCKET, projection_artifact_key), object_store.puts)
        self.assertEqual(
            json.loads(
                object_store.objects[(SOURCE_BUCKET, projection_artifact_key)].decode("utf-8")
            )["schema_version"],
            "handbook_service_navigation_projection_v1",
        )
        materialize.assert_not_called()

    def test_migrate_student_handbook_source_faithful_materializes_projection_artifact_when_legacy_copy_is_missing(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        raw_asset_registry = _FakeRawAssetRegistry()
        raw_version_id = "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1"
        canonical_raw_key = (
            "official_pdf/student-handbook/2018/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/capture/学生手册_2018.pdf"
        )
        projection_artifact_key = build_source_projection_artifact_key(
            raw_asset_id="asset:student-handbook-pdf",
            raw_version_id=raw_version_id,
            projection_name="handbook_navigation_service_catalog",
            filename="flow-graph.json",
            year="2018",
        )
        raw_asset_registry.upsert(
            RawAssetRecord(
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id=raw_version_id,
                corpus="regulations",
                collection="student_handbook",
                raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/学生手册_2018.pdf",
                content_hash="b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                source_filename="学生手册_2018.pdf",
                object_key=canonical_raw_key,
                ingestion_timestamp="2026-03-24T00:00:00+00:00",
                import_source="seed",
            )
        )

        with patch("campus_ingestion_core.handbook_source_migration.rebuild_local_data") as rebuild:
            rebuild.return_value = {"status": "rebuilt"}
            with patch(
                "campus_ingestion_core.handbook_source_migration.materialize_handbook_service_navigation_projection_artifact"
            ) as materialize:
                materialize.return_value = ProcessedArtifactInput(
                    object_key=projection_artifact_key,
                    data=(
                        b'{"schema_version":"handbook_service_navigation_projection_v1",'
                        b'"projection_name":"handbook_navigation_service_catalog",'
                        b'"raw_asset_id":"asset:student-handbook-pdf",'
                        b'"raw_version_id":"'
                        + raw_version_id.encode("utf-8")
                        + b'","source_document_id":"handbook:source-001",'
                        b'"source_uri":"campus-agent://regulations/student_handbook/docs/handbook:source-001",'
                        b'"source_handbook_section":"\xe4\xb8\xad\xe5\xa4\xae\xe6\xb0\x91\xe6\x97\x8f\xe5\xa4\xa7\xe5\xad\xa6\xe5\x85\xac\xe5\xaf\x93\xe5\x8f\x8a\xe5\x85\xac\xe8\xb4\xb9\xe5\x8c\xbb\xe7\x96\x97\xe7\xae\xa1\xe7\x90\x86\xe8\xa7\x84\xe5\xae\x9a",'
                        b'"source_page_start":252,"source_page_end":255,'
                        b'"target_document_id":"campus_services:service_catalog:66f91543748400ae59b3f9265353a0538088028a",'
                        b'"target_title":"\xe4\xb8\xad\xe5\xa4\xae\xe6\xb0\x91\xe6\x97\x8f\xe5\xa4\xa7\xe5\xad\xa6\xe5\xad\xa6\xe7\x94\x9f\xe5\x85\xac\xe5\xaf\x93\xe7\xae\xa1\xe7\x90\x86\xe5\xb7\xa5\xe4\xbd\x9c\xe6\xb5\x81\xe7\xa8\x8b",'
                        b'"extractor_runtime":{"kind":"prompt_runtime","mode":"captured"},'
                        b'"flow_graph":{"document_title":"\xe4\xb8\xad\xe5\xa4\xae\xe6\xb0\x91\xe6\x97\x8f\xe5\xa4\xa7\xe5\xad\xa6\xe5\xad\xa6\xe7\x94\x9f\xe5\x85\xac\xe5\xaf\x93\xe7\xae\xa1\xe7\x90\x86\xe5\xb7\xa5\xe4\xbd\x9c\xe6\xb5\x81\xe7\xa8\x8b","global_manual_review_required":false,"page_findings":[{"source_page":252,"page_heading":"p252","flows":[]},{"source_page":253,"page_heading":"p253","flows":[{"flow_heading":"f","audience_scope":"","steps":[{"step_id":"s1","step_text":"t","next_step_ids":[]}],"manual_review_notes":[]}]},{"source_page":254,"page_heading":"p254","flows":[]},{"source_page":255,"page_heading":"p255","flows":[]}]}}'
                    ),
                    content_type="application/json",
                )
                report = migrate_student_handbook_source_faithful(
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                        "OBJECT_STORE_BUCKET_DERIVED": DERIVED_BUCKET,
                        "REBUILD_CORPUS": "regulations",
                        "REBUILD_COLLECTION": "student_handbook",
                        "INGESTION_SPLIT_MANIFEST_PATH": "configs/ingestion/regulations/student_handbook/split-manifest.v1.json",
                        "HANDBOOK_SOURCE_PROJECTIONS_PATH": "configs/ingestion/regulations/student_handbook/source-projections.v1.json",
                        "RAW_VERSION_ID": raw_version_id,
                    },
                    object_store=object_store,
                    raw_asset_registry=raw_asset_registry,
                    document_registry=_FakeDocumentRegistry(),
                )

        self.assertEqual(report.canonical_raw_object_key, canonical_raw_key)
        self.assertIn((SOURCE_BUCKET, projection_artifact_key), object_store.puts)
        materialize.assert_called_once()

    def test_migrate_student_handbook_source_faithful_uses_runtime_manifest_override_when_building_request_from_env(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        raw_asset_registry = _FakeRawAssetRegistry()
        override_raw_asset_id = "asset:override-handbook-pdf"
        raw_version_id = "sha256:overridehash001"
        canonical_raw_key = (
            "official_pdf/override-handbook/2020/sha256/overridehash001/capture/学生手册_2020.pdf"
        )
        raw_asset_registry.records[(override_raw_asset_id, raw_version_id)] = SimpleNamespace(
            raw_asset_id=override_raw_asset_id,
            raw_version_id=raw_version_id,
            corpus="regulations",
            collection="student_handbook",
            raw_source_uri="s3://campus-rag-source/official_pdf/override-handbook/学生手册_2020.pdf",
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

            with (
                patch(
                    "campus_ingestion_core.handbook_source_migration.rebuild_local_data"
                ) as rebuild,
                patch(
                    "campus_ingestion_core.handbook_source_migration.materialize_handbook_service_navigation_projection_artifact"
                ) as materialize,
            ):
                rebuild.side_effect = lambda **kwargs: (
                    calls.append(kwargs)
                    or {"status": "rebuilt", "source_pdf": kwargs["env"]["REPLAY_SOURCE_PDF"]}
                )
                materialize.return_value = ProcessedArtifactInput(
                    object_key=build_source_projection_artifact_key(
                        raw_asset_id=override_raw_asset_id,
                        raw_version_id=raw_version_id,
                        projection_name="handbook_navigation_service_catalog",
                        filename="flow-graph.json",
                        year="2020",
                    ),
                    data=b'{"schema_version":"handbook_service_navigation_projection_v1","projection_name":"handbook_navigation_service_catalog","raw_asset_id":"asset:override-handbook-pdf","raw_version_id":"sha256:overridehash001","source_document_id":"handbook:test-override","source_uri":"x","source_handbook_section":"x","source_page_start":1,"source_page_end":1,"target_document_id":"campus_services:service_catalog:test","target_title":"x","extractor_runtime":{"kind":"prompt_runtime"},"flow_graph":{"document_title":"x","global_manual_review_required":false,"page_findings":[{"source_page":1,"page_heading":"a","flows":[{"flow_heading":"f","audience_scope":"","steps":[{"step_id":"s1","step_text":"t","next_step_ids":[]}],"manual_review_notes":[]}]}]}}',
                    content_type="application/json",
                )
                report = migrate_student_handbook_source_faithful(
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                        "OBJECT_STORE_BUCKET_DERIVED": DERIVED_BUCKET,
                        "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                        "RAW_VERSION_ID": raw_version_id,
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


if __name__ == "__main__":
    unittest.main()
