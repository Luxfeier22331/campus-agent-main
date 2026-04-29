from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.service_catalog_projection import (
    SERVICE_CATALOG_PROJECTION_FILENAME,
    assert_service_catalog_projection_release_ready,
    build_service_catalog_projection_bundle,
    validate_service_catalog_projection_bundle,
    write_service_catalog_projection_release,
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


class ServiceCatalogProjectionTest(unittest.TestCase):
    def test_builds_catalog_entries_from_service_guides_and_contact_directory(self) -> None:
        result = build_service_catalog_projection_bundle(
            service_guide_bundle=_service_guide_bundle(),
            contact_directory_bundle=_contact_directory_bundle(),
            generated_at="2026-04-26T10:00:00+08:00",
        )

        self.assertTrue(result.validation_report.valid, result.validation_report.issues)
        self.assertEqual(
            result.bundle["schema_version"],
            "campus_services_service_catalog_projection.v1",
        )
        self.assertEqual(
            result.bundle["source_families"],
            [
                "service_guide_projection_v1",
                "contact_directory_projection_v1",
            ],
        )
        by_name = {entry["display_name"]: entry for entry in result.bundle["service_entries"]}
        self.assertEqual(
            set(by_name),
            {"公费医疗报销办理指南", "公寓楼新生办理入住手续流程"},
        )
        reimbursement = by_name["公费医疗报销办理指南"]
        self.assertEqual(
            reimbursement["guide_record_refs"],
            ["service:handbook:student-public-medical-reimbursement"],
        )
        self.assertEqual(reimbursement["contact_record_refs"], ["contact:handbook:school-hospital"])
        self.assertEqual(reimbursement["owner_department"], "校医院")
        self.assertEqual(reimbursement["entry_refs"][0]["label"], "校医院")
        self.assertIn("公费医疗报销", reimbursement["aliases"])
        self.assertEqual(
            reimbursement["source_refs"],
            [
                "handbook:student_rules:pages:259-260#page=259",
                "handbook:student_rules:pages:259-260#page=260",
                "handbook:student_rules:pages:261-261#page=261",
            ],
        )

        dorm_check_in = by_name["公寓楼新生办理入住手续流程"]
        self.assertEqual(dorm_check_in["contact_record_refs"], [])
        self.assertEqual(dorm_check_in["owner_department"], "")

    def test_validation_rejects_ready_entry_without_source_refs(self) -> None:
        report = validate_service_catalog_projection_bundle(
            {
                "schema_version": "campus_services_service_catalog_projection.v1",
                "generated_at": "2026-04-26T10:00:00+08:00",
                "source_families": ["service_guide_projection_v1"],
                "service_entries": [
                    {
                        "service_id": "service:handbook:test",
                        "display_name": "测试服务",
                        "aliases": ["测试服务"],
                        "category": "student_housing",
                        "campus_scope": "all",
                        "audience": ["student"],
                        "owner_department": "",
                        "guide_record_refs": ["service:handbook:test"],
                        "contact_record_refs": [],
                        "entry_refs": [],
                        "source_refs": [],
                        "effective_from": "2018-09-01T00:00:00+08:00",
                        "effective_until": "2099-12-31T23:59:59+08:00",
                        "extraction_status": "ready",
                    }
                ],
                "conflict_records": [],
                "manual_review_sources": [],
            }
        )

        self.assertFalse(report.valid)
        self.assertIn("source_refs is required", report.issues[0]["message"])

    def test_release_gate_rejects_ready_count_mismatch(self) -> None:
        result = build_service_catalog_projection_bundle(
            service_guide_bundle=_service_guide_bundle(),
            contact_directory_bundle=_contact_directory_bundle(),
            generated_at="2026-04-26T10:00:00+08:00",
        )

        with self.assertRaisesRegex(
            ValueError,
            "service catalog projection ready entry count mismatch: expected 3, got 2",
        ):
            assert_service_catalog_projection_release_ready(
                result.bundle,
                expected_ready_records=3,
            )

    def test_write_release_publishes_versioned_and_current_projection(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            object_store = _FakeObjectStore()
            result = build_service_catalog_projection_bundle(
                service_guide_bundle=_service_guide_bundle(),
                contact_directory_bundle=_contact_directory_bundle(),
                generated_at="2026-04-26T10:00:00+08:00",
            )

            report = write_service_catalog_projection_release(
                bundle=result.bundle,
                output_dir=output_dir,
                release_id="service-catalog-handbook-20260426T100000",
                generated_at="2026-04-26T10:00:00+08:00",
                expected_ready_records=2,
                manual_review_sources=result.manual_review_sources,
                object_store=object_store,
                bucket="campus-rag-derived",
            )

        self.assertEqual(
            report.current_object_key,
            "campus_services/releases/service_catalog/current/service-catalog-projection.json",
        )
        self.assertEqual(
            json.loads(
                object_store.objects[
                    (
                        "campus-rag-derived",
                        "campus_services/releases/service_catalog/current/"
                        + SERVICE_CATALOG_PROJECTION_FILENAME,
                    )
                ].decode("utf-8")
            ),
            result.bundle,
        )


def _service_guide_bundle() -> dict[str, object]:
    return {
        "schema_version": "campus_services_service_guide_projection.v1",
        "generated_at": "2026-04-26T10:00:00+08:00",
        "source_families": ["handbook_curated_service_guide_v1"],
        "service_guide_records": [
            {
                "service_id": "service:handbook:student-public-medical-reimbursement",
                "display_name": "公费医疗报销办理指南",
                "aliases": ["公费医疗报销", "医疗报销"],
                "category": "student_public_medical",
                "campus_scope": "all",
                "audience": ["student"],
                "effective_from": "2018-09-01T00:00:00+08:00",
                "effective_until": "2099-12-31T23:59:59+08:00",
                "source_refs": [
                    "handbook:student_rules:pages:259-260#page=259",
                    "handbook:student_rules:pages:259-260#page=260",
                ],
                "guide_sections": [
                    {
                        "section_id": (
                            "service:handbook:student-public-medical-reimbursement"
                            ":section:procedure"
                        ),
                        "section_type": "procedure",
                        "title": "公费医疗报销流程",
                        "content": "到校医院办理报销。",
                        "order": 1,
                        "source_refs": ["handbook:student_rules:pages:259-260#page=260"],
                    }
                ],
                "materials": [],
                "entry_refs": [
                    {
                        "entry_id": (
                            "service:handbook:student-public-medical-reimbursement"
                            ":entry:school-hospital"
                        ),
                        "label": "校医院",
                        "entry_type": "offline_location",
                        "url": "",
                        "location_ref": "",
                        "source_refs": ["handbook:student_rules:pages:259-260#page=260"],
                    }
                ],
                "office_hours": [],
                "contact_refs": [],
                "eligibility_notes": ["学生"],
                "extraction_status": "ready",
            },
            {
                "service_id": "service:handbook:check-in",
                "display_name": "公寓楼新生办理入住手续流程",
                "aliases": ["入住", "宿舍"],
                "category": "student_housing",
                "campus_scope": "all",
                "audience": ["student"],
                "effective_from": "2018-09-01T00:00:00+08:00",
                "effective_until": "2099-12-31T23:59:59+08:00",
                "source_refs": ["handbook:student_rules:pages:252-255#page=253"],
                "guide_sections": [
                    {
                        "section_id": "service:handbook:check-in:section:procedure",
                        "section_type": "procedure",
                        "title": "公寓楼新生办理入住手续流程",
                        "content": "到指定公寓楼报到。",
                        "order": 1,
                        "source_refs": ["handbook:student_rules:pages:252-255#page=253"],
                    }
                ],
                "materials": [],
                "entry_refs": [],
                "office_hours": [],
                "contact_refs": [],
                "eligibility_notes": ["新生"],
                "extraction_status": "ready",
            },
        ],
        "conflict_records": [],
        "manual_review_sources": [],
    }


def _contact_directory_bundle() -> dict[str, object]:
    return {
        "schema_version": "campus_services_contact_directory_projection.v1",
        "generated_at": "2026-04-26T10:00:00+08:00",
        "source_families": ["handbook_phone_directory_projection_v1"],
        "source_documents": [
            {
                "title": "中央民族大学校内常用电话",
                "source_refs": ["handbook:student_rules:pages:261-261#page=261"],
            }
        ],
        "contact_records": [
            {
                "contact_id": "contact:handbook:school-hospital",
                "display_name": "校医院",
                "aliases": ["校医院"],
                "contact_group": "后勤产业集团",
                "department": "校医院",
                "phones": [
                    {
                        "phone_id": "contact:handbook:school-hospital:phone:1",
                        "label": "电话号码",
                        "number": "68933120",
                        "source_refs": ["handbook:student_rules:pages:261-261#page=261"],
                    }
                ],
                "emails": [],
                "location_refs": [],
                "source_refs": ["handbook:student_rules:pages:261-261#page=261"],
                "extraction_status": "ready",
            }
        ],
        "conflict_records": [],
        "manual_review_sources": [],
    }


if __name__ == "__main__":
    unittest.main()
