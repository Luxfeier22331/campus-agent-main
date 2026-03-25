from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord, RawAssetRef
from campus_ingestion_core.registry import (
    FileDocumentRegistry,
    FileRawAssetRegistry,
    PostgresDocumentRegistry,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)


HANDBOOK_DOC_UNITS_KEY = (
    "regulations/documents/student_handbook/test-001--test-001/"
    "source-faithful/undated/document-units.jsonl"
)
HANDBOOK_PROVIDER_KEY = (
    "regulations/sources/pdf_ocr/student-handbook/undated/sha256/raw-001/provider-response.jsonl"
)
HANDBOOK_CANONICAL_KEY = (
    "regulations/documents/student_handbook/test-001--test-001/source-faithful/undated/canonical.md"
)
CURRICULUM_DOC_UNITS_KEY = (
    "curriculum/documents/curriculum_plan/plan-001--plan-001/"
    "source-faithful/undated/document-units.jsonl"
)


def _handbook_document_record(*, version_id: str, content_hash: str, ingestion_timestamp: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="handbook:test-001",
        revision_track="source-faithful",
        version_id=version_id,
        source_uri="campusrag://canonical/regulations/student_handbook/docs/test-001.md",
        content_hash=content_hash,
        corpus="regulations",
        collection="student_handbook",
        cleaning_policy_version="student_handbook_cleaning_v1",
        acl_groups=("students",),
        campus_scope=None,
        status="active",
        ingestion_timestamp=ingestion_timestamp,
        parser_version="campusrag-import-v1",
        embedding_model="text-embedding-3-large",
        source_channel="pdf_ocr",
        raw_asset=RawAssetRef(
            raw_asset_id="asset:student-handbook-pdf",
            raw_version_id="sha256:raw-001",
            page_start=10,
            page_end=12,
        ),
        document_units_object_key=HANDBOOK_DOC_UNITS_KEY,
        provider_response_object_key=HANDBOOK_PROVIDER_KEY,
        canonical_markdown_object_key=HANDBOOK_CANONICAL_KEY,
        processed_object_keys=(
            HANDBOOK_PROVIDER_KEY,
            HANDBOOK_CANONICAL_KEY,
            HANDBOOK_DOC_UNITS_KEY,
        ),
        import_source="raw_online_ocr",
    )


def _curriculum_document_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="curriculum:plan-001",
        revision_track="source-faithful",
        version_id="sha256:raw-001:split:plan-001:abcd1234",
        source_uri="https://campus.example/curriculum/plan-001",
        content_hash="sha256:doc-001",
        corpus="curriculum",
        collection="curriculum_plan",
        acl_groups=(),
        campus_scope="main",
        status="active",
        ingestion_timestamp="2026-03-22T10:00:00+00:00",
        parser_version="curriculum-plan-ocr-v1",
        embedding_model="text-embedding-3-large",
        source_channel="pdf_ocr",
        raw_asset=RawAssetRef(
            raw_asset_id="asset:curriculum-plan-master-pdf",
            raw_version_id="sha256:raw-001",
            page_start=1,
            page_end=12,
        ),
        document_units_object_key=CURRICULUM_DOC_UNITS_KEY,
        processed_object_keys=(CURRICULUM_DOC_UNITS_KEY,),
        import_source="raw_online_ocr",
    )


def _handbook_raw_asset_record() -> RawAssetRecord:
    return RawAssetRecord(
        raw_asset_id="asset:student-handbook-pdf",
        raw_version_id="sha256:raw-001",
        corpus="regulations",
        collection="student_handbook",
        raw_source_uri="campusrag://raw/regulations/student_handbook/student-handbook.pdf",
        content_hash="raw-001",
        source_filename="student-handbook.pdf",
        object_key="pdf/student-handbook/undated/sha256/raw-001/student-handbook.pdf",
        ingestion_timestamp="2026-03-22T10:00:00+00:00",
        import_source="raw_online_ocr",
    )


def _curriculum_raw_asset_record() -> RawAssetRecord:
    return RawAssetRecord(
        raw_asset_id="asset:curriculum-plan-master-pdf",
        raw_version_id="sha256:raw-002",
        corpus="curriculum",
        collection="curriculum_plan",
        raw_source_uri="https://campus.example/curriculum/master.pdf",
        content_hash="raw-002",
        source_filename="curriculum-plan.pdf",
        object_key="pdf/curriculum-plan-master/undated/sha256/raw-002/curriculum-plan.pdf",
        ingestion_timestamp="2026-03-22T10:00:00+00:00",
        import_source="raw_online_ocr",
    )


class RegistryModelsTest(unittest.TestCase):
    def test_document_registry_record_serializes_required_fields(self) -> None:
        record = _handbook_document_record(
            version_id="v1:test-001",
            content_hash="sha256:test-001",
            ingestion_timestamp="2026-03-22T10:00:00+00:00",
        )

        payload = asdict(record)

        self.assertEqual(payload["document_id"], "handbook:test-001")
        self.assertEqual(payload["revision_track"], "source-faithful")
        self.assertEqual(payload["corpus"], "regulations")
        self.assertEqual(payload["collection"], "student_handbook")
        self.assertEqual(payload["cleaning_policy_version"], "student_handbook_cleaning_v1")
        self.assertEqual(payload["status"], "active")
        self.assertEqual(payload["import_source"], "raw_online_ocr")
        self.assertEqual(payload["source_channel"], "pdf_ocr")
        self.assertEqual(payload["raw_asset"]["raw_asset_id"], "asset:student-handbook-pdf")
        self.assertEqual(payload["raw_asset"]["raw_version_id"], "sha256:raw-001")
        self.assertEqual(payload["raw_asset"]["page_start"], 10)
        self.assertEqual(payload["raw_asset"]["page_end"], 12)
        self.assertEqual(
            payload["canonical_markdown_object_key"],
            HANDBOOK_CANONICAL_KEY,
        )

    def test_file_document_registry_upsert_and_get_are_stable(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = FileDocumentRegistry(Path(temp_dir) / "registry.json")
            record = _handbook_document_record(
                version_id="v1:test-001",
                content_hash="sha256:test-001",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
            )

            registry.upsert(record)
            loaded = registry.get("handbook:test-001", "source-faithful", "v1:test-001")

            self.assertEqual(loaded, record)

    def test_file_document_registry_lists_by_corpus_and_latest_versions(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = FileDocumentRegistry(Path(temp_dir) / "registry.json")
            v1 = _handbook_document_record(
                version_id="v1:test-001",
                content_hash="sha256:test-001",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
            )
            v2 = _handbook_document_record(
                version_id="v2:test-001",
                content_hash="sha256:test-002",
                ingestion_timestamp="2026-03-23T10:00:00+00:00",
            )

            registry.upsert(v1)
            registry.upsert(v2)

            records = registry.list_by_scope("regulations", "student_handbook")
            latest = registry.latest_versions("handbook:test-001")

            self.assertEqual(records, (v1, v2))
            self.assertEqual(latest, (v2,))

    def test_file_document_registry_upsert_many_persists_all_records(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = FileDocumentRegistry(Path(temp_dir) / "registry.json")
            handbook_record = _handbook_document_record(
                version_id="v1:test-001",
                content_hash="sha256:test-001",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
            )
            curriculum_record = _curriculum_document_record()

            registry.upsert_many((handbook_record, curriculum_record))

            self.assertEqual(
                registry.get("handbook:test-001", "source-faithful", "v1:test-001"),
                handbook_record,
            )
            self.assertEqual(
                registry.get(
                    "curriculum:plan-001",
                    "source-faithful",
                    "sha256:raw-001:split:plan-001:abcd1234",
                ),
                curriculum_record,
            )

    def test_file_document_registry_replace_scope_replaces_only_target_scope(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = FileDocumentRegistry(Path(temp_dir) / "registry.json")
            handbook_old = _handbook_document_record(
                version_id="v1:test-001",
                content_hash="sha256:test-001",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
            )
            handbook_new = _handbook_document_record(
                version_id="v2:test-001",
                content_hash="sha256:test-002",
                ingestion_timestamp="2026-03-23T10:00:00+00:00",
            )
            curriculum_record = _curriculum_document_record()
            registry.upsert(handbook_old)
            registry.upsert(curriculum_record)

            registry.replace_scope("regulations", "student_handbook", (handbook_new,))

            self.assertEqual(
                registry.list_by_scope("regulations", "student_handbook"),
                (handbook_new,),
            )
            self.assertEqual(
                registry.get(
                    "curriculum:plan-001",
                    "source-faithful",
                    "sha256:raw-001:split:plan-001:abcd1234",
                ),
                curriculum_record,
            )

    def test_file_document_registry_delete_by_corpus_removes_only_matching_records(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "registry.json"
            registry = FileDocumentRegistry(path)
            handbook_record = _handbook_document_record(
                version_id="v1:test-001",
                content_hash="sha256:test-001",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
            )
            curriculum_record = _curriculum_document_record()
            registry.upsert(handbook_record)
            registry.upsert(curriculum_record)

            registry.delete_by_scope("regulations", "student_handbook")

            self.assertIsNone(registry.get("handbook:test-001", "source-faithful", "v1:test-001"))
            self.assertEqual(
                registry.get(
                    "curriculum:plan-001",
                    "source-faithful",
                    "sha256:raw-001:split:plan-001:abcd1234",
                ),
                curriculum_record,
            )

    def test_file_document_registry_delete_document_removes_all_versions_for_document(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "registry.json"
            registry = FileDocumentRegistry(path)
            handbook_v1 = _handbook_document_record(
                version_id="v1:test-001",
                content_hash="sha256:test-001",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
            )
            handbook_v2 = _handbook_document_record(
                version_id="v2:test-001",
                content_hash="sha256:test-002",
                ingestion_timestamp="2026-03-23T10:00:00+00:00",
            )
            curriculum_record = _curriculum_document_record()
            registry.upsert(handbook_v1)
            registry.upsert(handbook_v2)
            registry.upsert(curriculum_record)

            registry.delete_document("handbook:test-001")

            self.assertIsNone(registry.get("handbook:test-001", "source-faithful", "v1:test-001"))
            self.assertIsNone(registry.get("handbook:test-001", "source-faithful", "v2:test-001"))
            self.assertEqual(
                registry.get(
                    "curriculum:plan-001",
                    "source-faithful",
                    "sha256:raw-001:split:plan-001:abcd1234",
                ),
                curriculum_record,
            )

    def test_file_document_registry_backfills_explicit_processed_keys_from_legacy_payload(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "registry.json"
            path.write_text(
                json.dumps(
                    {
                        "handbook:test-001::source-faithful::v1:test-001": {
                            "document_id": "handbook:test-001",
                            "revision_track": "source-faithful",
                            "version_id": "v1:test-001",
                            "source_uri": "campusrag://canonical/student_handbook/docs/test-001.md",
                            "content_hash": "sha256:test-001",
                            "corpus": "student_handbook",
                            "collection": "student_handbook",
                            "cleaning_policy_version": "student_handbook_cleaning_v1",
                            "acl_groups": ["students"],
                            "campus_scope": None,
                            "status": "active",
                            "ingestion_timestamp": "2026-03-22T10:00:00+00:00",
                            "parser_version": "campusrag-import-v1",
                            "embedding_model": "text-embedding-3-large",
                            "source_channel": "pdf_ocr",
                            "raw_asset": None,
                            "processed_object_keys": [
                                "student_handbook/documents/handbook/test-001/tracks/source-faithful/v1/test-001/provider-response.jsonl",
                                "student_handbook/documents/handbook/test-001/tracks/source-faithful/v1/test-001/canonical.md",
                                "student_handbook/documents/handbook/test-001/tracks/source-faithful/v1/test-001/document-units.jsonl",
                            ],
                            "import_source": "raw_online_ocr",
                        }
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            loaded = FileDocumentRegistry(path).get("handbook:test-001", "source-faithful", "v1:test-001")

            self.assertEqual(
                loaded.provider_response_object_key,
                "student_handbook/documents/handbook/test-001/tracks/source-faithful/v1/test-001/provider-response.jsonl",
            )
            self.assertEqual(loaded.corpus, "regulations")
            self.assertEqual(loaded.collection, "student_handbook")
            self.assertEqual(loaded.cleaning_policy_version, "student_handbook_cleaning_v1")
            self.assertEqual(
                loaded.canonical_markdown_object_key,
                "student_handbook/documents/handbook/test-001/tracks/source-faithful/v1/test-001/canonical.md",
            )
            self.assertEqual(
                loaded.document_units_object_key,
                "student_handbook/documents/handbook/test-001/tracks/source-faithful/v1/test-001/document-units.jsonl",
            )

    def test_file_raw_asset_registry_upsert_and_get_are_stable(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = FileRawAssetRegistry(Path(temp_dir) / "raw-assets.json")
            record = _handbook_raw_asset_record()

            registry.upsert(record)

            self.assertEqual(
                registry.get("asset:student-handbook-pdf", "sha256:raw-001"),
                record,
            )

    def test_file_raw_asset_registry_delete_by_corpus_removes_only_matching_records(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "raw-assets.json"
            registry = FileRawAssetRegistry(path)
            handbook_record = _handbook_raw_asset_record()
            curriculum_record = _curriculum_raw_asset_record()
            registry.upsert(handbook_record)
            registry.upsert(curriculum_record)

            registry.delete_by_scope("regulations", "student_handbook")

            self.assertIsNone(registry.get("asset:student-handbook-pdf", "sha256:raw-001"))
            self.assertEqual(
                registry.get("asset:curriculum-plan-master-pdf", "sha256:raw-002"),
                curriculum_record,
            )

    def test_curriculum_plan_records_are_supported(self) -> None:
        document_record = _curriculum_document_record()
        raw_asset_record = _curriculum_raw_asset_record()

        self.assertEqual(document_record.corpus, "curriculum")
        self.assertEqual(document_record.collection, "curriculum_plan")
        self.assertEqual(raw_asset_record.corpus, "curriculum")
        self.assertEqual(raw_asset_record.collection, "curriculum_plan")

    def test_build_document_registry_from_env_uses_database_url(self) -> None:
        with patch("campus_ingestion_core.registry.PostgresDocumentRegistry") as registry_cls:
            instance = registry_cls.return_value

            registry = build_document_registry_from_env(
                {"DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://registry.example/postgres"}
            )

            self.assertIs(registry, instance)
            registry_cls.assert_called_once_with("postgresql://registry.example/postgres")

    def test_build_raw_asset_registry_from_env_uses_database_url(self) -> None:
        with patch("campus_ingestion_core.registry.PostgresRawAssetRegistry") as registry_cls:
            instance = registry_cls.return_value

            registry = build_raw_asset_registry_from_env(
                {"DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://registry.example/postgres"}
            )

            self.assertIs(registry, instance)
            registry_cls.assert_called_once_with("postgresql://registry.example/postgres")

    def test_build_raw_asset_registry_from_env_prefers_dedicated_database_url(self) -> None:
        with patch("campus_ingestion_core.registry.PostgresRawAssetRegistry") as registry_cls:
            instance = registry_cls.return_value

            registry = build_raw_asset_registry_from_env(
                {
                    "RAW_ASSET_REGISTRY_DATABASE_URL": "postgresql://raw-registry.example/postgres",
                    "DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://document-registry.example/postgres",
                }
            )

            self.assertIs(registry, instance)
            registry_cls.assert_called_once_with("postgresql://raw-registry.example/postgres")

    def test_build_raw_asset_registry_from_env_accepts_dedicated_database_url_without_document_registry(self) -> None:
        with patch("campus_ingestion_core.registry.PostgresRawAssetRegistry") as registry_cls:
            instance = registry_cls.return_value

            registry = build_raw_asset_registry_from_env(
                {"RAW_ASSET_REGISTRY_DATABASE_URL": "postgresql://raw-registry.example/postgres"}
            )

            self.assertIs(registry, instance)
            registry_cls.assert_called_once_with("postgresql://raw-registry.example/postgres")

    def test_postgres_document_registry_delete_document_targets_document_id(self) -> None:
        with patch.object(PostgresDocumentRegistry, "_ensure_schema", return_value=None):
            registry = PostgresDocumentRegistry("postgresql://registry.example/postgres")
        with patch.object(registry, "_execute") as execute:
            registry.delete_document("handbook:bf03f0bd6930e89bcc6d2733c1e87a423b510675")

        execute.assert_called_once_with(
            "delete from document_registry_records where document_id = %s",
            ("handbook:bf03f0bd6930e89bcc6d2733c1e87a423b510675",),
        )

    def test_registry_builders_require_database_url(self) -> None:
        with self.assertRaisesRegex(ValueError, "DOCUMENT_REGISTRY_DATABASE_URL"):
            build_document_registry_from_env({})
        with self.assertRaisesRegex(
            ValueError, "RAW_ASSET_REGISTRY_DATABASE_URL or DOCUMENT_REGISTRY_DATABASE_URL"
        ):
            build_raw_asset_registry_from_env({})


if __name__ == "__main__":
    unittest.main()
