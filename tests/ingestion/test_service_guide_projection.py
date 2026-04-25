from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.service_guide_projection import (
    SERVICE_GUIDE_PROJECTION_FILENAME,
    build_service_guide_projection_bundle_from_handbook_flow_graph,
    validate_service_guide_projection_bundle,
    write_service_guide_projection_release,
)


class _FakeObjectStore:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.objects[(bucket, key)] = data


class ServiceGuideProjectionTest(unittest.TestCase):
    def test_builds_service_guide_projection_from_handbook_flow_graph(self) -> None:
        result = build_service_guide_projection_bundle_from_handbook_flow_graph(
            flow_graph_artifact=_handbook_flow_graph_artifact(),
            generated_at="2026-04-25T10:00:00+08:00",
            effective_from="2018-09-01T00:00:00+08:00",
            effective_until="2099-12-31T23:59:59+08:00",
        )

        self.assertTrue(result.validation_report.valid, result.validation_report.issues)
        bundle = result.bundle
        self.assertEqual(bundle["schema_version"], "campus_services_service_guide_projection.v1")
        self.assertEqual(
            bundle["source_families"],
            ["handbook_service_navigation_projection_v1"],
        )
        self.assertEqual(len(bundle["service_guide_records"]), 2)
        check_in = bundle["service_guide_records"][0]
        self.assertEqual(check_in["display_name"], "公寓楼新生办理入住手续流程")
        self.assertEqual(check_in["category"], "student_housing")
        self.assertEqual(check_in["campus_scope"], "all")
        self.assertEqual(check_in["audience"], ["student"])
        self.assertEqual(check_in["extraction_status"], "ready")
        self.assertIn("学生公寓", check_in["aliases"])
        self.assertIn("住宿", check_in["aliases"])
        self.assertIn("入住", check_in["aliases"])
        self.assertEqual(
            check_in["source_refs"],
            ["handbook:student_rules:pages:252-255#page=253"],
        )
        self.assertEqual(check_in["guide_sections"][0]["section_type"], "procedure")
        self.assertIn("持通知书到院系注册", check_in["guide_sections"][0]["content"])
        self.assertEqual(check_in["materials"], [])
        self.assertEqual(check_in["entry_refs"], [])

        leave = bundle["service_guide_records"][1]
        self.assertEqual(leave["display_name"], "公寓楼毕业生办理离校手续流程")
        self.assertEqual(leave["extraction_status"], "needs_manual_review")
        self.assertIn("离校", leave["aliases"])
        self.assertEqual(
            result.manual_review_sources,
            [
                {
                    "service_id": leave["service_id"],
                    "source_ref": "handbook:student_rules:pages:252-255#page=253",
                    "reason": "handbook_flow_manual_review_notes",
                    "notes": ["步骤2文字需要人工确认。"],
                }
            ],
        )

    def test_validation_rejects_ready_record_without_source_refs(self) -> None:
        report = validate_service_guide_projection_bundle(
            {
                "schema_version": "campus_services_service_guide_projection.v1",
                "generated_at": "2026-04-25T10:00:00+08:00",
                "source_families": ["handbook_service_navigation_projection_v1"],
                "service_guide_records": [
                    {
                        "service_id": "service:handbook:test",
                        "display_name": "测试服务",
                        "aliases": ["测试"],
                        "category": "student_housing",
                        "campus_scope": "all",
                        "audience": ["student"],
                        "effective_from": "2026-04-25T00:00:00+08:00",
                        "effective_until": "2099-12-31T23:59:59+08:00",
                        "source_refs": [],
                        "guide_sections": [],
                        "materials": [],
                        "entry_refs": [],
                        "office_hours": [],
                        "contact_refs": [],
                        "eligibility_notes": [],
                        "extraction_status": "ready",
                    }
                ],
                "conflict_records": [],
                "manual_review_sources": [],
            }
        )

        self.assertFalse(report.valid)
        self.assertIn("source_refs is required", report.issues[0]["message"])

    def test_write_release_publishes_versioned_and_current_projection(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            object_store = _FakeObjectStore()
            result = build_service_guide_projection_bundle_from_handbook_flow_graph(
                flow_graph_artifact=_handbook_flow_graph_artifact(),
                generated_at="2026-04-25T10:00:00+08:00",
                effective_from="2018-09-01T00:00:00+08:00",
                effective_until="2099-12-31T23:59:59+08:00",
            )

            report = write_service_guide_projection_release(
                bundle=result.bundle,
                output_dir=output_dir,
                release_id="service-guide-handbook-20260425T100000",
                generated_at="2026-04-25T10:00:00+08:00",
                manual_review_sources=result.manual_review_sources,
                object_store=object_store,
                bucket="campus-rag-derived",
            )

            self.assertTrue((output_dir / "current" / SERVICE_GUIDE_PROJECTION_FILENAME).exists())
            self.assertEqual(
                report.release_object_key,
                "campus_services/releases/service_guide/service-guide-handbook-20260425T100000/service-guide-projection.json",
            )
            self.assertEqual(
                report.current_object_key,
                "campus_services/releases/service_guide/current/service-guide-projection.json",
            )
            self.assertIn(
                (
                    "campus-rag-derived",
                    "campus_services/releases/service_guide/service-guide-handbook-20260425T100000/manual-review-report.json",
                ),
                object_store.objects,
            )

        self.assertEqual(
            json.loads(
                object_store.objects[
                    (
                        "campus-rag-derived",
                        "campus_services/releases/service_guide/current/"
                        + SERVICE_GUIDE_PROJECTION_FILENAME,
                    )
                ].decode("utf-8")
            ),
            result.bundle,
        )


def _handbook_flow_graph_artifact() -> dict[str, object]:
    return {
        "schema_version": "handbook_service_navigation_projection_v1",
        "projection_name": "handbook_navigation_service_catalog",
        "raw_asset_id": "asset:student-handbook-pdf",
        "raw_version_id": "sha256:test-raw-version",
        "source_document_id": "handbook:student_rules:2018",
        "source_uri": "campus-agent://regulations/student_rules/docs/handbook:student_rules:2018",
        "source_handbook_section": "中央民族大学公寓及公费医疗管理规定",
        "source_page_start": 252,
        "source_page_end": 255,
        "target_document_id": "campus_services:service_catalog:student-dorm-workflows",
        "target_title": "中央民族大学学生公寓管理工作流程",
        "extractor_runtime": {"kind": "captured_handbook_slice"},
        "flow_graph": {
            "document_title": "中央民族大学学生公寓管理工作流程",
            "global_manual_review_required": False,
            "page_findings": [
                {
                    "source_page": 252,
                    "page_heading": "中央民族大学公寓及公费医疗管理规定",
                    "flows": [],
                },
                {
                    "source_page": 253,
                    "page_heading": "中央民族大学学生公寓管理工作流程",
                    "flows": [
                        {
                            "flow_heading": "一、公寓楼新生办理入住手续流程",
                            "audience_scope": "",
                            "manual_review_notes": [],
                            "steps": [
                                {
                                    "step_id": "p253-f1-s1",
                                    "step_text": "1、持通知书到院系注册，领取校园一卡通，获知住宿楼号及房间。",
                                    "next_step_ids": ["p253-f1-s2"],
                                },
                                {
                                    "step_id": "p253-f1-s2",
                                    "step_text": "2、到指定公寓楼报到，出示入学通知书。",
                                    "next_step_ids": [],
                                },
                            ],
                        },
                        {
                            "flow_heading": "二、公寓楼毕业生办理离校手续流程",
                            "audience_scope": "",
                            "manual_review_notes": ["步骤2文字需要人工确认。"],
                            "steps": [
                                {
                                    "step_id": "p253-f2-s1",
                                    "step_text": "1、到楼长办公室。",
                                    "next_step_ids": ["p253-f2-s2"],
                                },
                                {
                                    "step_id": "p253-f2-s2",
                                    "step_text": "2、出示《毕业生离校通知单》。",
                                    "next_step_ids": [],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    }


if __name__ == "__main__":
    unittest.main()
