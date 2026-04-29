from __future__ import annotations

import unittest

from .provider_result_replay_rebuild_test_support import *


class ProviderResultReplayRebuildIndexingTest(unittest.TestCase):
    def test_replay_provider_response_rebuild_writes_trace_events_when_trace_path_is_configured(
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
            trace_path = root / "trace" / "rebuild.jsonl"

            with patch(
                "campus_ingestion_core.local_rebuild_replay._index_replayed_documents"
            ) as index_documents:
                replay_provider_response_rebuild(
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
                        "REBUILD_TRACE_JSONL_PATH": str(trace_path),
                    },
                    object_store=object_store,
                    registry=registry,
                    raw_asset_registry=raw_asset_registry,
                )

            index_documents.assert_not_called()
            events = [
                json.loads(line)
                for line in trace_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
            event_pairs = {(event["stage"], event["event"]) for event in events}
            self.assertIn(("replay.load_source_artifacts", "end"), event_pairs)
            self.assertIn(("replay.build_documents", "end"), event_pairs)
            self.assertIn(("replay.persist_documents", "end"), event_pairs)

    def test_replay_provider_response_rebuild_can_optionally_index_qdrant(self) -> None:
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
            qdrant_client = QdrantClient(location=":memory:")
            build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                filename="provider-response.jsonl",
            )

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
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                    "EMBEDDING_PROVIDER": "mock",
                    "SPARSE_PROVIDER": "mock",
                    "REBUILD_INDEX_QDRANT": "1",
                },
                object_store=object_store,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
                qdrant_client=qdrant_client,
            )

            self.assertEqual(report.failed_count, 0)
            aliases = {
                alias.alias_name: alias.collection_name
                for alias in qdrant_client.get_aliases().aliases or []
            }
            self.assertIn("student_rules", aliases)
            collection_info = qdrant_client.get_collection(aliases["student_rules"])
            self.assertGreater(collection_info.points_count or 0, 0)

    def test_replay_provider_response_rebuild_can_index_without_publishing_alias(self) -> None:
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
            qdrant_client = QdrantClient(location=":memory:")

            with patch(
                "campus_ingestion_core.local_rebuild_indexing.validate_scope_release",
                return_value=SimpleNamespace(status="passed", summary={"chunk_count": 1}),
            ):
                report = replay_provider_response_rebuild(
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                        "REBUILD_CORPUS": "curriculum",
                        "REBUILD_COLLECTION": "curriculum_plan",
                        "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                        "RAW_VERSION_ID": "sha256:curriculum-replay-001",
                        "REPLAY_SOURCE_PDF": "curriculum-plan.pdf",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                        "INGESTION_EMBEDDING_MODEL": "mock-embedding-8d",
                        "EMBEDDING_PROVIDER": "mock",
                        "SPARSE_PROVIDER": "mock",
                        "REBUILD_INDEX_QDRANT": "1",
                        "REBUILD_PUBLISH_ALIAS": "0",
                    },
                    object_store=object_store,
                    registry=registry,
                    raw_asset_registry=raw_asset_registry,
                    qdrant_client=qdrant_client,
                )

            self.assertEqual(report.failed_count, 0)
            aliases = {
                alias.alias_name: alias.collection_name
                for alias in qdrant_client.get_aliases().aliases or []
            }
            self.assertNotIn("curriculum_plan", aliases)
            collections = [
                collection.name for collection in qdrant_client.get_collections().collections or []
            ]
            self.assertTrue(any(str(name).startswith("curriculum_plan__r") for name in collections))
            upload_keys = [str(upload["key"]) for upload in object_store.uploads]
            self.assertTrue(any(key.endswith("/index-release.json") for key in upload_keys))
            self.assertTrue(any(key.endswith("/validation-summary.json") for key in upload_keys))
