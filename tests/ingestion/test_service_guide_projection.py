from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.service_guide_projection import (
    SERVICE_GUIDE_PROJECTION_FILENAME,
    assert_service_guide_projection_release_ready,
    build_service_guide_projection_bundle_from_curated_handbook_flow_graph,
    build_service_guide_projection_bundle_from_curated_service_guide,
    build_service_guide_projection_bundle_from_handbook_flow_graph,
    build_service_guide_projection_bundle_from_handbook_flow_graph_document_data,
    validate_service_guide_projection_bundle,
    write_service_guide_projection_release,
    write_service_guide_projection_release_from_source_truth_manifest,
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
    def test_source_truth_manifest_combines_expanded_handbook_service_guides(self) -> None:
        manifest_path = Path("configs/ingestion/campus_services/service_guide/source-truth.v1.json")

        with TemporaryDirectory() as temp_dir:
            object_store = _FakeObjectStore()
            report = write_service_guide_projection_release_from_source_truth_manifest(
                source_truth_manifest_path=manifest_path,
                output_dir=Path(temp_dir),
                generated_at="2026-04-25T10:00:00+08:00",
                object_store=object_store,
                bucket="campus-rag-derived",
                release_id="service-guide-handbook-expanded-test",
            )

        projection = json.loads(
            object_store.objects[("campus-rag-derived", report.current_object_key)].decode("utf-8")
        )
        self.assertEqual(len(projection["service_guide_records"]), 15)
        by_name = {record["display_name"]: record for record in projection["service_guide_records"]}
        self.assertIn("学生证补办办理指南", by_name)
        self.assertIn("学生申诉办理指南", by_name)
        self.assertIn("临时困难补助申请指南", by_name)
        self.assertIn("国家助学贷款申请指南", by_name)
        self.assertIn("勤工助学岗位聘用指南", by_name)
        self.assertIn("校园卡挂失与补卡", by_name)
        self.assertEqual(
            {material["name"] for material in by_name["学生证补办办理指南"]["materials"]},
            {"书面申请", "《中央民族大学补办学生证申请表》", "本人照片"},
        )
        self.assertEqual(
            by_name["学生证补办办理指南"]["office_hours"][0]["time_range"],
            "每周四下午",
        )
        self.assertEqual(
            {material["name"] for material in by_name["国家助学贷款申请指南"]["materials"]},
            {
                "国家助学贷款申请书",
                "国家助学贷款申请审批表",
                "相关材料",
                "院系申请国家助学贷款学生审核信息表",
            },
        )

    def test_builds_public_medical_service_guide_from_curated_source_truth(self) -> None:
        curated_path = Path(
            "configs/ingestion/regulations/student_rules/curated-service-guides/"
            "central-minzu-student-public-medical.v1.json"
        )

        result = build_service_guide_projection_bundle_from_curated_service_guide(
            curated_service_guide_artifact=json.loads(curated_path.read_text(encoding="utf-8")),
            generated_at="2026-04-25T10:00:00+08:00",
            effective_from="2018-09-01T00:00:00+08:00",
            effective_until="2099-12-31T23:59:59+08:00",
        )

        self.assertTrue(result.validation_report.valid, result.validation_report.issues)
        assert_service_guide_projection_release_ready(
            result.bundle,
            expected_ready_records=3,
        )
        self.assertEqual(result.bundle["source_families"], ["handbook_curated_service_guide_v1"])
        by_name = {
            record["display_name"]: record for record in result.bundle["service_guide_records"]
        }
        self.assertEqual(
            set(by_name),
            {
                "公费医疗资格与就医规则",
                "公费医疗报销办理指南",
                "公费医疗不予报销范围",
            },
        )
        reimbursement = by_name["公费医疗报销办理指南"]
        self.assertEqual(reimbursement["category"], "student_public_medical")
        self.assertIn("公费医疗报销", reimbursement["aliases"])
        self.assertEqual(
            {section["section_type"] for section in reimbursement["guide_sections"]},
            {"overview", "procedure", "required_materials", "entry"},
        )
        self.assertEqual(
            {material["name"] for material in reimbursement["materials"]},
            {
                "《转诊单》",
                "急诊证明",
                "检查报告",
                "处方",
                "住院收据",
                "住院费明细单",
                "书面申请",
                "出院手续",
            },
        )
        self.assertIn(
            "假期急病门诊报销",
            next(
                material["note"]
                for material in reimbursement["materials"]
                if material["name"] == "急诊证明"
            ),
        )
        self.assertEqual(
            reimbursement["entry_refs"],
            [
                {
                    "entry_id": "service:handbook:student-public-medical-reimbursement:entry:school-hospital",
                    "label": "校医院",
                    "entry_type": "offline_location",
                    "url": "",
                    "location_ref": "",
                    "source_refs": ["handbook:student_rules:pages:259-260#page=260"],
                }
            ],
        )
        self.assertEqual(reimbursement["office_hours"], [])
        self.assertEqual(reimbursement["contact_refs"], [])

    def test_builds_campus_card_service_guide_from_official_web_curated_source_truth(
        self,
    ) -> None:
        result = build_service_guide_projection_bundle_from_curated_service_guide(
            curated_service_guide_artifact=_official_web_campus_card_service_guide_artifact(),
            generated_at="2026-04-27T10:00:00+08:00",
            effective_from="2026-04-27T00:00:00+08:00",
            effective_until="2099-12-31T23:59:59+08:00",
        )

        self.assertTrue(result.validation_report.valid, result.validation_report.issues)
        assert_service_guide_projection_release_ready(
            result.bundle,
            expected_ready_records=1,
        )
        self.assertEqual(
            result.bundle["source_families"], ["official_web_curated_service_guide_v1"]
        )
        record = result.bundle["service_guide_records"][0]
        self.assertEqual(record["service_id"], "service:campus-card:lost-reissue")
        self.assertEqual(record["category"], "campus_card")
        self.assertIn("校园卡丢了", record["aliases"])
        self.assertIn("一卡通补卡", record["aliases"])
        self.assertEqual(
            {entry["label"] for entry in record["entry_refs"]},
            {"学生自助补卡机", "海淀校区校园卡管理中心", "丰台校区卡务中心"},
        )
        self_service_entry = next(
            entry for entry in record["entry_refs"] if entry["label"] == "学生自助补卡机"
        )
        self.assertIn("聚雅餐厅", self_service_entry["location_ref"])
        self.assertIn("图书馆一层门厅", self_service_entry["location_ref"])
        self.assertEqual(
            {contact["phone"] for contact in record["contact_refs"]},
            {"010-68933381", "010-83878225"},
        )
        self.assertIn(
            "30分钟后",
            next(
                section["content"]
                for section in record["guide_sections"]
                if section["section_type"] == "overview"
            ),
        )

    def test_builds_ready_projection_from_curated_handbook_flow_graph_artifact(self) -> None:
        result = build_service_guide_projection_bundle_from_curated_handbook_flow_graph(
            curated_flow_graph_artifact=_curated_handbook_flow_graph_artifact(),
            generated_at="2026-04-25T10:00:00+08:00",
            effective_from="2018-09-01T00:00:00+08:00",
            effective_until="2099-12-31T23:59:59+08:00",
        )

        self.assertTrue(result.validation_report.valid, result.validation_report.issues)
        self.assertEqual(len(result.bundle["service_guide_records"]), 6)
        self.assertEqual(result.manual_review_sources, [])
        assert_service_guide_projection_release_ready(
            result.bundle,
            expected_ready_records=6,
        )

    def test_builds_ready_projection_from_curated_handbook_flow_graph_document_data(self) -> None:
        result = build_service_guide_projection_bundle_from_handbook_flow_graph_document_data(
            document_data=_curated_handbook_flow_graph_document_data(),
            generated_at="2026-04-25T10:00:00+08:00",
            effective_from="2018-09-01T00:00:00+08:00",
            effective_until="2099-12-31T23:59:59+08:00",
            target_document_id="campus_services:service_catalog:student-dorm-workflows",
            source_document_id="handbook:student_rules:2018",
        )

        self.assertTrue(result.validation_report.valid, result.validation_report.issues)
        self.assertEqual(result.manual_review_sources, [])
        records = result.bundle["service_guide_records"]
        self.assertEqual(len(records), 6)
        self.assertEqual({record["extraction_status"] for record in records}, {"ready"})
        by_name = {record["display_name"]: record for record in records}
        self.assertIn("公寓楼毕业生办理离校手续流程", by_name)
        self.assertIn(
            "学生退钥匙，并在《毕业生离校通知单》上签字盖章。",
            by_name["公寓楼毕业生办理离校手续流程"]["guide_sections"][0]["content"],
        )
        self.assertEqual(
            by_name["研究生申请办理退宿手续"]["source_refs"],
            ["handbook:student_rules:pages:252-255#page=255"],
        )
        self.assertEqual(
            by_name["本科生申请不住宿流程"]["eligibility_notes"],
            ["本科生"],
        )

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

    def test_release_gate_rejects_manual_review_records(self) -> None:
        result = build_service_guide_projection_bundle_from_handbook_flow_graph(
            flow_graph_artifact=_handbook_flow_graph_artifact(),
            generated_at="2026-04-25T10:00:00+08:00",
            effective_from="2018-09-01T00:00:00+08:00",
            effective_until="2099-12-31T23:59:59+08:00",
        )

        with self.assertRaisesRegex(ValueError, "manual review"):
            assert_service_guide_projection_release_ready(result.bundle)

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


def _official_web_campus_card_service_guide_artifact() -> dict[str, object]:
    source_refs = [
        "https://met.muc.edu.cn/info/1027/1127.htm",
        "https://yx.muc.edu.cn/shuzixiaoyuan/yikatong/",
    ]
    return {
        "schemaVersion": "official_web_curated_service_guide.v1",
        "projectionName": "official_web_campus_card_service_guide",
        "targetDocumentId": "campus_services:service_catalog:campus-card",
        "sourceDocumentId": "official_web:campus-card-service-pages",
        "documentData": {
            "title": "中央民族大学校园卡服务指南",
            "sourceTitle": "学生校园卡服务 / 一卡通",
            "manualReviewRequired": False,
            "extractionStatus": "ready",
            "services": [
                {
                    "serviceId": "service:campus-card:lost-reissue",
                    "displayName": "校园卡挂失与补卡",
                    "aliases": [
                        "校园卡丢了",
                        "校园卡遗失",
                        "校园卡挂失",
                        "校园卡补办",
                        "一卡通丢了",
                        "一卡通补卡",
                    ],
                    "category": "campus_card",
                    "campusScope": "all",
                    "audience": ["student", "faculty"],
                    "sourceRefs": source_refs,
                    "guideSections": [
                        {
                            "sectionId": "service:campus-card:lost-reissue:section:overview",
                            "sectionType": "overview",
                            "title": "丢失后的处理范围",
                            "content": "校园卡丢失后应先办理挂失，再补办新卡；正式卡可挂失，临时卡不挂失。补卡后原余额可在30分钟后通过POS机刷卡领取或圈存机领取到新卡。",
                            "order": 1,
                            "sourceRefs": source_refs,
                        },
                        {
                            "sectionId": "service:campus-card:lost-reissue:section:procedure",
                            "sectionType": "procedure",
                            "title": "挂失与补卡流程",
                            "content": "1. 通过圈存机、企业微信或民大通APP办理挂失。\n2. 挂失后可在学生自助补卡机补办校园卡。\n3. 补卡后原余额可在30分钟后通过POS机刷卡领取或圈存机领取到新卡。",
                            "order": 2,
                            "sourceRefs": source_refs,
                        },
                        {
                            "sectionId": "service:campus-card:lost-reissue:section:entry",
                            "sectionType": "entry",
                            "title": "补卡入口与线下地点",
                            "content": "学生自助补卡机可办理补卡；自助补卡机位置包括丰台校区聚雅餐厅、荟贤餐厅、智慧中心校园卡前台，以及海淀校区文化楼西区一层、图书馆一层门厅、理工楼一层、中慧楼二层校园卡管理中心；海淀校区线下地点为中慧楼二层校园卡管理中心，丰台校区线下地点为智慧中心一层大厅卡务中心。",
                            "order": 3,
                            "sourceRefs": source_refs,
                        },
                        {
                            "sectionId": "service:campus-card:lost-reissue:section:contact",
                            "sectionType": "contact",
                            "title": "咨询电话",
                            "content": "海淀校区校园卡管理中心咨询电话010-68933381；丰台校区卡务中心咨询电话010-83878225。",
                            "order": 4,
                            "sourceRefs": source_refs,
                        },
                    ],
                    "materials": [],
                    "entryRefs": [
                        {
                            "entryId": "service:campus-card:lost-reissue:entry:self-service-machine",
                            "label": "学生自助补卡机",
                            "entryType": "instructions_only",
                            "locationRef": "丰台校区聚雅餐厅、荟贤餐厅、智慧中心校园卡前台；海淀校区文化楼西区一层、图书馆一层门厅、理工楼一层、中慧楼二层校园卡管理中心",
                            "sourceRefs": source_refs,
                        },
                        {
                            "entryId": "service:campus-card:lost-reissue:entry:haidian-card-center",
                            "label": "海淀校区校园卡管理中心",
                            "entryType": "offline_location",
                            "locationRef": "中慧楼二层",
                            "sourceRefs": ["https://met.muc.edu.cn/info/1027/1127.htm"],
                        },
                        {
                            "entryId": "service:campus-card:lost-reissue:entry:fengtai-card-center",
                            "label": "丰台校区卡务中心",
                            "entryType": "offline_location",
                            "locationRef": "智慧中心一层大厅",
                            "sourceRefs": ["https://met.muc.edu.cn/info/1027/1127.htm"],
                        },
                    ],
                    "officeHours": [],
                    "contactRefs": [
                        {
                            "contactId": "service:campus-card:lost-reissue:contact:haidian",
                            "label": "海淀校区校园卡管理中心",
                            "department": "校园卡管理中心",
                            "phone": "010-68933381",
                            "locationRef": "中慧楼二层",
                            "sourceRefs": ["https://met.muc.edu.cn/info/1027/1127.htm"],
                        },
                        {
                            "contactId": "service:campus-card:lost-reissue:contact:fengtai",
                            "label": "丰台校区卡务中心",
                            "department": "卡务中心",
                            "phone": "010-83878225",
                            "locationRef": "智慧中心一层大厅",
                            "sourceRefs": ["https://met.muc.edu.cn/info/1027/1127.htm"],
                        },
                    ],
                    "eligibilityNotes": [
                        "正式卡可办理挂失；临时卡不挂失。",
                    ],
                    "extractionStatus": "ready",
                    "manualReviewNotes": [],
                }
            ],
        },
    }


def _curated_handbook_flow_graph_document_data() -> dict[str, object]:
    return {
        "title": "中央民族大学学生公寓管理工作流程",
        "sourceHandbookSection": "中央民族大学公寓及公费医疗管理规定",
        "sourcePageStart": 252,
        "sourcePageEnd": 255,
        "manualReviewRequired": False,
        "extractionStatus": "ready",
        "pageFindings": [
            {
                "sourcePage": 253,
                "pageHeading": "中央民族大学学生公寓管理工作流程",
                "flows": [
                    {
                        "flowHeading": "公寓楼新生办理入住手续流程",
                        "audienceScope": "新生",
                        "manualReviewNotes": [],
                        "steps": [
                            {
                                "stepId": "p253-f1-s1",
                                "stepText": "持通知书到院系注册，领取校园一卡通，获知住宿楼号及房间。",
                                "nextStepIds": ["p253-f1-s2"],
                            },
                            {
                                "stepId": "p253-f1-s2",
                                "stepText": "到指定公寓楼报到，出示入学通知书。",
                                "nextStepIds": [],
                            },
                        ],
                    },
                    {
                        "flowHeading": "公寓楼毕业生办理离校手续流程",
                        "audienceScope": "毕业生",
                        "manualReviewNotes": [],
                        "steps": [
                            {
                                "stepId": "p253-f2-s1",
                                "stepText": "到楼长办公室。",
                                "nextStepIds": ["p253-f2-s2"],
                            },
                            {
                                "stepId": "p253-f2-s2",
                                "stepText": "出示《毕业生离校通知单》。",
                                "nextStepIds": ["p253-f2-s3"],
                            },
                            {
                                "stepId": "p253-f2-s3",
                                "stepText": "学生退钥匙，并在《毕业生离校通知单》上签字盖章。",
                                "nextStepIds": [],
                            },
                        ],
                    },
                ],
            },
            {
                "sourcePage": 254,
                "pageHeading": "三、计划内住宿学生申请不住宿流程",
                "flows": [
                    {
                        "flowHeading": "本科生申请不住宿流程",
                        "audienceScope": "本科生",
                        "manualReviewNotes": [],
                        "steps": [
                            {
                                "stepId": "p254-f1-s1",
                                "stepText": "写好不住宿申请，写明原因和不住宿的期限。",
                                "nextStepIds": [],
                            }
                        ],
                    },
                    {
                        "flowHeading": "研究生申请不住宿流程",
                        "audienceScope": "研究生",
                        "manualReviewNotes": [],
                        "steps": [
                            {
                                "stepId": "p254-f2-s1",
                                "stepText": "写好不住宿申请，注明期限。",
                                "nextStepIds": [],
                            }
                        ],
                    },
                ],
            },
            {
                "sourcePage": 255,
                "pageHeading": "四、住宿中途申请办理退宿流程",
                "flows": [
                    {
                        "flowHeading": "本科生特殊情况申请办理退宿手续",
                        "audienceScope": "本科生",
                        "manualReviewNotes": [],
                        "steps": [
                            {
                                "stepId": "p255-f1-s1",
                                "stepText": "写好退宿申请，注明不住宿的期限。",
                                "nextStepIds": [],
                            }
                        ],
                    },
                    {
                        "flowHeading": "研究生申请办理退宿手续",
                        "audienceScope": "研究生",
                        "manualReviewNotes": [],
                        "steps": [
                            {
                                "stepId": "p255-f2-s1",
                                "stepText": "写好退宿申请，写明原因和不住宿的期限。",
                                "nextStepIds": [],
                            }
                        ],
                    },
                ],
            },
        ],
    }


def _curated_handbook_flow_graph_artifact() -> dict[str, object]:
    return {
        "schemaVersion": "handbook_curated_service_flow_graph.v1",
        "projectionName": "handbook_navigation_service_catalog",
        "targetDocumentId": "campus_services:service_catalog:student-dorm-workflows",
        "sourceDocumentId": "handbook:student_rules:2018",
        "documentData": _curated_handbook_flow_graph_document_data(),
    }


if __name__ == "__main__":
    unittest.main()
