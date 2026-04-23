from __future__ import annotations

import unittest

from .rebuild_local_data_test_support import *


class RebuildLocalDataReplayTest(unittest.TestCase):
    def test_rebuild_provider_response_replay_accepts_typed_request_without_source_specific_env(
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
            },
            request=RebuildRequest(
                corpus="regulations",
                collection="student_rules",
                import_mode="provider_response_replay",
                raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            ),
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
        self.assertNotIn(
            "campus_services/documents/service_catalog/"
            "中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/flow-graph.json",
            cleared_prefixes,
        )
        self.assertEqual(document_registry.deleted_scopes, [])
        self.assertEqual(raw_asset_registry.deleted_scopes, [])
        self.assertEqual(len(calls), 1)
        self.assertNotIn("REBUILD_PROVIDER_RESPONSE_KEY", calls[0])
        self.assertNotIn("REBUILD_PROVIDER_RESPONSE_KEY", report.import_context)
        self.assertEqual(
            report.import_context["INGESTION_SPLIT_MANIFEST_PATH"],
            str(
                Path("configs/ingestion/regulations/student_rules/split-manifest.v1.json").resolve()
            ),
        )
        self.assertNotIn("OBJECT_STORE_SECRET_KEY", report.import_context)

    def test_rebuild_provider_response_replay_uses_curriculum_raw_asset_source_pdf_when_available(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        document_registry = _FakeDocumentRegistry()
        raw_asset_registry = _FakeRawAssetRegistry()
        raw_asset_registry.upsert(
            RawAssetRecord(
                raw_asset_id="asset:curriculum-plan-2022",
                raw_version_id="sha256:curriculum-replay-001",
                corpus="curriculum",
                collection="curriculum_plan",
                raw_source_uri="s3://upstream/curriculum-plan-2022.pdf",
                content_hash="curriculum-replay-001",
                source_filename="curriculum-plan-2022.pdf",
                object_key="official_pdf/curriculum-plan/2022/sha256/curriculum-replay-001/capture/curriculum-plan-2022.pdf",
                ingestion_timestamp="2026-04-03T00:00:00+00:00",
                import_source="raw_online_ocr",
            )
        )
        calls: list[dict[str, str]] = []

        report = rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            },
            request=RebuildRequest(
                corpus="curriculum",
                collection="curriculum_plan",
                import_mode="provider_response_replay",
                raw_version_id="sha256:curriculum-replay-001",
            ),
            object_store=object_store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            import_runner=lambda **kwargs: calls.append(kwargs["env"]) or {"status": "replay"},
        )

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["REPLAY_SOURCE_PDF"], "curriculum-plan-2022.pdf")
        self.assertEqual(report.import_context["REPLAY_SOURCE_PDF"], "curriculum-plan-2022.pdf")

    def test_rebuild_provider_response_replay_falls_back_to_curriculum_default_source_pdf_without_raw_asset_record(
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
            },
            request=RebuildRequest(
                corpus="curriculum",
                collection="curriculum_plan",
                import_mode="provider_response_replay",
                raw_version_id="sha256:curriculum-replay-001",
            ),
            object_store=object_store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            import_runner=lambda **kwargs: calls.append(kwargs["env"]) or {"status": "replay"},
        )

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["REPLAY_SOURCE_PDF"], "curriculum-plan.pdf")
        self.assertEqual(report.import_context["REPLAY_SOURCE_PDF"], "curriculum-plan.pdf")

    def test_rebuild_typed_request_ignores_stale_split_manifest_override_from_env(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        document_registry = _FakeDocumentRegistry()
        raw_asset_registry = _FakeRawAssetRegistry()
        calls: list[dict[str, str]] = []

        report = rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "INGESTION_SPLIT_MANIFEST_PATH": "configs/ingestion/regulations/student_rules/split-manifest.v1.json",
            },
            request=RebuildRequest(
                corpus="curriculum",
                collection="curriculum_plan",
                import_mode="provider_response_replay",
                raw_version_id="sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67",
            ),
            object_store=object_store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            import_runner=lambda **kwargs: calls.append(kwargs["env"]) or {"status": "replay"},
        )

        expected_manifest = str(
            Path("configs/ingestion/curriculum/curriculum_plan/split-manifest.v1.json").resolve()
        )
        self.assertEqual(report.import_context["INGESTION_SPLIT_MANIFEST_PATH"], expected_manifest)
        self.assertEqual(calls[0]["INGESTION_SPLIT_MANIFEST_PATH"], expected_manifest)

    def test_rebuild_local_data_writes_trace_events_when_trace_path_is_configured(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        with TemporaryDirectory() as temp_dir:
            trace_path = Path(temp_dir) / "rebuild-trace.jsonl"

            rebuild_local_data(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "REBUILD_TRACE_JSONL_PATH": str(trace_path),
                },
                request=RebuildRequest(
                    corpus="regulations",
                    collection="student_rules",
                    import_mode="raw_online_ocr",
                ),
                object_store=object_store,
                document_registry=_FakeDocumentRegistry(),
                raw_asset_registry=_FakeRawAssetRegistry(),
                import_runner=lambda **kwargs: {"status": "ok"},
            )

            events = [
                json.loads(line)
                for line in trace_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]

        self.assertTrue(events)
        self.assertEqual(events[0]["stage"], "rebuild.cleanup.collect_processed_keys")
        self.assertEqual(events[0]["event"], "start")
        self.assertEqual(events[-1]["stage"], "rebuild.import_runner")
        self.assertEqual(events[-1]["event"], "end")
        self.assertIn(
            ("rebuild.cleanup.delete_registry_scope", "end"),
            {(event["stage"], event["event"]) for event in events},
        )

    def test_rebuild_provider_response_replay_can_disable_alias_publish_in_import_context(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        calls: list[dict[str, str]] = []

        report = rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            },
            request=RebuildRequest(
                corpus="curriculum",
                collection="curriculum_plan",
                import_mode="provider_response_replay",
                raw_version_id="sha256:curriculum-replay-001",
                index_qdrant=True,
                publish_qdrant_alias=False,
            ),
            object_store=object_store,
            document_registry=_FakeDocumentRegistry(),
            raw_asset_registry=_FakeRawAssetRegistry(),
            import_runner=lambda **kwargs: calls.append(kwargs["env"]) or {"status": "replay"},
        )

        self.assertEqual(calls[0]["REBUILD_INDEX_QDRANT"], "1")
        self.assertEqual(calls[0]["REBUILD_PUBLISH_ALIAS"], "0")
        self.assertEqual(report.import_context["REBUILD_PUBLISH_ALIAS"], "0")

    def test_rebuild_provider_response_replay_uses_raw_processed_keys_when_scope_rows_have_legacy_auth_projection(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        document_registry = _LegacyProjectionBlockedDocumentRegistry(
            scope_keys={
                (
                    "curriculum",
                    "curriculum_plan",
                ): (
                    "curriculum/documents/curriculum_plan/plan-001/source-faithful/2022/canonical.md",
                    "curriculum/documents/curriculum_plan/plan-001/source-faithful/2022/document-units.jsonl",
                )
            }
        )

        rebuild_local_data(
            env={
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            },
            request=RebuildRequest(
                corpus="curriculum",
                collection="curriculum_plan",
                import_mode="provider_response_replay",
                raw_version_id="sha256:curriculum-replay-001",
            ),
            object_store=object_store,
            document_registry=document_registry,
            raw_asset_registry=_FakeRawAssetRegistry(),
            import_runner=lambda **kwargs: {"status": "replay"},
        )

        self.assertEqual(
            object_store.cleared_prefixes,
            [
                (
                    DERIVED_BUCKET,
                    "curriculum/documents/curriculum_plan/plan-001/source-faithful/2022/canonical.md",
                    (),
                ),
                (
                    DERIVED_BUCKET,
                    "curriculum/documents/curriculum_plan/plan-001/source-faithful/2022/document-units.jsonl",
                    (),
                ),
            ],
        )
        self.assertEqual(document_registry.deleted_scopes, [("curriculum", "curriculum_plan")])

    def test_rebuild_provider_response_replay_clears_declared_downstream_projection_artifacts(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        projection_config = {
            "schema_version": "student_rules_source_projections_v1",
            "source_corpus": "regulations",
            "source_collection": "student_rules",
            "raw_asset_id": "asset:student-handbook-pdf",
            "source_truth_artifacts": [
                "provider-response.jsonl",
                "layout-elements.jsonl",
                "split-manifest.v1.json",
                "per-document source rows",
            ],
            "rebuild_boundary": "source_truth",
            "rebuild_rule": "When canonical source truth exists, downstream rebuild must reuse source truth and must not return to raw.",
            "derived_document_fields": [
                "projection_name",
                "derived_from_raw_asset_id",
                "derived_from_raw_version_id",
                "derived_from",
                "derived_from_document_id",
                "parent_document_id",
                "source_title",
                "source_handbook_section",
                "source_page_start",
                "source_page_end",
                "attachment_kind",
                "attachment_role",
            ],
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
                    "projection_name": "handbook_navigation_service_catalog",
                    "target_corpus": "campus_services",
                    "target_collection": "service_catalog",
                    "projection_family": "derived_documents",
                    "replay_from_source_truth": True,
                    "derived_from": "source_truth",
                    "derived_from_document_id": None,
                    "parent_document_id": None,
                    "source_title": "中央民族大学公寓及公费医疗管理规定",
                    "source_handbook_section": "中央民族大学公寓及公费医疗管理规定",
                    "source_page_start": 252,
                    "source_page_end": 255,
                    "attachment_kind": "navigation_like",
                    "attachment_role": "service_navigation_document",
                    "target_title": "中央民族大学学生公寓管理工作流程",
                    "migration_reason": "handbook_navigation_document",
                },
            ],
        }
        with TemporaryDirectory() as temp_dir:
            projection_config_path = Path(temp_dir) / "source-projections.v1.json"
            projection_config_path.write_text(
                json.dumps(projection_config, ensure_ascii=False, indent=2), encoding="utf-8"
            )

            document_registry = _FakeDocumentRegistryWithRecords(
                _FakeDocumentRecord(
                    corpus="regulations",
                    collection="student_rules",
                    processed_object_keys=(
                        "regulations/documents/student_rules/doc-a/source-faithful/2018/canonical.md",
                        "regulations/documents/student_rules/doc-a/source-faithful/2018/document-units.jsonl",
                    ),
                ),
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
                    "HANDBOOK_SOURCE_PROJECTIONS_PATH": str(projection_config_path),
                },
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=_FakeRawAssetRegistry(),
                import_runner=lambda **kwargs: {"status": "replay"},
            )

        cleared_prefixes = [prefix for _, prefix, _ in object_store.cleared_prefixes]
        self.assertIn(
            "campus_services/documents/service_catalog/"
            "中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/canonical.md",
            cleared_prefixes,
        )
        self.assertIn(
            "campus_services/documents/service_catalog/"
            "中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/document-units.jsonl",
            cleared_prefixes,
        )
        self.assertNotIn(
            "campus_services/documents/service_catalog/"
            "中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/flow-graph.json",
            cleared_prefixes,
        )

    def test_rebuild_provider_response_replay_clears_declared_downstream_projection_artifacts_when_scope_rows_are_legacy(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        projection_config = {
            "schema_version": "student_rules_source_projections_v1",
            "source_corpus": "regulations",
            "source_collection": "student_rules",
            "raw_asset_id": "asset:student-handbook-pdf",
            "source_truth_artifacts": [
                "provider-response.jsonl",
                "layout-elements.jsonl",
                "split-manifest.v1.json",
                "per-document source rows",
            ],
            "rebuild_boundary": "source_truth",
            "rebuild_rule": "When canonical source truth exists, downstream rebuild must reuse source truth and must not return to raw.",
            "derived_document_fields": [
                "projection_name",
                "derived_from_raw_asset_id",
                "derived_from_raw_version_id",
                "derived_from",
                "derived_from_document_id",
                "parent_document_id",
                "source_title",
                "source_handbook_section",
                "source_page_start",
                "source_page_end",
                "attachment_kind",
                "attachment_role",
            ],
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
                    "projection_name": "handbook_navigation_service_catalog",
                    "target_corpus": "campus_services",
                    "target_collection": "service_catalog",
                    "projection_family": "derived_documents",
                    "replay_from_source_truth": True,
                    "derived_from": "source_truth",
                    "derived_from_document_id": None,
                    "parent_document_id": None,
                    "source_title": "中央民族大学公寓及公费医疗管理规定",
                    "source_handbook_section": "中央民族大学公寓及公费医疗管理规定",
                    "source_page_start": 252,
                    "source_page_end": 255,
                    "attachment_kind": "navigation_like",
                    "attachment_role": "service_navigation_document",
                    "target_title": "中央民族大学学生公寓管理工作流程",
                    "migration_reason": "handbook_navigation_document",
                },
            ],
        }
        with TemporaryDirectory() as temp_dir:
            projection_config_path = Path(temp_dir) / "source-projections.v1.json"
            projection_config_path.write_text(
                json.dumps(projection_config, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            document_registry = _LegacyProjectionBlockedDocumentRegistry(
                scope_keys={
                    (
                        "regulations",
                        "student_rules",
                    ): (
                        "regulations/documents/student_rules/doc-a/source-faithful/2018/canonical.md",
                        "regulations/documents/student_rules/doc-a/source-faithful/2018/document-units.jsonl",
                    ),
                    (
                        "campus_services",
                        "service_catalog",
                    ): (
                        "campus_services/documents/service_catalog/中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/canonical.md",
                        "campus_services/documents/service_catalog/中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/document-units.jsonl",
                    ),
                }
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
                    "HANDBOOK_SOURCE_PROJECTIONS_PATH": str(projection_config_path),
                },
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=_FakeRawAssetRegistry(),
                import_runner=lambda **kwargs: {"status": "replay"},
            )

        cleared_prefixes = [prefix for _, prefix, _ in object_store.cleared_prefixes]
        self.assertIn(
            "campus_services/documents/service_catalog/"
            "中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/canonical.md",
            cleared_prefixes,
        )
        self.assertIn(
            "campus_services/documents/service_catalog/"
            "中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/document-units.jsonl",
            cleared_prefixes,
        )
