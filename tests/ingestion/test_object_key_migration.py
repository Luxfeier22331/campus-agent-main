from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_ingestion_core.object_key_migration import migrate_registry_object_keys
from campus_ingestion_core.registry import FileDocumentRegistry
from campus_ingestion_core.models import DocumentRegistryRecord


class _FakeMigratingObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes]) -> None:
        self.objects = dict(objects)
        self.copied: list[tuple[str, str, str, str]] = []
        self.deleted: list[tuple[str, str]] = []

    def has_object(self, *, bucket: str, key: str) -> bool:
        return (bucket, key) in self.objects

    def copy_object(
        self,
        *,
        source_bucket: str,
        source_key: str,
        target_bucket: str,
        target_key: str,
    ) -> None:
        self.objects[(target_bucket, target_key)] = self.objects[(source_bucket, source_key)]
        self.copied.append((source_bucket, source_key, target_bucket, target_key))

    def delete_object(self, *, bucket: str, key: str) -> None:
        self.objects.pop((bucket, key), None)
        self.deleted.append((bucket, key))


class ObjectKeyMigrationTest(unittest.TestCase):
    def test_migration_copies_objects_updates_registry_and_deletes_legacy_keys(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            registry = FileDocumentRegistry(root / "registry.json")
            record = DocumentRegistryRecord(
                document_id="handbook:test-001",
                version_id="v1:test-001",
                source_uri="campusrag://canonical/student_handbook/docs/test-001.md",
                content_hash="sha256:test-001",
                corpus="student_handbook",
                ingestion_timestamp="2026-03-22T10:00:00+00:00",
                parser_version="campusrag-import-v1",
                embedding_model="text-embedding-3-large",
                raw_object_key="student_handbook/raw-source:test-001/sha256:raw-001/raw/test-001.pdf",
                raw_content_hash="raw-001",
                raw_source_filename="test-001.pdf",
                structured_object_key="student_handbook/handbook:test-001/v1:test-001/processed/structured.jsonl",
                provider_result_object_key="student_handbook/handbook:test-001/v1:test-001/processed/provider-result.jsonl",
                processed_object_keys=(
                    "student_handbook/handbook:test-001/v1:test-001/processed/provider-result.jsonl",
                    "student_handbook/handbook:test-001/v1:test-001/processed/structured.jsonl",
                ),
                import_source="raw_online_ocr",
            )
            registry.upsert(record)
            object_store = _FakeMigratingObjectStore(
                {
                    ("campus-rag-raw", record.raw_object_key): b"%PDF-1.4 test-001",
                    ("campus-rag-processed", record.provider_result_object_key): b'{"provider": true}\n',
                    ("campus-rag-processed", record.structured_object_key): b'{"structured": true}\n',
                }
            )

            report = migrate_registry_object_keys(registry=registry, object_store=object_store)

            migrated = registry.get("handbook:test-001", "v1:test-001")
            self.assertEqual(report.migrated_count, 1)
            self.assertEqual(report.skipped_count, 0)
            self.assertEqual(report.failed_count, 0)
            self.assertEqual(
                migrated.raw_object_key,
                "student_handbook/handbook:test-001/v1:test-001/test-001.pdf",
            )
            self.assertEqual(
                migrated.provider_result_object_key,
                "student_handbook/handbook:test-001/v1:test-001/provider-result.jsonl",
            )
            self.assertEqual(
                migrated.structured_object_key,
                "student_handbook/handbook:test-001/v1:test-001/structured.jsonl",
            )
            self.assertEqual(
                migrated.processed_object_keys,
                (
                    "student_handbook/handbook:test-001/v1:test-001/provider-result.jsonl",
                    "student_handbook/handbook:test-001/v1:test-001/structured.jsonl",
                ),
            )
            self.assertIn(
                ("campus-rag-raw", "student_handbook/handbook:test-001/v1:test-001/test-001.pdf"),
                object_store.objects,
            )
            self.assertIn(
                ("campus-rag-processed", "student_handbook/handbook:test-001/v1:test-001/provider-result.jsonl"),
                object_store.objects,
            )
            self.assertIn(
                ("campus-rag-processed", "student_handbook/handbook:test-001/v1:test-001/structured.jsonl"),
                object_store.objects,
            )
            self.assertNotIn(("campus-rag-raw", record.raw_object_key), object_store.objects)

    def test_migration_handles_multiple_records_sharing_one_legacy_raw_object(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            registry = FileDocumentRegistry(root / "registry.json")
            shared_raw_key = "student_handbook/raw-source:shared/sha256:raw-001/raw/student-handbook.pdf"
            records = (
                DocumentRegistryRecord(
                    document_id="handbook:test-001",
                    version_id="v1:test-001",
                    source_uri="campusrag://canonical/student_handbook/docs/test-001.md",
                    content_hash="sha256:test-001",
                    corpus="student_handbook",
                    ingestion_timestamp="2026-03-22T10:00:00+00:00",
                    parser_version="campusrag-import-v1",
                    embedding_model="text-embedding-3-large",
                    raw_object_key=shared_raw_key,
                    raw_content_hash="raw-001",
                    raw_source_filename="student-handbook.pdf",
                    structured_object_key="student_handbook/handbook:test-001/v1:test-001/processed/structured.jsonl",
                    provider_result_object_key=None,
                    processed_object_keys=("student_handbook/handbook:test-001/v1:test-001/processed/structured.jsonl",),
                    import_source="campusrag_existing_ocr",
                ),
                DocumentRegistryRecord(
                    document_id="handbook:test-002",
                    version_id="v1:test-002",
                    source_uri="campusrag://canonical/student_handbook/docs/test-002.md",
                    content_hash="sha256:test-002",
                    corpus="student_handbook",
                    ingestion_timestamp="2026-03-22T10:00:01+00:00",
                    parser_version="campusrag-import-v1",
                    embedding_model="text-embedding-3-large",
                    raw_object_key=shared_raw_key,
                    raw_content_hash="raw-001",
                    raw_source_filename="student-handbook.pdf",
                    structured_object_key="student_handbook/handbook:test-002/v1:test-002/processed/structured.jsonl",
                    provider_result_object_key=None,
                    processed_object_keys=("student_handbook/handbook:test-002/v1:test-002/processed/structured.jsonl",),
                    import_source="campusrag_existing_ocr",
                ),
            )
            for record in records:
                registry.upsert(record)
            object_store = _FakeMigratingObjectStore(
                {
                    ("campus-rag-raw", shared_raw_key): b"%PDF-1.4 shared",
                    ("campus-rag-processed", records[0].structured_object_key): b'{"structured": 1}\n',
                    ("campus-rag-processed", records[1].structured_object_key): b'{"structured": 2}\n',
                }
            )

            report = migrate_registry_object_keys(registry=registry, object_store=object_store)

            self.assertEqual(report.migrated_count, 2)
            self.assertEqual(report.failed_count, 0)
            self.assertEqual(
                registry.get("handbook:test-001", "v1:test-001").raw_object_key,
                "student_handbook/handbook:test-001/v1:test-001/student-handbook.pdf",
            )
            self.assertEqual(
                registry.get("handbook:test-002", "v1:test-002").raw_object_key,
                "student_handbook/handbook:test-002/v1:test-002/student-handbook.pdf",
            )
            self.assertIn(
                ("campus-rag-raw", "student_handbook/handbook:test-001/v1:test-001/student-handbook.pdf"),
                object_store.objects,
            )
            self.assertIn(
                ("campus-rag-raw", "student_handbook/handbook:test-002/v1:test-002/student-handbook.pdf"),
                object_store.objects,
            )
            self.assertNotIn(("campus-rag-raw", shared_raw_key), object_store.objects)


if __name__ == "__main__":
    unittest.main()
