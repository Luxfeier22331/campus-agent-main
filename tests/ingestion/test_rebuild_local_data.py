from __future__ import annotations

from types import SimpleNamespace
import unittest
from unittest.mock import patch

from campus_ingestion_core.local_rebuild import migrate_student_handbook_source_faithful, rebuild_local_data
from campus_ingestion_core.models import RawAssetRecord


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


class RebuildLocalDataTest(unittest.TestCase):
    def test_rebuild_clears_minio_and_registry_without_touching_qdrant_by_default(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        qdrant = _FakeQdrantAdmin()
        document_registry = _FakeDocumentRegistryWithRecords(
            _FakeDocumentRecord(
                corpus="regulations",
                collection="student_handbook",
                processed_object_keys=(
                    "regulations/sources/pdf_ocr/student-handbook/undated/sha256/raw-001/provider-response.jsonl",
                    "regulations/sources/pdf_ocr/student-handbook/undated/sha256/raw-001/layout-elements.jsonl",
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
                "OBJECT_STORE_BUCKET_RAW": "campus-rag-raw",
                "OBJECT_STORE_BUCKET_PROCESSED": "campus-rag-processed",
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
                ("campus-rag-raw", "pdf/student-handbook/undated/sha256/raw-001/student-handbook.pdf", ()),
                (
                    "campus-rag-processed",
                    "regulations/sources/pdf_ocr/student-handbook/undated/sha256/raw-001/provider-response.jsonl",
                    (),
                ),
                (
                    "campus-rag-processed",
                    "regulations/sources/pdf_ocr/student-handbook/undated/sha256/raw-001/layout-elements.jsonl",
                    (),
                ),
                (
                    "campus-rag-processed",
                    "regulations/documents/student_handbook/test-001--test-001/source-faithful/2018/canonical.md",
                    (),
                ),
                (
                    "campus-rag-processed",
                    "regulations/documents/student_handbook/test-001--test-001/source-faithful/2018/document-units.jsonl",
                    (),
                ),
            ],
        )
        self.assertEqual(qdrant.reset_collections, [])
        self.assertEqual(document_registry.deleted_scopes, [("regulations", "student_handbook")])
        self.assertEqual(raw_asset_registry.deleted_scopes, [("regulations", "student_handbook")])
        self.assertEqual(calls, [report.import_env])
        self.assertEqual(report.import_result, {"status": "ok"})

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
            "regulations/sources/pdf_ocr/student-handbook/undated/sha256/"
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
                    "curriculum/sources/pdf_ocr/curriculum-plan-master/undated/sha256/raw-001/provider-response.jsonl",
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
                ("campus-rag-raw", "pdf/curriculum-plan-master/undated/sha256/raw-001/curriculum-plan.pdf", ()),
                (
                    "campus-rag-processed",
                    "curriculum/sources/pdf_ocr/curriculum-plan-master/undated/sha256/raw-001/provider-response.jsonl",
                    (),
                ),
                (
                    "campus-rag-processed",
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
        self.assertEqual(raw_asset_registry.deleted_scopes, [("curriculum", "curriculum_plan")])
        self.assertEqual(calls, [report.import_env])
        self.assertEqual(report.import_result, {"status": "raw"})

    def test_rebuild_provider_response_replay_preserves_source_key_in_processed_bucket(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        document_registry = _FakeDocumentRegistry()
        raw_asset_registry = _FakeRawAssetRegistry()
        calls: list[dict[str, str]] = []
        source_key = (
            "regulations/sources/pdf_ocr/student-handbook/undated/sha256/"
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

        self.assertEqual(
            object_store.cleared_prefixes,
            [
                (
                    "campus-rag-processed",
                    "regulations/sources/pdf_ocr/student-handbook/undated/sha256/"
                    "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/layout-elements.jsonl",
                    (),
                ),
            ],
        )
        self.assertEqual(document_registry.deleted_scopes, [])
        self.assertEqual(raw_asset_registry.deleted_scopes, [])
        self.assertEqual(calls, [report.import_env])
        self.assertEqual(report.import_result, {"status": "replay"})

    def test_migrate_student_handbook_source_faithful_renames_raw_asset_and_dispatches_rebuild(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        raw_asset_registry = _FakeRawAssetRegistry()
        old_raw_key = (
            "pdf/student-handbook/undated/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/student-handbook.pdf"
        )
        provider_response_key = (
            "regulations/sources/pdf_ocr/student-handbook/undated/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider-response.jsonl"
        )
        object_store.objects[("campus-rag-raw", old_raw_key)] = b"%PDF-1.4 handbook"
        raw_asset_registry.upsert(
            RawAssetRecord(
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                corpus="regulations",
                collection="student_handbook",
                raw_source_uri="s3://campus-rag-raw/pdf/student-handbook/student-handbook.pdf",
                content_hash="b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                source_filename="student-handbook.pdf",
                object_key=old_raw_key,
                ingestion_timestamp="2026-03-24T00:00:00+00:00",
                import_source="seed",
            )
        )
        calls: list[dict[str, str]] = []

        with patch("campus_ingestion_core.local_rebuild.rebuild_local_data") as rebuild:
            rebuild.side_effect = (
                lambda **kwargs: calls.append(kwargs["env"])
                or {"status": "rebuilt", "source_pdf": kwargs["env"]["REPLAY_SOURCE_PDF"]}
            )
            report = migrate_student_handbook_source_faithful(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_RAW": "campus-rag-raw",
                    "OBJECT_STORE_BUCKET_PROCESSED": "campus-rag-processed",
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
        self.assertIn(("campus-rag-raw", new_raw_key), object_store.puts)
        self.assertEqual(calls[0]["REBUILD_IMPORT_MODE"], "provider_response_replay")
        self.assertEqual(calls[0]["REPLAY_SOURCE_PDF"], "学生手册_2018.pdf")

    def test_migrate_student_handbook_source_faithful_refreshes_legacy_scope_when_raw_key_is_already_canonical(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        raw_asset_registry = _FakeRawAssetRegistry()
        canonical_raw_key = (
            "pdf/student-handbook/2018/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/学生手册_2018.pdf"
        )
        provider_response_key = (
            "regulations/sources/pdf_ocr/student-handbook/2018/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider-response.jsonl"
        )
        raw_asset_registry.records[
            ("asset:student-handbook-pdf", "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1")
        ] = SimpleNamespace(
            raw_asset_id="asset:student-handbook-pdf",
            raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            corpus="student_handbook",
            collection="student_handbook",
            raw_source_uri="s3://campus-rag-raw/pdf/student-handbook/学生手册_2018.pdf",
            content_hash="b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            source_filename="学生手册_2018.pdf",
            object_key=canonical_raw_key,
            ingestion_timestamp="2026-03-24T00:00:00+00:00",
            import_source="seed",
        )
        calls: list[dict[str, str]] = []

        with patch("campus_ingestion_core.local_rebuild.rebuild_local_data") as rebuild:
            rebuild.side_effect = (
                lambda **kwargs: calls.append(kwargs["env"])
                or {"status": "rebuilt", "source_pdf": kwargs["env"]["REPLAY_SOURCE_PDF"]}
            )
            report = migrate_student_handbook_source_faithful(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_RAW": "campus-rag-raw",
                    "OBJECT_STORE_BUCKET_PROCESSED": "campus-rag-processed",
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
        self.assertEqual(calls[0]["REBUILD_IMPORT_MODE"], "provider_response_replay")


if __name__ == "__main__":
    unittest.main()
