from __future__ import annotations

import unittest

from .provider_result_replay_rebuild_test_support import *  # noqa: F401,F403


class ProviderResultReplayBuildTest(unittest.TestCase):
    def test_build_replay_documents_uses_projection_artifact_for_service_navigation_hybrid_lane(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_config_path = root / "source-projections.v1.json"
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
                            },
                            {
                                "projection_name": "handbook_navigation_service_catalog",
                                "target_corpus": "campus_services",
                                "target_collection": "service_catalog",
                                "projection_family": "derived_documents",
                                "replay_from_source_truth": True,
                                "derived_from": "source_truth",
                                "source_title": "中央民族大学公寓及公费医疗管理规定",
                                "source_handbook_section": "中央民族大学公寓及公费医疗管理规定",
                                "source_page_start": 252,
                                "source_page_end": 255,
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
            collection_config = CollectionTruthConfig(
                corpus="regulations",
                collection="student_rules",
                config_root=root,
                runtime_profile_path=root / "runtime-profile.json",
                split_manifest_path=root / "split-manifest.v1.json",
                canonical_profile_path=root / "canonical-profile.json",
                chunk_profile_path=root / "chunk-profile.json",
                source_projections_path=projection_config_path,
            )
            split_manifest = SplitManifest(
                manifest_version="student_rules_split_manifest_v1",
                corpus="regulations",
                collection="student_rules",
                raw_asset_id="asset:student-handbook-pdf",
                documents=(
                    SplitManifestDocument(
                        document_id="handbook:source-001",
                        title="中央民族大学公寓及公费医疗管理规定",
                        handbook_section="中央民族大学公寓及公费医疗管理规定",
                        page_start=252,
                        page_end=255,
                        source_uri="campus-agent://regulations/student_rules/docs/handbook:source-001",
                    ),
                ),
            )
            raw_asset_record = RawAssetRecord(
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:test-raw-version",
                corpus="regulations",
                collection="student_rules",
                raw_source_uri="s3://source/student-handbook.pdf",
                content_hash="test-raw-version",
                source_filename="学生手册_2018.pdf",
                object_key="official_pdf/student-handbook/2018/sha256/test-raw-version/capture/student-handbook.pdf",
                ingestion_timestamp="2026-04-20T00:00:00+00:00",
                import_source="raw_online_ocr",
            )
            structured_rows = [
                {
                    "row_id": "page-0252-title",
                    "page_start": 252,
                    "page_end": 252,
                    "row_type": "heading",
                    "block_role": "title",
                    "text_normalized": "中央民族大学公寓及公费医疗管理规定",
                    "text_raw": "中央民族大学公寓及公费医疗管理规定",
                }
            ]
            projection_artifact_key = build_source_projection_artifact_key(
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:test-raw-version",
                projection_name="handbook_navigation_service_catalog",
                filename="flow-graph.json",
                year="2018",
            )

            with (
                patch(
                    "campus_ingestion_core.local_rebuild_documents._build_handbook_replay_document_input"
                ) as build_primary_document,
                patch(
                    "campus_ingestion_core.handbook_source_projections.build_handbook_service_navigation_hybrid_document_from_projection_artifact"
                ) as build_hybrid,
            ):
                build_primary_document.return_value = DocumentImportInput(
                    source_label="primary-doc",
                    document_units_bytes=b'{"doc_id":"handbook:source-001","version_id":"primary:test"}\n',
                    provider_response_bytes=None,
                    canonical_markdown_bytes=b"# \xe4\xb8\xad\xe5\xa4\xae\xe6\xb0\x91\xe6\x97\x8f\xe5\xa4\xa7\xe5\xad\xa6\xe5\x85\xac\xe5\xaf\x93\xe5\x8f\x8a\xe5\x85\xac\xe8\xb4\xb9\xe5\x8c\xbb\xe7\x96\x97\xe7\xae\xa1\xe7\x90\x86\xe8\xa7\x84\xe5\xae\x9a\n",
                    metadata={"document_id": "handbook:source-001", "version_id": "primary:test"},
                    import_source="provider_response_replay",
                    corpus="regulations",
                    collection="student_rules",
                )
                build_hybrid.return_value = DocumentImportInput(
                    source_label="hybrid-doc",
                    document_units_bytes=(
                        '{"doc_id":"campus_services:service_catalog:test-001","version_id":"flow-graph:test",'
                        '"chunk_id":"flow-001","root_unit_id":"flow-001","unit_type":"section_text",'
                        '"clean_text":"学生到学院完成报到登记","source_pdf":"学生手册_2018.pdf",'
                        '"source_url":"campus-agent://regulations/student_rules/docs/handbook:source-001",'
                        '"source":{"id":"campus-agent://regulations/student_rules/docs/handbook:source-001"},'
                        '"page_start":253,"page_end":253,"anchor":{"page_start":253,"page_end":253},'
                        '"metadata":{"title":"中央民族大学学生公寓管理工作流程"},'
                        '"entitlement_groups":[],"visibility_scope":null,"visibility_level":"public",'
                        '"policy_projection_version":"phase1-authorization-projection-v1"}\n'
                    ).encode("utf-8"),
                    provider_response_bytes=None,
                    canonical_markdown_bytes=b"# \xe4\xb8\xad\xe5\xa4\xae\xe6\xb0\x91\xe6\x97\x8f\xe5\xa4\xa7\xe5\xad\xa6\xe5\xad\xa6\xe7\x94\x9f\xe5\x85\xac\xe5\xaf\x93\xe7\xae\xa1\xe7\x90\x86\xe5\xb7\xa5\xe4\xbd\x9c\xe6\xb5\x81\xe7\xa8\x8b\n",
                    metadata={
                        "document_id": "campus_services:service_catalog:test-001",
                        "version_id": "flow-graph:test",
                        "title": "中央民族大学学生公寓管理工作流程",
                    },
                    import_source="provider_response_replay",
                    corpus="campus_services",
                    collection="service_catalog",
                    raw_source_uri=raw_asset_record.raw_source_uri,
                    raw_asset_id=raw_asset_record.raw_asset_id,
                    raw_version_id=raw_asset_record.raw_version_id,
                    provider_response_object_key="provider-response-key",
                )
                reader = _FakeObjectStore(provider_result_bytes=b"")
                reader.objects[(SOURCE_BUCKET, projection_artifact_key)] = (
                    b'{"schema_version":"handbook_service_navigation_projection_v1",'
                    b'"projection_name":"handbook_navigation_service_catalog",'
                    b'"raw_asset_id":"asset:student-handbook-pdf",'
                    b'"raw_version_id":"sha256:test-raw-version",'
                    b'"source_document_id":"handbook:source-001",'
                    b'"source_uri":"campus-agent://regulations/student_rules/docs/handbook:source-001",'
                    b'"source_handbook_section":"\xe4\xb8\xad\xe5\xa4\xae\xe6\xb0\x91\xe6\x97\x8f\xe5\xa4\xa7\xe5\xad\xa6\xe5\x85\xac\xe5\xaf\x93\xe5\x8f\x8a\xe5\x85\xac\xe8\xb4\xb9\xe5\x8c\xbb\xe7\x96\x97\xe7\xae\xa1\xe7\x90\x86\xe8\xa7\x84\xe5\xae\x9a",'
                    b'"source_page_start":252,"source_page_end":255,'
                    b'"target_document_id":"campus_services:service_catalog:test-001",'
                    b'"target_title":"\xe4\xb8\xad\xe5\xa4\xae\xe6\xb0\x91\xe6\x97\x8f\xe5\xa4\xa7\xe5\xad\xa6\xe5\xad\xa6\xe7\x94\x9f\xe5\x85\xac\xe5\xaf\x93\xe7\xae\xa1\xe7\x90\x86\xe5\xb7\xa5\xe4\xbd\x9c\xe6\xb5\x81\xe7\xa8\x8b",'
                    b'"extractor_runtime":{"kind":"prompt_runtime","mode":"captured"},'
                    b'"flow_graph":{"document_title":"\xe4\xb8\xad\xe5\xa4\xae\xe6\xb0\x91\xe6\x97\x8f\xe5\xa4\xa7\xe5\xad\xa6\xe5\xad\xa6\xe7\x94\x9f\xe5\x85\xac\xe5\xaf\x93\xe7\xae\xa1\xe7\x90\x86\xe5\xb7\xa5\xe4\xbd\x9c\xe6\xb5\x81\xe7\xa8\x8b","global_manual_review_required":false,"page_findings":[{"source_page":252,"page_heading":"p252","flows":[]},{"source_page":253,"page_heading":"p253","flows":[{"flow_heading":"f","audience_scope":"","steps":[{"step_id":"s1","step_text":"t","next_step_ids":[]}],"manual_review_notes":[]}]},{"source_page":254,"page_heading":"p254","flows":[]},{"source_page":255,"page_heading":"p255","flows":[]}]}}'
                )

                _build_replay_documents(
                    source={"OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET},
                    collection_config=collection_config,
                    split_manifest=split_manifest,
                    corpus="regulations",
                    collection="student_rules",
                    source_pdf="学生手册_2018.pdf",
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id="sha256:test-raw-version",
                    provider_response_key="provider-response-key",
                    layout_elements_key="layout-elements-key",
                    structured_rows=structured_rows,
                    reader=reader,
                    source_bucket=SOURCE_BUCKET,
                    replay_raw_asset_record=raw_asset_record,
                )

        self.assertEqual(build_hybrid.call_count, 1)
        self.assertEqual(
            build_hybrid.call_args.kwargs["raw_asset_record"].object_key,
            raw_asset_record.object_key,
        )
        self.assertEqual(
            build_hybrid.call_args.kwargs["projection_artifact_key"], projection_artifact_key
        )

    def test_build_replay_documents_fails_closed_when_service_navigation_hybrid_lane_has_no_raw_asset_record(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_config_path = root / "source-projections.v1.json"
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
                            },
                            {
                                "projection_name": "handbook_navigation_service_catalog",
                                "target_corpus": "campus_services",
                                "target_collection": "service_catalog",
                                "projection_family": "derived_documents",
                                "replay_from_source_truth": True,
                                "derived_from": "source_truth",
                                "source_title": "中央民族大学公寓及公费医疗管理规定",
                                "source_handbook_section": "中央民族大学公寓及公费医疗管理规定",
                                "source_page_start": 252,
                                "source_page_end": 255,
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
            collection_config = CollectionTruthConfig(
                corpus="regulations",
                collection="student_rules",
                config_root=root,
                runtime_profile_path=root / "runtime-profile.json",
                split_manifest_path=root / "split-manifest.v1.json",
                canonical_profile_path=root / "canonical-profile.json",
                chunk_profile_path=root / "chunk-profile.json",
                source_projections_path=projection_config_path,
            )
            split_manifest = SplitManifest(
                manifest_version="student_rules_split_manifest_v1",
                corpus="regulations",
                collection="student_rules",
                raw_asset_id="asset:student-handbook-pdf",
                documents=(
                    SplitManifestDocument(
                        document_id="handbook:source-001",
                        title="中央民族大学公寓及公费医疗管理规定",
                        handbook_section="中央民族大学公寓及公费医疗管理规定",
                        page_start=252,
                        page_end=255,
                        source_uri="campus-agent://regulations/student_rules/docs/handbook:source-001",
                    ),
                ),
            )
            structured_rows = [
                {
                    "row_id": "page-0252-title",
                    "page_start": 252,
                    "page_end": 252,
                    "row_type": "heading",
                    "block_role": "title",
                    "text_normalized": "中央民族大学公寓及公费医疗管理规定",
                    "text_raw": "中央民族大学公寓及公费医疗管理规定",
                }
            ]

            with patch(
                "campus_ingestion_core.local_rebuild_documents._build_handbook_replay_document_input"
            ) as build_primary_document:
                build_primary_document.return_value = DocumentImportInput(
                    source_label="primary-doc",
                    document_units_bytes=b'{"doc_id":"handbook:source-001","version_id":"primary:test"}\n',
                    provider_response_bytes=None,
                    canonical_markdown_bytes=b"# \xe4\xb8\xad\xe5\xa4\xae\xe6\xb0\x91\xe6\x97\x8f\xe5\xa4\xa7\xe5\xad\xa6\xe5\x85\xac\xe5\xaf\x93\xe5\x8f\x8a\xe5\x85\xac\xe8\xb4\xb9\xe5\x8c\xbb\xe7\x96\x97\xe7\xae\xa1\xe7\x90\x86\xe8\xa7\x84\xe5\xae\x9a\n",
                    metadata={"document_id": "handbook:source-001", "version_id": "primary:test"},
                    import_source="provider_response_replay",
                    corpus="regulations",
                    collection="student_rules",
                )
                with self.assertRaisesRegex(ValueError, "raw asset record is required"):
                    _build_replay_documents(
                        source={"OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET},
                        collection_config=collection_config,
                        split_manifest=split_manifest,
                        corpus="regulations",
                        collection="student_rules",
                        source_pdf="学生手册_2018.pdf",
                        raw_asset_id="asset:student-handbook-pdf",
                        raw_version_id="sha256:test-raw-version",
                        provider_response_key="provider-response-key",
                        layout_elements_key="layout-elements-key",
                        structured_rows=structured_rows,
                        reader=_FakeObjectStore(provider_result_bytes=b""),
                        source_bucket=SOURCE_BUCKET,
                        replay_raw_asset_record=None,
                    )

    def test_build_replay_documents_fails_closed_when_service_navigation_projection_artifact_is_missing(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_config_path = root / "source-projections.v1.json"
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
                            },
                            {
                                "projection_name": "handbook_navigation_service_catalog",
                                "target_corpus": "campus_services",
                                "target_collection": "service_catalog",
                                "projection_family": "derived_documents",
                                "replay_from_source_truth": True,
                                "derived_from": "source_truth",
                                "source_title": "中央民族大学公寓及公费医疗管理规定",
                                "source_handbook_section": "中央民族大学公寓及公费医疗管理规定",
                                "source_page_start": 252,
                                "source_page_end": 255,
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
            collection_config = CollectionTruthConfig(
                corpus="regulations",
                collection="student_rules",
                config_root=root,
                runtime_profile_path=root / "runtime-profile.json",
                split_manifest_path=root / "split-manifest.v1.json",
                canonical_profile_path=root / "canonical-profile.json",
                chunk_profile_path=root / "chunk-profile.json",
                source_projections_path=projection_config_path,
            )
            split_manifest = SplitManifest(
                manifest_version="student_rules_split_manifest_v1",
                corpus="regulations",
                collection="student_rules",
                raw_asset_id="asset:student-handbook-pdf",
                documents=(
                    SplitManifestDocument(
                        document_id="handbook:source-001",
                        title="中央民族大学公寓及公费医疗管理规定",
                        handbook_section="中央民族大学公寓及公费医疗管理规定",
                        page_start=252,
                        page_end=255,
                        source_uri="campus-agent://regulations/student_rules/docs/handbook:source-001",
                    ),
                ),
            )
            raw_asset_record = RawAssetRecord(
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id="sha256:test-raw-version",
                corpus="regulations",
                collection="student_rules",
                raw_source_uri="s3://source/student-handbook.pdf",
                content_hash="test-raw-version",
                source_filename="学生手册_2018.pdf",
                object_key="official_pdf/student-handbook/2018/sha256/test-raw-version/capture/student-handbook.pdf",
                ingestion_timestamp="2026-04-20T00:00:00+00:00",
                import_source="raw_online_ocr",
            )
            structured_rows = [
                {
                    "row_id": "page-0252-title",
                    "page_start": 252,
                    "page_end": 252,
                    "row_type": "heading",
                    "block_role": "title",
                    "text_normalized": "中央民族大学公寓及公费医疗管理规定",
                    "text_raw": "中央民族大学公寓及公费医疗管理规定",
                }
            ]

            with patch(
                "campus_ingestion_core.local_rebuild_documents._build_handbook_replay_document_input"
            ) as build_primary_document:
                build_primary_document.return_value = DocumentImportInput(
                    source_label="primary-doc",
                    document_units_bytes=b'{"doc_id":"handbook:source-001","version_id":"primary:test"}\n',
                    provider_response_bytes=None,
                    canonical_markdown_bytes=b"# test\n",
                    metadata={"document_id": "handbook:source-001", "version_id": "primary:test"},
                    import_source="provider_response_replay",
                    corpus="regulations",
                    collection="student_rules",
                )
                with self.assertRaisesRegex(
                    ValueError,
                    "missing handbook service navigation projection artifact",
                ):
                    _build_replay_documents(
                        source={"OBJECT_STORE_BUCKET_SOURCE": SOURCE_BUCKET},
                        collection_config=collection_config,
                        split_manifest=split_manifest,
                        corpus="regulations",
                        collection="student_rules",
                        source_pdf="学生手册_2018.pdf",
                        raw_asset_id="asset:student-handbook-pdf",
                        raw_version_id="sha256:test-raw-version",
                        provider_response_key="provider-response-key",
                        layout_elements_key="layout-elements-key",
                        structured_rows=structured_rows,
                        reader=_FakeObjectStore(provider_result_bytes=b""),
                        source_bucket=SOURCE_BUCKET,
                        replay_raw_asset_record=raw_asset_record,
                    )
