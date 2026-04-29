from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.service_guide_projection_eval import (
    ServiceGuideProjectionEvalCase,
    evaluate_service_guide_projection_bundle,
    load_default_service_guide_projection_eval_cases,
)
from campus_ingestion_core.service_guide_projection import (
    write_service_guide_projection_release_from_source_truth_manifest,
)


class ServiceGuideProjectionEvalTest(unittest.TestCase):
    def test_default_cases_cover_guide_focuses_and_expected_fail_close_fields(self) -> None:
        object_store = _FakeObjectStore()
        with TemporaryDirectory() as temp_dir:
            report = write_service_guide_projection_release_from_source_truth_manifest(
                source_truth_manifest_path=Path(
                    "configs/ingestion/campus_services/service_guide/source-truth.v1.json"
                ),
                output_dir=Path(temp_dir) / "service-guide",
                generated_at="2026-04-26T10:00:00+08:00",
                object_store=object_store,
                bucket="campus-rag-derived",
                release_id="service-guide-eval-test",
            )
            bundle = json.loads(Path(report.current_projection_path).read_text(encoding="utf-8"))

        eval_report = evaluate_service_guide_projection_bundle(
            bundle,
            cases=load_default_service_guide_projection_eval_cases(),
        )

        self.assertTrue(eval_report.passed, eval_report.failed_case_ids)
        self.assertEqual(eval_report.summary["total"], 6)
        self.assertEqual(eval_report.summary["passed"], 6)
        by_case = {case.case_id: case for case in eval_report.case_results}
        self.assertEqual(
            by_case["student-card-office-hours"].observed_values["office_hours"],
            ["每周四下午"],
        )
        self.assertEqual(
            by_case["public-medical-contact-fail-close"].observed_missing_fields,
            ["contact_refs"],
        )
        self.assertEqual(
            by_case["campus-card-lost-reissue"].observed_values["contacts"],
            ["海淀校区校园卡管理中心", "丰台校区卡务中心"],
        )

    def test_eval_reports_missing_required_materials(self) -> None:
        report = evaluate_service_guide_projection_bundle(
            {
                "schema_version": "campus_services_service_guide_projection.v1",
                "service_guide_records": [
                    {
                        "service_id": "service:handbook:student-card-replacement",
                        "display_name": "学生证补办办理指南",
                        "aliases": ["学生证补办"],
                        "source_refs": ["handbook:student_rules:pages:163-165#page=164"],
                        "materials": [{"name": "书面申请"}],
                        "entry_refs": [],
                        "office_hours": [],
                        "contact_refs": [],
                    }
                ],
            },
            cases=(
                ServiceGuideProjectionEvalCase(
                    case_id="student-card-materials",
                    service_id="service:handbook:student-card-replacement",
                    required_material_names=("书面申请", "《中央民族大学补办学生证申请表》"),
                    required_source_refs=("handbook:student_rules:pages:163-165#page=164",),
                ),
            ),
        )

        self.assertFalse(report.passed)
        self.assertEqual(report.failed_case_ids, ["student-card-materials"])
        self.assertIn(
            "missing material: 《中央民族大学补办学生证申请表》",
            report.case_results[0].failures,
        )


class _FakeObjectStore:
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        return None


if __name__ == "__main__":
    unittest.main()
