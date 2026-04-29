from __future__ import annotations

import unittest

from .process_raw_ingestion_job_test_support import *


class ProcessRawIngestionJobHandbookReingestionTest(unittest.TestCase):
    def test_process_raw_ingestion_job_skips_unchanged_handbook_reingestion(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook stable"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook-master/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(_student_handbook_manifest_payload(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-master-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook-master/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                )
            )
            env = {
                "RAW_ASSET_ID": "asset:student-handbook-master-pdf",
                "RAW_VERSION_ID": raw_version_id,
                "INGESTION_CORPUS": "regulations",
                "INGESTION_COLLECTION": "student_rules",
                "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                "OCR_API_KEY": "token",
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "IMPORT_REPORT_DIR": str(root / "reports"),
                "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }

            first = process_raw_ingestion_job(
                env=env,
                object_store=object_store,
                online_ocr=_FixtureOnlineOcrClient("provider-result-stable.jsonl"),
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )
            second = process_raw_ingestion_job(
                env=env,
                object_store=object_store,
                online_ocr=_FixtureOnlineOcrClient("provider-result-stable.jsonl"),
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            document_id = build_handbook_doc_id("中央民族大学奖学金评定办法")
            self.assertEqual(first.success_count, 1)
            self.assertEqual(first.created_document_ids, (document_id,))
            self.assertEqual(first.updated_document_ids, ())
            self.assertEqual(first.skipped_document_ids, ())
            self.assertEqual(second.success_count, 0)
            self.assertEqual(second.skipped_count, 1)
            self.assertEqual(second.created_document_ids, ())
            self.assertEqual(second.updated_document_ids, ())
            self.assertEqual(second.skipped_document_ids, (document_id,))
            self.assertEqual(second.document_ids, ())

            report_payload = json.loads(Path(second.report_path).read_text(encoding="utf-8"))
            self.assertEqual(report_payload["created_document_ids"], [])
            self.assertEqual(report_payload["updated_document_ids"], [])
            self.assertEqual(report_payload["skipped_document_ids"], [document_id])

    def test_process_raw_ingestion_job_records_updated_document_ids_for_changed_handbook_content(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            stable_bytes = b"%PDF-1.4 remote student handbook stable"
            updated_bytes = b"%PDF-1.4 remote student handbook updated"
            stable_hash = hashlib.sha256(stable_bytes).hexdigest()
            updated_hash = hashlib.sha256(updated_bytes).hexdigest()
            stable_version_id = f"sha256:{stable_hash}"
            updated_version_id = f"sha256:{updated_hash}"
            stable_key = f"official_pdf/student-handbook-master/undated/sha256/{stable_hash}/capture/student-handbook.pdf"
            updated_key = f"official_pdf/student-handbook-master/undated/sha256/{updated_hash}/capture/student-handbook.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(_student_handbook_manifest_payload(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, stable_key)] = stable_bytes
            object_store.objects[(SOURCE_BUCKET, updated_key)] = updated_bytes
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-master-pdf",
                    raw_version_id=stable_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook-master/student-handbook.pdf",
                    content_hash=stable_hash,
                    source_filename="student-handbook.pdf",
                    object_key=stable_key,
                )
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-master-pdf",
                    raw_version_id=updated_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook-master/student-handbook.pdf",
                    content_hash=updated_hash,
                    source_filename="student-handbook.pdf",
                    object_key=updated_key,
                )
            )

            first = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-master-pdf",
                    "RAW_VERSION_ID": stable_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_rules",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                object_store=object_store,
                online_ocr=_FixtureOnlineOcrClient("provider-result-stable.jsonl"),
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )
            second = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-master-pdf",
                    "RAW_VERSION_ID": updated_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_rules",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                object_store=object_store,
                online_ocr=_FixtureOnlineOcrClient("provider-result-updated.jsonl"),
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            document_id = build_handbook_doc_id("中央民族大学奖学金评定办法")
            self.assertEqual(first.created_document_ids, (document_id,))
            self.assertEqual(second.success_count, 1)
            self.assertEqual(second.created_document_ids, ())
            self.assertEqual(second.updated_document_ids, (document_id,))
            self.assertEqual(second.skipped_document_ids, ())
            self.assertEqual(second.document_ids, (document_id,))

            registry_payload = json.loads(
                (root / "registry" / "student_handbook_documents.json").read_text(encoding="utf-8")
            )
            versions = [
                payload["version_id"]
                for payload in registry_payload.values()
                if payload["document_id"] == document_id
            ]
            self.assertEqual(len(versions), 2)
            self.assertEqual(len(set(versions)), 2)

            report_payload = json.loads(Path(second.report_path).read_text(encoding="utf-8"))
            self.assertEqual(report_payload["created_document_ids"], [])
            self.assertEqual(report_payload["updated_document_ids"], [document_id])
            self.assertEqual(report_payload["skipped_document_ids"], [])
