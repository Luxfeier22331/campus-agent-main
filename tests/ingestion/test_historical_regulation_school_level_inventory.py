from __future__ import annotations

import unittest

from campus_ingestion_core.historical_regulation_school_level_inventory import (
    build_historical_regulation_school_level_inventory,
)


class HistoricalRegulationSchoolLevelInventoryTests(unittest.TestCase):
    def test_buckets_collected_regulation_like_notices_by_school_level_policy(self) -> None:
        inventory = build_historical_regulation_school_level_inventory(
            collected_bundle=_collected_bundle(),
            completed_manifest={"entries": [{"source_notice_id": "done"}]},
            generated_at="2026-05-02T00:00:00+00:00",
        )

        by_notice = {record["source_notice_id"]: record for record in inventory["records"]}

        self.assertEqual(
            inventory["schema_version"],
            "historical_regulation_school_level_inventory.v1",
        )
        self.assertEqual(inventory["input_notice_count"], 6)
        self.assertEqual(
            inventory["status_counts"],
            {
                "already_completed_hold": 1,
                "duplicate_hold": 1,
                "school_level_ready_for_canonical_chunk": 1,
                "scoped_rule_chunk_only_non_serving": 1,
                "wrapper_needs_owner_text_recovery": 1,
                "wrapper_summary_backlog": 1,
            },
        )
        self.assertEqual(inventory["school_level_ready_notice_ids"], ["school"])
        self.assertEqual(inventory["canonical_chunk_candidate_notice_ids"], ["school", "scoped"])
        self.assertEqual(inventory["downstream_eligible_notice_ids"], ["school"])
        self.assertEqual(inventory["non_serving_notice_ids"], ["scoped"])
        self.assertEqual(inventory["recovery_notice_ids"], ["wrapper", "summary"])
        self.assertEqual(inventory["hold_notice_ids"], ["duplicate", "done"])
        self.assertEqual(
            inventory["policy"]["scope_baseline"],
            "only_school_level_regulations_enter_document_site_or_rag_consumption",
        )
        self.assertEqual(
            inventory["policy"]["stop_point"],
            "canonical_document_units_chunk_quality_only",
        )
        self.assertFalse(inventory["serving_closed_assertion"]["embedding_opened"])
        self.assertFalse(inventory["candidate_store_noop_assertion"]["candidate_enqueue_opened"])

        self.assertEqual(by_notice["school"]["target_collection"], "institutional_rules")
        self.assertTrue(by_notice["school"]["document_site_eligible"])
        self.assertTrue(by_notice["school"]["rag_consumption_eligible"])
        self.assertEqual(
            by_notice["school"]["object_storage_prefix"],
            (
                "regulations/documents/institutional_rules/"
                "中央民族大学学生申诉管理办法--d6ce69f5/current-effective/undated/"
            ),
        )

        self.assertEqual(by_notice["scoped"]["target_collection"], "scoped_rules")
        self.assertFalse(by_notice["scoped"]["document_site_eligible"])
        self.assertFalse(by_notice["scoped"]["rag_consumption_eligible"])
        self.assertEqual(
            by_notice["scoped"]["downstream_consumption_status"],
            "chunk_only_non_serving",
        )

        self.assertEqual(by_notice["wrapper"]["status"], "wrapper_needs_owner_text_recovery")
        self.assertIn("wrapper_not_owner_text", by_notice["wrapper"]["reason_codes"])
        self.assertEqual(by_notice["duplicate"]["status"], "duplicate_hold")
        self.assertEqual(by_notice["duplicate"]["duplicate_survivor_notice_id"], "school")
        self.assertEqual(by_notice["done"]["status"], "already_completed_hold")

    def test_preserves_run14_manual_holds_and_school_level_overrides(self) -> None:
        inventory = build_historical_regulation_school_level_inventory(
            collected_bundle=[
                _notice(
                    notice_id="191705",
                    title="重要通知--中央民族大学丰台校区就医管理办法（暂行）",
                    organization="校医院（疾病防控办公室）",
                    content="第一条 为规范丰台校区就医管理，制定本办法。",
                ),
                _notice(
                    notice_id="351119",
                    title="关于《<中央民族大学差旅费管理办法>（民大校发〔2025〕104号）》发布实施的通知",
                    organization="财务处",
                    content="第一条 为规范差旅费管理，制定本办法。",
                ),
                _notice(
                    notice_id="187233",
                    title="关于修订《中央民族大学采购工作管理办法》的通知",
                    organization="资产管理处（实验室建设管理中心、招标采购中心）",
                    content="第一条 为规范采购工作，制定本办法。",
                ),
                _notice(
                    notice_id="191177",
                    title="生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
                    organization="生命与环境科学学院",
                    content="第一条 为规范暑假期间实验室安全管理，制定本规定。",
                ),
                _notice(
                    notice_id="191176",
                    title="生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
                    organization="生命与环境科学学院",
                    content="第一条 为规范暑假期间实验室安全管理，制定本规定。",
                ),
            ],
            generated_at="2026-05-02T00:00:00+00:00",
        )

        by_notice = {record["source_notice_id"]: record for record in inventory["records"]}

        self.assertEqual(by_notice["191705"]["status"], "school_level_ready_for_canonical_chunk")
        self.assertEqual(by_notice["191705"]["target_collection"], "institutional_rules")
        self.assertTrue(by_notice["191705"]["document_site_eligible"])
        self.assertEqual(by_notice["351119"]["status"], "operator_excluded_hold")
        self.assertIn("351119", inventory["hold_notice_ids"])
        self.assertIn(
            "operator_excluded_from_owner_recovery",
            by_notice["351119"]["reason_codes"],
        )
        self.assertEqual(by_notice["187233"]["status"], "wrapper_needs_owner_text_recovery")
        self.assertEqual(by_notice["187233"]["target_collection"], "institutional_rules")
        self.assertIn(
            "body_text_not_complete_owner_policy",
            by_notice["187233"]["reason_codes"],
        )
        self.assertEqual(by_notice["191176"]["status"], "scoped_rule_chunk_only_non_serving")
        self.assertEqual(by_notice["191177"]["status"], "duplicate_hold")
        self.assertEqual(by_notice["191177"]["duplicate_survivor_notice_id"], "191176")


def _collected_bundle() -> list[dict[str, object]]:
    return [
        _notice(
            notice_id="school",
            title="中央民族大学学生申诉管理办法",
            organization="学生工作部",
            content="第一章 总则 第一条 为规范学生申诉处理工作，制定本办法。",
        ),
        _notice(
            notice_id="scoped",
            title="历史文化学院2026年硕博连读博士研究生招生实施细则",
            organization="历史文化学院",
            content="第一条 根据学校通知，历史文化学院制定本实施细则。",
        ),
        _notice(
            notice_id="wrapper",
            title="关于发布《中央民族大学采购工作管理办法》的通知",
            organization="采购与招标管理中心",
            content="附件：中央民族大学采购工作管理办法",
        ),
        _notice(
            notice_id="summary",
            title="关于印发实施《中央民族大学学生申诉管理办法》的通知",
            organization="学生工作部",
            content="请各单位遵照执行。",
        ),
        _notice(
            notice_id="duplicate",
            title="中央民族大学学生申诉管理办法",
            organization="学生工作部",
            content="第一章 总则 第一条 为规范学生申诉处理工作，制定本办法。",
        ),
        _notice(
            notice_id="done",
            title="中央民族大学丰台校区就医管理办法（暂行）",
            organization="校医院",
            content="第一条 为规范丰台校区就医管理，制定本办法。",
        ),
    ]


def _notice(
    *,
    notice_id: str,
    title: str,
    organization: str,
    content: str,
) -> dict[str, object]:
    return {
        "notice_id": notice_id,
        "notice": {
            "notice_id": notice_id,
            "notice_title": title,
            "organization_name": organization,
            "notice_content": content,
            "notice_release_time": "2026-01-01 00:00",
        },
        "links": [],
        "attachments": [],
        "notice_attachments": [],
    }


if __name__ == "__main__":
    unittest.main()
