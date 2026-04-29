from __future__ import annotations

import unittest
from dataclasses import replace

from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionManifestReport,
)
from campus_ingestion_core.internal_notice_selected_regulation_audit import (
    build_internal_notice_selected_regulation_cohort_audit,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_DEFAULT_AGENT_NOTICE,
    NOTICE_DEFAULT_AGENT_RAG,
    NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
    NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
    NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
    NOTICE_SEMANTIC_OWNER_AUTHORITY_PENDING,
    NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
    NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_SCOPED_RULES,
    InMemoryNoticeConsumptionProjectionStore,
    NoticeConsumptionProjectionEntry,
)

from tests.ingestion.internal_notice_consumption_projection_test_support import (
    _inventory_entry,
    _machine_processing_report,
)
from tests.ingestion.internal_notice_regulation_promotion_test_support import (
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)


class InternalNoticeSelectedRegulationCohortAuditTest(unittest.TestCase):
    def test_audit_classifies_importable_held_and_owner_recovery_rows(self) -> None:
        projection_store = InMemoryNoticeConsumptionProjectionStore(
            (
                _entry(
                    notice_id="300001",
                    title="中央民族大学实验室安全管理规定",
                    primary_role=NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
                    target_surface=NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
                ),
                _entry(
                    notice_id="300002",
                    title="新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则",
                    primary_role=NOTICE_PRIMARY_ROLE_ANNUAL_CYCLE_RULE,
                    target_surface=NOTICE_TARGET_SURFACE_SCOPED_RULES,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
                ),
                _entry(
                    notice_id="300003",
                    title="关于修订《中央民族大学采购工作管理办法》的通知",
                    role_metadata={
                        "notice_title": "关于修订《中央民族大学采购工作管理办法》的通知"
                    },
                ),
                _entry(
                    notice_id="300004",
                    title="关于发布《中央民族大学关于学生使用人工智能的指导意见》的通知",
                    primary_role=NOTICE_PRIMARY_ROLE_ATTACHMENT_RULE_BODY,
                    target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
                    semantic_owner=NOTICE_SEMANTIC_OWNER_AUTHORITY_PENDING,
                    role_metadata={
                        "title": "关于发布《中央民族大学关于学生使用人工智能的指导意见》的通知",
                        "owner_source_missing_reason": "attachment_backed_regulation_body_missing",
                    },
                ),
            )
        )
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        inventory_store.upsert_many(
            (
                _inventory("300001", "中央民族大学实验室安全管理规定"),
                _inventory("300002", "新闻与传播学院推荐2026届本科生免试攻读研究生工作实施细则"),
                _inventory("300003", "关于修订《中央民族大学采购工作管理办法》的通知"),
                _inventory(
                    "300004", "关于发布《中央民族大学关于学生使用人工智能的指导意见》的通知"
                ),
            )
        )
        promotion_report = _manifest(
            (
                replace(
                    _machine_processing_report(
                        document_id="notice:muc_internal_portal:300003",
                        notice_id="300003",
                        document_nature="wrapper_notice",
                        reasons=("parent_notice_body_not_full_regulation_text",),
                        source_title="关于修订《中央民族大学采购工作管理办法》的通知",
                    ),
                    action="hold_in_internal_notice",
                    promotion_class="wrapper_notice_only",
                ),
            )
        )

        report = build_internal_notice_selected_regulation_cohort_audit(
            projection_store=projection_store,
            source_truth_inventory_store=inventory_store,
            promotion_report=promotion_report,
            notice_ids=("300001", "300002", "300003", "300004", "300005"),
        )

        rows_by_notice = {row.notice_id: row for row in report.rows}
        self.assertEqual(
            report.requested_notice_ids,
            ("300001", "300002", "300003", "300004", "300005"),
        )
        self.assertEqual(report.missing_projection_notice_ids, ("300005",))
        self.assertEqual(rows_by_notice["300001"].classification, "full_text_candidate")
        self.assertTrue(rows_by_notice["300001"].import_eligible)
        self.assertEqual(rows_by_notice["300002"].classification, "scoped_rule_candidate")
        self.assertTrue(rows_by_notice["300002"].import_eligible)
        self.assertEqual(rows_by_notice["300003"].classification, "amendment_summary_only")
        self.assertFalse(rows_by_notice["300003"].import_eligible)
        self.assertEqual(
            rows_by_notice["300003"].stable_reason,
            "parent_notice_body_not_full_regulation_text",
        )
        self.assertEqual(rows_by_notice["300004"].classification, "attachment_owner_candidate")
        self.assertEqual(
            rows_by_notice["300004"].stable_reason,
            "attachment_backed_regulation_body_missing",
        )
        self.assertEqual(report.selected_import_notice_ids, ("300001", "300002"))
        self.assertEqual(report.held_notice_ids, ("300003", "300004"))
        self.assertNotIn("review_later", report.classification_counts)
        self.assertNotIn("manual_review_required", report.classification_counts)


def _entry(
    *,
    notice_id: str,
    title: str,
    primary_role: str = NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
    target_surface: str = NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    consumption_status: str = NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    semantic_owner: str = NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
    role_metadata: dict[str, object] | None = None,
) -> NoticeConsumptionProjectionEntry:
    return NoticeConsumptionProjectionEntry(
        source_family="internal_notice_restricted",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id=notice_id,
        unit_id=f"notice_unit:muc_internal_portal:{notice_id}:{primary_role}",
        primary_role=primary_role,
        semantic_owner=semantic_owner,
        default_agent=(
            NOTICE_DEFAULT_AGENT_RAG
            if consumption_status == NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
            else NOTICE_DEFAULT_AGENT_NOTICE
        ),
        target_surface=target_surface,
        temporal_policy="standing_until_replaced",
        completeness_status="complete",
        answerability="answerable",
        consumption_status=consumption_status,
        source_notice_document_id=f"notice:muc_internal_portal:{notice_id}",
        source_document_id=f"notice:muc_internal_portal:{notice_id}",
        role_metadata=role_metadata or {"title": title, "notice_title": title},
    )


def _inventory(notice_id: str, title: str):
    entry = _inventory_entry(notice_id=notice_id, notice_title=title)
    snapshot = dict(entry.parent_snapshot)
    snapshot["notice_browser_url"] = f"https://portal.example.edu/notices/{notice_id}"
    return replace(entry, parent_snapshot=snapshot)


def _manifest(documents):
    return InternalNoticeRegulationPromotionManifestReport(
        corpus="campus_notices",
        collection="internal_notice",
        target_corpus="regulations",
        target_collection="institutional_rules",
        target_serving_stage="candidate",
        registry_record_count=len(documents),
        selected_record_count=len(documents),
        selected_notice_ids=tuple(sorted({document.notice_id for document in documents})),
        selected_document_ids=(),
        scanned_document_count=len(documents),
        candidate_count=0,
        hold_count=len(documents),
        machine_processing_required_count=0,
        promotion_class_counts={},
        action_counts={},
        lane_counts={},
        documents=tuple(documents),
    )


if __name__ == "__main__":
    unittest.main()
