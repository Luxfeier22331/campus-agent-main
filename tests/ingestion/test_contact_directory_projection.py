from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.contact_directory_projection import (
    CONTACT_DIRECTORY_PROJECTION_FILENAME,
    build_contact_directory_projection_bundle_from_handbook_document_units,
    validate_contact_directory_projection_bundle,
    write_contact_directory_projection_release,
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


class ContactDirectoryProjectionTest(unittest.TestCase):
    def test_builds_contact_directory_from_handbook_phone_policy_units(self) -> None:
        result = build_contact_directory_projection_bundle_from_handbook_document_units(
            document_units=[
                _phone_policy_unit(
                    section_path=["校级办公与公共服务"],
                    clean_text="校园110：68932220\n研究生院(学位办)办公室 68932649",
                ),
                _phone_policy_unit(
                    section_path=["后勤产业集团"],
                    clean_text="公寓管理部 68933547\n餐饮服务部 68933180",
                ),
            ],
            generated_at="2026-04-26T10:00:00+08:00",
            source_title="中央民族大学校内常用电话",
            source_page_start=261,
            source_page_end=261,
        )

        self.assertTrue(result.validation_report.valid, result.validation_report.issues)
        self.assertEqual(
            result.bundle["schema_version"],
            "campus_services_contact_directory_projection.v1",
        )
        self.assertEqual(
            result.bundle["source_families"],
            ["handbook_phone_directory_projection_v1"],
        )
        by_name = {record["display_name"]: record for record in result.bundle["contact_records"]}
        self.assertEqual(
            set(by_name),
            {"校园110", "研究生院(学位办)办公室", "公寓管理部", "餐饮服务部"},
        )
        self.assertEqual(by_name["校园110"]["contact_group"], "校级办公与公共服务")
        self.assertEqual(by_name["校园110"]["phones"][0]["number"], "68932220")
        self.assertEqual(by_name["公寓管理部"]["contact_group"], "后勤产业集团")
        self.assertEqual(
            by_name["研究生院(学位办)办公室"]["source_refs"],
            ["handbook:student_rules:pages:261-261#page=261"],
        )
        self.assertEqual(result.manual_review_sources, [])

    def test_validation_rejects_ready_contact_without_contact_channel(self) -> None:
        report = validate_contact_directory_projection_bundle(
            {
                "schema_version": "campus_services_contact_directory_projection.v1",
                "generated_at": "2026-04-26T10:00:00+08:00",
                "source_families": ["handbook_phone_directory_projection_v1"],
                "contact_records": [
                    {
                        "contact_id": "contact:handbook:test",
                        "display_name": "校医院",
                        "aliases": ["校医院"],
                        "contact_group": "后勤产业集团",
                        "department": "校医院",
                        "phones": [],
                        "emails": [],
                        "location_refs": [],
                        "source_refs": ["handbook:student_rules:pages:261-261#page=261"],
                        "extraction_status": "ready",
                    }
                ],
                "conflict_records": [],
                "manual_review_sources": [],
            }
        )

        self.assertFalse(report.valid)
        self.assertIn("phones or emails is required", report.issues[0]["message"])

    def test_write_release_publishes_versioned_and_current_projection(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir)
            object_store = _FakeObjectStore()
            result = build_contact_directory_projection_bundle_from_handbook_document_units(
                document_units=[
                    _phone_policy_unit(
                        section_path=["校级办公与公共服务"],
                        clean_text="校园110 68932220",
                    )
                ],
                generated_at="2026-04-26T10:00:00+08:00",
                source_title="中央民族大学校内常用电话",
                source_page_start=261,
                source_page_end=261,
            )

            report = write_contact_directory_projection_release(
                bundle=result.bundle,
                output_dir=output_dir,
                release_id="contact-directory-handbook-20260426T100000",
                generated_at="2026-04-26T10:00:00+08:00",
                manual_review_sources=result.manual_review_sources,
                object_store=object_store,
                bucket="campus-rag-derived",
            )

        self.assertEqual(
            report.release_object_key,
            "campus_services/releases/contact_directory/"
            "contact-directory-handbook-20260426T100000/contact-directory-projection.json",
        )
        self.assertEqual(
            report.current_object_key,
            "campus_services/releases/contact_directory/current/contact-directory-projection.json",
        )
        self.assertEqual(
            json.loads(
                object_store.objects[
                    (
                        "campus-rag-derived",
                        "campus_services/releases/contact_directory/current/"
                        + CONTACT_DIRECTORY_PROJECTION_FILENAME,
                    )
                ].decode("utf-8")
            ),
            result.bundle,
        )


def _phone_policy_unit(*, section_path: list[str], clean_text: str) -> dict[str, object]:
    return {
        "unit_type": "policy_page",
        "clean_text": clean_text,
        "anchor": {
            "section_path": section_path,
            "page_start": 261,
            "page_end": 261,
        },
    }


if __name__ == "__main__":
    unittest.main()
