from __future__ import annotations

import unittest

from campus_ingestion_core.historical_regulation_school_level_owner_recovery import (
    build_historical_regulation_school_level_owner_recovery_audit,
)


class HistoricalRegulationSchoolLevelOwnerRecoveryTests(unittest.TestCase):
    def test_blocks_school_level_recovery_targets_without_owner_sources(self) -> None:
        audit = build_historical_regulation_school_level_owner_recovery_audit(
            school_level_inventory=_phase05_inventory(),
            collected_bundle=_collected_bundle_without_owner_sources(),
            generated_at="2026-05-03T00:00:00+00:00",
        )

        by_notice = {record["source_notice_id"]: record for record in audit["records"]}

        self.assertEqual(
            audit["schema_version"],
            "historical_regulation_school_level_owner_recovery.v1",
        )
        self.assertEqual(audit["target_notice_ids"], ["355282", "187233", "177880"])
        self.assertEqual(audit["source_candidate_notice_ids"], [])
        self.assertEqual(audit["blocked_notice_ids"], ["355282", "187233", "177880"])
        self.assertEqual(
            audit["status_counts"],
            {
                "blocked_incomplete_owner_text": 1,
                "blocked_no_owner_source": 2,
            },
        )
        self.assertEqual(audit["source_candidate_count"], 0)
        self.assertEqual(audit["blocked_count"], 3)
        self.assertEqual(audit["canonical_chunk_ready_notice_ids"], [])
        self.assertEqual(audit["policy"]["stop_point"], "owner_text_source_readiness_only")
        self.assertFalse(audit["serving_closed_assertion"]["embedding_opened"])
        self.assertFalse(audit["candidate_store_noop_assertion"]["candidate_enqueue_opened"])

        self.assertEqual(by_notice["355282"]["status"], "blocked_no_owner_source")
        self.assertEqual(by_notice["355282"]["target_collection"], "institutional_rules")
        self.assertEqual(by_notice["355282"]["owner_source_candidate_count"], 0)
        self.assertIn("no_captured_attachment_or_link", by_notice["355282"]["reason_codes"])

        self.assertEqual(by_notice["187233"]["status"], "blocked_incomplete_owner_text")
        self.assertEqual(by_notice["187233"]["target_collection"], "institutional_rules")
        self.assertIn("body_text_not_complete_owner_policy", by_notice["187233"]["reason_codes"])

        self.assertEqual(by_notice["177880"]["status"], "blocked_no_owner_source")
        self.assertFalse(by_notice["177880"]["document_site_eligible"])
        self.assertFalse(by_notice["177880"]["rag_consumption_eligible"])

    def test_reports_source_candidate_without_opening_canonical_chunk(self) -> None:
        audit = build_historical_regulation_school_level_owner_recovery_audit(
            school_level_inventory={
                "records": [
                    {
                        "source_notice_id": "wrapper",
                        "title": "关于发布《中央民族大学示例管理办法》的通知",
                        "effective_regulation_title": "中央民族大学示例管理办法",
                        "status": "wrapper_needs_owner_text_recovery",
                        "target_collection": "institutional_rules",
                        "target_surface": "regulations/institutional_rules",
                        "object_storage_prefix": (
                            "regulations/documents/institutional_rules/"
                            "中央民族大学示例管理办法--00000000/current-effective/undated/"
                        ),
                        "reason_codes": ["wrapper_not_owner_text"],
                    }
                ]
            },
            collected_bundle=[
                {
                    "notice_id": "wrapper",
                    "notice": {
                        "notice_id": "wrapper",
                        "notice_title": "关于发布《中央民族大学示例管理办法》的通知",
                        "notice_content": "附件：中央民族大学示例管理办法",
                    },
                    "links": [{"href": "https://example.test/rule.pdf", "text": "办法全文"}],
                    "notice_attachments": [],
                    "attachments": [],
                }
            ],
            generated_at="2026-05-03T00:00:00+00:00",
        )

        self.assertEqual(audit["source_candidate_notice_ids"], ["wrapper"])
        self.assertEqual(audit["canonical_chunk_ready_notice_ids"], [])
        self.assertEqual(audit["records"][0]["status"], "owner_source_candidate_found")
        self.assertFalse(audit["records"][0]["document_site_eligible"])
        self.assertFalse(audit["records"][0]["rag_consumption_eligible"])


def _phase05_inventory() -> dict[str, object]:
    return {
        "records": [
            _inventory_record(
                notice_id="355282",
                title="关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知",
                effective_title="中央民族大学关于学生使用人工智能的指导意见（2026版）",
                status="wrapper_summary_backlog",
                reason_codes=["wrapper_summary_not_owner_text"],
            ),
            _inventory_record(
                notice_id="187233",
                title="关于修订《中央民族大学采购工作管理办法》的通知",
                effective_title="中央民族大学采购工作管理办法",
                status="wrapper_needs_owner_text_recovery",
                reason_codes=["body_text_not_complete_owner_policy"],
            ),
            _inventory_record(
                notice_id="177880",
                title="关于印发实施《中央民族大学学生申诉管理办法》的通知",
                effective_title="中央民族大学学生申诉管理办法",
                status="wrapper_summary_backlog",
                reason_codes=["wrapper_summary_not_owner_text"],
            ),
            _inventory_record(
                notice_id="191705",
                title="重要通知--中央民族大学丰台校区就医管理办法（暂行）",
                effective_title="中央民族大学丰台校区就医管理办法（暂行）",
                status="school_level_ready_for_canonical_chunk",
                reason_codes=["school_level_regulation_candidate"],
            ),
        ]
    }


def _inventory_record(
    *,
    notice_id: str,
    title: str,
    effective_title: str,
    status: str,
    reason_codes: list[str],
) -> dict[str, object]:
    return {
        "source_notice_id": notice_id,
        "title": title,
        "effective_regulation_title": effective_title,
        "status": status,
        "target_collection": "institutional_rules",
        "target_surface": "regulations/institutional_rules",
        "object_storage_prefix": (
            "regulations/documents/institutional_rules/"
            f"{effective_title}--00000000/current-effective/undated/"
        ),
        "reason_codes": reason_codes,
    }


def _collected_bundle_without_owner_sources() -> list[dict[str, object]]:
    return [
        _bundle_record(
            notice_id="355282",
            title="关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知",
            content="附件：中央民族大学关于学生使用人工智能的指导意见（2026版）",
        ),
        _bundle_record(
            notice_id="187233",
            title="关于修订《中央民族大学采购工作管理办法》的通知",
            content="第一条 这是采购注意事项，不是完整采购工作管理办法正文。",
        ),
        _bundle_record(
            notice_id="177880",
            title="关于印发实施《中央民族大学学生申诉管理办法》的通知",
            content="特此通知，请遵照执行。",
        ),
    ]


def _bundle_record(*, notice_id: str, title: str, content: str) -> dict[str, object]:
    return {
        "notice_id": notice_id,
        "notice": {
            "notice_id": notice_id,
            "notice_title": title,
            "notice_content": content,
        },
        "links": [],
        "notice_attachments": [],
        "attachments": [],
    }


if __name__ == "__main__":
    unittest.main()
