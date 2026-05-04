from __future__ import annotations

import unittest

from scripts.official_web_service_guide_isolated_publish_proof import (
    build_isolated_derived_bucket_name,
    compare_publish_results_to_preview,
)


class OfficialWebServiceGuideIsolatedPublishProofTest(unittest.TestCase):
    def test_build_isolated_derived_bucket_name_is_s3_safe(self) -> None:
        name = build_isolated_derived_bucket_name("Campus Agent Proof Bucket")

        self.assertEqual(name, name.lower())
        self.assertLessEqual(len(name), 63)
        self.assertNotIn("_", name)
        self.assertTrue(name.startswith("campus-rag-derived-proof-"))

    def test_compare_publish_results_to_preview_matches_service_guide_records(self) -> None:
        preview_report = {
            "results": [
                {
                    "selected_write_id": "sw_service_1",
                    "collection": "service_guide",
                    "record_count": 1,
                    "full_record_count": 5,
                    "task_scope_display_names": ["中央民族大学信息公开依申请公开工作流程"],
                    "full_impact_display_names": [
                        "中央民族大学信息公开依申请公开工作流程",
                        "中央民族大学 VPN 使用说明",
                    ],
                },
                {
                    "selected_write_id": "sw_contact_1",
                    "collection": "contact_directory",
                    "record_count": 1,
                    "full_record_count": 2,
                    "task_scope_display_names": ["中央民族大学信息公开联系方式"],
                    "full_impact_display_names": ["中央民族大学信息公开联系方式"],
                },
            ]
        }
        publish_results = [
            {
                "selected_write_id": "sw_service_1",
                "record_count": 1,
                "full_record_count": 5,
                "task_scope_display_names": ["中央民族大学信息公开依申请公开工作流程"],
                "full_impact_display_names": [
                    "中央民族大学信息公开依申请公开工作流程",
                    "中央民族大学 VPN 使用说明",
                ],
            }
        ]

        comparison = compare_publish_results_to_preview(
            preview_report=preview_report,
            publish_results=publish_results,
        )

        self.assertTrue(comparison["passed"])
        self.assertEqual(comparison["service_guide_task_count"], 1)
        self.assertEqual(comparison["mismatches"], [])

    def test_compare_publish_results_to_preview_reports_count_mismatch(self) -> None:
        preview_report = {
            "results": [
                {
                    "selected_write_id": "sw_service_1",
                    "collection": "service_guide",
                    "record_count": 1,
                    "full_record_count": 5,
                    "task_scope_display_names": ["中央民族大学信息公开依申请公开工作流程"],
                    "full_impact_display_names": ["中央民族大学信息公开依申请公开工作流程"],
                }
            ]
        }
        publish_results = [
            {
                "selected_write_id": "sw_service_1",
                "record_count": 2,
                "full_record_count": 5,
                "task_scope_display_names": ["中央民族大学信息公开依申请公开工作流程"],
                "full_impact_display_names": ["中央民族大学信息公开依申请公开工作流程"],
            }
        ]

        comparison = compare_publish_results_to_preview(
            preview_report=preview_report,
            publish_results=publish_results,
        )

        self.assertFalse(comparison["passed"])
        self.assertEqual(comparison["mismatches"][0]["field"], "record_count")


if __name__ == "__main__":
    unittest.main()
