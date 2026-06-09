# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from campus_knowledge_capability.retrieval_intent import (
    RetrievalIntent,
    RetrievalIntentExpectation,
    RetrievalIntentTarget,
)

from tests.agent.knowledge_capability_answer_quality_regression_suite_support import *


class KnowledgeCapabilityAnswerQualityRegressionTestPart03(unittest.TestCase):
    def test_condition_overview_preserves_policy_member_coverage_before_repeated_rows(
        self,
    ) -> None:
        member_doc_ids = (
            "handbook:national",
            "handbook:inspirational",
            "handbook:professional",
            "handbook:special",
            "handbook:social",
        )
        evidence = EvidenceBundle(
            query_text="申请奖学金需要满足什么条件",
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="handbook:national",
                        title="中央民族大学本科学生国家奖学金评审办法",
                        snippet="遵纪守法,遵守学校规章制度。",
                        score=1.0,
                        chunk="national-discipline",
                        detail_label="第八条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:national",
                        title="中央民族大学本科学生国家奖学金评审办法",
                        snippet="遵纪守法,遵守学校规章制度。",
                        score=1.0,
                        chunk="national-discipline",
                        detail_label="第八条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:national",
                        title="中央民族大学本科学生国家奖学金评审办法",
                        snippet="诚实守信,道德品质优秀。",
                        score=1.0,
                        chunk="national-integrity",
                        detail_label="第八条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:special",
                        title="中央民族大学本科学生专项奖学金评定办法",
                        snippet="参评专项奖学金应当遵纪守法,遵守学校规章制度。",
                        score=0.91,
                        chunk="special-duplicate-condition",
                        detail_label="第十条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:special",
                        title="中央民族大学本科学生专项奖学金评定办法",
                        snippet="参评专项奖学金应当诚实守信,道德品质优良。",
                        score=0.9,
                        chunk="special-novel-condition",
                        detail_label="第十条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:professional",
                        title="中央民族大学本科学生专业奖学金评定办法",
                        snippet="参评专业奖学金应当学习刻苦,学业成绩优秀。",
                        score=0.9,
                        chunk="professional-condition",
                        detail_label="第十条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:social",
                        title="中央民族大学社会奖助学金管理办法",
                        snippet=(
                            "第一条 社会奖学金用于奖励品学兼优或在某一方面有特殊才华的学生。\n"
                            "第三条 学校向捐赠方颁发捐赠证书。\n"
                            "第四条 凡申请社会奖助学金的学生,必须在满足我校奖助学金"
                            "基本评选条件的基础上,同时符合该项奖助学金的评选要求。"
                        ),
                        score=0.89,
                        chunk="social-condition",
                        detail_label="第五条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:inspirational",
                        title="中央民族大学本科学生国家励志奖学金评审办法",
                        snippet="参评国家励志奖学金应当家庭经济困难,生活俭朴。",
                        score=0.88,
                        chunk="inspirational-condition",
                        detail_label="第八条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
            ),
        )

        retrieval_intent = RetrievalIntent(
            kind="condition_table",
            normalized_query=evidence.query_text,
            expected=RetrievalIntentExpectation(
                answer_kind="condition_table",
                evidence_roles=("eligibility_condition",),
                coverage_policy="category_member_coverage",
                selection_policy="one_answer_ready_source_per_member",
            ),
            target=RetrievalIntentTarget(
                corpus="regulations",
                collection="student_rules",
                category_id="scholarship",
                category_member_document_ids=member_doc_ids,
                condition_subject="generic_condition",
            ),
        )

        draft = KnowledgeCapability().build_answer(evidence, retrieval_intent=retrieval_intent)

        self.assertEqual(
            tuple(source.doc_id for source in draft.supporting_sources),
            member_doc_ids,
        )
        self.assertIn("专项奖学金", draft.answer_text)
        self.assertIn("专业奖学金", draft.answer_text)
        self.assertIn("社会奖助学金", draft.answer_text)
        self.assertIn("国家励志奖学金", draft.answer_text)
        self.assertIn("诚实守信", draft.answer_text)
        self.assertNotIn("颁发捐赠证书", draft.answer_text)
        self.assertNotIn("连续捐赠三年", draft.answer_text)

    def test_condition_overview_member_coverage_keeps_duplicate_intros_without_cross_policy_rows(
        self,
    ) -> None:
        member_doc_ids = (
            "handbook:national",
            "handbook:inspirational",
            "handbook:professional",
            "handbook:special",
            "handbook:social",
        )
        evidence = EvidenceBundle(
            query_text="申请奖学金需要满足什么条件",
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="handbook:national",
                        title="中央民族大学本科学生国家奖学金评审办法",
                        snippet="参评本科学生国家奖学金须具备以下基本条件:",
                        score=0.94,
                        chunk="national-intro",
                        detail_label="第八条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_intro",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="intro",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:inspirational",
                        title="中央民族大学本科学生国家励志奖学金评审办法",
                        snippet="参评本科学生国家励志奖学金需具备以下基本条件:",
                        score=0.93,
                        chunk="inspirational-intro",
                        detail_label="第八条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_intro",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="intro",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:professional",
                        title="中央民族大学本科学生专业奖学金评定办法",
                        snippet="参评本科学生专业奖学金需具备以下基本条件:",
                        score=0.92,
                        chunk="professional-intro",
                        detail_label="第十条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_intro",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="intro",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:professional",
                        title="中央民族大学本科学生专业奖学金评定办法",
                        snippet="参评本科学生专项奖学金,还需具备以下相应条件:",
                        score=0.91,
                        chunk="professional-cross-policy-intro",
                        detail_label="第十一条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_intro",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="intro",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:special",
                        title="中央民族大学本科学生专项奖学金评定办法",
                        snippet="参评本科学生专项奖学金需具备以下基本条件:",
                        score=0.9,
                        chunk="special-intro",
                        detail_label="第十条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_intro",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="intro",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:social",
                        title="中央民族大学社会奖助学金管理办法",
                        snippet="凡申请社会奖助学金的学生,必须同时符合该项奖助学金的评选要求。",
                        score=0.89,
                        chunk="social-condition",
                        detail_label="第四条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
            ),
        )
        retrieval_intent = RetrievalIntent(
            kind="condition_table",
            normalized_query=evidence.query_text,
            expected=RetrievalIntentExpectation(
                answer_kind="condition_table",
                evidence_roles=("eligibility_condition", "eligibility_intro"),
                coverage_policy="category_member_coverage",
                selection_policy="one_answer_ready_source_per_member",
            ),
            target=RetrievalIntentTarget(
                corpus="regulations",
                collection="student_rules",
                category_id="scholarship",
                category_member_document_ids=member_doc_ids,
                condition_subject="generic_condition",
            ),
        )

        draft = KnowledgeCapability().build_answer(evidence, retrieval_intent=retrieval_intent)

        self.assertEqual(
            tuple(source.doc_id for source in draft.supporting_sources), member_doc_ids
        )
        self.assertIn("国家励志奖学金", draft.answer_text)
        self.assertIn("专项奖学金", draft.answer_text)
        self.assertNotIn(
            "专业奖学金评定办法 第十一条：参评本科学生专项奖学金",
            draft.answer_text,
        )

    def test_condition_overview_member_coverage_prefers_condition_rows_over_intro_rows(
        self,
    ) -> None:
        member_doc_ids = ("handbook:national", "handbook:inspirational")
        evidence = EvidenceBundle(
            query_text="申请奖学金需要满足什么条件",
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="handbook:national",
                        title="中央民族大学本科学生国家奖学金评审办法",
                        snippet="参评本科学生国家奖学金须具备以下基本条件:",
                        score=0.99,
                        chunk="national-intro",
                        detail_label="第八条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_intro",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="intro",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:national",
                        title="中央民族大学本科学生国家奖学金评审办法",
                        snippet="参评国家奖学金应当遵纪守法,学习成绩优异,综合测评排名靠前。",
                        score=0.9,
                        chunk="national-condition",
                        detail_label="第八条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="rank_threshold",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:inspirational",
                        title="中央民族大学本科学生国家励志奖学金评审办法",
                        snippet="参评国家励志奖学金应当家庭经济困难,生活俭朴,学习成绩优秀。",
                        score=0.91,
                        chunk="inspirational-condition",
                        detail_label="第八条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
            ),
        )
        retrieval_intent = RetrievalIntent(
            kind="condition_table",
            normalized_query=evidence.query_text,
            expected=RetrievalIntentExpectation(
                answer_kind="condition_table",
                evidence_roles=("eligibility_condition", "eligibility_intro"),
                coverage_policy="category_member_coverage",
                selection_policy="one_answer_ready_source_per_member",
            ),
            target=RetrievalIntentTarget(
                corpus="regulations",
                collection="student_rules",
                category_id="scholarship",
                category_member_document_ids=member_doc_ids,
                condition_subject="generic_condition",
            ),
        )

        draft = KnowledgeCapability().build_answer(evidence, retrieval_intent=retrieval_intent)

        self.assertEqual(
            tuple(source.doc_id for source in draft.supporting_sources), member_doc_ids
        )
        self.assertIn("学习成绩优异", draft.answer_text)
        self.assertIn("家庭经济困难", draft.answer_text)
        self.assertNotIn("国家奖学金须具备以下基本条件", draft.answer_text)

    def test_condition_overview_excludes_application_review_rows_from_scholarship_conditions(
        self,
    ) -> None:
        member_doc_ids = (
            "handbook:national",
            "handbook:inspirational",
            "handbook:professional",
            "handbook:special",
            "handbook:social",
        )
        evidence = EvidenceBundle(
            query_text="申请奖学金需要满足什么条件",
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="handbook:national",
                        title="中央民族大学本科学生国家奖学金评审办法",
                        snippet="诚实守信,道德品质优秀,所评学年品行测评等级为优秀。",
                        score=0.95,
                        chunk="national-condition",
                        detail_label="第八条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:inspirational",
                        title="中央民族大学本科学生国家励志奖学金评审办法",
                        snippet="学习成绩优良,单科成绩不低于70分,所修全部课程的平均成绩不低于80分。",
                        score=0.94,
                        chunk="inspirational-condition",
                        detail_label="第八条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:professional",
                        title="中央民族大学本科学生专业奖学金评定办法",
                        snippet="诚实守信,道德品质优良,所评学年品行测评等级为良好及以上等级。",
                        score=0.93,
                        chunk="professional-condition",
                        detail_label="第十条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:special",
                        title="中央民族大学本科学生专项奖学金评定办法",
                        snippet="热爱祖国,维护民族团结,拥护中国共产党。",
                        score=0.92,
                        chunk="special-condition",
                        detail_label="第十条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:social",
                        title="中央民族大学社会奖助学金管理办法",
                        snippet="本人申请及班级民主评议推荐。",
                        score=0.99,
                        chunk="social-application-review",
                        detail_label="第六条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:social",
                        title="中央民族大学社会奖助学金管理办法",
                        snippet="凡申请社会奖助学金的学生,必须同时符合该项奖助学金的评选要求。",
                        score=0.9,
                        chunk="social-condition",
                        detail_label="第四条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
            ),
        )
        retrieval_intent = RetrievalIntent(
            kind="condition_table",
            normalized_query=evidence.query_text,
            expected=RetrievalIntentExpectation(
                answer_kind="condition_table",
                evidence_roles=("eligibility_condition",),
                coverage_policy="category_member_coverage",
                selection_policy="one_answer_ready_source_per_member",
            ),
            target=RetrievalIntentTarget(
                corpus="regulations",
                collection="student_rules",
                category_id="scholarship",
                category_member_document_ids=member_doc_ids,
                condition_subject="generic_condition",
            ),
        )

        draft = KnowledgeCapability().build_answer(evidence, retrieval_intent=retrieval_intent)

        self.assertIn("社会奖助学金", draft.answer_text)
        self.assertIn("评选要求", draft.answer_text)
        self.assertNotIn("本人申请", draft.answer_text)
        self.assertNotIn("民主评议", draft.answer_text)
        self.assertNotIn("推荐", draft.answer_text)

    def test_condition_overview_excludes_inline_application_review_tail_from_condition_clause(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="申请奖学金需要满足什么条件",
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="handbook:social",
                        title="中央民族大学社会奖助学金管理办法",
                        snippet=(
                            "第四条 凡申请社会奖助学金的学生,必须在满足我校奖助学金"
                            "基本评选条件的基础上,同时符合该项奖助学金的评选要求。"
                            "第六条 本人申请及班级民主评议推荐。"
                        ),
                        score=0.95,
                        chunk="social-mixed-inline",
                        detail_label="第四条-第六条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
            ),
        )
        retrieval_intent = RetrievalIntent(
            kind="condition_table",
            normalized_query=evidence.query_text,
            expected=RetrievalIntentExpectation(
                answer_kind="condition_table",
                evidence_roles=("eligibility_condition",),
                coverage_policy="category_member_coverage",
                selection_policy="one_answer_ready_source_per_member",
            ),
            target=RetrievalIntentTarget(
                corpus="regulations",
                collection="student_rules",
                category_id="scholarship",
                category_member_document_ids=("handbook:social",),
                condition_subject="generic_condition",
            ),
        )

        draft = KnowledgeCapability().build_answer(evidence, retrieval_intent=retrieval_intent)

        self.assertIn("评选要求", draft.answer_text)
        self.assertNotIn("本人申请", draft.answer_text)
        self.assertNotIn("民主评议", draft.answer_text)
        self.assertNotIn("推荐", draft.answer_text)

    def test_condition_overview_excludes_application_review_action_without_condition_predicate(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="申请奖学金需要满足什么条件",
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="handbook:social",
                        title="中央民族大学社会奖助学金管理办法",
                        snippet=(
                            "第六条 本人申请及班级民主评议推荐。根据中央民族大学奖助学金的申请条件"
                        ),
                        score=0.95,
                        chunk="social-application-review-live",
                        detail_label="第六条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:social",
                        title="中央民族大学社会奖助学金管理办法",
                        snippet="凡申请社会奖助学金的学生,必须同时符合该项奖助学金的评选要求。",
                        score=0.9,
                        chunk="social-condition",
                        detail_label="第四条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        condition_group_subject="generic_condition",
                        condition_polarity="positive",
                        semantic_role="condition",
                        claim_type="condition",
                    ),
                ),
            ),
        )
        retrieval_intent = RetrievalIntent(
            kind="condition_table",
            normalized_query=evidence.query_text,
            expected=RetrievalIntentExpectation(
                answer_kind="condition_table",
                evidence_roles=("eligibility_condition",),
                coverage_policy="category_member_coverage",
                selection_policy="one_answer_ready_source_per_member",
            ),
            target=RetrievalIntentTarget(
                corpus="regulations",
                collection="student_rules",
                category_id="scholarship",
                category_member_document_ids=("handbook:social",),
                condition_subject="generic_condition",
            ),
        )

        draft = KnowledgeCapability().build_answer(evidence, retrieval_intent=retrieval_intent)

        self.assertIn("评选要求", draft.answer_text)
        self.assertNotIn("本人申请", draft.answer_text)
        self.assertNotIn("民主评议", draft.answer_text)
        self.assertNotIn("推荐", draft.answer_text)
