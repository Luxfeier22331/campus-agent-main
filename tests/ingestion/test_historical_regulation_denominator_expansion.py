from __future__ import annotations

import unittest

from campus_ingestion_core.historical_regulation_denominator_expansion import (
    build_historical_regulation_denominator_expansion_audit,
)


class HistoricalRegulationDenominatorExpansionTests(unittest.TestCase):
    def test_classifies_run14_body_text_survivors_without_opening_release_lane(self) -> None:
        audit = build_historical_regulation_denominator_expansion_audit(
            batch_config=_run14_batch_config(),
            cohort_manifest=_run14_cohort_manifest(),
            wrapper_follow_up_manifest=_wrapper_follow_up_manifest(),
            completed_v9_admission_manifest={"entries": [{"source_notice_id": "477"}]},
            generated_at="2026-05-02T00:00:00+00:00",
        )

        by_notice = {row["source_notice_id"]: row for row in audit["records"]}

        self.assertEqual(audit["schema_version"], "historical_regulation_denominator_expansion.v1")
        self.assertEqual(audit["batch_id"], "run14-policy-regulation-expanded-v1")
        self.assertEqual(audit["input_notice_count"], 16)
        self.assertEqual(audit["status_counts"]["ready_for_canonical_chunk_v9"], 9)
        self.assertEqual(audit["status_counts"]["duplicate_hold"], 1)
        self.assertEqual(audit["status_counts"]["needs_owner_text_recovery"], 4)
        self.assertEqual(audit["status_counts"]["excluded_by_operator_policy"], 1)
        self.assertEqual(audit["status_counts"]["defer_wrapper_summary_backlog"], 1)

        ready_ids = audit["ready_notice_ids"]
        self.assertEqual(
            ready_ids,
            [
                "354006",
                "353963",
                "351907",
                "196411",
                "191705",
                "191176",
                "187004",
                "186977",
                "186957",
            ],
        )
        self.assertEqual(
            audit["target_collection_counts"],
            {"institutional_rules": 1, "scoped_rules": 8},
        )
        self.assertEqual(
            audit["downstream_eligible_notice_ids"],
            ["191705"],
        )
        self.assertEqual(
            audit["policy"]["downstream_consumption_eligible_collections"],
            ["institutional_rules"],
        )
        self.assertEqual(by_notice["354006"]["target_collection"], "scoped_rules")
        self.assertEqual(
            by_notice["354006"]["downstream_consumption_status"], "chunk_only_non_serving"
        )
        self.assertFalse(by_notice["354006"]["document_site_eligible"])
        self.assertFalse(by_notice["354006"]["rag_consumption_eligible"])
        self.assertEqual(by_notice["191705"]["target_collection"], "institutional_rules")
        self.assertEqual(
            by_notice["191705"]["title"],
            "中央民族大学丰台校区就医管理办法（暂行）",
        )
        self.assertEqual(
            by_notice["191705"]["downstream_consumption_status"], "eligible_after_release_gate"
        )
        self.assertTrue(by_notice["191705"]["document_site_eligible"])
        self.assertTrue(by_notice["191705"]["rag_consumption_eligible"])
        self.assertEqual(by_notice["187233"]["status"], "needs_owner_text_recovery")
        self.assertIn("body_text_not_complete_owner_policy", by_notice["187233"]["reason_codes"])
        self.assertEqual(by_notice["191176"]["status"], "ready_for_canonical_chunk_v9")
        self.assertEqual(by_notice["191177"]["status"], "duplicate_hold")
        self.assertEqual(by_notice["191177"]["duplicate_survivor_notice_id"], "191176")
        self.assertEqual(by_notice["355282"]["status"], "needs_owner_text_recovery")
        self.assertEqual(by_notice["351119"]["status"], "excluded_by_operator_policy")
        self.assertEqual(by_notice["177880"]["status"], "defer_wrapper_summary_backlog")
        self.assertFalse(audit["serving_closed_assertion"]["embedding_opened"])
        self.assertFalse(audit["serving_closed_assertion"]["alias_publish_opened"])

    def test_rejects_wrapper_notice_from_ready_candidates_even_when_in_body_cohort(self) -> None:
        batch_config = _run14_batch_config()
        cohort_manifest = _run14_cohort_manifest()
        cohort_manifest["cohorts"]["A"]["notice_ids"].append("355282")

        audit = build_historical_regulation_denominator_expansion_audit(
            batch_config=batch_config,
            cohort_manifest=cohort_manifest,
            wrapper_follow_up_manifest=_wrapper_follow_up_manifest(),
            generated_at="2026-05-02T00:00:00+00:00",
        )

        by_notice = {row["source_notice_id"]: row for row in audit["records"]}
        self.assertEqual(by_notice["355282"]["status"], "needs_owner_text_recovery")
        self.assertIn("wrapper_not_owner_text", by_notice["355282"]["reason_codes"])


def _run14_batch_config() -> dict[str, object]:
    notices = [
        (
            "355282",
            "关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知",
            "wrapper_notice_likely_external_canonical_text",
        ),
        (
            "354006",
            "中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则",
            "body_contains_substantial_policy_text",
        ),
        (
            "353963",
            "中央民族大学新闻与传播学院 2026年“英才计划”硕博连读研究生招生实施细则",
            "body_is_policy_text",
        ),
        (
            "351907",
            "新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则",
            "body_is_policy_text",
        ),
        (
            "351704",
            "关于发布《中央民族大学新一轮本科教育教学审核评估应知应会手册》的通知",
            "wrapper_notice_likely_external_canonical_text",
        ),
        (
            "351699",
            "关于发布《中央民族大学新一轮本科教育教学审核评估应知应会手册》的通知",
            "wrapper_notice_likely_external_canonical_text",
        ),
        (
            "351119",
            "关于《<中央民族大学差旅费管理办法>（民大校发〔2025〕104号）》发布实施的通知",
            "wrapper_notice_likely_external_canonical_text",
        ),
        (
            "196411",
            "中央民族大学民族学与社会学学院2022年硕博连读博士研究生招生实施细则",
            "body_contains_substantial_policy_text",
        ),
        (
            "191705",
            "重要通知--中央民族大学丰台校区就医管理办法（暂行）",
            "body_contains_substantial_policy_text",
        ),
        (
            "191177",
            "生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
            "body_contains_substantial_policy_text",
        ),
        (
            "191176",
            "生命与环境科学学院关于2021年暑假期间实验室安全管理规定",
            "body_contains_substantial_policy_text",
        ),
        (
            "187233",
            "关于修订《中央民族大学采购工作管理办法》的通知",
            "body_contains_substantial_policy_text",
        ),
        ("187004", "历史文化学院2021年硕博连读博士研究生 招生实施细则", "body_is_policy_text"),
        (
            "186977",
            "药学院2021年硕博连读博士研究生招生实施细则",
            "body_contains_substantial_policy_text",
        ),
        (
            "186957",
            "中央民族大学民族学与社会学学院2021年硕博连读博士研究生招生实施细则",
            "body_contains_substantial_policy_text",
        ),
        (
            "177880",
            "关于印发实施《中央民族大学学生申诉管理办法》的通知",
            "wrapper_or_summary_notice",
        ),
    ]
    return {
        "batch_id": "run14-policy-regulation-expanded-v1",
        "notices": [
            {
                "notice_id": notice_id,
                "notice_title": title,
                "decision": "include",
                "source_shape": source_shape,
            }
            for notice_id, title, source_shape in notices
        ],
    }


def _run14_cohort_manifest() -> dict[str, object]:
    return {
        "batch_id": "run14-policy-regulation-expanded-v1",
        "cohorts": {
            "A": {
                "notice_ids": [
                    "354006",
                    "353963",
                    "351907",
                    "196411",
                    "191705",
                    "191177",
                    "191176",
                    "187233",
                    "187004",
                    "186977",
                    "186957",
                ]
            },
            "B": {"notice_ids": ["355282", "351704", "351699", "351119"]},
            "C": {"notice_ids": ["177880"]},
        },
    }


def _wrapper_follow_up_manifest() -> dict[str, object]:
    return {
        "wrapper_notice_ids": ["355282", "351704", "351699", "351119", "177880"],
        "exclusion_rule": "wrapper_notices_do_not_enter_cohort_a_body_text_baseline",
    }


if __name__ == "__main__":
    unittest.main()
