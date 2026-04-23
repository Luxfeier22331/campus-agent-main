from __future__ import annotations

import unittest

from .process_raw_ingestion_job_test_support import *


class ProcessRawIngestionJobHandbookProjectionTest(unittest.TestCase):
    def test_process_raw_ingestion_job_emits_declared_handbook_downstream_projections(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook stable"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook-master/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "raw_asset_id": "asset:student-handbook-master-pdf",
                        "documents": [
                            {
                                "document_id": "handbook:bf03f0bd6930e89bcc6d2733c1e87a423b510675",
                                "title": "中央民族大学奖学金评定办法",
                                "handbook_section": "中央民族大学学生奖励管理规定",
                                "page_start": 1,
                                "page_end": 1,
                                "source_uri": "https://campus.example/handbook/scholarship-policy",
                            }
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            projection_config_path = root / "configs" / "source-projections.v1.json"
            projection_config_path.write_text(
                json.dumps(
                    {
                        "schema_version": "student_rules_source_projections_v1",
                        "source_corpus": "regulations",
                        "source_collection": "student_rules",
                        "raw_asset_id": "asset:student-handbook-master-pdf",
                        "projections": [
                            {
                                "projection_name": "student_handbook_primary_documents",
                                "target_corpus": "regulations",
                                "target_collection": "student_rules",
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
                                "source_title": "中央民族大学奖学金评定办法",
                                "source_handbook_section": "中央民族大学学生奖励管理规定",
                                "source_page_start": 1,
                                "source_page_end": 1,
                                "attachment_kind": "navigation_like",
                                "attachment_role": "service_contact_directory",
                                "target_title": "中央民族大学奖学金评定办法（联系人投影）",
                                "migration_reason": "handbook_contact_projection_test",
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
            registry = InMemoryDocumentRegistry(backing_path=root / "registry" / "documents.json")
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "raw-assets.json"
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

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-master-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "regulations",
                    "INGESTION_COLLECTION": "student_rules",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "HANDBOOK_SOURCE_PROJECTIONS_PATH": str(projection_config_path),
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                },
                object_store=object_store,
                online_ocr=_FixtureOnlineOcrClient("provider-result-stable.jsonl"),
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.success_count, 2)
            self.assertEqual(
                tuple(
                    sorted(
                        record.document_id
                        for record in registry.list_by_scope("campus_services", "contact_directory")
                    )
                ),
                ("campus_services:contact_directory:28eb517c07c83d26ca0c17d33ec46fcdf2eb5258",),
            )

    def test_student_handbook_normalized_raw_ingestion_requires_split_manifest(self) -> None:
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

            with self.assertRaisesRegex(ValueError, "split_manifest_path is required"):
                process_raw_ingestion_job(
                    env={
                        "RAW_ASSET_ID": "asset:student-handbook-pdf",
                        "RAW_VERSION_ID": raw_version_id,
                        "INGESTION_CORPUS": "regulations",
                        "INGESTION_COLLECTION": "student_rules",
                        "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                        "OCR_API_KEY": "token",
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                        "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                    },
                    object_store=object_store,
                    online_ocr=_FakeOnlineOcrClient(),
                    registry=InMemoryDocumentRegistry(
                        backing_path=root / "registry" / "student_handbook_documents.json"
                    ),
                    raw_asset_registry=raw_asset_registry,
                )

    def test_process_raw_ingestion_job_normalizes_student_handbook_provider_result_into_logical_documents(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook-master/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "raw_asset_id": "asset:student-handbook-master-pdf",
                        "documents": [
                            {
                                "document_id": "manifest:scholarship-policy",
                                "title": "中央民族大学奖学金评定办法",
                                "handbook_section": "中央民族大学学生奖励管理规定",
                                "page_start": 1,
                                "page_end": 2,
                                "source_uri": "https://campus.example/handbook/scholarship-policy",
                            },
                            {
                                "document_id": "manifest:discipline-policy",
                                "title": "中央民族大学学生违纪处分办法",
                                "handbook_section": "中央民族大学学生日常管理规定",
                                "page_start": 3,
                                "page_end": 3,
                                "source_uri": "https://campus.example/handbook/discipline-policy",
                                "entitlement_groups": ["students"],
                                "visibility_scope": "main",
                                "visibility_level": "restricted",
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
            online_ocr = _StudentHandbookNormalizedFakeOnlineOcrClient()
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

            report = process_raw_ingestion_job(
                env={
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
                },
                object_store=object_store,
                online_ocr=online_ocr,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            provider_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-master-pdf",
                raw_version_id=raw_version_id,
                filename="provider-response.jsonl",
            )
            structured_full_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-master-pdf",
                raw_version_id=raw_version_id,
                filename="layout-elements.jsonl",
            )
            scholarship_doc_id = build_handbook_doc_id("中央民族大学奖学金评定办法")
            discipline_doc_id = build_handbook_doc_id("中央民族大学学生违纪处分办法")

            self.assertEqual(report.success_count, 2)
            self.assertEqual(report.failed_count, 0)
            self.assertEqual(report.raw_uploaded_count, 0)
            self.assertEqual(report.raw_reused_count, 0)
            self.assertEqual(report.document_ids, (scholarship_doc_id, discipline_doc_id))
            self.assertEqual(len(online_ocr.calls), 1)
            self.assertEqual(online_ocr.calls[0].name, "student-handbook.pdf")

            upload_keys = [str(upload["key"]) for upload in object_store.uploads]
            self.assertEqual(upload_keys[0:2], [provider_key, structured_full_key])
            self.assertEqual(
                len([key for key in upload_keys if key.endswith("/document-units.jsonl")]), 2
            )
            self.assertEqual(len([key for key in upload_keys if key.endswith("/canonical.md")]), 2)
            self.assertNotIn(raw_key, upload_keys)

            registry_payload = json.loads(
                (root / "registry" / "student_handbook_documents.json").read_text(encoding="utf-8")
            )
            self.assertEqual(len(registry_payload), 2)
            scholarship_record = next(
                payload
                for payload in registry_payload.values()
                if payload["document_id"] == scholarship_doc_id
            )
            discipline_record = next(
                payload
                for payload in registry_payload.values()
                if payload["document_id"] == discipline_doc_id
            )
            self.assertEqual(scholarship_record["provider_response_object_key"], provider_key)
            self.assertEqual(discipline_record["provider_response_object_key"], provider_key)
            self.assertIn(structured_full_key, scholarship_record["processed_object_keys"])
            self.assertIn(structured_full_key, discipline_record["processed_object_keys"])
            self.assertTrue(
                scholarship_record["canonical_markdown_object_key"].endswith("/canonical.md")
            )
            self.assertTrue(
                discipline_record["canonical_markdown_object_key"].endswith("/canonical.md")
            )
            self.assertEqual(scholarship_record["raw_asset"]["page_start"], 1)
            self.assertEqual(scholarship_record["raw_asset"]["page_end"], 2)
            self.assertEqual(discipline_record["raw_asset"]["page_start"], 3)
            self.assertEqual(discipline_record["raw_asset"]["page_end"], 3)
            self.assertEqual(
                scholarship_record["source_uri"],
                "https://campus.example/handbook/scholarship-policy",
            )
            self.assertEqual(
                discipline_record["source_uri"], "https://campus.example/handbook/discipline-policy"
            )
            self.assertEqual(discipline_record["entitlement_groups"], ["students"])
            self.assertEqual(discipline_record["visibility_scope"], "main")
            self.assertEqual(
                scholarship_record["cleaning_policy_version"], "student_rules_cleaning_v1"
            )
            self.assertEqual(
                discipline_record["cleaning_policy_version"], "student_rules_cleaning_v1"
            )
            self.assertEqual(scholarship_record["parser_version"], "paddleocr-vl-1.5")
            self.assertEqual(discipline_record["parser_version"], "paddleocr-vl-1.5")
            self.assertEqual(scholarship_record["embedding_model"], "Qwen3-Embedding-4B")
            self.assertEqual(discipline_record["embedding_model"], "Qwen3-Embedding-4B")

    def test_process_raw_ingestion_job_persists_handbook_document_artifact_keys_under_year_namespace(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook 2018"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_filename = "学生手册_2018.pdf"
            raw_key = f"official_pdf/student-handbook-master/2018/sha256/{raw_hash}/capture/{raw_filename}"
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
                    raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook-master/2018/学生手册_2018.pdf",
                    content_hash=raw_hash,
                    source_filename=raw_filename,
                    object_key=raw_key,
                )
            )

            report = process_raw_ingestion_job(
                env={
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
                },
                object_store=object_store,
                online_ocr=_FixtureOnlineOcrClient("provider-result-stable.jsonl"),
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.success_count, 1)
            record = registry.list_by_scope("regulations", "student_rules")[0]
            expected_document_units_key = build_processed_artifact_key(
                corpus="regulations",
                collection="student_rules",
                document_id=record.document_id,
                revision_track=record.revision_track,
                version_id=record.version_id,
                title="中央民族大学奖学金评定办法",
                year="2018",
                filename="document-units.jsonl",
            )
            expected_canonical_key = build_processed_artifact_key(
                corpus="regulations",
                collection="student_rules",
                document_id=record.document_id,
                revision_track=record.revision_track,
                version_id=record.version_id,
                title="中央民族大学奖学金评定办法",
                year="2018",
                filename="canonical.md",
            )
            self.assertEqual(record.document_units_object_key, expected_document_units_key)
            self.assertEqual(record.canonical_markdown_object_key, expected_canonical_key)
            self.assertIn(expected_document_units_key, record.processed_object_keys)
            self.assertIn(expected_canonical_key, record.processed_object_keys)
            self.assertIn((DERIVED_BUCKET, expected_document_units_key), object_store.objects)
            self.assertIn((DERIVED_BUCKET, expected_canonical_key), object_store.objects)

    def test_process_raw_ingestion_job_builds_handbook_chunks_from_persisted_document_units(
        self,
    ) -> None:
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

            report = process_raw_ingestion_job(
                env={
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
                },
                object_store=object_store,
                online_ocr=_FixtureOnlineOcrClient("provider-result-stable.jsonl"),
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.success_count, 1)
            record = registry.list_by_scope("regulations", "student_rules")[0]
            chunks = build_indexable_chunks_from_record(
                record=record,
                object_store=object_store,
                bucket=DERIVED_BUCKET,
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

            self.assertGreaterEqual(len(chunks), 1)
            self.assertTrue(
                all(
                    chunk.chunk_id.startswith(
                        f"{record.document_id}:{record.revision_track}:{record.version_id}:chunk-"
                    )
                    for chunk in chunks
                )
            )
            self.assertTrue(all(chunk.source_chunk_id for chunk in chunks))
            self.assertTrue(all(chunk.metadata["root_unit_id"] for chunk in chunks))
            self.assertTrue(all(chunk.metadata["segment_index"] >= 1 for chunk in chunks))
            self.assertTrue(all(chunk.metadata["segment_total"] >= 1 for chunk in chunks))
            self.assertTrue(
                all(
                    chunk.metadata["chunk_policy_version"] == "student_rules_semantic_v3"
                    for chunk in chunks
                )
            )
            self.assertTrue(
                all(
                    chunk.metadata["cleaning_policy_version"] == "student_rules_cleaning_v1"
                    for chunk in chunks
                )
            )

    def test_process_raw_ingestion_job_rejects_split_manifest_with_mismatched_raw_asset_id(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook-master/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "raw_asset_id": "asset:wrong-handbook-pdf",
                        "documents": [
                            {
                                "document_id": "manifest:scholarship-policy",
                                "title": "中央民族大学奖学金评定办法",
                                "handbook_section": "中央民族大学学生奖励管理规定",
                                "page_start": 1,
                                "page_end": 2,
                                "source_uri": "https://campus.example/handbook/scholarship-policy",
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

            with self.assertRaisesRegex(ValueError, "split manifest raw_asset_id mismatch"):
                process_raw_ingestion_job(
                    env={
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
                    },
                    object_store=object_store,
                    online_ocr=_StudentHandbookNormalizedFakeOnlineOcrClient(),
                    registry=InMemoryDocumentRegistry(
                        backing_path=root / "registry" / "student_handbook_documents.json"
                    ),
                    raw_asset_registry=raw_asset_registry,
                )

    def test_process_raw_ingestion_job_records_manifest_title_mismatch_without_persisting_document(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"official_pdf/student-handbook-master/undated/sha256/{raw_hash}/capture/student-handbook.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "raw_asset_id": "asset:student-handbook-master-pdf",
                        "documents": [
                            {
                                "document_id": "manifest:scholarship-policy",
                                "title": "中央民族大学奖学金评定办法",
                                "handbook_section": "中央民族大学学生奖励管理规定",
                                "page_start": 1,
                                "page_end": 2,
                                "source_uri": "https://campus.example/handbook/scholarship-policy",
                            },
                            {
                                "document_id": "manifest:discipline-policy",
                                "title": "错误的标题",
                                "handbook_section": "中央民族大学学生日常管理规定",
                                "page_start": 3,
                                "page_end": 3,
                                "source_uri": "https://campus.example/handbook/discipline-policy",
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

            report = process_raw_ingestion_job(
                env={
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
                },
                object_store=object_store,
                online_ocr=_StudentHandbookNormalizedFakeOnlineOcrClient(),
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            scholarship_doc_id = build_handbook_doc_id("中央民族大学奖学金评定办法")
            self.assertEqual(report.success_count, 1)
            self.assertEqual(report.failed_count, 1)
            self.assertEqual(report.document_ids, (scholarship_doc_id,))
            self.assertIn("manifest title mismatch", report.errors[0])
            self.assertIn("manifest:discipline-policy", report.errors[0])

            registry_payload = json.loads(
                (root / "registry" / "student_handbook_documents.json").read_text(encoding="utf-8")
            )
            self.assertEqual(len(registry_payload), 1)
            stored_record = next(iter(registry_payload.values()))
            self.assertEqual(stored_record["document_id"], scholarship_doc_id)
