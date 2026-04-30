from __future__ import annotations

import json
import unittest
from pathlib import Path

from campus_ingestion_core.authenticated_notice_notice_family import (
    load_authenticated_notice_notice_family_config,
)
from campus_ingestion_core.authenticated_notice_routing_taxonomy_eval import (
    evaluate_authenticated_notice_routing_taxonomy_jsonl,
    load_authenticated_notice_routing_taxonomy_eval_cases_jsonl,
)


class AuthenticatedNoticeRoutingTaxonomyEvalTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.config = load_authenticated_notice_notice_family_config(
            Path(
                "configs/ingestion/campus_notices/internal_notice/notice-family-classification.v1.json"
            )
        )

    def test_loads_jsonl_eval_cases(self) -> None:
        cases = load_authenticated_notice_routing_taxonomy_eval_cases_jsonl(
            "\n".join(
                (
                    "",
                    json.dumps(
                        {
                            "case_id": "course-selection",
                            "notice_id": "354192",
                            "title": "关于2025-2026学年第二学期本科生网上选课的通知",
                            "notice_type_name": "教学通知",
                            "expected_notice_family": "course_teaching_arrangement",
                            "expected_consumption_route": "notice_level_query",
                            "expected_machine_processing_policy": "not_required",
                            "expected_attachment_processing_policy": "not_required",
                        },
                        ensure_ascii=False,
                    ),
                )
            )
        )

        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0].case_id, "course-selection")
        self.assertEqual(cases[0].notice_id, "354192")
        self.assertEqual(cases[0].expected_notice_family, "course_teaching_arrangement")
        self.assertEqual(cases[0].expected_attachment_processing_policy, "not_required")

    def test_evaluates_expected_family_route_and_machine_policy(self) -> None:
        report = evaluate_authenticated_notice_routing_taxonomy_jsonl(
            "\n".join(
                (
                    json.dumps(
                        {
                            "case_id": "course-selection",
                            "notice_id": "354192",
                            "title": "关于2025-2026学年第二学期本科生网上选课的通知",
                            "notice_type_name": "教学通知",
                            "expected_notice_family": "course_teaching_arrangement",
                            "expected_consumption_route": "notice_level_query",
                            "expected_machine_processing_policy": "not_required",
                        },
                        ensure_ascii=False,
                    ),
                    json.dumps(
                        {
                            "case_id": "procurement-image",
                            "notice_id": "353466",
                            "title": "家具采购项目比选公告",
                            "body": "附件为报名表和采购材料。",
                            "notice_type_name": "办公通知",
                            "attachment_ref_count": 1,
                            "multimodal_processing_required_count": 1,
                            "expected_notice_family": "procurement_notice",
                            "expected_consumption_route": "notice_level_query",
                            "expected_machine_processing_policy": "skip",
                            "expected_attachment_processing_policy": "metadata_only",
                        },
                        ensure_ascii=False,
                    ),
                    json.dumps(
                        {
                            "case_id": "lecture-image-skip",
                            "notice_id": "355546",
                            "title": "讲座预告丨舞蹈学院名家讲堂",
                            "notice_type_name": "科研通知",
                            "attachment_ref_count": 1,
                            "ocr_required_count": 1,
                            "expected_notice_family": "lecture_publicity",
                            "expected_consumption_route": "notice_level_query",
                            "expected_machine_processing_policy": "skip",
                            "expected_attachment_processing_policy": "metadata_only",
                        },
                        ensure_ascii=False,
                    ),
                )
            ),
            config=self.config,
        )

        self.assertTrue(report.ok)
        self.assertEqual(report.case_count, 3)
        self.assertEqual(report.passed_count, 3)
        self.assertEqual(report.failed_count, 0)
        self.assertEqual(report.accuracy, 1.0)
        self.assertEqual(report.failures, ())
        self.assertEqual(report.predicted_notice_family_counts["procurement_notice"], 1)
        self.assertEqual(report.predicted_machine_processing_policy_counts["skip"], 2)
        self.assertEqual(
            report.predicted_attachment_processing_policy_counts["metadata_only"],
            2,
        )

    def test_notice_level_query_defaults_attachment_expectation_to_metadata_only(
        self,
    ) -> None:
        report = evaluate_authenticated_notice_routing_taxonomy_jsonl(
            json.dumps(
                {
                    "case_id": "exam-arrangement-attachment",
                    "notice_id": "355702",
                    "title": "关于做好2025-2026学年第二学期期末考试工作的通知",
                    "body": "正文已经覆盖期末考试时间、工作安排和命题要求。",
                    "notice_type_name": "教学通知",
                    "attachment_ref_count": 3,
                    "expected_notice_family": "academic_course_exam_operation",
                    "expected_consumption_route": "notice_level_query",
                    "expected_machine_processing_policy": "not_required",
                },
                ensure_ascii=False,
            ),
            config=self.config,
        )

        self.assertTrue(report.ok)
        self.assertEqual(
            report.expected_attachment_processing_policy_counts["metadata_only"],
            1,
        )
        self.assertEqual(
            report.predicted_attachment_processing_policy_counts["metadata_only"],
            1,
        )

    def test_reports_mismatch_details(self) -> None:
        report = evaluate_authenticated_notice_routing_taxonomy_jsonl(
            json.dumps(
                {
                    "case_id": "wrong-family",
                    "notice_id": "355546",
                    "title": "讲座预告丨舞蹈学院名家讲堂",
                    "notice_type_name": "科研通知",
                    "expected_notice_family": "course_teaching_arrangement",
                    "expected_consumption_route": "no_adoption",
                    "expected_machine_processing_policy": "not_required",
                    "expected_attachment_processing_policy": "process",
                },
                ensure_ascii=False,
            ),
            config=self.config,
        )

        self.assertFalse(report.ok)
        self.assertEqual(report.case_count, 1)
        self.assertEqual(report.passed_count, 0)
        self.assertEqual(report.failed_count, 1)
        self.assertEqual(report.accuracy, 0.0)
        self.assertEqual(report.failures[0].case_id, "wrong-family")
        self.assertEqual(
            report.failures[0].mismatches["notice_family"]["actual"],
            "lecture_publicity",
        )
        self.assertEqual(
            report.failures[0].mismatches["suggested_consumption_route"]["expected"],
            "no_adoption",
        )
        self.assertEqual(
            report.failures[0].mismatches["machine_processing_policy"]["actual"],
            "skip",
        )
        self.assertEqual(
            report.failures[0].mismatches["attachment_processing_policy"]["actual"],
            "metadata_only",
        )


if __name__ == "__main__":
    unittest.main()
