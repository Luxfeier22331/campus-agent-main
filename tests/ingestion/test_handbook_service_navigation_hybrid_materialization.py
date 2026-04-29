from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.campusrag_ingestion_artifacts import ProcessedArtifactInput
from campus_ingestion_core.handbook_service_navigation_hybrid_materialization import (
    ServiceNavigationFlow,
    ServiceNavigationFlowGraph,
    ServiceNavigationPageFinding,
    ServiceNavigationStep,
    build_handbook_service_navigation_hybrid_document,
    build_handbook_service_navigation_hybrid_document_from_projection_artifact,
    is_handbook_service_navigation_projection,
)
from campus_ingestion_core.models import RawAssetRecord


class _FakeReader:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload
        self.reads: list[tuple[str, str]] = []

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        self.reads.append((bucket, key))
        return self.payload


class HandbookServiceNavigationHybridMaterializationTest(unittest.TestCase):
    def test_projection_selector_matches_only_exact_bounded_service_navigation_slice(self) -> None:
        self.assertTrue(
            is_handbook_service_navigation_projection(
                projection_name="handbook_navigation_service_catalog",
                target_collection="service_catalog",
                attachment_role="service_navigation_document",
                source_page_start=252,
                source_page_end=255,
            )
        )
        self.assertFalse(
            is_handbook_service_navigation_projection(
                projection_name="handbook_phone_directory",
                target_collection="service_catalog",
                attachment_role="service_navigation_document",
                source_page_start=252,
                source_page_end=255,
            )
        )
        self.assertFalse(
            is_handbook_service_navigation_projection(
                projection_name="handbook_navigation_service_catalog",
                target_collection="contact_directory",
                attachment_role="service_navigation_document",
                source_page_start=252,
                source_page_end=255,
            )
        )
        self.assertFalse(
            is_handbook_service_navigation_projection(
                projection_name="handbook_navigation_service_catalog",
                target_collection="service_catalog",
                attachment_role="service_navigation_leaf",
                source_page_start=252,
                source_page_end=255,
            )
        )
        self.assertFalse(
            is_handbook_service_navigation_projection(
                projection_name="handbook_navigation_service_catalog",
                target_collection="service_catalog",
                attachment_role="service_navigation_document",
                source_page_start=252,
                source_page_end=254,
            )
        )

    def test_build_hybrid_document_materializes_flow_graph_and_lineage_artifacts(self) -> None:
        reader = _FakeReader(b"%PDF-fake%")
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
        flow_graph = ServiceNavigationFlowGraph(
            document_title="中央民族大学学生公寓管理工作流程",
            page_findings=(
                ServiceNavigationPageFinding(
                    source_page=252,
                    page_heading="学生公寓办理总览",
                    flows=(),
                ),
                ServiceNavigationPageFinding(
                    source_page=253,
                    page_heading="学生公寓入住流程",
                    flows=(
                        ServiceNavigationFlow(
                            flow_heading="新生入住办理流程",
                            audience_scope="本科生新生",
                            steps=(
                                ServiceNavigationStep(
                                    step_id="step-1",
                                    step_text="学生到学院完成报到登记",
                                    next_step_ids=("step-2",),
                                ),
                                ServiceNavigationStep(
                                    step_id="step-2",
                                    step_text="持报到材料前往公寓办理入住",
                                    next_step_ids=(),
                                ),
                            ),
                            manual_review_notes=(),
                        ),
                    ),
                ),
                ServiceNavigationPageFinding(
                    source_page=254,
                    page_heading="学生公寓退宿流程",
                    flows=(),
                ),
                ServiceNavigationPageFinding(
                    source_page=255,
                    page_heading="学生公寓调整流程",
                    flows=(),
                ),
            ),
            global_manual_review_required=False,
        )

        with (
            patch(
                "campus_ingestion_core.handbook_service_navigation_hybrid_materialization._render_declared_pdf_pages_to_pngs",
                return_value=(
                    (252, b"page-252"),
                    (253, b"page-253"),
                    (254, b"page-254"),
                    (255, b"page-255"),
                ),
            ),
            patch(
                "campus_ingestion_core.handbook_service_navigation_hybrid_materialization._extract_service_navigation_flow_graph",
                return_value=flow_graph,
            ),
        ):
            document = build_handbook_service_navigation_hybrid_document(
                source={},
                reader=reader,
                source_bucket="campus-rag-source",
                raw_asset_record=raw_asset_record,
                source_document_id="handbook:source-001",
                source_uri="campus-agent://regulations/student_rules/docs/handbook:source-001",
                source_handbook_section="中央民族大学公寓及公费医疗管理规定",
                target_document_id="campus_services:service_catalog:test-001",
                target_title="中央民族大学学生公寓管理工作流程",
                projection_name="handbook_navigation_service_catalog",
                derived_from="source_truth",
                parent_document_id="handbook:source-001",
                attachment_kind="navigation_like",
                attachment_role="service_navigation_document",
                provider_response_key=(
                    "official_pdf/student-handbook/2018/sha256/test-raw-version/"
                    "provider/paddleocr-vl-1-5/provider-response.jsonl"
                ),
                layout_elements_key=(
                    "official_pdf/student-handbook/2018/sha256/test-raw-version/"
                    "source-truth/layout-elements.jsonl"
                ),
                source_page_start=252,
                source_page_end=255,
                entitlement_groups=("students",),
                visibility_scope="main",
                visibility_level="restricted",
                import_source="raw_online_ocr",
            )

        self.assertEqual(
            reader.reads,
            [("campus-rag-source", raw_asset_record.object_key)],
        )
        self.assertEqual(document.title, "中央民族大学学生公寓管理工作流程")
        self.assertIn(
            "official_pdf/student-handbook/2018/sha256/test-raw-version/source-truth/layout-elements.jsonl",
            document.additional_processed_object_keys,
        )
        flow_graph_artifact = next(
            artifact
            for artifact in document.additional_processed_artifacts
            if artifact.object_key.endswith("/flow-graph.json")
        )
        self.assertIsInstance(flow_graph_artifact, ProcessedArtifactInput)
        parsed_flow_graph = json.loads(flow_graph_artifact.data.decode("utf-8"))
        self.assertEqual(
            parsed_flow_graph["schema_version"], "handbook_service_navigation_projection_v1"
        )
        self.assertEqual(
            parsed_flow_graph["projection_name"], "handbook_navigation_service_catalog"
        )
        self.assertEqual(
            parsed_flow_graph["target_document_id"], "campus_services:service_catalog:test-001"
        )
        self.assertEqual(
            parsed_flow_graph["flow_graph"]["document_title"], "中央民族大学学生公寓管理工作流程"
        )
        self.assertEqual(
            [page["source_page"] for page in parsed_flow_graph["flow_graph"]["page_findings"]],
            [252, 253, 254, 255],
        )
        self.assertIn("新生入住办理流程", document.canonical_markdown_bytes.decode("utf-8"))
        self.assertIn("学生到学院完成报到登记", document.canonical_markdown_bytes.decode("utf-8"))
        rows = [
            json.loads(line)
            for line in document.document_units_bytes.decode("utf-8").splitlines()
            if line.strip()
        ]
        self.assertEqual(rows[0]["doc_id"], "campus_services:service_catalog:test-001")
        self.assertEqual(
            rows[0]["metadata"]["projection_name"], "handbook_navigation_service_catalog"
        )
        self.assertEqual(rows[0]["metadata"]["derived_from_document_id"], "handbook:source-001")
        self.assertEqual(
            rows[0]["metadata"]["derived_from_raw_asset_id"], "asset:student-handbook-pdf"
        )
        self.assertEqual(rows[0]["metadata"]["attachment_role"], "service_navigation_document")
        self.assertEqual(rows[0]["entitlement_groups"], ["students"])
        self.assertEqual(rows[0]["visibility_scope"], "main")
        self.assertEqual(rows[0]["visibility_level"], "restricted")

    def test_build_hybrid_document_from_projection_artifact_reuses_source_side_artifact(
        self,
    ) -> None:
        reader = _FakeReader(
            (
                json.dumps(
                    {
                        "schema_version": "handbook_service_navigation_projection_v1",
                        "projection_name": "handbook_navigation_service_catalog",
                        "raw_asset_id": "asset:student-handbook-pdf",
                        "raw_version_id": "sha256:test-raw-version",
                        "source_document_id": "handbook:source-001",
                        "source_uri": "campus-agent://regulations/student_rules/docs/handbook:source-001",
                        "source_handbook_section": "中央民族大学公寓及公费医疗管理规定",
                        "source_page_start": 252,
                        "source_page_end": 255,
                        "target_document_id": "campus_services:service_catalog:test-001",
                        "target_title": "中央民族大学学生公寓管理工作流程",
                        "extractor_runtime": {"kind": "prompt_runtime", "mode": "captured"},
                        "flow_graph": {
                            "document_title": "中央民族大学学生公寓管理工作流程",
                            "global_manual_review_required": False,
                            "page_findings": [
                                {
                                    "source_page": 252,
                                    "page_heading": "学生公寓办理总览",
                                    "flows": [],
                                },
                                {
                                    "source_page": 253,
                                    "page_heading": "学生公寓入住流程",
                                    "flows": [
                                        {
                                            "flow_heading": "新生入住办理流程",
                                            "audience_scope": "本科生新生",
                                            "steps": [
                                                {
                                                    "step_id": "step-1",
                                                    "step_text": "学生到学院完成报到登记",
                                                    "next_step_ids": ["step-2"],
                                                },
                                                {
                                                    "step_id": "step-2",
                                                    "step_text": "持报到材料前往公寓办理入住",
                                                    "next_step_ids": [],
                                                },
                                            ],
                                            "manual_review_notes": [],
                                        }
                                    ],
                                },
                                {
                                    "source_page": 254,
                                    "page_heading": "学生公寓退宿流程",
                                    "flows": [],
                                },
                                {
                                    "source_page": 255,
                                    "page_heading": "学生公寓调整流程",
                                    "flows": [],
                                },
                            ],
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n"
            ).encode("utf-8")
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
            import_source="provider_response_replay",
        )

        document = build_handbook_service_navigation_hybrid_document_from_projection_artifact(
            reader=reader,
            source_bucket="campus-rag-source",
            projection_artifact_key=(
                "official_pdf/student-handbook/2018/sha256/test-raw-version/"
                "projection/handbook_navigation_service_catalog/flow-graph.json"
            ),
            raw_asset_record=raw_asset_record,
            source_document_id="handbook:source-001",
            source_uri="campus-agent://regulations/student_rules/docs/handbook:source-001",
            source_handbook_section="中央民族大学公寓及公费医疗管理规定",
            target_document_id="campus_services:service_catalog:test-001",
            target_title="中央民族大学学生公寓管理工作流程",
            projection_name="handbook_navigation_service_catalog",
            derived_from="source_truth",
            parent_document_id="handbook:source-001",
            attachment_kind="navigation_like",
            attachment_role="service_navigation_document",
            provider_response_key=(
                "official_pdf/student-handbook/2018/sha256/test-raw-version/"
                "provider/paddleocr-vl-1-5/provider-response.jsonl"
            ),
            layout_elements_key=(
                "official_pdf/student-handbook/2018/sha256/test-raw-version/"
                "source-truth/layout-elements.jsonl"
            ),
            source_page_start=252,
            source_page_end=255,
            entitlement_groups=("students",),
            visibility_scope="main",
            visibility_level="restricted",
            import_source="provider_response_replay",
        )

        self.assertEqual(
            reader.reads,
            [
                (
                    "campus-rag-source",
                    "official_pdf/student-handbook/2018/sha256/test-raw-version/"
                    "projection/handbook_navigation_service_catalog/flow-graph.json",
                )
            ],
        )
        self.assertEqual(document.additional_processed_artifacts, ())
        self.assertIn(
            "official_pdf/student-handbook/2018/sha256/test-raw-version/"
            "projection/handbook_navigation_service_catalog/flow-graph.json",
            document.additional_processed_object_keys,
        )

    def test_build_hybrid_document_fails_closed_when_graph_has_no_body_bearing_steps(self) -> None:
        reader = _FakeReader(b"%PDF-fake%")
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
        flow_graph = ServiceNavigationFlowGraph(
            document_title="中央民族大学学生公寓管理工作流程",
            page_findings=(
                ServiceNavigationPageFinding(
                    source_page=252,
                    page_heading="学生公寓办理总览",
                    flows=(),
                ),
                ServiceNavigationPageFinding(
                    source_page=253,
                    page_heading="学生公寓入住流程",
                    flows=(),
                ),
                ServiceNavigationPageFinding(
                    source_page=254,
                    page_heading="学生公寓退宿流程",
                    flows=(),
                ),
                ServiceNavigationPageFinding(
                    source_page=255,
                    page_heading="学生公寓调整流程",
                    flows=(),
                ),
            ),
            global_manual_review_required=True,
        )

        with (
            patch(
                "campus_ingestion_core.handbook_service_navigation_hybrid_materialization._render_declared_pdf_pages_to_pngs",
                return_value=(
                    (252, b"page-252"),
                    (253, b"page-253"),
                    (254, b"page-254"),
                    (255, b"page-255"),
                ),
            ),
            patch(
                "campus_ingestion_core.handbook_service_navigation_hybrid_materialization._extract_service_navigation_flow_graph",
                return_value=flow_graph,
            ),
            self.assertRaisesRegex(ValueError, "body-bearing steps"),
        ):
            build_handbook_service_navigation_hybrid_document(
                source={},
                reader=reader,
                source_bucket="campus-rag-source",
                raw_asset_record=raw_asset_record,
                source_document_id="handbook:source-001",
                source_uri="campus-agent://regulations/student_rules/docs/handbook:source-001",
                source_handbook_section="中央民族大学公寓及公费医疗管理规定",
                target_document_id="campus_services:service_catalog:test-001",
                target_title="中央民族大学学生公寓管理工作流程",
                projection_name="handbook_navigation_service_catalog",
                derived_from="source_truth",
                parent_document_id="handbook:source-001",
                attachment_kind="navigation_like",
                attachment_role="service_navigation_document",
                provider_response_key="provider-response-key",
                layout_elements_key="layout-elements-key",
                source_page_start=252,
                source_page_end=255,
                entitlement_groups=(),
                visibility_scope=None,
                visibility_level="public",
                import_source="raw_online_ocr",
            )

    def test_build_hybrid_document_fails_closed_when_graph_page_mapping_drifts_from_declared_selector(
        self,
    ) -> None:
        reader = _FakeReader(b"%PDF-fake%")
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
        flow_graph = ServiceNavigationFlowGraph(
            document_title="中央民族大学学生公寓管理工作流程",
            page_findings=(
                ServiceNavigationPageFinding(
                    source_page=253,
                    page_heading="学生公寓入住流程",
                    flows=(
                        ServiceNavigationFlow(
                            flow_heading="新生入住办理流程",
                            audience_scope="本科生新生",
                            steps=(
                                ServiceNavigationStep(
                                    step_id="step-1",
                                    step_text="学生到学院完成报到登记",
                                    next_step_ids=(),
                                ),
                            ),
                            manual_review_notes=(),
                        ),
                    ),
                ),
                ServiceNavigationPageFinding(
                    source_page=254,
                    page_heading="学生公寓退宿流程",
                    flows=(),
                ),
                ServiceNavigationPageFinding(
                    source_page=255,
                    page_heading="学生公寓调整流程",
                    flows=(),
                ),
                ServiceNavigationPageFinding(
                    source_page=256,
                    page_heading="学生公寓补充说明",
                    flows=(),
                ),
            ),
            global_manual_review_required=False,
        )

        with (
            patch(
                "campus_ingestion_core.handbook_service_navigation_hybrid_materialization._render_declared_pdf_pages_to_pngs",
                return_value=(
                    (252, b"page-252"),
                    (253, b"page-253"),
                    (254, b"page-254"),
                    (255, b"page-255"),
                ),
            ),
            patch(
                "campus_ingestion_core.handbook_service_navigation_hybrid_materialization._extract_service_navigation_flow_graph",
                return_value=flow_graph,
            ),
            self.assertRaisesRegex(ValueError, "page mapping mismatch"),
        ):
            build_handbook_service_navigation_hybrid_document(
                source={},
                reader=reader,
                source_bucket="campus-rag-source",
                raw_asset_record=raw_asset_record,
                source_document_id="handbook:source-001",
                source_uri="campus-agent://regulations/student_rules/docs/handbook:source-001",
                source_handbook_section="中央民族大学公寓及公费医疗管理规定",
                target_document_id="campus_services:service_catalog:test-001",
                target_title="中央民族大学学生公寓管理工作流程",
                projection_name="handbook_navigation_service_catalog",
                derived_from="source_truth",
                parent_document_id="handbook:source-001",
                attachment_kind="navigation_like",
                attachment_role="service_navigation_document",
                provider_response_key="provider-response-key",
                layout_elements_key="layout-elements-key",
                source_page_start=252,
                source_page_end=255,
                entitlement_groups=(),
                visibility_scope=None,
                visibility_level="public",
                import_source="raw_online_ocr",
            )

    def test_build_hybrid_document_fails_closed_when_graph_contains_dangling_edges(self) -> None:
        reader = _FakeReader(b"%PDF-fake%")
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
        flow_graph = ServiceNavigationFlowGraph(
            document_title="中央民族大学学生公寓管理工作流程",
            page_findings=(
                ServiceNavigationPageFinding(
                    source_page=252,
                    page_heading="学生公寓办理总览",
                    flows=(
                        ServiceNavigationFlow(
                            flow_heading="新生入住办理流程",
                            audience_scope="本科生新生",
                            steps=(
                                ServiceNavigationStep(
                                    step_id="step-1",
                                    step_text="学生到学院完成报到登记",
                                    next_step_ids=("step-9",),
                                ),
                            ),
                            manual_review_notes=(),
                        ),
                    ),
                ),
                ServiceNavigationPageFinding(
                    source_page=253,
                    page_heading="学生公寓入住流程",
                    flows=(),
                ),
                ServiceNavigationPageFinding(
                    source_page=254,
                    page_heading="学生公寓退宿流程",
                    flows=(),
                ),
                ServiceNavigationPageFinding(
                    source_page=255,
                    page_heading="学生公寓调整流程",
                    flows=(),
                ),
            ),
            global_manual_review_required=False,
        )

        with (
            patch(
                "campus_ingestion_core.handbook_service_navigation_hybrid_materialization._render_declared_pdf_pages_to_pngs",
                return_value=(
                    (252, b"page-252"),
                    (253, b"page-253"),
                    (254, b"page-254"),
                    (255, b"page-255"),
                ),
            ),
            patch(
                "campus_ingestion_core.handbook_service_navigation_hybrid_materialization._extract_service_navigation_flow_graph",
                return_value=flow_graph,
            ),
            self.assertRaisesRegex(ValueError, "dangling next_step_ids"),
        ):
            build_handbook_service_navigation_hybrid_document(
                source={},
                reader=reader,
                source_bucket="campus-rag-source",
                raw_asset_record=raw_asset_record,
                source_document_id="handbook:source-001",
                source_uri="campus-agent://regulations/student_rules/docs/handbook:source-001",
                source_handbook_section="中央民族大学公寓及公费医疗管理规定",
                target_document_id="campus_services:service_catalog:test-001",
                target_title="中央民族大学学生公寓管理工作流程",
                projection_name="handbook_navigation_service_catalog",
                derived_from="source_truth",
                parent_document_id="handbook:source-001",
                attachment_kind="navigation_like",
                attachment_role="service_navigation_document",
                provider_response_key="provider-response-key",
                layout_elements_key="layout-elements-key",
                source_page_start=252,
                source_page_end=255,
                entitlement_groups=(),
                visibility_scope=None,
                visibility_level="public",
                import_source="raw_online_ocr",
            )


if __name__ == "__main__":
    unittest.main()
