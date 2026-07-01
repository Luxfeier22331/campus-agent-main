from __future__ import annotations

import unittest

from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationPromotionDocumentReport,
)

from .internal_notice_scoped_rule_materialization_test_support import (
    _canonical_markdown,
    _FakeObjectStore,
    _inventory_entry,
    _record,
    scoped_materialization,
)


class InternalNoticeScopedRuleMaterializationCandidateTest(unittest.TestCase):
    def test_build_scoped_rule_candidate_prefers_source_title_for_annual_cycle_rule(self) -> None:
        source_record = _record(
            notice_id="187004",
            title_slug="history-rule",
            content_hash="sha256:history-rule",
            body_key="campus_notices/documents/internal_notice/187004/canonical.md",
            units_key="campus_notices/documents/internal_notice/187004/document-units.jsonl",
            is_current=True,
        )
        object_store = _FakeObjectStore(
            objects={
                (
                    "campus-agent-derived",
                    source_record.canonical_markdown_object_key or "",
                ): _canonical_markdown(
                    "# 示例历史学院2021年硕博连读博士研究生 招生实施细则\n\n"
                    "根据教育部有关文件精神及《示例大学2021年硕博连读博士研究生招生工作》要求，"
                    "我院在2021年博士研究生招生中继续实行硕博连读招生。\n"
                ),
            }
        )
        report = InternalNoticeRegulationPromotionDocumentReport(
            document_id=source_record.document_id,
            notice_id="187004",
            site_id="example_internal_portal",
            source_kind="parent_notice",
            source_title="示例历史学院2021年硕博连读博士研究生 招生实施细则",
            input_lane="notice_body",
            revision_track="source-faithful",
            version_id=source_record.version_id,
            action="requires_multimodal_processing",
            promotion_class="scoped_rule",
            document_nature="annual_cycle_rule",
            semantic_owner_kind="notice_body",
            target_corpus="regulations",
            target_collection="scoped_rules",
            regulation_title_normalized="示例大学2021年硕博连读博士研究生招生工作",
            issuing_org="示例大学",
            effective_date="2021年1月8日",
            revision_signal=None,
            source_notice_release_time="2021-01-07 16:30",
            source_parent_document_id=source_record.document_id,
            source_attachment_ref_id=None,
            source_attachment_sha256=None,
            duplicate_group_key=None,
            duplicate_primary_document_id=None,
            quality_gates_passed=("canonical_text_available",),
            missing_required_metadata=(),
            reasons=("annual_cycle_or_program_rule_detected",),
            artifact_key=None,
        )

        candidate = scoped_materialization._build_scoped_rule_candidate(
            report=report,
            source_record=source_record,
            inventory_entry=_inventory_entry(
                notice_id="187004",
                notice_title="示例历史学院2021年硕博连读博士研究生 招生实施细则",
                published_date="2021-01-07 16:30",
            ),
            object_store=object_store,
            bucket_derived="campus-agent-derived",
            document_nature="annual_cycle_rule",
        )

        self.assertEqual(
            candidate.title,
            "示例历史学院2021年硕博连读博士研究生 招生实施细则",
        )
        self.assertEqual(candidate.cycle_year, "2021")
        self.assertEqual(candidate.school_unit_name, "示例历史学院")

    def test_build_scoped_rule_candidate_normalizes_school_unit_name_without_institution_prefix(
        self,
    ) -> None:
        source_record = _record(
            notice_id="186957",
            title_slug="ethnology-rule",
            content_hash="sha256:ethnology-rule",
            body_key="campus_notices/documents/internal_notice/186957/canonical.md",
            units_key="campus_notices/documents/internal_notice/186957/document-units.jsonl",
            is_current=True,
        )
        object_store = _FakeObjectStore(
            objects={
                (
                    "campus-agent-derived",
                    source_record.canonical_markdown_object_key or "",
                ): _canonical_markdown(
                    "# 示例大学示例社会学院2021年硕博连读博士研究生招生实施细则\n\n"
                    "根据教育部有关文件精神，我院开展硕博连读招生。\n"
                ),
            }
        )
        report = InternalNoticeRegulationPromotionDocumentReport(
            document_id=source_record.document_id,
            notice_id="186957",
            site_id="example_internal_portal",
            source_kind="parent_notice",
            source_title="示例大学示例社会学院2021年硕博连读博士研究生招生实施细则",
            input_lane="notice_body",
            revision_track="source-faithful",
            version_id=source_record.version_id,
            action="requires_multimodal_processing",
            promotion_class="scoped_rule",
            document_nature="annual_cycle_rule",
            semantic_owner_kind="notice_body",
            target_corpus="regulations",
            target_collection="scoped_rules",
            regulation_title_normalized="示例大学示例社会学院2021年硕博连读博士研究生招生实施细则",
            issuing_org="示例大学",
            effective_date="2021年1月6日",
            revision_signal=None,
            source_notice_release_time="2021-01-05 14:59",
            source_parent_document_id=source_record.document_id,
            source_attachment_ref_id=None,
            source_attachment_sha256=None,
            duplicate_group_key=None,
            duplicate_primary_document_id=None,
            quality_gates_passed=("canonical_text_available",),
            missing_required_metadata=(),
            reasons=("annual_cycle_or_program_rule_detected",),
            artifact_key=None,
        )

        candidate = scoped_materialization._build_scoped_rule_candidate(
            report=report,
            source_record=source_record,
            inventory_entry=_inventory_entry(
                notice_id="186957",
                notice_title="示例大学示例社会学院2021年硕博连读博士研究生招生实施细则",
                published_date="2021-01-05 14:59",
            ),
            object_store=object_store,
            bucket_derived="campus-agent-derived",
            document_nature="annual_cycle_rule",
        )

        self.assertEqual(candidate.school_unit_name, "示例社会学院")

    def test_school_unit_extraction_accepts_single_character_college_names(self) -> None:
        self.assertEqual(
            scoped_materialization._extract_school_unit_name(
                "甲学院2021年硕博连读博士研究生招生实施细则"
            ),
            "甲学院",
        )
        self.assertEqual(
            scoped_materialization._extract_school_unit_name(
                "示例大学甲学院2021年硕博连读博士研究生招生实施细则"
            ),
            "甲学院",
        )

    def test_build_scoped_rule_candidate_prefers_source_title_for_time_bound_rule(self) -> None:
        source_record = _record(
            notice_id="191705",
            title_slug="fengtai-rule",
            content_hash="sha256:fengtai-rule",
            body_key="campus_notices/documents/internal_notice/191705/canonical.md",
            units_key="campus_notices/documents/internal_notice/191705/document-units.jsonl",
            is_current=True,
        )
        object_store = _FakeObjectStore(
            objects={
                (
                    "campus-agent-derived",
                    source_record.canonical_markdown_object_key or "",
                ): _canonical_markdown(
                    "# 示例大学丰台校区就医管理办法（暂行）\n\n"
                    "校医院正式运营前，由临时医疗点承担校区基础门诊服务。\n"
                ),
            }
        )
        report = InternalNoticeRegulationPromotionDocumentReport(
            document_id=source_record.document_id,
            notice_id="191705",
            site_id="example_internal_portal",
            source_kind="parent_notice",
            source_title="重要通知--示例大学丰台校区就医管理办法（暂行）",
            input_lane="notice_body",
            revision_track="source-faithful",
            version_id=source_record.version_id,
            action="requires_multimodal_processing",
            promotion_class="scoped_rule",
            document_nature="time_bound_operational_rule",
            semantic_owner_kind="notice_body",
            target_corpus="regulations",
            target_collection="scoped_rules",
            regulation_title_normalized="示例大学丰台校区医疗服务说明",
            issuing_org="示例大学",
            effective_date=None,
            revision_signal=None,
            source_notice_release_time="2021-06-30 10:00",
            source_parent_document_id=source_record.document_id,
            source_attachment_ref_id=None,
            source_attachment_sha256=None,
            duplicate_group_key=None,
            duplicate_primary_document_id=None,
            quality_gates_passed=("canonical_text_available",),
            missing_required_metadata=(),
            reasons=("time_bound_operational_rule_detected",),
            artifact_key=None,
        )

        candidate = scoped_materialization._build_scoped_rule_candidate(
            report=report,
            source_record=source_record,
            inventory_entry=_inventory_entry(
                notice_id="191705",
                notice_title="重要通知--示例大学丰台校区就医管理办法（暂行）",
                published_date="2021-06-30 10:00",
            ),
            object_store=object_store,
            bucket_derived="campus-agent-derived",
            document_nature="time_bound_operational_rule",
        )

        self.assertEqual(
            candidate.title,
            "重要通知--示例大学丰台校区就医管理办法（暂行）",
        )
        self.assertEqual(candidate.campus_site, "示例大学丰台校区")
        self.assertEqual(candidate.force_status, "provisional_in_force")

    def test_build_scoped_rule_candidate_fails_closed_for_body_phrase_in_annual_rule(self) -> None:
        source_record = _record(
            notice_id="351907",
            title_slug="annual-rule-body-false-positive",
            content_hash="sha256:annual-rule-body-false-positive",
            body_key="campus_notices/documents/internal_notice/351907/canonical.md",
            units_key="campus_notices/documents/internal_notice/351907/document-units.jsonl",
            is_current=True,
        )
        object_store = _FakeObjectStore(
            objects={
                (
                    "campus-agent-derived",
                    source_record.canonical_markdown_object_key or "",
                ): _canonical_markdown(
                    "# 示例大学2026届推荐应届本科毕业生免试攻读硕士学位研究生实施办法\n\n"
                    "严格按照《示例大学2026届推荐应届本科毕业生免试攻读硕士学位研究生实施办法》执行。\n"
                    "其中，综合成绩按百分制计算，由学业成绩和综合素质成绩两部分组成。\n"
                ),
            }
        )
        report = InternalNoticeRegulationPromotionDocumentReport(
            document_id=source_record.document_id,
            notice_id="351907",
            site_id="example_internal_portal",
            source_kind="parent_notice",
            source_title="示例大学2026届推荐应届本科毕业生免试攻读硕士学位研究生实施办法",
            input_lane="notice_body",
            revision_track="source-faithful",
            version_id=source_record.version_id,
            action="requires_multimodal_processing",
            promotion_class="scoped_rule",
            document_nature="annual_cycle_rule",
            semantic_owner_kind="notice_body",
            target_corpus="regulations",
            target_collection="scoped_rules",
            regulation_title_normalized="示例大学2026届推荐应届本科毕业生免试攻读硕士学位研究生实施办法",
            issuing_org="示例大学",
            effective_date=None,
            revision_signal=None,
            source_notice_release_time="2025-09-06 11:52",
            source_parent_document_id=source_record.document_id,
            source_attachment_ref_id=None,
            source_attachment_sha256=None,
            duplicate_group_key=None,
            duplicate_primary_document_id=None,
            quality_gates_passed=("canonical_text_available",),
            missing_required_metadata=(),
            reasons=("annual_cycle_or_program_rule_detected",),
            artifact_key=None,
        )

        candidate = scoped_materialization._build_scoped_rule_candidate(
            report=report,
            source_record=source_record,
            inventory_entry=_inventory_entry(
                notice_id="351907",
                notice_title="示例大学2026届推荐应届本科毕业生免试攻读硕士学位研究生实施办法",
                published_date="2025-09-06 11:52",
            ),
            object_store=object_store,
            bucket_derived="campus-agent-derived",
            document_nature="annual_cycle_rule",
        )

        self.assertEqual(candidate.cycle_year, "2026")
        self.assertIsNone(candidate.school_unit_name)

    def test_build_scoped_rule_candidate_fails_closed_for_body_phrase_in_time_bound_rule(
        self,
    ) -> None:
        source_record = _record(
            notice_id="191706",
            title_slug="time-bound-rule-body-false-positive",
            content_hash="sha256:time-bound-rule-body-false-positive",
            body_key="campus_notices/documents/internal_notice/191706/canonical.md",
            units_key="campus_notices/documents/internal_notice/191706/document-units.jsonl",
            is_current=True,
        )
        object_store = _FakeObjectStore(
            objects={
                (
                    "campus-agent-derived",
                    source_record.canonical_markdown_object_key or "",
                ): _canonical_markdown(
                    "# 示例大学丰台校区就医管理办法（暂行）\n\n"
                    "校医院正式运营前，由临时医疗点承担校区基础门诊服务。\n"
                    "学校增设丰台区王佐镇社区卫生服务中心，为丰台校区师生提供医保转诊服务。\n"
                ),
            }
        )
        report = InternalNoticeRegulationPromotionDocumentReport(
            document_id=source_record.document_id,
            notice_id="191706",
            site_id="example_internal_portal",
            source_kind="parent_notice",
            source_title="重要通知--示例大学丰台校区就医管理办法（暂行）",
            input_lane="notice_body",
            revision_track="source-faithful",
            version_id=source_record.version_id,
            action="requires_multimodal_processing",
            promotion_class="scoped_rule",
            document_nature="time_bound_operational_rule",
            semantic_owner_kind="notice_body",
            target_corpus="regulations",
            target_collection="scoped_rules",
            regulation_title_normalized="示例大学丰台校区就医管理办法（暂行）",
            issuing_org="示例大学",
            effective_date=None,
            revision_signal=None,
            source_notice_release_time="2021-09-10 16:32",
            source_parent_document_id=source_record.document_id,
            source_attachment_ref_id=None,
            source_attachment_sha256=None,
            duplicate_group_key=None,
            duplicate_primary_document_id=None,
            quality_gates_passed=("canonical_text_available",),
            missing_required_metadata=(),
            reasons=("time_bound_operational_rule_detected",),
            artifact_key=None,
        )

        candidate = scoped_materialization._build_scoped_rule_candidate(
            report=report,
            source_record=source_record,
            inventory_entry=_inventory_entry(
                notice_id="191706",
                notice_title="重要通知--示例大学丰台校区就医管理办法（暂行）",
                published_date="2021-09-10 16:32",
            ),
            object_store=object_store,
            bucket_derived="campus-agent-derived",
            document_nature="time_bound_operational_rule",
        )

        self.assertEqual(candidate.campus_site, "示例大学丰台校区")
        self.assertIsNone(candidate.school_unit_name)
        self.assertEqual(candidate.force_status, "provisional_in_force")
