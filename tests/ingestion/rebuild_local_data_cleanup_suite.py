from __future__ import annotations

import unittest

from .rebuild_local_data_test_support import *  # noqa: F401,F403


class RebuildLocalDataCleanupTest(unittest.TestCase):
    def test_rebuild_clears_minio_and_registry_without_touching_qdrant_by_default(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        qdrant = _FakeQdrantAdmin()
        document_registry = _FakeDocumentRegistryWithRecords(
            _FakeDocumentRecord(
                corpus="regulations",
                collection="student_rules",
                processed_object_keys=(
                    "official_pdf/student-handbook/undated/sha256/raw-001/provider/paddleocr-vl-1-5/provider-response.jsonl",
                    "official_pdf/student-handbook/undated/sha256/raw-001/source-truth/layout-elements.jsonl",
                    "regulations/documents/student_rules/test-001--test-001/source-faithful/2018/canonical.md",
                    "regulations/documents/student_rules/test-001--test-001/source-faithful/2018/document-units.jsonl",
                ),
            )
        )
        raw_asset_registry = _FakeRawAssetRegistry()
        raw_asset_registry.upsert(
            RawAssetRecord(
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:raw-001",
                corpus="regulations",
                collection="student_rules",
                raw_source_uri="s3://upstream/student-handbook.pdf",
                content_hash="raw-001",
                source_filename="student-handbook.pdf",
                object_key="official_pdf/student-handbook/undated/sha256/raw-001/capture/student-handbook.pdf",
                ingestion_timestamp="2026-03-24T00:00:00+00:00",
                import_source="seed",
            )
        )
        calls: list[dict[str, str]] = []

        report = rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                "OBJECT_STORE_BUCKET_DERIVED": DERIVED_BUCKET,
                "REBUILD_CORPUS": "regulations",
                "REBUILD_COLLECTION": "student_rules",
                "REBUILD_IMPORT_MODE": "raw_online_ocr",
            },
            object_store=object_store,
            qdrant_admin=qdrant,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            import_runner=lambda **kwargs: calls.append(kwargs["env"]) or {"status": "ok"},
        )

        self.assertEqual(
            object_store.cleared_prefixes,
            [
                (
                    DERIVED_BUCKET,
                    "regulations/documents/student_rules/test-001--test-001/source-faithful/2018/canonical.md",
                    (),
                ),
                (
                    DERIVED_BUCKET,
                    "regulations/documents/student_rules/test-001--test-001/source-faithful/2018/document-units.jsonl",
                    (),
                ),
            ],
        )
        self.assertEqual(qdrant.reset_aliases, [])
        self.assertEqual(document_registry.deleted_scopes, [("regulations", "student_rules")])
        self.assertEqual(raw_asset_registry.deleted_scopes, [])
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["REBUILD_IMPORT_MODE"], "raw_online_ocr")
        self.assertEqual(report.import_result, {"status": "ok"})
        self.assertEqual(report.import_context["REBUILD_IMPORT_MODE"], "raw_online_ocr")
        self.assertNotIn("OBJECT_STORE_SECRET_KEY", report.import_context)

    def test_rebuild_can_optionally_reset_qdrant_collection(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        qdrant = _FakeQdrantAdmin()

        rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "REBUILD_CORPUS": "regulations",
                "REBUILD_COLLECTION": "student_rules",
                "REBUILD_IMPORT_MODE": "raw_online_ocr",
                "QDRANT_URL": "https://qdrant.example.com",
                "REBUILD_RESET_QDRANT": "1",
            },
            object_store=object_store,
            qdrant_admin=qdrant,
            document_registry=_FakeDocumentRegistry(),
            raw_asset_registry=_FakeRawAssetRegistry(),
            import_runner=lambda **kwargs: {"status": "ok"},
        )

        self.assertEqual(qdrant.reset_aliases, ["student_rules"])

    def test_resolve_rebuild_target_qdrant_aliases_defaults_to_request_collection_without_global_scope(
        self,
    ) -> None:
        collections = _resolve_rebuild_target_qdrant_aliases(
            source={},
            request=RebuildRequest(
                corpus="curriculum",
                collection="curriculum_plan",
                import_mode="raw_online_ocr",
            ),
            collection_config=resolve_collection_truth_config("curriculum", "curriculum_plan"),
        )

        self.assertEqual(collections, ("curriculum_plan",))

    def test_rebuild_provider_response_replay_does_not_touch_qdrant_without_explicit_flags(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        qdrant = _FakeQdrantAdmin()

        rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "REBUILD_CORPUS": "regulations",
                "REBUILD_COLLECTION": "student_rules",
                "REBUILD_IMPORT_MODE": "provider_response_replay",
                "RAW_VERSION_ID": "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            },
            object_store=object_store,
            qdrant_admin=qdrant,
            document_registry=_FakeDocumentRegistry(),
            raw_asset_registry=_FakeRawAssetRegistry(),
            import_runner=lambda **kwargs: {"status": "replay"},
        )

        self.assertEqual(qdrant.reset_aliases, [])

    def test_rebuild_provider_response_replay_resets_all_target_qdrant_collections(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        qdrant = _FakeQdrantAdmin()
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_config_path = root / "configs" / "source-projections.v1.json"
            projection_config_path.parent.mkdir(parents=True)
            projection_config_path.write_text(
                json.dumps(
                    {
                        "schema_version": "student_rules_source_projections_v1",
                        "source_corpus": "regulations",
                        "source_collection": "student_rules",
                        "raw_asset_id": "asset:student-handbook-pdf",
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
                                "source_title": "中央民族大学校内常用电话",
                                "attachment_kind": "navigation_like",
                                "attachment_role": "service_contact_directory",
                                "target_title": "中央民族大学校内常用电话",
                            },
                            {
                                "projection_name": "handbook_navigation_service_catalog",
                                "target_corpus": "campus_services",
                                "target_collection": "service_catalog",
                                "projection_family": "derived_documents",
                                "replay_from_source_truth": True,
                                "derived_from": "source_truth",
                                "derived_from_document_id": None,
                                "parent_document_id": None,
                                "source_title": "中央民族大学公寓及公费医疗管理规定",
                                "attachment_kind": "navigation_like",
                                "attachment_role": "service_navigation_document",
                                "target_title": "中央民族大学学生公寓管理工作流程",
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            rebuild_local_data(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "REBUILD_CORPUS": "regulations",
                    "REBUILD_COLLECTION": "student_rules",
                    "REBUILD_IMPORT_MODE": "provider_response_replay",
                    "RAW_VERSION_ID": "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                    "QDRANT_URL": "https://qdrant.example.com",
                    "REBUILD_RESET_QDRANT": "1",
                    "HANDBOOK_SOURCE_PROJECTIONS_PATH": str(projection_config_path),
                },
                object_store=object_store,
                qdrant_admin=qdrant,
                document_registry=_FakeDocumentRegistry(),
                raw_asset_registry=_FakeRawAssetRegistry(),
                import_runner=lambda **kwargs: {"status": "replay"},
            )

        self.assertEqual(
            qdrant.reset_aliases,
            ["student_rules", "contact_directory", "service_catalog"],
        )

    def test_rebuild_provider_response_replay_resets_curriculum_target_qdrant_collection_only(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        qdrant = _FakeQdrantAdmin()

        rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "REBUILD_CORPUS": "curriculum",
                "REBUILD_COLLECTION": "curriculum_plan",
                "REBUILD_IMPORT_MODE": "provider_response_replay",
                "RAW_VERSION_ID": "sha256:curriculum-replay-001",
                "QDRANT_URL": "https://qdrant.example.com",
                "REBUILD_RESET_QDRANT": "1",
            },
            object_store=object_store,
            qdrant_admin=qdrant,
            document_registry=_FakeDocumentRegistry(),
            raw_asset_registry=_FakeRawAssetRegistry(),
            import_runner=lambda **kwargs: {"status": "replay"},
        )

        self.assertEqual(
            qdrant.reset_aliases,
            ["curriculum_plan", "course_facts", "program_family_facts", "program_semester_facts"],
        )

    def test_rebuild_uses_ingestion_corpus_prefix_for_curriculum_plan(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        document_registry = _FakeDocumentRegistryWithRecords(
            _FakeDocumentRecord(
                corpus="curriculum",
                collection="curriculum_plan",
                processed_object_keys=(
                    "official_pdf/curriculum-plan-master/undated/sha256/raw-001/provider/vlm/provider-response.jsonl",
                    "curriculum/documents/curriculum_plan/plan-001--plan-001/source-faithful/undated/document-units.jsonl",
                ),
            )
        )
        raw_asset_registry = _FakeRawAssetRegistry()
        raw_asset_registry.upsert(
            RawAssetRecord(
                raw_asset_id="asset:curriculum-plan-master-pdf",
                raw_version_id="sha256:raw-001",
                corpus="curriculum",
                collection="curriculum_plan",
                raw_source_uri="s3://upstream/curriculum-plan.pdf",
                content_hash="raw-001",
                source_filename="curriculum-plan.pdf",
                object_key="official_pdf/curriculum-plan-master/undated/sha256/raw-001/capture/curriculum-plan.pdf",
                ingestion_timestamp="2026-03-24T00:00:00+00:00",
                import_source="raw_online_ocr",
            )
        )

        rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "REBUILD_IMPORT_MODE": "raw_online_ocr",
                "REBUILD_CORPUS": "curriculum",
                "REBUILD_COLLECTION": "curriculum_plan",
            },
            object_store=object_store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            import_runner=lambda **kwargs: {"status": "ok"},
        )

        self.assertEqual(
            object_store.cleared_prefixes,
            [
                (
                    DERIVED_BUCKET,
                    "curriculum/documents/curriculum_plan/plan-001--plan-001/source-faithful/undated/document-units.jsonl",
                    (),
                ),
            ],
        )

    def test_rebuild_local_data_requires_explicit_import_mode(self) -> None:
        with self.assertRaisesRegex(ValueError, "REBUILD_IMPORT_MODE"):
            rebuild_local_data(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "REBUILD_CORPUS": "regulations",
                    "REBUILD_COLLECTION": "student_rules",
                },
                object_store=_FakeObjectStoreAdmin(),
                import_runner=lambda **kwargs: {"status": "ok"},
            )

    def test_rebuild_local_data_rejects_removed_existing_ocr_mode(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported REBUILD_IMPORT_MODE: existing_ocr"):
            rebuild_local_data(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "REBUILD_CORPUS": "regulations",
                    "REBUILD_COLLECTION": "student_rules",
                    "REBUILD_IMPORT_MODE": "existing_ocr",
                },
                object_store=_FakeObjectStoreAdmin(),
                import_runner=lambda **kwargs: {"status": "ok"},
            )

    def test_rebuild_local_data_requires_canonical_registry_env_when_runtime_registries_are_not_injected(
        self,
    ) -> None:
        with self.assertRaisesRegex(
            ValueError, "DOCUMENT_REGISTRY_DATABASE_URL or CAMPUS_SHARED_POSTGRES_URL is required"
        ):
            rebuild_local_data(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "REBUILD_CORPUS": "regulations",
                    "REBUILD_COLLECTION": "student_rules",
                    "REBUILD_IMPORT_MODE": "raw_online_ocr",
                },
                object_store=_FakeObjectStoreAdmin(),
                import_runner=lambda **kwargs: {"status": "ok"},
            )

    def test_rebuild_local_data_deletes_registry_by_corpus_and_can_dispatch_raw_online_ocr(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        document_registry = _FakeDocumentRegistry()
        raw_asset_registry = _FakeRawAssetRegistry()
        calls: list[dict[str, str]] = []

        report = rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "REBUILD_CORPUS": "curriculum",
                "REBUILD_COLLECTION": "curriculum_plan",
                "REBUILD_IMPORT_MODE": "raw_online_ocr",
            },
            object_store=object_store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            import_runner=lambda **kwargs: calls.append(kwargs["env"]) or {"status": "raw"},
        )

        self.assertEqual(document_registry.deleted_scopes, [("curriculum", "curriculum_plan")])
        self.assertEqual(raw_asset_registry.deleted_scopes, [])
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["REBUILD_IMPORT_MODE"], "raw_online_ocr")
        self.assertEqual(report.import_result, {"status": "raw"})
        self.assertEqual(report.import_context["REBUILD_IMPORT_MODE"], "raw_online_ocr")
        self.assertNotIn("OBJECT_STORE_SECRET_KEY", report.import_context)

    def test_rebuild_provider_response_replay_preserves_source_key_in_processed_bucket(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        document_registry = _FakeDocumentRegistry()
        raw_asset_registry = _FakeRawAssetRegistry()
        calls: list[dict[str, str]] = []
        source_key = (
            "official_pdf/student-handbook/undated/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/provider/paddleocr-vl-1-5/provider-response.jsonl"
        )

        report = rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "REBUILD_CORPUS": "regulations",
                "REBUILD_COLLECTION": "student_rules",
                "REBUILD_IMPORT_MODE": "provider_response_replay",
                "RAW_VERSION_ID": "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            },
            object_store=object_store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            import_runner=lambda **kwargs: calls.append(kwargs["env"]) or {"status": "replay"},
        )

        cleared_prefixes = [prefix for _, prefix, _ in object_store.cleared_prefixes]
        self.assertIn(
            "campus_services/documents/contact_directory/"
            "中央民族大学校内常用电话--bf03f0bd/source-faithful/2018/canonical.md",
            cleared_prefixes,
        )
        self.assertIn(
            "campus_services/documents/service_catalog/"
            "中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/document-units.jsonl",
            cleared_prefixes,
        )
        self.assertNotIn(source_key, cleared_prefixes)
        self.assertEqual(document_registry.deleted_scopes, [])
        self.assertEqual(raw_asset_registry.deleted_scopes, [])
        self.assertEqual(len(calls), 1)
        self.assertEqual(report.import_result, {"status": "replay"})
        self.assertNotIn("REBUILD_PROVIDER_RESPONSE_KEY", calls[0])
        self.assertNotIn("REBUILD_PROVIDER_RESPONSE_KEY", report.import_context)
        self.assertNotIn("OBJECT_STORE_SECRET_KEY", report.import_context)

    def test_replay_provider_response_rebuild_supports_curriculum_plan(self) -> None:
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
                        "raw_asset_id": "asset:curriculum-plan-master-pdf",
                        "documents": [
                            {
                                "document_id": "curriculum:plan-001",
                                "title": "Plan 001",
                                "page_start": 1,
                                "page_end": 1,
                                "entitlement_groups": [],
                                "visibility_scope": "main",
                                "status": "active",
                            }
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            provider_lines = [
                {
                    "pageNumber": 1,
                    "result": {
                        "layoutParsingResults": [
                            {
                                "blockType": "title",
                                "blockId": "p1-title",
                                "readingOrder": 1,
                                "markdown": {"text": "Plan 001"},
                            },
                            {
                                "blockType": "paragraph",
                                "blockId": "p1-body",
                                "readingOrder": 2,
                                "markdown": {"text": "培养具有跨学科能力的复合型人才。"},
                            },
                        ]
                    },
                    "logId": "log-001",
                }
            ]
            provider_bytes = (
                "\n".join(json.dumps(line, ensure_ascii=False) for line in provider_lines) + "\n"
            ).encode("utf-8")
            raw_version_id = "sha256:curriculum-replay-001"
            provider_response_key = build_source_ocr_artifact_key(
                raw_asset_id="asset:curriculum-plan-master-pdf",
                raw_version_id=raw_version_id,
                filename="provider-response.jsonl",
                source_channel="official_pdf",
                model_slug="vlm",
                year="undated",
            )
            object_store = _FakeObjectStoreAdmin()
            object_store.objects[(SOURCE_BUCKET, provider_response_key)] = provider_bytes
            document_registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "curriculum_plan_documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "curriculum_plan_raw_assets.json"
            )
            raw_asset_registry.upsert(
                RawAssetRecord(
                    raw_asset_id="asset:curriculum-plan-master-pdf",
                    raw_version_id=raw_version_id,
                    corpus="curriculum",
                    collection="curriculum_plan",
                    raw_source_uri="s3://campus-rag-source/official_pdf/curriculum-plan-master-pdf/curriculum-plan.pdf",
                    content_hash="curriculum-replay-001",
                    source_filename="curriculum-plan.pdf",
                    object_key=(
                        "official_pdf/curriculum-plan-master-pdf/undated/sha256/"
                        "curriculum-replay-001/capture/curriculum-plan.pdf"
                    ),
                    ingestion_timestamp="2026-03-27T00:00:00+00:00",
                    import_source="seed",
                )
            )

            report = replay_provider_response_rebuild(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                    "OBJECT_STORE_BUCKET_DERIVED": DERIVED_BUCKET,
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "REBUILD_CORPUS": "curriculum",
                    "REBUILD_COLLECTION": "curriculum_plan",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                    "RAW_VERSION_ID": raw_version_id,
                    "REPLAY_SOURCE_PDF": "curriculum-plan.pdf",
                },
                object_store=object_store,
                registry=document_registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.document_ids, ("curriculum:plan-001",))
            records = document_registry.list_by_scope("curriculum", "curriculum_plan")
            self.assertEqual(len(records), 1)
            record = records[0]
            self.assertEqual(record.document_id, "curriculum:plan-001")
            self.assertEqual(record.cleaning_policy_version, "curriculum_plan_cleaning_v1")
            self.assertEqual(record.parser_version, "mineru-vlm-adapted-v2")
            layout_elements_key = build_source_truth_artifact_key(
                raw_asset_id="asset:curriculum-plan-master-pdf",
                raw_version_id=raw_version_id,
                filename="layout-elements.jsonl",
                source_channel="official_pdf",
                year="undated",
            )
            self.assertIn((SOURCE_BUCKET, layout_elements_key), object_store.objects)
            document_units_key = build_processed_artifact_key(
                corpus="curriculum",
                collection="curriculum_plan",
                document_id=record.document_id,
                revision_track=record.revision_track,
                version_id=record.version_id,
                title="Plan 001",
                year=None,
                filename="document-units.jsonl",
            )
            self.assertIn((DERIVED_BUCKET, document_units_key), object_store.objects)
