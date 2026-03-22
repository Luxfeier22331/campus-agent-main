from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.registry import FileDocumentRegistry


class RegistryModelsTest(unittest.TestCase):
    def test_document_registry_record_serializes_required_fields(self) -> None:
        record = DocumentRegistryRecord(
            document_id="handbook:test-001",
            version_id="v1:test-001",
            source_uri="campusrag://canonical/student_handbook/docs/test-001.md",
            content_hash="sha256:test-001",
            corpus="student_handbook",
            acl_groups=("students",),
            campus_scope=None,
            status="active",
            ingestion_timestamp="2026-03-22T10:00:00+00:00",
            parser_version="campusrag-import-v1",
            embedding_model="text-embedding-3-large",
            raw_object_key="student_handbook/handbook:test-001/v1:test-001/student-handbook.pdf",
            raw_content_hash="raw-001",
            raw_source_filename="student-handbook.pdf",
            raw_page_start=10,
            raw_page_end=12,
            structured_object_key="student_handbook/handbook:test-001/v1:test-001/structured.jsonl",
            provider_result_object_key="student_handbook/handbook:test-001/v1:test-001/provider-result.jsonl",
            processed_object_keys=("student_handbook/handbook:test-001/v1:test-001/structured.jsonl",),
            import_source="campusrag_existing_ocr",
        )

        payload = asdict(record)

        self.assertEqual(payload["document_id"], "handbook:test-001")
        self.assertEqual(payload["corpus"], "student_handbook")
        self.assertEqual(payload["status"], "active")
        self.assertEqual(payload["import_source"], "campusrag_existing_ocr")
        self.assertEqual(payload["raw_content_hash"], "raw-001")
        self.assertEqual(payload["raw_source_filename"], "student-handbook.pdf")
        self.assertEqual(payload["raw_page_start"], 10)
        self.assertEqual(payload["raw_page_end"], 12)
        self.assertEqual(
            payload["structured_object_key"],
            "student_handbook/handbook:test-001/v1:test-001/structured.jsonl",
        )
        self.assertEqual(
            payload["provider_result_object_key"],
            "student_handbook/handbook:test-001/v1:test-001/provider-result.jsonl",
        )

    def test_file_registry_upsert_and_get_are_stable(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = FileDocumentRegistry(Path(temp_dir) / "registry.json")
            record = DocumentRegistryRecord(
                document_id="handbook:test-001",
                version_id="v1:test-001",
                source_uri="campusrag://canonical/student_handbook/docs/test-001.md",
                content_hash="sha256:test-001",
                corpus="student_handbook",
                acl_groups=("students",),
                campus_scope=None,
                status="active",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
                parser_version="campusrag-import-v1",
                embedding_model="text-embedding-3-large",
                raw_object_key="student_handbook/handbook:test-001/v1:test-001/student-handbook.pdf",
                raw_content_hash="raw-001",
                raw_source_filename="student-handbook.pdf",
                raw_page_start=10,
                raw_page_end=12,
                structured_object_key="student_handbook/handbook:test-001/v1:test-001/structured.jsonl",
                provider_result_object_key="student_handbook/handbook:test-001/v1:test-001/provider-result.jsonl",
                processed_object_keys=("student_handbook/handbook:test-001/v1:test-001/structured.jsonl",),
                import_source="campusrag_existing_ocr",
            )

            registry.upsert(record)
            loaded = registry.get("handbook:test-001", "v1:test-001")

            self.assertEqual(loaded, record)

    def test_file_registry_lists_by_corpus_and_latest_versions(self) -> None:
        with TemporaryDirectory() as temp_dir:
            registry = FileDocumentRegistry(Path(temp_dir) / "registry.json")
            v1 = DocumentRegistryRecord(
                document_id="handbook:test-001",
                version_id="v1:test-001",
                source_uri="campusrag://canonical/student_handbook/docs/test-001.md",
                content_hash="sha256:test-001",
                corpus="student_handbook",
                acl_groups=("students",),
                campus_scope=None,
                status="active",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
                parser_version="campusrag-import-v1",
                embedding_model="text-embedding-3-large",
                raw_object_key="student_handbook/handbook:test-001/v1:test-001/student-handbook.pdf",
                raw_content_hash="raw-001",
                raw_source_filename="student-handbook.pdf",
                raw_page_start=10,
                raw_page_end=12,
                structured_object_key="student_handbook/handbook:test-001/v1:test-001/structured.jsonl",
                provider_result_object_key="student_handbook/handbook:test-001/v1:test-001/provider-result.jsonl",
                processed_object_keys=("student_handbook/handbook:test-001/v1:test-001/structured.jsonl",),
                import_source="campusrag_existing_ocr",
            )
            v2 = DocumentRegistryRecord(
                document_id="handbook:test-001",
                version_id="v2:test-001",
                source_uri="campusrag://canonical/student_handbook/docs/test-001.md",
                content_hash="sha256:test-002",
                corpus="student_handbook",
                acl_groups=("students",),
                campus_scope=None,
                status="active",
                ingestion_timestamp="2026-03-23T10:00:00+00:00",
                parser_version="campusrag-import-v1",
                embedding_model="text-embedding-3-large",
                raw_object_key="student_handbook/handbook:test-001/v2:test-001/student-handbook.pdf",
                raw_content_hash="raw-002",
                raw_source_filename="student-handbook.pdf",
                raw_page_start=10,
                raw_page_end=12,
                structured_object_key="student_handbook/handbook:test-001/v2:test-001/structured.jsonl",
                provider_result_object_key="student_handbook/handbook:test-001/v2:test-001/provider-result.jsonl",
                processed_object_keys=("student_handbook/handbook:test-001/v2:test-001/structured.jsonl",),
                import_source="campusrag_existing_ocr",
            )

            registry.upsert(v1)
            registry.upsert(v2)

            records = registry.list_by_corpus("student_handbook")
            latest = registry.latest_versions("handbook:test-001")

            self.assertEqual(records, (v1, v2))
            self.assertEqual(latest, (v2,))

    def test_file_registry_backfills_explicit_processed_keys_from_legacy_payload(self) -> None:
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
                            "acl_groups": ["students"],
                            "campus_scope": None,
                            "status": "active",
                            "ingestion_timestamp": "2026-03-22T10:00:00+00:00",
                            "parser_version": "campusrag-import-v1",
                            "embedding_model": "text-embedding-3-large",
                            "raw_object_key": None,
                            "raw_content_hash": None,
                            "raw_source_filename": None,
                            "raw_page_start": None,
                            "raw_page_end": None,
                            "processed_object_keys": [
                                "student_handbook/handbook:test-001/v1:test-001/provider-result.jsonl",
                                "student_handbook/handbook:test-001/v1:test-001/structured.jsonl",
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
                "student_handbook/handbook:test-001/v1:test-001/provider-result.jsonl",
            )
            self.assertEqual(
                loaded.structured_object_key,
                "student_handbook/handbook:test-001/v1:test-001/structured.jsonl",
            )


if __name__ == "__main__":
    unittest.main()
