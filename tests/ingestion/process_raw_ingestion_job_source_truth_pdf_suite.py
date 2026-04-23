from __future__ import annotations

import unittest

from .process_raw_ingestion_job_test_support import *  # noqa: F401,F403


class ProcessRawIngestionJobSourceTruthPdfTest(unittest.TestCase):
    def test_process_raw_ingestion_job_requires_registered_raw_asset_identity(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)

            with self.assertRaisesRegex(ValueError, "raw_asset_id is required"):
                process_raw_ingestion_job(
                    env={
                        "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                        "OCR_API_KEY": "token",
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "RAW_ASSET_REGISTRY_DATABASE_URL": "postgresql://raw-registry.example/postgres",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                    },
                    object_store=_FakeObjectStore(),
                    online_ocr=_FakeOnlineOcrClient(),
                )

    def test_raw_ingestion_process_settings_accepts_mineru_primary_provider(self) -> None:
        settings = RawIngestionProcessSettings.from_request(
            RawIngestionRequest(
                raw_asset_id="asset:test",
                raw_version_id="sha256:test",
                corpus="curriculum",
                collection="curriculum_plan",
                artifact_mode="source_truth_only",
            ),
            env={
                "OCR_BASE_URL": "https://mineru.example",
                "OCR_API_KEY": "secret",
                "OCR_PROVIDER_MODE": "mineru_api",
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            },
        )

        self.assertEqual(settings.online_ocr.provider, "mineru_api")
        self.assertEqual(settings.parser_version, "mineru-vlm-adapted-v2")

    def test_process_raw_ingestion_job_source_truth_only_reads_registered_raw_asset_from_object_store(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            provider_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id=raw_version_id,
                filename="provider-response.jsonl",
                model_slug="vlm",
            )
            layout_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id=raw_version_id,
                filename="layout-elements.jsonl",
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            online_ocr = _FakeOnlineOcrClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_rules",
                    "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
                    "OCR_BASE_URL": "https://mineru.example",
                    "OCR_API_KEY": "token",
                    "OCR_PROVIDER_MODE": "mineru_api",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                object_store=object_store,
                online_ocr=online_ocr,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.import_mode, "raw_ingestion")
            self.assertEqual(report.success_count, 1)
            self.assertEqual(report.skipped_count, 0)
            self.assertEqual(report.failed_count, 0)
            self.assertEqual(report.raw_uploaded_count, 0)
            self.assertEqual(report.raw_reused_count, 1)
            self.assertEqual(report.document_ids, ())
            self.assertEqual(len(online_ocr.calls), 1)
            self.assertEqual(online_ocr.calls[0].name, "student-handbook.pdf")
            self.assertEqual(
                [upload["key"] for upload in object_store.uploads], [provider_key, layout_key]
            )
            self.assertFalse((root / "registry" / "student_handbook_documents.json").exists())

    def test_source_truth_only_routes_pdf_through_mineru_primary_and_persists_raw_zip_sidecar(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 mineru primary"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            paddle_client = _TrackingPaddleOnlineOcrClient()
            mineru_client = _SuccessfulMineruCanonicalClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                    asset_kind="document",
                    asset_subkind="pdf",
                    classification_confidence=1.0,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_rules",
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
            self.assertEqual(len(mineru_client.calls), 1)
            self.assertEqual(len(paddle_client.calls), 0)
            uploaded_keys = [str(upload["key"]) for upload in object_store.uploads]
            self.assertTrue(any(key.endswith("/provider-response.jsonl") for key in uploaded_keys))
            self.assertTrue(
                any(key.endswith("/provider-response-raw.zip") for key in uploaded_keys)
            )
            self.assertTrue(any(key.endswith("/layout-elements.jsonl") for key in uploaded_keys))
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

    def test_source_truth_only_accepts_mineru_as_primary_config_for_pdf(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 mineru primary only"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            mineru_client = _SuccessfulMineruCanonicalClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                    asset_kind="document",
                    asset_subkind="pdf",
                    classification_confidence=1.0,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_rules",
                    "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
                    "OCR_BASE_URL": "https://mineru.example",
                    "OCR_API_KEY": "mineru-token",
                    "OCR_PROVIDER_MODE": "mineru_api",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                object_store=object_store,
                online_ocr=mineru_client,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.success_count, 1)
            self.assertEqual(len(mineru_client.calls), 1)
            uploaded_keys = [str(upload["key"]) for upload in object_store.uploads]
            self.assertTrue(any(key.endswith("/provider-response.jsonl") for key in uploaded_keys))
            self.assertTrue(
                any(key.endswith("/provider-response-raw.zip") for key in uploaded_keys)
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

    def test_source_truth_only_persists_split_mineru_raw_artifacts_and_manifest(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 mineru split"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            mineru_client = _SplitMineruCanonicalClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                    asset_kind="document",
                    asset_subkind="pdf",
                    classification_confidence=1.0,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_rules",
                    "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
                    "OCR_BASE_URL": "https://mineru.example",
                    "OCR_API_KEY": "mineru-token",
                    "OCR_PROVIDER_MODE": "mineru_api",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                },
                object_store=object_store,
                online_ocr=mineru_client,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.success_count, 1)
            self.assertEqual(len(mineru_client.calls), 1)
            uploaded_keys = [str(upload["key"]) for upload in object_store.uploads]
            self.assertTrue(any(key.endswith("/provider-response.jsonl") for key in uploaded_keys))
            self.assertTrue(
                any(key.endswith("/provider-response-raw.part-0001.zip") for key in uploaded_keys)
            )
            self.assertTrue(
                any(key.endswith("/provider-response-raw.part-0002.zip") for key in uploaded_keys)
            )
            self.assertTrue(
                any(key.endswith("/provider-response-raw.manifest.json") for key in uploaded_keys)
            )
            self.assertFalse(
                any(key.endswith("/provider-response-raw.zip") for key in uploaded_keys)
            )

    def test_source_truth_only_falls_back_to_paddle_when_mineru_primary_fails_for_pdf(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 mineru fallback"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            paddle_client = _TrackingPaddleOnlineOcrClient()
            mineru_client = _FailingMineruCanonicalClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                    asset_kind="document",
                    asset_subkind="pdf",
                    classification_confidence=1.0,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_rules",
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
            self.assertEqual(len(mineru_client.calls), 1)
            self.assertEqual(len(paddle_client.calls), 1)
            uploaded_keys = [str(upload["key"]) for upload in object_store.uploads]
            self.assertTrue(any(key.endswith("/provider-response.jsonl") for key in uploaded_keys))
            self.assertFalse(
                any(key.endswith("/provider-response-raw.zip") for key in uploaded_keys)
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
            self.assertTrue(all(row["ocr_provider"] == "paddleocr_async" for row in layout_rows))

    def test_source_truth_only_reuses_registered_raw_asset_but_rewrites_provider_result(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 volatile"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/volatile/undated/sha256/{raw_hash}/capture/volatile.pdf"
            provider_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:volatile-pdf",
                raw_version_id=raw_version_id,
                filename="provider-response.jsonl",
                model_slug="vlm",
            )
            layout_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:volatile-pdf",
                raw_version_id=raw_version_id,
                filename="layout-elements.jsonl",
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            online_ocr = _VolatileFakeOnlineOcrClient()
            env = {
                "RAW_ASSET_ID": "asset:volatile-pdf",
                "RAW_VERSION_ID": raw_version_id,
                "INGESTION_CORPUS": "regulations",
                "INGESTION_COLLECTION": "student_rules",
                "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
                "OCR_BASE_URL": "https://mineru.example",
                "OCR_API_KEY": "token",
                "OCR_PROVIDER_MODE": "mineru_api",
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "IMPORT_REPORT_DIR": str(root / "reports"),
                "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:volatile-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/volatile/volatile.pdf",
                    content_hash=raw_hash,
                    source_filename="volatile.pdf",
                    object_key=raw_key,
                )
            )

            first = process_raw_ingestion_job(
                env=env,
                object_store=object_store,
                online_ocr=online_ocr,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )
            second = process_raw_ingestion_job(
                env=env,
                object_store=object_store,
                online_ocr=online_ocr,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(first.success_count, 1)
            self.assertEqual(second.success_count, 1)
            self.assertEqual(second.skipped_count, 0)
            self.assertEqual(second.raw_uploaded_count, 0)
            self.assertEqual(second.raw_reused_count, 1)
            self.assertEqual(len(object_store.uploads), 4)
            self.assertEqual(
                [upload["key"] for upload in object_store.uploads[-2:]], [provider_key, layout_key]
            )

    def test_process_raw_ingestion_job_source_truth_only_uses_dedicated_raw_asset_registry_env(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 curriculum plan"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/curriculum-plan/undated/sha256/{raw_hash}/capture/curriculum-plan.pdf"
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes

            with patch(
                "campus_ingestion_core.raw_ingestion.build_raw_asset_registry_from_env"
            ) as build_registry:
                raw_asset_registry = InMemoryRawAssetRegistry(
                    backing_path=root / "registry" / "curriculum_plan_raw_assets.json"
                )
                build_registry.return_value = raw_asset_registry
                raw_asset_registry.upsert(
                    _curriculum_raw_asset_record(
                        raw_asset_id="asset:curriculum-plan-pdf",
                        raw_version_id=raw_version_id,
                        raw_source_uri="s3://campus-rag-source/official_pdf/curriculum-plan/curriculum-plan.pdf",
                        content_hash=raw_hash,
                        source_filename="curriculum-plan.pdf",
                        object_key=raw_key,
                    )
                )

                process_raw_ingestion_job(
                    env={
                        "RAW_ASSET_ID": "asset:curriculum-plan-pdf",
                        "RAW_VERSION_ID": raw_version_id,
                        "INGESTION_CORPUS": "curriculum",
                        "INGESTION_COLLECTION": "curriculum_plan",
                        "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
                        "RAW_ASSET_REGISTRY_DATABASE_URL": "postgresql://raw-registry.example/postgres",
                        "OCR_BASE_URL": "https://mineru.example/api/v1/extract",
                        "OCR_API_KEY": "token",
                        "OCR_PROVIDER_MODE": "mineru_api",
                        "OCR_MODEL": "vlm",
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                    },
                    object_store=object_store,
                    online_ocr=_FakeOnlineOcrClient(),
                )

            build_registry.assert_called_once_with(
                {
                    "RAW_ASSET_ID": "asset:curriculum-plan-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "curriculum",
                    "INGESTION_COLLECTION": "curriculum_plan",
                    "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
                    "RAW_ASSET_REGISTRY_DATABASE_URL": "postgresql://raw-registry.example/postgres",
                    "OCR_BASE_URL": "https://mineru.example/api/v1/extract",
                    "OCR_API_KEY": "token",
                    "OCR_PROVIDER_MODE": "mineru_api",
                    "OCR_MODEL": "vlm",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                }
            )

    def test_process_raw_ingestion_job_requires_ocr_credentials(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                )
            )

            with self.assertRaisesRegex(ValueError, "OCR_BASE_URL and OCR_API_KEY"):
                process_raw_ingestion_job(
                    env={
                        "RAW_ASSET_ID": "asset:student-handbook-pdf",
                        "RAW_VERSION_ID": raw_version_id,
                        "INGESTION_CORPUS": "regulations",
                        "INGESTION_COLLECTION": "student_rules",
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                        "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                    },
                    object_store=object_store,
                    registry=InMemoryDocumentRegistry(
                        backing_path=root / "registry" / "student_handbook_documents.json"
                    ),
                    raw_asset_registry=raw_asset_registry,
                )
