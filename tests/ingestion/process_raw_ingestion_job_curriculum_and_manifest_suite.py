from __future__ import annotations

import unittest

from .process_raw_ingestion_job_test_support import *


class ProcessRawIngestionJobCurriculumAndManifestTest(unittest.TestCase):
    def _build_curriculum_source_locator(
        self,
        *,
        raw_hash: str,
        page_start: int,
        page_end: int,
    ) -> str:
        return (
            "campusrag://source/curriculum/"
            f"curriculum-plan-master-pdf/sha256/{raw_hash}/capture/pages/{page_start}-{page_end}"
        )

    def test_source_truth_only_rejects_split_manifest(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "raw_asset_id": "asset:student-handbook-pdf",
                        "documents": [],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
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

            with self.assertRaisesRegex(
                ValueError, "source_truth_only does not support split manifest ingestion"
            ):
                process_raw_ingestion_job(
                    env={
                        "RAW_ASSET_ID": "asset:student-handbook-pdf",
                        "RAW_VERSION_ID": raw_version_id,
                        "INGESTION_CORPUS": "regulations",
                        "INGESTION_COLLECTION": "student_rules",
                        "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
                        "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                        "OCR_BASE_URL": "https://mineru.example/api/v1/extract",
                        "OCR_API_KEY": "token",
                        "OCR_PROVIDER_MODE": "mineru_api",
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                    },
                    object_store=object_store,
                    online_ocr=_FakeOnlineOcrClient(),
                    registry=InMemoryDocumentRegistry(
                        backing_path=root / "registry" / "student_handbook_documents.json"
                    ),
                    raw_asset_registry=raw_asset_registry,
                )

    def test_process_raw_ingestion_job_supports_curriculum_plan_split_manifest(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 curriculum plan"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/curriculum-plan-master/undated/sha256/{raw_hash}/capture/curriculum-plan.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_payload = {
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
                    },
                    {
                        "document_id": "curriculum:plan-002",
                        "title": "Plan 002",
                        "page_start": 2,
                        "page_end": 2,
                        "entitlement_groups": ["students"],
                        "visibility_scope": "main",
                        "visibility_level": "restricted",
                    },
                ],
            }
            split_manifest_path.write_text(
                json.dumps(split_manifest_payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            online_ocr = _CurriculumPlanFakeOnlineOcrClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "curriculum_plan_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "curriculum_plan_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _curriculum_raw_asset_record(
                    raw_asset_id="asset:curriculum-plan-master-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-source/official_pdf/curriculum-plan-master/curriculum-plan.pdf",
                    content_hash=raw_hash,
                    source_filename="curriculum-plan.pdf",
                    object_key=raw_key,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:curriculum-plan-master-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "curriculum",
                    "INGESTION_COLLECTION": "curriculum_plan",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "OCR_BASE_URL": "https://mineru.example/api/v1/extract",
                    "OCR_API_KEY": "token",
                    "OCR_PROVIDER_MODE": "mineru_api",
                    "OCR_MODEL": "vlm",
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

            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            source_uri_1 = self._build_curriculum_source_locator(
                raw_hash=raw_hash, page_start=1, page_end=1
            )
            source_uri_2 = self._build_curriculum_source_locator(
                raw_hash=raw_hash, page_start=2, page_end=2
            )
            digest_1 = hashlib.sha256(
                "|".join(
                    [
                        raw_version_id,
                        "curriculum_plan_split_manifest_v1",
                        "curriculum:plan-001",
                        "1",
                        "1",
                    ]
                ).encode("utf-8")
            ).hexdigest()[:12]
            digest_2 = hashlib.sha256(
                "|".join(
                    [
                        raw_version_id,
                        "curriculum_plan_split_manifest_v1",
                        "curriculum:plan-002",
                        "2",
                        "2",
                    ]
                ).encode("utf-8")
            ).hexdigest()[:12]

            self.assertEqual(report.success_count, 2)
            self.assertEqual(report.failed_count, 0)
            self.assertEqual(report.raw_uploaded_count, 0)
            self.assertEqual(report.raw_reused_count, 0)
            self.assertEqual(report.document_ids, ("curriculum:plan-001", "curriculum:plan-002"))
            self.assertEqual(len(online_ocr.calls), 1)
            self.assertEqual(online_ocr.calls[0].name, "curriculum-plan.pdf")
            self.assertEqual(
                [upload["key"] for upload in object_store.uploads],
                [
                    build_processed_asset_artifact_key(
                        corpus="curriculum",
                        raw_asset_id="asset:curriculum-plan-master-pdf",
                        raw_version_id=raw_version_id,
                        filename="provider-response.jsonl",
                        model_slug="vlm",
                    ),
                    build_processed_asset_artifact_key(
                        corpus="curriculum",
                        raw_asset_id="asset:curriculum-plan-master-pdf",
                        raw_version_id=raw_version_id,
                        filename="layout-elements.jsonl",
                    ),
                    build_processed_artifact_key(
                        corpus="curriculum",
                        collection="curriculum_plan",
                        document_id="curriculum:plan-001",
                        revision_track="source-faithful",
                        version_id=f"sha256:{raw_hash}:split:plan-001:{digest_1}",
                        title="Plan 001",
                        year=None,
                        filename="canonical.md",
                    ),
                    build_processed_artifact_key(
                        corpus="curriculum",
                        collection="curriculum_plan",
                        document_id="curriculum:plan-001",
                        revision_track="source-faithful",
                        version_id=f"sha256:{raw_hash}:split:plan-001:{digest_1}",
                        title="Plan 001",
                        year=None,
                        filename="document-units.jsonl",
                    ),
                    build_processed_artifact_key(
                        corpus="curriculum",
                        collection="curriculum_plan",
                        document_id="curriculum:plan-002",
                        revision_track="source-faithful",
                        version_id=f"sha256:{raw_hash}:split:plan-002:{digest_2}",
                        title="Plan 002",
                        year=None,
                        filename="canonical.md",
                    ),
                    build_processed_artifact_key(
                        corpus="curriculum",
                        collection="curriculum_plan",
                        document_id="curriculum:plan-002",
                        revision_track="source-faithful",
                        version_id=f"sha256:{raw_hash}:split:plan-002:{digest_2}",
                        title="Plan 002",
                        year=None,
                        filename="document-units.jsonl",
                    ),
                ],
            )

            registry_payload = json.loads(
                (root / "registry" / "curriculum_plan_documents.json").read_text(encoding="utf-8")
            )
            plan_001 = registry_payload[
                f"curriculum:plan-001::source-faithful::sha256:{raw_hash}:split:plan-001:{digest_1}"
            ]
            plan_002 = registry_payload[
                f"curriculum:plan-002::source-faithful::sha256:{raw_hash}:split:plan-002:{digest_2}"
            ]
            self.assertEqual(
                plan_001["provider_response_object_key"],
                build_processed_asset_artifact_key(
                    corpus="curriculum",
                    raw_asset_id="asset:curriculum-plan-master-pdf",
                    raw_version_id=raw_version_id,
                    filename="provider-response.jsonl",
                    model_slug="vlm",
                ),
            )
            self.assertEqual(
                plan_002["processed_object_keys"],
                [
                    build_processed_asset_artifact_key(
                        corpus="curriculum",
                        raw_asset_id="asset:curriculum-plan-master-pdf",
                        raw_version_id=raw_version_id,
                        filename="provider-response.jsonl",
                        model_slug="vlm",
                    ),
                    build_processed_artifact_key(
                        corpus="curriculum",
                        collection="curriculum_plan",
                        document_id="curriculum:plan-002",
                        revision_track="source-faithful",
                        version_id=f"sha256:{raw_hash}:split:plan-002:{digest_2}",
                        title="Plan 002",
                        year=None,
                        filename="canonical.md",
                    ),
                    build_processed_artifact_key(
                        corpus="curriculum",
                        collection="curriculum_plan",
                        document_id="curriculum:plan-002",
                        revision_track="source-faithful",
                        version_id=f"sha256:{raw_hash}:split:plan-002:{digest_2}",
                        title="Plan 002",
                        year=None,
                        filename="document-units.jsonl",
                    ),
                    build_processed_asset_artifact_key(
                        corpus="curriculum",
                        raw_asset_id="asset:curriculum-plan-master-pdf",
                        raw_version_id=raw_version_id,
                        filename="layout-elements.jsonl",
                    ),
                ],
            )
            self.assertEqual(plan_001["cleaning_policy_version"], "curriculum_plan_cleaning_v1")
            self.assertEqual(plan_002["cleaning_policy_version"], "curriculum_plan_cleaning_v1")
            self.assertEqual(plan_002["visibility_scope"], "main")
            self.assertEqual(plan_002["entitlement_groups"], ["students"])
            self.assertEqual(plan_001["revision_track"], "source-faithful")
            self.assertEqual(plan_001["source_channel"], "pdf_ocr")
            self.assertEqual(plan_001["source_uri"], source_uri_1)
            self.assertEqual(plan_002["source_uri"], source_uri_2)

    def test_process_raw_ingestion_job_curriculum_plan_split_manifest_prefers_mineru_lane(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 curriculum plan mineru canonical"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = (
                f"official_pdf/curriculum-plan-master/undated/sha256/{raw_hash}/"
                "capture/curriculum-plan.pdf"
            )
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
                            }
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            paddle_client = _TrackingPaddleOnlineOcrClient()
            mineru_client = _SuccessfulMineruCanonicalClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "curriculum_plan_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "curriculum_plan_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _curriculum_raw_asset_record(
                    raw_asset_id="asset:curriculum-plan-master-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri=(
                        "s3://campus-rag-source/official_pdf/"
                        "curriculum-plan-master/curriculum-plan.pdf"
                    ),
                    content_hash=raw_hash,
                    source_filename="curriculum-plan.pdf",
                    object_key=raw_key,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:curriculum-plan-master-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "curriculum",
                    "INGESTION_COLLECTION": "curriculum_plan",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
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
            upload_keys = [str(upload["key"]) for upload in object_store.uploads]
            self.assertIn(
                build_processed_asset_artifact_key(
                    corpus="curriculum",
                    raw_asset_id="asset:curriculum-plan-master-pdf",
                    raw_version_id=raw_version_id,
                    filename="provider-response.jsonl",
                    model_slug="vlm",
                ),
                upload_keys,
            )

    def test_process_raw_ingestion_job_curriculum_plan_split_manifest_fails_closed_when_mineru_primary_fails(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 curriculum mineru fail closed"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = (
                f"official_pdf/curriculum-plan-master/undated/sha256/{raw_hash}/"
                "capture/curriculum-plan.pdf"
            )
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
                            }
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            paddle_client = _TrackingPaddleOnlineOcrClient()
            mineru_client = _FailingMineruCanonicalClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "curriculum_plan_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "curriculum_plan_raw_assets.json"
            )
            raw_asset_registry.upsert(
                _curriculum_raw_asset_record(
                    raw_asset_id="asset:curriculum-plan-master-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri=(
                        "s3://campus-rag-source/official_pdf/"
                        "curriculum-plan-master/curriculum-plan.pdf"
                    ),
                    content_hash=raw_hash,
                    source_filename="curriculum-plan.pdf",
                    object_key=raw_key,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:curriculum-plan-master-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "curriculum",
                    "INGESTION_COLLECTION": "curriculum_plan",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
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
            self.assertEqual(len(mineru_client.calls), 1)
            self.assertEqual(len(paddle_client.calls), 0)
            self.assertEqual(object_store.uploads, [])
            self.assertTrue(
                any(
                    "source-truth-only OCR routing failed" in error
                    and "mineru_api: mineru failed" in error
                    for error in report.errors
                )
            )

    def test_process_raw_ingestion_job_supports_curriculum_plan_source_truth_only_presplit(
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
            online_ocr = _CurriculumPlanFakeOnlineOcrClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "curriculum_plan_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "curriculum_plan_raw_assets.json"
            )
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

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:curriculum-plan-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "curriculum",
                    "INGESTION_COLLECTION": "curriculum_plan",
                    "RAW_INGESTION_ARTIFACT_MODE": "source_truth_only",
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
                online_ocr=online_ocr,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.success_count, 1)
            self.assertEqual(report.failed_count, 0)
            self.assertEqual(report.raw_uploaded_count, 0)
            self.assertEqual(report.raw_reused_count, 1)
            self.assertEqual(report.document_ids, ())
            self.assertEqual(len(online_ocr.calls), 1)
            self.assertEqual(online_ocr.calls[0].name, "curriculum-plan.pdf")
            self.assertEqual(
                [upload["key"] for upload in object_store.uploads],
                [
                    build_processed_asset_artifact_key(
                        corpus="curriculum",
                        raw_asset_id="asset:curriculum-plan-pdf",
                        raw_version_id=raw_version_id,
                        filename="provider-response.jsonl",
                        model_slug="vlm",
                    ),
                    build_processed_asset_artifact_key(
                        corpus="curriculum",
                        raw_asset_id="asset:curriculum-plan-pdf",
                        raw_version_id=raw_version_id,
                        filename="layout-elements.jsonl",
                    ),
                ],
            )
            self.assertFalse((root / "registry" / "curriculum_plan_documents.json").exists())
            layout_key = build_processed_asset_artifact_key(
                corpus="curriculum",
                raw_asset_id="asset:curriculum-plan-pdf",
                raw_version_id=raw_version_id,
                filename="layout-elements.jsonl",
            )
            layout_bytes = object_store.objects[(SOURCE_BUCKET, layout_key)]
            layout_rows = [
                json.loads(line)
                for line in layout_bytes.decode("utf-8").splitlines()
                if line.strip()
            ]
            self.assertTrue(layout_rows)
            self.assertEqual(layout_rows[0]["schema_version"], "curriculum_layout_elements_v3")

            raw_asset_payload = json.loads(
                (root / "registry" / "curriculum_plan_raw_assets.json").read_text(encoding="utf-8")
            )
            self.assertEqual(len(raw_asset_payload), 1)

    def test_process_raw_ingestion_job_rejects_split_manifest_with_mismatched_corpus(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 curriculum plan"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/curriculum-plan-master/undated/sha256/{raw_hash}/capture/curriculum-plan.pdf"
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
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[(SOURCE_BUCKET, raw_key)] = raw_bytes
            online_ocr = _CurriculumPlanFakeOnlineOcrClient()
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "curriculum_plan_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "curriculum_plan_raw_assets.json"
            )
            raw_asset_registry.upsert(
                RawAssetRecord(
                    raw_asset_id="asset:curriculum-plan-master-pdf",
                    raw_version_id=raw_version_id,
                    corpus="regulations",
                    collection="student_rules",
                    raw_source_uri="s3://campus-rag-source/official_pdf/curriculum-plan-master/curriculum-plan.pdf",
                    content_hash=raw_hash,
                    source_filename="curriculum-plan.pdf",
                    object_key=raw_key,
                    ingestion_timestamp="2026-03-23T00:00:00+00:00",
                    import_source="seed",
                )
            )

            with self.assertRaisesRegex(ValueError, "split manifest corpus mismatch"):
                process_raw_ingestion_job(
                    env={
                        "RAW_ASSET_ID": "asset:curriculum-plan-master-pdf",
                        "RAW_VERSION_ID": raw_version_id,
                        "INGESTION_CORPUS": "regulations",
                        "INGESTION_COLLECTION": "student_rules",
                        "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                        "OCR_BASE_URL": "https://mineru.example/api/v1/extract",
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
