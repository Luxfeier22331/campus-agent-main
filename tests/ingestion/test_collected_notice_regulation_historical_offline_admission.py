from __future__ import annotations

import unittest

from campus_ingestion_core.collected_notice_regulation_historical_offline_admission import (
    build_historical_offline_regulation_admission,
)


class CollectedNoticeRegulationHistoricalOfflineAdmissionTests(unittest.TestCase):
    def test_converts_ready_manual_and_historical_hold_entries_for_chunk_only_backfill(
        self,
    ) -> None:
        admission_manifest = {
            "entries": [
                {
                    "source_notice_id": "477",
                    "source_surface": "file_release",
                    "source_document_id": "file-release:muc_internal_portal:477",
                    "searchable_unit_id": "searchable:file_release:muc_internal_portal:477",
                    "title": "中央民族大学本科毕业论文（设计）工作管理办法",
                    "regulation_title_normalized": "中央民族大学本科毕业论文（设计）工作管理办法",
                    "issuing_org": "中央民族大学",
                    "regulation_admission_class": "historical_time_window_rule_hold",
                    "consumption_class": "search_only",
                    "target_collection": "scoped_rules",
                    "owner_text_status": "ready",
                    "owner_text_recovery": {"written_refs": {"plain_text": {"key": "x"}}},
                    "reason_codes": ["historical_time_window_rule_not_promoted"],
                    "source_object_refs": [{"bucket": "source", "key": "raw.pdf"}],
                },
                {
                    "source_notice_id": "551",
                    "source_surface": "file_release",
                    "source_document_id": "file-release:muc_internal_portal:551",
                    "searchable_unit_id": "searchable:file_release:muc_internal_portal:551",
                    "title": "中央民族大学本科教学质量监控管理办法",
                    "regulation_title_normalized": "中央民族大学本科教学质量监控管理办法",
                    "issuing_org": "中央民族大学",
                    "regulation_admission_class": "manual_review",
                    "consumption_class": "defer",
                    "target_collection": None,
                    "owner_text_status": "ready",
                    "owner_text_recovery": {"written_refs": {"plain_text": {"key": "y"}}},
                    "reason_codes": ["regulation_candidate_requires_manual_review"],
                    "source_object_refs": [{"bucket": "source", "key": "raw-2.pdf"}],
                },
            ]
        }
        candidate_audit = {
            "candidates": [
                {
                    "source_notice_id": "477",
                    "target_collection": "institutional_rules",
                    "regulation_admission_class": "needs_multimodal",
                },
                {
                    "source_notice_id": "551",
                    "target_collection": "institutional_rules",
                    "regulation_admission_class": "needs_multimodal",
                },
            ]
        }

        result = build_historical_offline_regulation_admission(
            admission_manifest=admission_manifest,
            candidate_audit=candidate_audit,
            target_collection_overrides={"477": "institutional_rules"},
            generated_at="2026-05-02T00:00:00Z",
        )

        entries = result["admission_manifest"]["entries"]
        self.assertEqual(result["admission_manifest"]["counts"]["downstream_admitted"], 2)
        self.assertEqual(
            [entry["consumption_class"] for entry in entries],
            ["downstream_admitted", "downstream_admitted"],
        )
        self.assertEqual(
            [entry["regulation_admission_class"] for entry in entries],
            ["institutional_rules_candidate", "institutional_rules_candidate"],
        )
        self.assertEqual(
            [entry["target_collection"] for entry in entries],
            ["institutional_rules", "institutional_rules"],
        )
        self.assertTrue(all(entry["target"] == "regulation" for entry in entries))
        self.assertTrue(
            all(
                "historical_offline_chunk_only_backfill" in entry["reason_codes"]
                for entry in entries
            )
        )
        self.assertEqual(result["candidate_audit"]["candidate_count"], 2)
        self.assertEqual(result["resolution_report"]["converted_count"], 2)
        self.assertFalse(result["serving_closed_assertion"]["rag_release_opened"])

    def test_requires_ready_owner_text_before_offline_conversion(self) -> None:
        with self.assertRaisesRegex(ValueError, "owner_text_status=ready"):
            build_historical_offline_regulation_admission(
                admission_manifest={
                    "entries": [
                        {
                            "source_notice_id": "477",
                            "title": "中央民族大学本科毕业论文（设计）工作管理办法",
                            "regulation_admission_class": "manual_review",
                            "owner_text_status": "not_ready",
                        }
                    ]
                },
                candidate_audit={"candidates": []},
                target_collection_overrides={"477": "institutional_rules"},
            )


if __name__ == "__main__":
    unittest.main()
