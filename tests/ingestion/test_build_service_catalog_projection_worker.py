from __future__ import annotations

import importlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

worker = importlib.import_module("campus_ingestion_worker.build_service_catalog_projection")


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


class BuildServiceCatalogProjectionWorkerTest(unittest.TestCase):
    def test_worker_builds_catalog_projection_release_from_current_projections(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            service_guide_projection_path = root / "service-guide-projection.json"
            contact_directory_projection_path = root / "contact-directory-projection.json"
            _write_json(service_guide_projection_path, _service_guide_bundle())
            _write_json(contact_directory_projection_path, _contact_directory_bundle())
            object_store = _FakeObjectStore()

            report = worker.build_service_catalog_projection_release_from_current_projections(
                service_guide_projection_path=service_guide_projection_path,
                contact_directory_projection_path=contact_directory_projection_path,
                work_dir=root / "work",
                generated_at="2026-04-26T10:00:00+08:00",
                release_id="service-catalog-handbook-20260426T100000",
                expected_ready_records=1,
                object_store=object_store,
                derived_bucket="campus-rag-derived",
            )

        self.assertEqual(report.release_id, "service-catalog-handbook-20260426T100000")
        current_payload = json.loads(
            object_store.objects[
                (
                    "campus-rag-derived",
                    "campus_services/releases/service_catalog/current/"
                    "service-catalog-projection.json",
                )
            ].decode("utf-8")
        )
        self.assertEqual(
            current_payload["schema_version"],
            "campus_services_service_catalog_projection.v1",
        )
        self.assertEqual(
            current_payload["service_entries"][0]["contact_record_refs"],
            ["contact:handbook:school-hospital"],
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
                "aliases": ["公费医疗报销"],
                "category": "student_public_medical",
                "campus_scope": "all",
                "audience": ["student"],
                "effective_from": "2018-09-01T00:00:00+08:00",
                "effective_until": "2099-12-31T23:59:59+08:00",
                "source_refs": ["handbook:student_rules:pages:259-260#page=260"],
                "guide_sections": [],
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
                "eligibility_notes": [],
                "extraction_status": "ready",
            }
        ],
        "conflict_records": [],
        "manual_review_sources": [],
    }


def _contact_directory_bundle() -> dict[str, object]:
    return {
        "schema_version": "campus_services_contact_directory_projection.v1",
        "generated_at": "2026-04-26T10:00:00+08:00",
        "source_families": ["handbook_phone_directory_projection_v1"],
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


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
