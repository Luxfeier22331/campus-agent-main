from __future__ import annotations

import unittest

from .rebuild_local_data_test_support import *  # noqa: F401,F403


class StudentHandbookSourceMigrationTest(unittest.TestCase):
    def test_migrate_student_handbook_source_faithful_renames_raw_asset_and_dispatches_rebuild(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        raw_asset_registry = _FakeRawAssetRegistry()
        old_raw_key = (
            "official_pdf/student-handbook/undated/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/capture/student-handbook.pdf"
        )
        object_store.objects[(SOURCE_BUCKET, old_raw_key)] = b"%PDF-1.4 handbook"
        raw_asset_registry.upsert(
            RawAssetRecord(
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                corpus="regulations",
                collection="student_rules",
                raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/student-handbook.pdf",
                content_hash="b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                source_filename="student-handbook.pdf",
                object_key=old_raw_key,
                ingestion_timestamp="2026-03-24T00:00:00+00:00",
                import_source="seed",
            )
        )
        calls: list[dict[str, object]] = []

        with (
            patch("campus_ingestion_core.handbook_source_migration.rebuild_local_data") as rebuild,
            patch(
                "campus_ingestion_core.handbook_source_migration.materialize_handbook_service_navigation_projection_artifact"
            ) as materialize,
        ):
            rebuild.side_effect = lambda **kwargs: (
                calls.append(kwargs)
                or {"status": "rebuilt", "source_pdf": kwargs["env"]["REPLAY_SOURCE_PDF"]}
            )
            materialize.return_value = ProcessedArtifactInput(
                object_key=build_source_projection_artifact_key(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                    projection_name="handbook_navigation_service_catalog",
                    filename="flow-graph.json",
                    year="2018",
                ),
                data=b'{"schema_version":"handbook_service_navigation_projection_v1","projection_name":"handbook_navigation_service_catalog","raw_asset_id":"asset:student-handbook-pdf","raw_version_id":"sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1","source_document_id":"handbook:source-001","source_uri":"x","source_handbook_section":"x","source_page_start":252,"source_page_end":255,"target_document_id":"campus_services:service_catalog:test","target_title":"x","extractor_runtime":{"kind":"prompt_runtime"},"flow_graph":{"document_title":"x","global_manual_review_required":false,"page_findings":[{"source_page":252,"page_heading":"a","flows":[]},{"source_page":253,"page_heading":"b","flows":[{"flow_heading":"f","audience_scope":"","steps":[{"step_id":"s1","step_text":"t","next_step_ids":[]}],"manual_review_notes":[]}]},{"source_page":254,"page_heading":"c","flows":[]},{"source_page":255,"page_heading":"d","flows":[]}]}}',
                content_type="application/json",
            )
            report = migrate_student_handbook_source_faithful(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                    "OBJECT_STORE_BUCKET_DERIVED": DERIVED_BUCKET,
                    "REBUILD_CORPUS": "regulations",
                    "REBUILD_COLLECTION": "student_rules",
                    "INGESTION_SPLIT_MANIFEST_PATH": "configs/ingestion/regulations/student_rules/split-manifest.v1.json",
                    "RAW_VERSION_ID": "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                },
                object_store=object_store,
                raw_asset_registry=raw_asset_registry,
                document_registry=_FakeDocumentRegistry(),
            )

        new_raw_key = (
            "official_pdf/student-handbook/2018/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/capture/学生手册_2018.pdf"
        )
        self.assertEqual(report.canonical_raw_filename, "学生手册_2018.pdf")
        self.assertEqual(report.previous_raw_object_key, old_raw_key)
        self.assertEqual(report.canonical_raw_object_key, new_raw_key)
        self.assertEqual(
            raw_asset_registry.get(
                "asset:student-handbook-pdf",
                "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            ).source_filename,
            "学生手册_2018.pdf",
        )
        self.assertIn((SOURCE_BUCKET, new_raw_key), object_store.puts)
        self.assertEqual(calls[0]["request"].import_mode, "provider_response_replay")
        self.assertEqual(calls[0]["env"]["REPLAY_SOURCE_PDF"], "学生手册_2018.pdf")

    def test_migrate_student_handbook_source_faithful_refreshes_legacy_scope_when_raw_key_is_already_canonical(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        raw_asset_registry = _FakeRawAssetRegistry()
        canonical_raw_key = (
            "official_pdf/student-handbook/2018/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/capture/学生手册_2018.pdf"
        )
        raw_asset_registry.records[
            (
                "asset:student-handbook-pdf",
                "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            )
        ] = SimpleNamespace(
            raw_asset_id="asset:student-handbook-pdf",
            raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            corpus="student_rules",
            collection="student_rules",
            raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/学生手册_2018.pdf",
            content_hash="b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            source_filename="学生手册_2018.pdf",
            object_key=canonical_raw_key,
            ingestion_timestamp="2026-03-24T00:00:00+00:00",
            import_source="seed",
        )
        calls: list[dict[str, object]] = []

        with (
            patch("campus_ingestion_core.handbook_source_migration.rebuild_local_data") as rebuild,
            patch(
                "campus_ingestion_core.handbook_source_migration.materialize_handbook_service_navigation_projection_artifact"
            ) as materialize,
        ):
            rebuild.side_effect = lambda **kwargs: (
                calls.append(kwargs)
                or {"status": "rebuilt", "source_pdf": kwargs["env"]["REPLAY_SOURCE_PDF"]}
            )
            materialize.return_value = ProcessedArtifactInput(
                object_key=build_source_projection_artifact_key(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                    projection_name="handbook_navigation_service_catalog",
                    filename="flow-graph.json",
                    year="2018",
                ),
                data=b'{"schema_version":"handbook_service_navigation_projection_v1","projection_name":"handbook_navigation_service_catalog","raw_asset_id":"asset:student-handbook-pdf","raw_version_id":"sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1","source_document_id":"handbook:source-001","source_uri":"x","source_handbook_section":"x","source_page_start":252,"source_page_end":255,"target_document_id":"campus_services:service_catalog:test","target_title":"x","extractor_runtime":{"kind":"prompt_runtime"},"flow_graph":{"document_title":"x","global_manual_review_required":false,"page_findings":[{"source_page":252,"page_heading":"a","flows":[]},{"source_page":253,"page_heading":"b","flows":[{"flow_heading":"f","audience_scope":"","steps":[{"step_id":"s1","step_text":"t","next_step_ids":[]}],"manual_review_notes":[]}]},{"source_page":254,"page_heading":"c","flows":[]},{"source_page":255,"page_heading":"d","flows":[]}]}}',
                content_type="application/json",
            )
            report = migrate_student_handbook_source_faithful(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                    "OBJECT_STORE_BUCKET_DERIVED": DERIVED_BUCKET,
                    "REBUILD_CORPUS": "regulations",
                    "REBUILD_COLLECTION": "student_rules",
                    "INGESTION_SPLIT_MANIFEST_PATH": "configs/ingestion/regulations/student_rules/split-manifest.v1.json",
                    "RAW_VERSION_ID": "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                },
                object_store=object_store,
                raw_asset_registry=raw_asset_registry,
                document_registry=_FakeDocumentRegistry(),
            )

        refreshed = raw_asset_registry.get(
            "asset:student-handbook-pdf",
            "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
        )
        self.assertEqual(report.canonical_raw_object_key, canonical_raw_key)
        self.assertIsNotNone(refreshed)
        self.assertEqual(refreshed.corpus, "regulations")
        self.assertEqual(refreshed.collection, "student_rules")
        self.assertEqual(refreshed.source_filename, "学生手册_2018.pdf")
        self.assertEqual(refreshed.object_key, canonical_raw_key)
        self.assertTrue(
            any(
                bucket == SOURCE_BUCKET
                and "/projection/handbook_navigation_service_catalog/flow-graph.json" in key
                for bucket, key in object_store.puts
            )
        )
        self.assertEqual(object_store.cleared_prefixes, [])
        self.assertEqual(calls[0]["request"].import_mode, "provider_response_replay")

    def test_migrate_student_handbook_source_faithful_accepts_source_asset_request(self) -> None:
        object_store = _FakeObjectStoreAdmin()
        raw_asset_registry = _FakeRawAssetRegistry()
        canonical_raw_key = (
            "official_pdf/student-handbook/2018/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/capture/学生手册_2018.pdf"
        )
        raw_asset_registry.records[
            (
                "asset:student-handbook-pdf",
                "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            )
        ] = SimpleNamespace(
            raw_asset_id="asset:student-handbook-pdf",
            raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            corpus="regulations",
            collection="student_rules",
            raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/学生手册_2018.pdf",
            content_hash="b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
            source_filename="学生手册_2018.pdf",
            object_key=canonical_raw_key,
            ingestion_timestamp="2026-03-24T00:00:00+00:00",
            import_source="seed",
        )
        calls: list[dict[str, object]] = []

        with (
            patch("campus_ingestion_core.handbook_source_migration.rebuild_local_data") as rebuild,
            patch(
                "campus_ingestion_core.handbook_source_migration.materialize_handbook_service_navigation_projection_artifact"
            ) as materialize,
        ):
            rebuild.side_effect = lambda **kwargs: (
                calls.append(kwargs)
                or {"status": "rebuilt", "source_pdf": kwargs["env"]["REPLAY_SOURCE_PDF"]}
            )
            materialize.return_value = ProcessedArtifactInput(
                object_key=build_source_projection_artifact_key(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                    projection_name="handbook_navigation_service_catalog",
                    filename="flow-graph.json",
                    year="2018",
                ),
                data=b'{"schema_version":"handbook_service_navigation_projection_v1","projection_name":"handbook_navigation_service_catalog","raw_asset_id":"asset:student-handbook-pdf","raw_version_id":"sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1","source_document_id":"handbook:source-001","source_uri":"x","source_handbook_section":"x","source_page_start":252,"source_page_end":255,"target_document_id":"campus_services:service_catalog:test","target_title":"x","extractor_runtime":{"kind":"prompt_runtime"},"flow_graph":{"document_title":"x","global_manual_review_required":false,"page_findings":[{"source_page":252,"page_heading":"a","flows":[]},{"source_page":253,"page_heading":"b","flows":[{"flow_heading":"f","audience_scope":"","steps":[{"step_id":"s1","step_text":"t","next_step_ids":[]}],"manual_review_notes":[]}]},{"source_page":254,"page_heading":"c","flows":[]},{"source_page":255,"page_heading":"d","flows":[]}]}}',
                content_type="application/json",
            )
            report = migrate_student_handbook_source_faithful(
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                    "OBJECT_STORE_BUCKET_DERIVED": DERIVED_BUCKET,
                },
                request=StudentHandbookSourceAssetRequest(
                    raw_version_id="sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                ),
                object_store=object_store,
                raw_asset_registry=raw_asset_registry,
                document_registry=_FakeDocumentRegistry(),
            )

        self.assertEqual(report.canonical_raw_object_key, canonical_raw_key)
        self.assertEqual(calls[0]["request"].import_mode, "provider_response_replay")
        self.assertEqual(
            calls[0]["request"].raw_version_id,
            "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
        )
        self.assertEqual(
            calls[0]["request"].source_pdf,
            "学生手册_2018.pdf",
        )
        self.assertEqual(
            rebuild.call_args.kwargs["request"].raw_version_id,
            "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
        )
        self.assertEqual(
            rebuild.call_args.kwargs["env"]["REPLAY_SOURCE_PDF"],
            "学生手册_2018.pdf",
        )
        self.assertEqual(
            calls[0]["request"].raw_asset_id,
            "asset:student-handbook-pdf",
        )

    def test_migrate_student_handbook_source_faithful_backfills_projection_artifact_from_legacy_document_artifact(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        raw_asset_registry = _FakeRawAssetRegistry()
        raw_version_id = "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1"
        canonical_raw_key = (
            "official_pdf/student-handbook/2018/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/capture/学生手册_2018.pdf"
        )
        legacy_flow_graph_key = (
            "campus_services/documents/service_catalog/"
            "中央民族大学学生公寓管理工作流程--66f91543/source-faithful/2018/flow-graph.json"
        )
        projection_artifact_key = build_source_projection_artifact_key(
            raw_asset_id="asset:student-handbook-pdf",
            raw_version_id=raw_version_id,
            projection_name="handbook_navigation_service_catalog",
            filename="flow-graph.json",
            year="2018",
        )
        object_store.objects[(DERIVED_BUCKET, legacy_flow_graph_key)] = (
            b'{"document_title":"\xe4\xb8\xad\xe5\xa4\xae\xe6\xb0\x91\xe6\x97\x8f\xe5\xa4\xa7\xe5\xad\xa6\xe5\xad\xa6\xe7\x94\x9f\xe5\x85\xac\xe5\xaf\x93\xe7\xae\xa1\xe7\x90\x86\xe5\xb7\xa5\xe4\xbd\x9c\xe6\xb5\x81\xe7\xa8\x8b","global_manual_review_required":false,"page_findings":[{"source_page":252,"page_heading":"p252","flows":[]},{"source_page":253,"page_heading":"p253","flows":[{"flow_heading":"f","audience_scope":"","steps":[{"step_id":"s1","step_text":"t","next_step_ids":[]}],"manual_review_notes":[]}]},{"source_page":254,"page_heading":"p254","flows":[]},{"source_page":255,"page_heading":"p255","flows":[]}]}'
        )
        raw_asset_registry.upsert(
            RawAssetRecord(
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id=raw_version_id,
                corpus="regulations",
                collection="student_rules",
                raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/学生手册_2018.pdf",
                content_hash="b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                source_filename="学生手册_2018.pdf",
                object_key=canonical_raw_key,
                ingestion_timestamp="2026-03-24T00:00:00+00:00",
                import_source="seed",
            )
        )

        with patch("campus_ingestion_core.handbook_source_migration.rebuild_local_data") as rebuild:
            rebuild.return_value = {"status": "rebuilt"}
            with patch(
                "campus_ingestion_core.handbook_source_migration.materialize_handbook_service_navigation_projection_artifact"
            ) as materialize:
                report = migrate_student_handbook_source_faithful(
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                        "OBJECT_STORE_BUCKET_DERIVED": DERIVED_BUCKET,
                        "REBUILD_CORPUS": "regulations",
                        "REBUILD_COLLECTION": "student_rules",
                        "INGESTION_SPLIT_MANIFEST_PATH": "configs/ingestion/regulations/student_rules/split-manifest.v1.json",
                        "HANDBOOK_SOURCE_PROJECTIONS_PATH": "configs/ingestion/regulations/student_rules/source-projections.v1.json",
                        "RAW_VERSION_ID": raw_version_id,
                    },
                    object_store=object_store,
                    raw_asset_registry=raw_asset_registry,
                    document_registry=_FakeDocumentRegistry(),
                )

        self.assertEqual(report.canonical_raw_object_key, canonical_raw_key)
        self.assertIn((SOURCE_BUCKET, projection_artifact_key), object_store.puts)
        self.assertEqual(
            json.loads(
                object_store.objects[(SOURCE_BUCKET, projection_artifact_key)].decode("utf-8")
            )["schema_version"],
            "handbook_service_navigation_projection_v1",
        )
        materialize.assert_not_called()

    def test_migrate_student_handbook_source_faithful_materializes_projection_artifact_when_legacy_copy_is_missing(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        raw_asset_registry = _FakeRawAssetRegistry()
        raw_version_id = "sha256:b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1"
        canonical_raw_key = (
            "official_pdf/student-handbook/2018/sha256/"
            "b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1/capture/学生手册_2018.pdf"
        )
        projection_artifact_key = build_source_projection_artifact_key(
            raw_asset_id="asset:student-handbook-pdf",
            raw_version_id=raw_version_id,
            projection_name="handbook_navigation_service_catalog",
            filename="flow-graph.json",
            year="2018",
        )
        raw_asset_registry.upsert(
            RawAssetRecord(
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id=raw_version_id,
                corpus="regulations",
                collection="student_rules",
                raw_source_uri="s3://campus-rag-source/official_pdf/student-handbook/学生手册_2018.pdf",
                content_hash="b618dc93bbe22c6c7683a395688b395268d621ce36360ace2f13f77190f544b1",
                source_filename="学生手册_2018.pdf",
                object_key=canonical_raw_key,
                ingestion_timestamp="2026-03-24T00:00:00+00:00",
                import_source="seed",
            )
        )

        with patch("campus_ingestion_core.handbook_source_migration.rebuild_local_data") as rebuild:
            rebuild.return_value = {"status": "rebuilt"}
            with patch(
                "campus_ingestion_core.handbook_source_migration.materialize_handbook_service_navigation_projection_artifact"
            ) as materialize:
                materialize.return_value = ProcessedArtifactInput(
                    object_key=projection_artifact_key,
                    data=(
                        b'{"schema_version":"handbook_service_navigation_projection_v1",'
                        b'"projection_name":"handbook_navigation_service_catalog",'
                        b'"raw_asset_id":"asset:student-handbook-pdf",'
                        b'"raw_version_id":"'
                        + raw_version_id.encode("utf-8")
                        + b'","source_document_id":"handbook:source-001",'
                        b'"source_uri":"campus-agent://regulations/student_rules/docs/handbook:source-001",'
                        b'"source_handbook_section":"\xe4\xb8\xad\xe5\xa4\xae\xe6\xb0\x91\xe6\x97\x8f\xe5\xa4\xa7\xe5\xad\xa6\xe5\x85\xac\xe5\xaf\x93\xe5\x8f\x8a\xe5\x85\xac\xe8\xb4\xb9\xe5\x8c\xbb\xe7\x96\x97\xe7\xae\xa1\xe7\x90\x86\xe8\xa7\x84\xe5\xae\x9a",'
                        b'"source_page_start":252,"source_page_end":255,'
                        b'"target_document_id":"campus_services:service_catalog:66f91543748400ae59b3f9265353a0538088028a",'
                        b'"target_title":"\xe4\xb8\xad\xe5\xa4\xae\xe6\xb0\x91\xe6\x97\x8f\xe5\xa4\xa7\xe5\xad\xa6\xe5\xad\xa6\xe7\x94\x9f\xe5\x85\xac\xe5\xaf\x93\xe7\xae\xa1\xe7\x90\x86\xe5\xb7\xa5\xe4\xbd\x9c\xe6\xb5\x81\xe7\xa8\x8b",'
                        b'"extractor_runtime":{"kind":"prompt_runtime","mode":"captured"},'
                        b'"flow_graph":{"document_title":"\xe4\xb8\xad\xe5\xa4\xae\xe6\xb0\x91\xe6\x97\x8f\xe5\xa4\xa7\xe5\xad\xa6\xe5\xad\xa6\xe7\x94\x9f\xe5\x85\xac\xe5\xaf\x93\xe7\xae\xa1\xe7\x90\x86\xe5\xb7\xa5\xe4\xbd\x9c\xe6\xb5\x81\xe7\xa8\x8b","global_manual_review_required":false,"page_findings":[{"source_page":252,"page_heading":"p252","flows":[]},{"source_page":253,"page_heading":"p253","flows":[{"flow_heading":"f","audience_scope":"","steps":[{"step_id":"s1","step_text":"t","next_step_ids":[]}],"manual_review_notes":[]}]},{"source_page":254,"page_heading":"p254","flows":[]},{"source_page":255,"page_heading":"p255","flows":[]}]}}'
                    ),
                    content_type="application/json",
                )
                report = migrate_student_handbook_source_faithful(
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                        "OBJECT_STORE_BUCKET_DERIVED": DERIVED_BUCKET,
                        "REBUILD_CORPUS": "regulations",
                        "REBUILD_COLLECTION": "student_rules",
                        "INGESTION_SPLIT_MANIFEST_PATH": "configs/ingestion/regulations/student_rules/split-manifest.v1.json",
                        "HANDBOOK_SOURCE_PROJECTIONS_PATH": "configs/ingestion/regulations/student_rules/source-projections.v1.json",
                        "RAW_VERSION_ID": raw_version_id,
                    },
                    object_store=object_store,
                    raw_asset_registry=raw_asset_registry,
                    document_registry=_FakeDocumentRegistry(),
                )

        self.assertEqual(report.canonical_raw_object_key, canonical_raw_key)
        self.assertIn((SOURCE_BUCKET, projection_artifact_key), object_store.puts)
        materialize.assert_called_once()

    def test_migrate_student_handbook_source_faithful_uses_runtime_manifest_override_when_building_request_from_env(
        self,
    ) -> None:
        object_store = _FakeObjectStoreAdmin()
        raw_asset_registry = _FakeRawAssetRegistry()
        override_raw_asset_id = "asset:override-handbook-pdf"
        raw_version_id = "sha256:overridehash001"
        canonical_raw_key = (
            "official_pdf/override-handbook/2020/sha256/overridehash001/capture/学生手册_2020.pdf"
        )
        raw_asset_registry.records[(override_raw_asset_id, raw_version_id)] = SimpleNamespace(
            raw_asset_id=override_raw_asset_id,
            raw_version_id=raw_version_id,
            corpus="regulations",
            collection="student_rules",
            raw_source_uri="s3://campus-rag-source/official_pdf/override-handbook/学生手册_2020.pdf",
            content_hash="overridehash001",
            source_filename="学生手册_2020.pdf",
            object_key=canonical_raw_key,
            ingestion_timestamp="2026-03-24T00:00:00+00:00",
            import_source="seed",
        )
        calls: list[dict[str, object]] = []

        with TemporaryDirectory() as temp_dir:
            split_manifest_path = Path(temp_dir) / "split-manifest.v1.json"
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_rules_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "raw_asset_id": override_raw_asset_id,
                        "documents": [
                            {
                                "document_id": "handbook:test-override",
                                "title": "测试文档",
                                "handbook_section": "测试分组",
                                "page_start": 1,
                                "page_end": 1,
                                "source_uri": "campus-agent://regulations/student_rules/docs/handbook:test-override",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            with (
                patch(
                    "campus_ingestion_core.handbook_source_migration.rebuild_local_data"
                ) as rebuild,
                patch(
                    "campus_ingestion_core.handbook_source_migration.materialize_handbook_service_navigation_projection_artifact"
                ) as materialize,
            ):
                rebuild.side_effect = lambda **kwargs: (
                    calls.append(kwargs)
                    or {"status": "rebuilt", "source_pdf": kwargs["env"]["REPLAY_SOURCE_PDF"]}
                )
                materialize.return_value = ProcessedArtifactInput(
                    object_key=build_source_projection_artifact_key(
                        raw_asset_id=override_raw_asset_id,
                        raw_version_id=raw_version_id,
                        projection_name="handbook_navigation_service_catalog",
                        filename="flow-graph.json",
                        year="2020",
                    ),
                    data=b'{"schema_version":"handbook_service_navigation_projection_v1","projection_name":"handbook_navigation_service_catalog","raw_asset_id":"asset:override-handbook-pdf","raw_version_id":"sha256:overridehash001","source_document_id":"handbook:test-override","source_uri":"x","source_handbook_section":"x","source_page_start":1,"source_page_end":1,"target_document_id":"campus_services:service_catalog:test","target_title":"x","extractor_runtime":{"kind":"prompt_runtime"},"flow_graph":{"document_title":"x","global_manual_review_required":false,"page_findings":[{"source_page":1,"page_heading":"a","flows":[{"flow_heading":"f","audience_scope":"","steps":[{"step_id":"s1","step_text":"t","next_step_ids":[]}],"manual_review_notes":[]}]}]}}',
                    content_type="application/json",
                )
                report = migrate_student_handbook_source_faithful(
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET,
                        "OBJECT_STORE_BUCKET_DERIVED": DERIVED_BUCKET,
                        "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                        "RAW_VERSION_ID": raw_version_id,
                        "HANDBOOK_CANONICAL_RAW_FILENAME": "学生手册_2020.pdf",
                    },
                    object_store=object_store,
                    raw_asset_registry=raw_asset_registry,
                    document_registry=_FakeDocumentRegistry(),
                )

        self.assertEqual(report.canonical_raw_object_key, canonical_raw_key)
        self.assertEqual(calls[0]["request"].raw_asset_id, override_raw_asset_id)
        self.assertEqual(calls[0]["request"].raw_version_id, raw_version_id)
        self.assertEqual(calls[0]["env"]["REPLAY_SOURCE_PDF"], "学生手册_2020.pdf")
