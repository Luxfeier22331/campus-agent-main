from __future__ import annotations

import unittest

from .provider_result_replay_rebuild_test_support import *  # noqa: F401,F403


class ProviderResultReplayRebuildFailureTest(unittest.TestCase):
    def test_replay_provider_response_rebuild_uses_raw_asset_source_pdf_when_request_omits_it(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "curriculum_plan_split_manifest_v1",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "raw_asset_id": "asset:curriculum-plan-2022",
                        "documents": [
                            {
                                "document_id": "curriculum:test-doc-001",
                                "title": "培养方案示例",
                                "page_start": 1,
                                "page_end": 1,
                                "source_uri": "campus-agent://curriculum/curriculum_plan/docs/curriculum:test-doc-001",
                            }
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            provider_lines = [
                _provider_batch_line(
                    _provider_page(
                        _provider_block(
                            "doc_title", "培养方案示例", block_id="p1-title", block_order=1
                        ),
                        _provider_block(
                            "text", "一、培养目标。", block_id="p1-body", block_order=2
                        ),
                    ),
                )
            ]
            provider_result_bytes = (
                "\n".join(json.dumps(line, ensure_ascii=False) for line in provider_lines) + "\n"
            ).encode("utf-8")
            object_store = _FakeObjectStore(provider_result_bytes=provider_result_bytes)
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "curriculum_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "curriculum_raw_assets.json"
            )
            raw_asset_registry.upsert(
                RawAssetRecord(
                    raw_asset_id="asset:curriculum-plan-2022",
                    raw_version_id="sha256:curriculum-replay-001",
                    corpus="curriculum",
                    collection="curriculum_plan",
                    raw_source_uri="s3://upstream/curriculum-plan-2022.pdf",
                    content_hash="curriculum-replay-001",
                    source_filename="curriculum-plan-2022.pdf",
                    object_key=(
                        "official_pdf/curriculum-plan/2022/sha256/curriculum-replay-001/"
                        "capture/curriculum-plan-2022.pdf"
                    ),
                    ingestion_timestamp="2026-04-03T00:00:00+00:00",
                    import_source="raw_online_ocr",
                )
            )

            report = replay_provider_response_rebuild(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                    "REBUILD_CORPUS": "curriculum",
                    "REBUILD_COLLECTION": "curriculum_plan",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "RAW_VERSION_ID": "sha256:curriculum-replay-001",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                    "EMBEDDING_PROVIDER": "mock",
                },
                request=RebuildRequest(
                    corpus="curriculum",
                    collection="curriculum_plan",
                    import_mode="provider_response_replay",
                    raw_version_id="sha256:curriculum-replay-001",
                ),
                object_store=object_store,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.failed_count, 0)
            self.assertEqual(
                object_store.reads[0],
                (
                    SOURCE_BUCKET,
                    "official_pdf/curriculum-plan/2022/sha256/"
                    "curriculum-replay-001/provider/paddleocr-vl-1-5/provider-response.jsonl",
                ),
            )

    def test_replay_provider_response_rebuild_indexing_defers_to_record_chunk_profile(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "raw_asset_id": "asset:student-handbook-pdf",
                        "documents": [
                            {
                                "document_id": "handbook:d0a1db59ed9a8b00c4349200916edae208d876f6",
                                "title": "普通高等学校学生管理规定",
                                "handbook_section": "国家高等教育管理有关规定",
                                "page_start": 1,
                                "page_end": 2,
                                "source_uri": "campus-agent://regulations/student_rules/docs/handbook:d0a1db59ed9a8b00c4349200916edae208d876f6",
                            }
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            provider_lines = [
                _provider_batch_line(
                    _provider_page(
                        _provider_block(
                            "doc_title",
                            "普通高等学校学生管理规定",
                            block_id="p1-title",
                            block_order=1,
                        ),
                        _provider_block(
                            "text", "第一条 学校坚持育人为本。", block_id="p1-body", block_order=2
                        ),
                    ),
                    _provider_page(
                        _provider_block(
                            "text",
                            "第二条 学生应当遵守校纪校规。",
                            block_id="p2-body",
                            block_order=1,
                        ),
                    ),
                )
            ]
            provider_result_bytes = (
                "\n".join(json.dumps(line, ensure_ascii=False) for line in provider_lines) + "\n"
            ).encode("utf-8")
            object_store = _FakeObjectStore(provider_result_bytes=provider_result_bytes)
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                filename="provider-response.jsonl",
            )

            chunk_profile_args: list[object | None] = []

            def _capture_chunk_profile(**kwargs: object) -> tuple[object, ...]:
                chunk_profile_args.append(kwargs.get("chunk_profile"))
                record = kwargs["record"]
                assert isinstance(record, DocumentRegistryRecord)
                return (
                    IndexableChunk(
                        document_id=record.document_id,
                        revision_track=record.revision_track,
                        version_id=record.version_id,
                        chunk_id=f"{record.document_id}:chunk-0001",
                        chunk_order=1,
                        corpus=record.corpus,
                        collection=record.collection,
                        entitlement_groups=record.entitlement_groups,
                        visibility_scope=record.visibility_scope,
                        visibility_level="public",
                        source_uri=record.source_uri,
                        source_chunk_id=None,
                        anchor={"page_start": 1, "page_end": 1},
                        text="captured chunk",
                        source_channel=record.source_channel,
                        is_current=record.is_current,
                        parser_version=record.parser_version,
                        embedding_model=record.embedding_model,
                        embedding=(0.1, 0.2),
                    ),
                )

            with (
                patch(
                    "campus_ingestion_core.local_rebuild_indexing.build_indexable_chunks_from_jsonl",
                    side_effect=_capture_chunk_profile,
                ),
                patch(
                    "campus_ingestion_core.local_rebuild_indexing.validate_scope_release",
                    return_value=SimpleNamespace(status="passed", summary={"chunk_count": 1}),
                ),
                patch(
                    "campus_ingestion_core.local_rebuild_indexing.index_chunks_to_qdrant",
                    return_value=(),
                ),
                patch(
                    "campus_ingestion_core.local_rebuild_indexing.publish_release_alias",
                    return_value=None,
                ),
            ):
                report = replay_provider_response_rebuild(
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                        "REBUILD_CORPUS": "regulations",
                        "REBUILD_COLLECTION": "student_rules",
                        "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                        "RAW_VERSION_ID": "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                        "REPLAY_SOURCE_PDF": "学生手册_2018.pdf",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                        "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                        "EMBEDDING_PROVIDER": "mock",
                        "REBUILD_INDEX_QDRANT": "1",
                    },
                    object_store=object_store,
                    registry=registry,
                    raw_asset_registry=raw_asset_registry,
                    qdrant_client=QdrantClient(location=":memory:"),
                )

            self.assertEqual(report.failed_count, 0)
            self.assertEqual(chunk_profile_args, [None])

    def test_replay_provider_response_rebuild_reports_indexing_failure_in_final_report(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "raw_asset_id": "asset:student-handbook-pdf",
                        "documents": [
                            {
                                "document_id": "handbook:d0a1db59ed9a8b00c4349200916edae208d876f6",
                                "title": "普通高等学校学生管理规定",
                                "handbook_section": "国家高等教育管理有关规定",
                                "page_start": 1,
                                "page_end": 2,
                                "source_uri": "campus-agent://regulations/student_rules/docs/handbook:d0a1db59ed9a8b00c4349200916edae208d876f6",
                            },
                            {
                                "document_id": "handbook:1a45ef1bc4be11e74514b0bf6e3365ada8a07bbd",
                                "title": "高等学校学生行为准则",
                                "handbook_section": "国家高等教育管理有关规定",
                                "page_start": 3,
                                "page_end": 3,
                                "source_uri": "campus-agent://regulations/student_rules/docs/handbook:1a45ef1bc4be11e74514b0bf6e3365ada8a07bbd",
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            provider_lines = [
                _provider_batch_line(
                    _provider_page(
                        _provider_block(
                            "doc_title",
                            "普通高等学校学生管理规定",
                            block_id="p1-title",
                            block_order=1,
                        ),
                        _provider_block(
                            "text", "第一条 学校坚持育人为本。", block_id="p1-body", block_order=2
                        ),
                    ),
                    _provider_page(
                        _provider_block(
                            "text",
                            "第二条 学生应当遵守校纪校规。",
                            block_id="p2-body",
                            block_order=1,
                        ),
                    ),
                    _provider_page(
                        _provider_block(
                            "doc_title", "高等学校学生行为准则", block_id="p3-title", block_order=1
                        ),
                        _provider_block(
                            "text",
                            "学生应当勤奋学习，尊敬师长。",
                            block_id="p3-body",
                            block_order=2,
                        ),
                    ),
                )
            ]
            provider_result_bytes = (
                "\n".join(json.dumps(line, ensure_ascii=False) for line in provider_lines) + "\n"
            ).encode("utf-8")
            object_store = _FakeObjectStore(provider_result_bytes=provider_result_bytes)
            registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "student_handbook_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "student_handbook_raw_assets.json"
            )
            build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                filename="provider-response.jsonl",
            )
            canonical_provider_key = (
                "official_pdf/student-handbook/2018/sha256/"
                "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider/paddleocr-vl-1-5/provider-response.jsonl"
            )
            canonical_layout_key = (
                "official_pdf/student-handbook/2018/sha256/"
                "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/source-truth/layout-elements.jsonl"
            )

            with patch(
                "campus_ingestion_core.local_rebuild_replay._index_replayed_documents",
                side_effect=RuntimeError("qdrant indexing failed"),
            ):
                report = replay_provider_response_rebuild(
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                        "REBUILD_CORPUS": "regulations",
                        "REBUILD_COLLECTION": "student_rules",
                        "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                        "RAW_VERSION_ID": "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                        "REPLAY_SOURCE_PDF": "学生手册_2018.pdf",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                        "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                        "EMBEDDING_PROVIDER": "mock",
                        "REBUILD_INDEX_QDRANT": "1",
                    },
                    object_store=object_store,
                    registry=registry,
                    raw_asset_registry=raw_asset_registry,
                    qdrant_client=QdrantClient(location=":memory:"),
                )

            self.assertEqual(report.import_mode, "provider_response_replay")
            self.assertEqual(report.success_count, 2)
            self.assertEqual(report.failed_count, 1)
            self.assertEqual(report.raw_uploaded_count, 0)
            self.assertEqual(report.raw_reused_count, 0)
            self.assertIn("qdrant indexing failed", report.errors[0])

            upload_keys = [str(upload["key"]) for upload in object_store.uploads]
            self.assertIn(canonical_provider_key, upload_keys)
            self.assertIn(canonical_layout_key, upload_keys)
            self.assertEqual(
                len([key for key in upload_keys if key.endswith("/document-units.jsonl")]), 2
            )
            self.assertEqual(len([key for key in upload_keys if key.endswith("/canonical.md")]), 2)

            records = registry.list_by_scope("regulations", "student_rules")
            self.assertEqual(len(records), 2)
            self.assertTrue(
                all(record.import_source == "provider_response_replay" for record in records)
            )
            self.assertTrue(
                all(record.canonical_markdown_object_key is not None for record in records)
            )
            self.assertEqual(raw_asset_registry.list_by_scope("regulations", "student_rules"), ())

            report_path = Path(report.report_path)
            self.assertTrue(report_path.exists())
            payload = json.loads(report_path.read_text(encoding="utf-8"))
            self.assertEqual(payload["success_count"], 2)
            self.assertEqual(payload["failed_count"], 1)
            self.assertIn("qdrant indexing failed", payload["errors"][0])
