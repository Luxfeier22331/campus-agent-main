from __future__ import annotations

import importlib
import json
import unittest
from unittest.mock import patch

import httpx
from campus_ingestion_core.campusrag_ingestion_artifacts import ProcessedArtifactInput
from campus_ingestion_core.handbook_service_navigation_hybrid_materialization import (
    ServiceNavigationFlow,
    ServiceNavigationFlowGraph,
    ServiceNavigationPageFinding,
    ServiceNavigationStep,
    _extract_service_navigation_flow_graph,
    build_handbook_service_navigation_hybrid_document,
    build_handbook_service_navigation_hybrid_document_from_projection_artifact,
    is_handbook_service_navigation_projection,
)
from campus_ingestion_core.models import RawAssetRecord

CASE_MODULES = (
    "tests.ingestion.test_handbook_service_navigation_hybrid_materialization",
    "tests.ingestion.cases_handbook_service_navigation_hybrid_materialization_tail",
)


def load_tests(
    loader: unittest.TestLoader, tests: unittest.TestSuite, pattern: str | None
) -> unittest.TestSuite:
    suite = unittest.TestSuite()
    for module_name in CASE_MODULES:
        if module_name == __name__:
            suite.addTests(
                loader.loadTestsFromTestCase(HandbookServiceNavigationHybridMaterializationTest)
            )
            continue
        suite.addTests(loader.loadTestsFromModule(importlib.import_module(module_name)))
    return suite


class _FakeReader:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload
        self.reads: list[tuple[str, str]] = []

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        self.reads.append((bucket, key))
        return self.payload


class _FakeResponsesClient:
    posts: list[dict[str, object]]

    def __init__(self, *args: object, **kwargs: object) -> None:
        self.posts = []

    def __enter__(self) -> _FakeResponsesClient:
        return self

    def __exit__(self, exc_type: object, exc: object, tb: object) -> bool:
        return False

    def post(
        self,
        path: str,
        *,
        json: dict[str, object],
        headers: dict[str, str],
    ) -> object:
        self.posts.append({"path": path, "json": json, "headers": headers})
        return httpx.Response(
            200,
            request=httpx.Request("POST", f"https://example.invalid{path}"),
            json={
                "output_parsed": {
                    "document_title": "中央民族大学学生公寓管理工作流程",
                    "page_findings": [
                        {
                            "source_page": 252,
                            "page_heading": "学生公寓办理总览",
                            "flows": [],
                        }
                    ],
                    "global_manual_review_required": False,
                }
            },
        )


class HandbookServiceNavigationHybridMaterializationTest(unittest.TestCase):
    def test_hybrid_extraction_rejects_llm_api_key_alias(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "HANDBOOK_SERVICE_NAVIGATION_API_KEY is required",
        ):
            _extract_service_navigation_flow_graph(
                source={
                    "LLM_API_KEY": "legacy-key",
                    "HANDBOOK_SERVICE_NAVIGATION_MODEL": "gpt-test",
                },
                target_title="学生公寓管理工作流程",
                page_images=((252, b"PNG"),),
                source_page_start=252,
                source_page_end=252,
            )

    def test_hybrid_extraction_ignores_optional_tuning_env(self) -> None:
        fake_client = _FakeResponsesClient()
        with patch(
            "campus_ingestion_core.handbook_service_navigation_hybrid_materialization.httpx.Client",
            return_value=fake_client,
        ):
            graph = _extract_service_navigation_flow_graph(
                source={
                    "HANDBOOK_SERVICE_NAVIGATION_API_KEY": "test-key",
                    "HANDBOOK_SERVICE_NAVIGATION_MODEL": "gpt-test",
                    "HANDBOOK_SERVICE_NAVIGATION_BASE_URL": "https://domain.example/v1",
                    "HANDBOOK_SERVICE_NAVIGATION_REASONING_EFFORT": "high",
                    "HANDBOOK_SERVICE_NAVIGATION_MAX_OUTPUT_TOKENS": "123",
                },
                target_title="学生公寓管理工作流程",
                page_images=((252, b"PNG"),),
                source_page_start=252,
                source_page_end=252,
            )

        self.assertEqual(graph.document_title, "中央民族大学学生公寓管理工作流程")
        self.assertEqual(len(fake_client.posts), 1)
        payload = fake_client.posts[0]["json"]
        self.assertIsInstance(payload, dict)
        self.assertNotIn("reasoning", payload)
        self.assertNotIn("max_output_tokens", payload)

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

    def test_build_hybrid_document_fails_closed_when_flow_graph_requires_manual_review(
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
                                    next_step_ids=(),
                                ),
                            ),
                            manual_review_notes=("步骤文字需要人工确认。",),
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
            self.assertRaisesRegex(ValueError, "manual review"),
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
                entitlement_groups=("students",),
                visibility_scope="main",
                visibility_level="restricted",
                import_source="raw_online_ocr",
            )

    def test_build_hybrid_document_from_projection_artifact_rejects_manual_review_state(
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
                        "extractor_runtime": {
                            "kind": "handbook_service_navigation",
                            "model": "gpt-test",
                        },
                        "flow_graph": {
                            "document_title": "中央民族大学学生公寓管理工作流程",
                            "global_manual_review_required": True,
                            "page_findings": [
                                {
                                    "source_page": 252,
                                    "page_heading": "学生公寓办理总览",
                                    "flows": [
                                        {
                                            "flow_heading": "新生入住办理流程",
                                            "audience_scope": "本科生新生",
                                            "steps": [
                                                {
                                                    "step_id": "step-1",
                                                    "step_text": "学生到学院完成报到登记",
                                                    "next_step_ids": [],
                                                }
                                            ],
                                            "manual_review_notes": [],
                                        }
                                    ],
                                },
                                {
                                    "source_page": 253,
                                    "page_heading": "学生公寓入住流程",
                                    "flows": [],
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
            import_source="raw_online_ocr",
        )

        with self.assertRaisesRegex(ValueError, "manual review"):
            build_handbook_service_navigation_hybrid_document_from_projection_artifact(
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
                provider_response_key="provider-response-key",
                layout_elements_key="layout-elements-key",
                source_page_start=252,
                source_page_end=255,
                entitlement_groups=("students",),
                visibility_scope="main",
                visibility_level="restricted",
                import_source="provider_response_replay",
            )

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
                        "extractor_runtime": {
                            "kind": "handbook_service_navigation",
                            "mode": "captured",
                        },
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
