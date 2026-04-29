from .process_raw_ingestion_job_handbook_projection_support import *


class ProcessRawIngestionJobHandbookProjectionValidationTest(
    ProcessRawIngestionJobHandbookProjectionBaseTest
):
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
