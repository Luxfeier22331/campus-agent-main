from __future__ import annotations

import unittest

from .process_raw_ingestion_job_test_support import *  # noqa: F401,F403


class ProcessRawIngestionJobSourceTruthImageTest(unittest.TestCase):
    def test_source_truth_only_dual_runs_generic_image_and_promotes_simple_table_to_paddle(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"fake-simple-table-image"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = (
                f"official_pdf/notice-table/undated/sha256/{raw_hash}/capture/notice-table.png"
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            paddle_client = _SimpleTablePaddleImageClient()
            mineru_client = _EmptyMineruImageClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:notice-table-png",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/notice-table/notice-table.png",
                    content_hash=raw_hash,
                    source_filename="notice-table.png",
                    object_key=raw_key,
                    content_type="image/png",
                    file_extension=".png",
                    page_count=1,
                    image_width=1200,
                    image_height=800,
                    asset_kind="image",
                    asset_subkind="generic_image",
                    classification_confidence=1.0,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:notice-table-png",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_handbook",
                    "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OCR_PROVIDER_MODE": "paddleocr_async_jobs",
                    "OCR_MINERU_BASE_URL": "https://mineru.example",
                    "OCR_MINERU_API_KEY": "mineru-token",
                    "OCR_MINERU_PROVIDER_MODE": "mineru_api",
                    "OCR_MINERU_MODEL": "vlm",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                object_store=object_store,
                online_ocr_clients={
                    "paddleocr_async_jobs": paddle_client,
                    "mineru_api": mineru_client,
                },
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.success_count, 1)
            self.assertEqual(len(paddle_client.calls), 1)
            self.assertEqual(len(mineru_client.calls), 1)
            updated_record = raw_asset_registry.get("asset:notice-table-png", raw_version_id)
            self.assertIsNotNone(updated_record)
            self.assertEqual(updated_record.asset_subkind, "simple_table_image")
            uploaded_keys = [str(upload["key"]) for upload in object_store.uploads]
            self.assertTrue(any(key.endswith("/provider-response.jsonl") for key in uploaded_keys))
            self.assertFalse(
                any(key.endswith("/provider-response-raw.zip") for key in uploaded_keys)
            )
            self.assertTrue(
                any(key.endswith("/ocr-routing-decision.json") for key in uploaded_keys)
            )

    def test_source_truth_only_dual_runs_generic_image_and_promotes_complex_table_to_mineru(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"fake-complex-table-image"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = (
                f"official_pdf/wide-schedule/undated/sha256/{raw_hash}/capture/wide-schedule.png"
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            paddle_client = _WeakPaddleImageClient()
            mineru_client = _ComplexTableMineruImageClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:wide-schedule-png",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/wide-schedule/wide-schedule.png",
                    content_hash=raw_hash,
                    source_filename="wide-schedule.png",
                    object_key=raw_key,
                    content_type="image/png",
                    file_extension=".png",
                    page_count=1,
                    image_width=2200,
                    image_height=900,
                    asset_kind="image",
                    asset_subkind="generic_image",
                    classification_confidence=1.0,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:wide-schedule-png",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_handbook",
                    "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OCR_PROVIDER_MODE": "paddleocr_async_jobs",
                    "OCR_MINERU_BASE_URL": "https://mineru.example",
                    "OCR_MINERU_API_KEY": "mineru-token",
                    "OCR_MINERU_PROVIDER_MODE": "mineru_api",
                    "OCR_MINERU_MODEL": "vlm",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                object_store=object_store,
                online_ocr_clients={
                    "paddleocr_async_jobs": paddle_client,
                    "mineru_api": mineru_client,
                },
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.success_count, 1)
            self.assertEqual(len(paddle_client.calls), 1)
            self.assertEqual(len(mineru_client.calls), 1)
            updated_record = raw_asset_registry.get("asset:wide-schedule-png", raw_version_id)
            self.assertIsNotNone(updated_record)
            self.assertEqual(updated_record.asset_subkind, "complex_table_image")
            uploaded_keys = [str(upload["key"]) for upload in object_store.uploads]
            self.assertTrue(any(key.endswith("/provider-response.jsonl") for key in uploaded_keys))
            self.assertTrue(
                any(key.endswith("/provider-response-raw.zip") for key in uploaded_keys)
            )
            self.assertTrue(
                any(key.endswith("/ocr-routing-decision.json") for key in uploaded_keys)
            )
            layout_upload = next(
                upload
                for upload in object_store.uploads
                if str(upload["key"]).endswith("/layout-elements.jsonl")
            )
            layout_rows = [
                json.loads(line)
                for line in layout_upload["data"].decode("utf-8").splitlines()
                if line.strip()
            ]
            self.assertTrue(layout_rows)
            self.assertTrue(all(row["ocr_provider"] == "mineru_api" for row in layout_rows))

    def test_source_truth_only_dual_runs_generic_image_and_fail_closes_spatial_image(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"fake-spatial-image"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/campus-map/undated/sha256/{raw_hash}/capture/campus-map.png"
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            paddle_client = _SparseMapPaddleImageClient()
            mineru_client = _SpatialMineruImageClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:campus-map-png",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/campus-map/campus-map.png",
                    content_hash=raw_hash,
                    source_filename="campus-map.png",
                    object_key=raw_key,
                    content_type="image/png",
                    file_extension=".png",
                    page_count=1,
                    image_width=1600,
                    image_height=1200,
                    asset_kind="image",
                    asset_subkind="generic_image",
                    classification_confidence=1.0,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:campus-map-png",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_handbook",
                    "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OCR_PROVIDER_MODE": "paddleocr_async_jobs",
                    "OCR_MINERU_BASE_URL": "https://mineru.example",
                    "OCR_MINERU_API_KEY": "mineru-token",
                    "OCR_MINERU_PROVIDER_MODE": "mineru_api",
                    "OCR_MINERU_MODEL": "vlm",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                object_store=object_store,
                online_ocr_clients={
                    "paddleocr_async_jobs": paddle_client,
                    "mineru_api": mineru_client,
                },
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.success_count, 0)
            self.assertEqual(report.failed_count, 1)
            self.assertEqual(len(paddle_client.calls), 1)
            self.assertEqual(len(mineru_client.calls), 1)
            updated_record = raw_asset_registry.get("asset:campus-map-png", raw_version_id)
            self.assertIsNotNone(updated_record)
            self.assertEqual(updated_record.asset_subkind, "spatial_image")
            uploaded_keys = [str(upload["key"]) for upload in object_store.uploads]
            self.assertFalse(any(key.endswith("/provider-response.jsonl") for key in uploaded_keys))
            self.assertFalse(
                any(key.endswith("/provider-response-raw.zip") for key in uploaded_keys)
            )
            self.assertFalse(any(key.endswith("/layout-elements.jsonl") for key in uploaded_keys))
            self.assertTrue(
                any(key.endswith("/ocr-routing-decision.json") for key in uploaded_keys)
            )
