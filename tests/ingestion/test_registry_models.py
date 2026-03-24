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
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)


class RegistryModelsTest(unittest.TestCase):
    def test_document_registry_record_serializes_required_fields(self) -> None:
        record = DocumentRegistryRecord(
            document_id="handbook:test-001",
            version_id="v1:test-001",
            source_uri="campusrag://canonical/student_handbook/docs/test-001.md",
            content_hash="sha256:test-001",
            corpus="student_handbook",
            cleaning_policy_version="student_handbook_cleaning_v1",
            acl_groups=("students",),
            campus_scope=None,
            status="active",
            ingestion_timestamp="2026-03-22T10:00:00+00:00",
            parser_version="campusrag-import-v1",
            embedding_model="text-embedding-3-large",
            raw_asset=RawAssetRef(
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:raw-001",
                page_start=10,
                page_end=12,
            ),
            structured_object_key="student_handbook/documents/handbook/test-001/v1/test-001/structured.jsonl",
            provider_result_object_key="student_handbook/documents/handbook/test-001/v1/test-001/provider-result.jsonl",
            processed_object_keys=("student_handbook/documents/handbook/test-001/v1/test-001/structured.jsonl",),
            import_source="campusrag_existing_ocr",
        )

        payload = asdict(record)

        self.assertEqual(payload["document_id"], "handbook:test-001")
        self.assertEqual(payload["corpus"], "student_handbook")
        self.assertEqual(payload["cleaning_policy_version"], "student_handbook_cleaning_v1")
        self.assertEqual(payload["status"], "active")
        self.assertEqual(payload["import_source"], "campusrag_existing_ocr")
        self.assertEqual(payload["raw_asset"]["raw_asset_id"], "asset:student-handbook-pdf")
        self.assertEqual(payload["raw_asset"]["raw_version_id"], "sha256:raw-001")
        self.assertEqual(payload["raw_asset"]["page_start"], 10)
        self.assertEqual(payload["raw_asset"]["page_end"], 12)

    def test_file_document_registry_upsert_and_get_are_stable(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = FileDocumentRegistry(Path(temp_dir) / "registry.json")
            record = DocumentRegistryRecord(
                document_id="handbook:test-001",
                version_id="v1:test-001",
                source_uri="campusrag://canonical/student_handbook/docs/test-001.md",
                content_hash="sha256:test-001",
                corpus="student_handbook",
                cleaning_policy_version="student_handbook_cleaning_v1",
                acl_groups=("students",),
                campus_scope=None,
                status="active",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
                parser_version="campusrag-import-v1",
                embedding_model="text-embedding-3-large",
                raw_asset=RawAssetRef(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id="sha256:raw-001",
                    page_start=10,
                    page_end=12,
                ),
                structured_object_key="student_handbook/documents/handbook/test-001/v1/test-001/structured.jsonl",
                provider_result_object_key="student_handbook/documents/handbook/test-001/v1/test-001/provider-result.jsonl",
                processed_object_keys=("student_handbook/documents/handbook/test-001/v1/test-001/structured.jsonl",),
                import_source="campusrag_existing_ocr",
            )

            registry.upsert(record)
            loaded = registry.get("handbook:test-001", "v1:test-001")

            self.assertEqual(loaded, record)

    def test_file_document_registry_lists_by_corpus_and_latest_versions(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = FileDocumentRegistry(Path(temp_dir) / "registry.json")
            v1 = DocumentRegistryRecord(
                document_id="handbook:test-001",
                version_id="v1:test-001",
                source_uri="campusrag://canonical/student_handbook/docs/test-001.md",
                content_hash="sha256:test-001",
                corpus="student_handbook",
                cleaning_policy_version="student_handbook_cleaning_v1",
                acl_groups=("students",),
                campus_scope=None,
                status="active",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
                parser_version="campusrag-import-v1",
                embedding_model="text-embedding-3-large",
                raw_asset=RawAssetRef(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id="sha256:raw-001",
                    page_start=10,
                    page_end=12,
                ),
                structured_object_key="student_handbook/documents/handbook/test-001/v1/test-001/structured.jsonl",
                provider_result_object_key="student_handbook/documents/handbook/test-001/v1/test-001/provider-result.jsonl",
                processed_object_keys=("student_handbook/documents/handbook/test-001/v1/test-001/structured.jsonl",),
                import_source="campusrag_existing_ocr",
            )
            v2 = DocumentRegistryRecord(
                document_id="handbook:test-001",
                version_id="v2:test-001",
                source_uri="campusrag://canonical/student_handbook/docs/test-001.md",
                content_hash="sha256:test-002",
                corpus="student_handbook",
                cleaning_policy_version="student_handbook_cleaning_v2",
                acl_groups=("students",),
                campus_scope=None,
                status="active",
                ingestion_timestamp="2026-03-23T10:00:00+00:00",
                parser_version="campusrag-import-v1",
                embedding_model="text-embedding-3-large",
                raw_asset=RawAssetRef(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id="sha256:raw-002",
                    page_start=10,
                    page_end=12,
                ),
                structured_object_key="student_handbook/documents/handbook/test-001/v2/test-001/structured.jsonl",
                provider_result_object_key="student_handbook/documents/handbook/test-001/v2/test-001/provider-result.jsonl",
                processed_object_keys=("student_handbook/documents/handbook/test-001/v2/test-001/structured.jsonl",),
                import_source="campusrag_existing_ocr",
            )

            registry.upsert(v1)
            registry.upsert(v2)

            records = registry.list_by_corpus("student_handbook")
            latest = registry.latest_versions("handbook:test-001")

            self.assertEqual(records, (v1, v2))
            self.assertEqual(latest, (v2,))

    def test_file_document_registry_delete_by_corpus_removes_only_matching_records(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "registry.json"
            registry = FileDocumentRegistry(path)
            handbook_record = DocumentRegistryRecord(
                document_id="handbook:test-001",
                version_id="v1:test-001",
                source_uri="campusrag://canonical/student_handbook/docs/test-001.md",
                content_hash="sha256:test-001",
                corpus="student_handbook",
                cleaning_policy_version="student_handbook_cleaning_v1",
                acl_groups=(),
                campus_scope=None,
                status="active",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
                parser_version="campusrag-import-v1",
                embedding_model="text-embedding-3-large",
                raw_asset=None,
                structured_object_key="student_handbook/documents/handbook/test-001/v1/test-001/structured.jsonl",
                provider_result_object_key=None,
                processed_object_keys=("student_handbook/documents/handbook/test-001/v1/test-001/structured.jsonl",),
                import_source="campusrag_existing_ocr",
            )
            curriculum_record = DocumentRegistryRecord(
                document_id="curriculum:plan-001",
                version_id="sha256:raw-001:split:plan-001:abcd1234",
                source_uri="campusrag://source/curriculum_plan/curriculum-plan-master-pdf/sha256/raw-001/pages/1-12",
                content_hash="sha256:doc-001",
                corpus="curriculum_plan",
                cleaning_policy_version="curriculum_plan_cleaning_v1",
                acl_groups=(),
                campus_scope="main",
                status="active",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
                parser_version="curriculum-plan-ocr-v1",
                embedding_model="text-embedding-3-large",
                raw_asset=None,
                structured_object_key=(
                    "curriculum_plan/documents/curriculum/plan-001/sha256/raw-001/split/plan-001/abcd1234/structured.jsonl"
                ),
                provider_result_object_key=None,
                processed_object_keys=(
                    "curriculum_plan/documents/curriculum/plan-001/sha256/raw-001/split/plan-001/abcd1234/structured.jsonl",
                ),
                import_source="raw_online_ocr",
            )
            registry.upsert(handbook_record)
            registry.upsert(curriculum_record)

            registry.delete_by_corpus("student_handbook")

            self.assertIsNone(registry.get("handbook:test-001", "v1:test-001"))
            self.assertEqual(
                registry.get("curriculum:plan-001", "sha256:raw-001:split:plan-001:abcd1234"),
                curriculum_record,
            )

    def test_file_document_registry_backfills_explicit_processed_keys_from_legacy_payload(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "registry.json"
            path.write_text(
                json.dumps(
                    {
                        "handbook:test-001::v1:test-001": {
                            "document_id": "handbook:test-001",
                            "version_id": "v1:test-001",
                            "source_uri": "campusrag://canonical/student_handbook/docs/test-001.md",
                            "content_hash": "sha256:test-001",
                            "corpus": "student_handbook",
                            "cleaning_policy_version": "student_handbook_cleaning_v1",
                            "acl_groups": ["students"],
                            "campus_scope": None,
                            "status": "active",
                            "ingestion_timestamp": "2026-03-22T10:00:00+00:00",
                            "parser_version": "campusrag-import-v1",
                            "embedding_model": "text-embedding-3-large",
                            "raw_asset": None,
                            "processed_object_keys": [
                                "student_handbook/documents/handbook/test-001/v1/test-001/provider-result.jsonl",
                                "student_handbook/documents/handbook/test-001/v1/test-001/structured.jsonl",
                            ],
                            "import_source": "raw_online_ocr",
                        }
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            loaded = FileDocumentRegistry(path).get("handbook:test-001", "v1:test-001")

            self.assertEqual(
                loaded.provider_result_object_key,
                "student_handbook/documents/handbook/test-001/v1/test-001/provider-result.jsonl",
            )
            self.assertEqual(loaded.cleaning_policy_version, "student_handbook_cleaning_v1")
            self.assertEqual(
                loaded.structured_object_key,
                "student_handbook/documents/handbook/test-001/v1/test-001/structured.jsonl",
            )

    def test_file_raw_asset_registry_upsert_and_get_are_stable(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = FileRawAssetRegistry(Path(temp_dir) / "raw-assets.json")
            record = RawAssetRecord(
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:raw-001",
                corpus="student_handbook",
                raw_source_uri="campusrag://raw/student_handbook/student-handbook.pdf",
                content_hash="raw-001",
                source_filename="student-handbook.pdf",
                object_key="student_handbook/assets/student-handbook-pdf/sha256/raw-001/student-handbook.pdf",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
                import_source="campusrag_existing_ocr",
            )

            registry.upsert(record)

            self.assertEqual(
                registry.get("asset:student-handbook-pdf", "sha256:raw-001"),
                record,
            )

    def test_file_raw_asset_registry_delete_by_corpus_removes_only_matching_records(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "raw-assets.json"
            registry = FileRawAssetRegistry(path)
            handbook_record = RawAssetRecord(
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:raw-001",
                corpus="student_handbook",
                raw_source_uri="campusrag://raw/student_handbook/student-handbook.pdf",
                content_hash="raw-001",
                source_filename="student-handbook.pdf",
                object_key="student_handbook/assets/student-handbook-pdf/sha256/raw-001/student-handbook.pdf",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
                import_source="campusrag_existing_ocr",
            )
            curriculum_record = RawAssetRecord(
                raw_asset_id="asset:curriculum-plan-master-pdf",
                raw_version_id="sha256:raw-002",
                corpus="curriculum_plan",
                raw_source_uri="https://campus.example/curriculum/master.pdf",
                content_hash="raw-002",
                source_filename="curriculum-plan.pdf",
                object_key="curriculum_plan/assets/curriculum-plan-master-pdf/sha256/raw-002/curriculum-plan.pdf",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
                import_source="raw_online_ocr",
            )
            registry.upsert(handbook_record)
            registry.upsert(curriculum_record)

            registry.delete_by_corpus("student_handbook")

            self.assertIsNone(registry.get("asset:student-handbook-pdf", "sha256:raw-001"))
            self.assertEqual(
                registry.get("asset:curriculum-plan-master-pdf", "sha256:raw-002"),
                curriculum_record,
            )

    def test_curriculum_plan_records_are_supported(self) -> None:
        document_record = DocumentRegistryRecord(
            document_id="curriculum:plan-001",
            version_id="sha256:raw-001:split:plan-001",
            source_uri="campusrag://source/curriculum_plan/curriculum-plan-master-pdf/sha256/raw-001/pages/1-12",
            content_hash="sha256:doc-001",
            corpus="curriculum_plan",
            acl_groups=(),
            campus_scope="main",
            status="active",
            ingestion_timestamp="2026-03-22T10:00:00+00:00",
            parser_version="curriculum-plan-ocr-v1",
            embedding_model="text-embedding-3-large",
            raw_asset=RawAssetRef(
                raw_asset_id="asset:curriculum-plan-master-pdf",
                raw_version_id="sha256:raw-001",
                page_start=1,
                page_end=12,
            ),
            structured_object_key=(
                "curriculum_plan/documents/curriculum/plan-001/sha256/raw-001/split/plan-001/structured.jsonl"
            ),
            processed_object_keys=(
                "curriculum_plan/documents/curriculum/plan-001/sha256/raw-001/split/plan-001/structured.jsonl",
            ),
            import_source="raw_online_ocr",
        )
        raw_asset_record = RawAssetRecord(
            raw_asset_id="asset:curriculum-plan-master-pdf",
            raw_version_id="sha256:raw-001",
            corpus="curriculum_plan",
            raw_source_uri="https://campus.example/curriculum/master.pdf",
            content_hash="raw-001",
            source_filename="curriculum-plan.pdf",
            object_key="curriculum_plan/assets/curriculum-plan-master-pdf/sha256/raw-001/curriculum-plan.pdf",
            ingestion_timestamp="2026-03-22T10:00:00+00:00",
            import_source="raw_online_ocr",
        )

        self.assertEqual(document_record.corpus, "curriculum_plan")
        self.assertEqual(raw_asset_record.corpus, "curriculum_plan")

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

    def test_registry_builders_require_database_url(self) -> None:
        with self.assertRaisesRegex(ValueError, "DOCUMENT_REGISTRY_DATABASE_URL"):
            build_document_registry_from_env({})
        with self.assertRaisesRegex(ValueError, "DOCUMENT_REGISTRY_DATABASE_URL"):
            build_raw_asset_registry_from_env({})


if __name__ == "__main__":
    unittest.main()
