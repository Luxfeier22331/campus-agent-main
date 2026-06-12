# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from campus_knowledge_capability.query_planning import plan_student_handbook_query
from campus_knowledge_capability.retrieval_intent import (
    RetrievalIntent,
    RetrievalIntentExpectation,
    RetrievalIntentTarget,
)

from tests.agent.knowledge_capability_answer_quality_regression_suite_support import *


class KnowledgeCapabilityAnswerQualityRegressionTestPart04(unittest.TestCase):
    def test_condition_overview_multi_policy_answer_does_not_use_single_policy_context_prefix(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="申请奖学金需要满足什么条件",
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="handbook:inspirational",
                        title="中央民族大学本科学生国家励志奖学金评审办法",
                        snippet="拥护中国共产党,热爱祖国,维护国家统一和民族团结;",
                        score=1.0,
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
                        doc_id="handbook:national",
                        title="中央民族大学本科学生国家奖学金评审办法",
                        snippet="遵纪守法,遵守学校规章制度;",
                        score=0.99,
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
                category_member_document_ids=("handbook:inspirational", "handbook:national"),
                condition_subject="generic_condition",
            ),
        )

        draft = KnowledgeCapability().build_answer(evidence, retrieval_intent=retrieval_intent)

        self.assertNotIn(
            "《中央民族大学本科学生国家励志奖学金评审办法》 第八条明确", draft.answer_text
        )
        self.assertIn("中央民族大学本科学生国家励志奖学金评审办法 第八条", draft.answer_text)
        self.assertIn("中央民族大学本科学生国家奖学金评审办法 第八条", draft.answer_text)

    def test_condition_overview_excludes_procedure_material_rows_when_condition_rows_exist(
        self,
    ) -> None:
        title = "中央民族大学解除学生纪律处分实施办法"
        condition_source = replace(
            _make_policy_source(
                doc_id="handbook:demerit-relief",
                title=title,
                snippet="第三条 学生受处分满考察期后，可以申请解除纪律处分。",
                score=0.88,
                chunk="discipline-relief-condition",
                detail_label="第三条",
            ),
            content_role="eligibility",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="eligibility_condition",
                semantic_role="eligibility_condition",
                claim_type="condition",
                condition_subject="discipline_relief_condition",
                condition_polarity="positive",
                action_type="lift_discipline",
                article_no="第三条",
            ),
        )
        material_source = replace(
            _make_policy_source(
                doc_id="handbook:demerit-relief",
                title=title,
                snippet=(
                    "无异议后,学院将公示情况说明随同解除处分审批表、获奖证书原件、"
                    "参加公益活动证明材料等材料一并报学生处审核。"
                ),
                score=0.96,
                chunk="discipline-relief-materials",
                detail_label="第七条",
            ),
            content_role="procedure",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="procedure_step",
                semantic_role="procedure_step",
                claim_type="procedure",
                condition_subject="application_procedure",
                condition_polarity="positive",
                action_type="lift_discipline",
                article_no="第七条",
            ),
        )
        evidence = EvidenceBundle(
            query_text="被处分后多久可以申请解除处分",
            corpus="regulations",
            collection="student_rules",
            sources=(material_source, condition_source),
        )

        draft = KnowledgeCapability().build_answer(
            evidence,
            retrieval_intent=plan_student_handbook_query(evidence.query_text).retrieval_intent,
        )

        self.assertIn("满考察期后", draft.answer_text)
        self.assertNotIn("审批表", draft.answer_text)
        self.assertNotIn("证明材料", draft.answer_text)

    def test_disciplinary_relief_how_long_answer_prefers_waiting_condition_over_approval_steps(
        self,
    ) -> None:
        title = "中央民族大学解除学生纪律处分实施办法"
        condition_source = replace(
            _make_policy_source(
                doc_id="handbook:demerit-relief",
                title=title,
                snippet="第三条 学生受处分满考察期后，可以申请解除纪律处分。",
                score=0.88,
                chunk="discipline-relief-condition",
                detail_label="第三条",
            ),
            content_role="eligibility",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="eligibility_condition",
                semantic_role="eligibility_condition",
                claim_type="condition",
                condition_subject="discipline_relief_condition",
                condition_polarity="positive",
                action_type="lift_discipline",
                article_no="第三条",
            ),
        )
        approval_source = replace(
            _make_policy_source(
                doc_id="handbook:demerit-relief",
                title=title,
                snippet="学院审核后报学生处，学生处审核后报请主管校领导审批决定。",
                score=0.96,
                chunk="discipline-relief-approval",
            ),
            content_role="procedure",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="procedure_step",
                semantic_role="procedure_step",
                claim_type="procedure",
                condition_subject="application_procedure",
                condition_polarity="positive",
                action_type="lift_discipline",
            ),
        )
        evidence = EvidenceBundle(
            query_text="被处分后多久可以申请解除处分",
            corpus="regulations",
            collection="student_rules",
            sources=(approval_source, condition_source),
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertIn("满考察期后", draft.answer_text)
        self.assertIn("申请解除纪律处分", draft.answer_text)
        self.assertNotIn("主管校领导审批", draft.answer_text)

    def test_attendance_absence_threshold_answer_prefers_absence_threshold_clause(self) -> None:
        title = "中央民族大学学生违纪处分实施办法"
        threshold_source = replace(
            _make_policy_source(
                doc_id="handbook:discipline",
                title=title,
                snippet="第三十三条 一学期内旷课累计达到10学时以上的，按违纪处理。",
                score=0.86,
                chunk="absence-threshold",
                detail_label="第三十三条",
            ),
            content_role="requirement",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="eligibility_condition",
                semantic_role="eligibility_condition",
                claim_type="condition",
                condition_subject="generic_condition",
                condition_polarity="positive",
                article_no="第三十三条",
            ),
        )
        generic_source = replace(
            _make_policy_source(
                doc_id="handbook:discipline",
                title=title,
                snippet="学生应遵守学校纪律，违纪处分按照规定程序执行。",
                score=0.95,
                chunk="discipline-generic",
            ),
            content_role="requirement",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="eligibility_condition",
                semantic_role="eligibility_condition",
                claim_type="condition",
                condition_subject="generic_condition",
                condition_polarity="positive",
            ),
        )
        evidence = EvidenceBundle(
            query_text="旷课多少学时会按违纪处理",
            corpus="regulations",
            collection="student_rules",
            sources=(generic_source, threshold_source),
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertIn("10学时", draft.answer_text)
        self.assertIn("旷课", draft.answer_text)
        self.assertNotIn("按照规定程序执行", draft.answer_text)

    def test_attendance_absence_threshold_treats_periods_as_class_hours(self) -> None:
        title = "中央民族大学学生违纪处分实施办法"
        threshold_source = replace(
            _make_policy_source(
                doc_id="handbook:discipline",
                title=title,
                snippet=(
                    "第三十三条 违反学校考勤管理规定，无故旷课者，视情节给予如下处分："
                    "一学期累计旷课16节以下者，给予学院(系)通报批评处分；"
                    "一学期累计旷课达16-23节者，给予警告处分。"
                ),
                score=0.86,
                chunk="absence-threshold-periods",
                detail_label="第三十三条",
            ),
            content_role="procedure",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="eligibility_condition",
                semantic_role="eligibility_condition",
                claim_type="condition",
                condition_subject="generic_condition",
                condition_polarity="positive",
                article_no="第三十三条",
            ),
        )
        generic_source = replace(
            _make_policy_source(
                doc_id="handbook:discipline",
                title=title,
                snippet=(
                    "第八条 凡具有中央民族大学正式学籍的学生违反学校纪律需按本办法给予处分的，"
                    "本(预)科学生由学生处负责处理。第九条 学生发生违纪行为，"
                    "由学生处、教务处等共同负责调查取证相关违纪事实。"
                ),
                score=0.95,
                chunk="discipline-generic-authority",
                detail_label="第八条-第九条",
            ),
            content_role="eligibility",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="eligibility_condition",
                semantic_role="condition",
                claim_type="condition",
                condition_subject="generic_condition",
                condition_polarity="positive",
            ),
        )
        evidence = EvidenceBundle(
            query_text="旷课多少学时会按违纪处理",
            corpus="regulations",
            collection="student_rules",
            sources=(generic_source, threshold_source),
        )

        draft = KnowledgeCapability().build_answer(
            evidence,
            retrieval_intent=plan_student_handbook_query(evidence.query_text).retrieval_intent,
        )

        self.assertIn("16", draft.answer_text)
        self.assertIn("旷课", draft.answer_text)
        self.assertNotIn("共同负责调查取证", draft.answer_text)

    def test_attendance_absence_threshold_keeps_quantified_threshold_rows(self) -> None:
        title = "中央民族大学学生违纪处分实施办法"
        threshold_source = replace(
            _make_policy_source(
                doc_id="handbook:9350d885657d7409e524e73666b828b826f07191",
                title=title,
                snippet="\n".join(
                    (
                        "第三十三条 违反学校考勤管理规定，无故旷课者，视情节给予如下处分：",
                        "(一)一学期累计旷课16节以下者，给予学院(系)通报批评处分；",
                        "(二)一学期累计旷课达16-23节者，给予警告处分；",
                        "(三)一学期累计旷课达24-31节者，给予严重警告处分；",
                        "(四)一学期累计旷课达32-39节者，给予记过处分；",
                        "(五)一学期累计旷课达40-49节者，给予留校察看处分；",
                        "(六)一学期累计旷课达50节(含)以上者，可以给予开除学籍处分。",
                    )
                ),
                score=0.91,
                chunk="absence-threshold-live-chunk",
                detail_label="第三十三条",
            ),
            content_role="article_body",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="supporting_detail",
                semantic_role="supporting_detail",
                claim_type="policy_clause",
                condition_polarity="neutral",
                article_no="第三十三条",
            ),
        )
        evidence = EvidenceBundle(
            query_text="旷课多少学时会按违纪处理",
            corpus="regulations",
            collection="student_rules",
            sources=(threshold_source,),
        )

        draft = KnowledgeCapability().build_answer(
            evidence,
            retrieval_intent=plan_student_handbook_query(evidence.query_text).retrieval_intent,
        )

        self.assertIn("16节以下", draft.answer_text)
        self.assertIn("50节(含)以上", draft.answer_text)
        self.assertNotIn("视情节给予如下处分：第三十三条", draft.answer_text)
        self.assertIsNotNone(draft.typed_draft)
        self.assertEqual(draft.typed_draft.kind, "condition_table")
        self.assertGreaterEqual(len(draft.typed_draft.rows), 2)

    def test_disciplinary_relief_how_long_keeps_period_condition_over_procedure_rows(
        self,
    ) -> None:
        title = "中央民族大学解除学生纪律处分实施办法"
        condition_source = replace(
            _make_policy_source(
                doc_id="handbook:demerit-relief",
                title=title,
                snippet="第五条 学生受处分考察期满后，符合解除处分条件的，可以申请解除处分。",
                score=0.84,
                chunk="discipline-relief-period-condition",
                detail_label="第五条",
            ),
            content_role="eligibility",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="eligibility_condition",
                semantic_role="eligibility_condition",
                claim_type="condition",
                condition_subject="discipline_relief_condition",
                condition_polarity="positive",
                action_type="lift_discipline",
                article_no="第五条",
            ),
        )
        procedure_source = replace(
            _make_policy_source(
                doc_id="handbook:demerit-relief",
                title=title,
                snippet="第七条 学院审核后报学生处，学生处审核后报请主管校领导审批决定。",
                score=0.96,
                chunk="discipline-relief-approval",
                detail_label="第七条",
            ),
            content_role="procedure",
            is_answer_bearing=True,
            anchor=_answer_ready_anchor(
                answer_role="procedure_step",
                semantic_role="procedure_step",
                claim_type="procedure",
                condition_subject="application_procedure",
                condition_polarity="positive",
                action_type="lift_discipline",
                article_no="第七条",
            ),
        )
        evidence = EvidenceBundle(
            query_text="被处分后多久可以申请解除处分",
            corpus="regulations",
            collection="student_rules",
            sources=(procedure_source, condition_source),
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertIn("考察期满", draft.answer_text)
        self.assertIn("可以申请解除处分", draft.answer_text)
        self.assertNotIn("主管校领导审批", draft.answer_text)

    def test_detail_clause_prefers_statements_covering_query_critical_terms(self) -> None:
        evidence = EvidenceBundle(
            query_text="国奖第九条里对论文和著作怎么要求的？",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_policy_source(
                    doc_id="handbook:national",
                    title="中央民族大学本科学生国家奖学金评审办法",
                    snippet="第九条 参评本科学生国家奖学金还须具备以下条件之一: 在体育竞赛中取得显著成绩。",
                    score=0.93,
                    chunk="national-sports",
                ),
                _make_policy_source(
                    doc_id="handbook:national",
                    title="中央民族大学本科学生国家奖学金评审办法",
                    snippet="第九条 学术研究方面取得显著成绩,以第一作者发表论文或以第一、二作者出版学术著作。",
                    score=0.91,
                    chunk="national-paper-book",
                ),
            ),
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertIn("论文", draft.answer_text)
        self.assertIn("著作", draft.answer_text)
        self.assertNotIn("体育竞赛", draft.answer_text)

    def test_rewritten_policy_title_detail_query_still_answers_clause_content(self) -> None:
        title = "中央民族大学本科学生国家奖学金评审办法"
        evidence = EvidenceBundle(
            query_text=f"{title} 国奖第九条里对论文和著作怎么要求的?",
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="handbook:national",
                        title=title,
                        snippet=(
                            f"{title} / 第三章 评选条件 / 第九条\n"
                            "2. 在学术研究上取得显著成绩,以第一作者发表的论文被SCI、EI、"
                            "ISTP、SSCI全文收录,以第一、二作者出版学术专著。"
                        ),
                        score=0.96,
                        chunk="national-paper-book",
                        detail_label="第九条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="example_evidence",
                        semantic_role="example",
                        claim_type="condition",
                        condition_subject="paper_or_publication",
                        condition_polarity="positive",
                        article_no="第九条",
                        clause_no="2.",
                    ),
                ),
            ),
        )

        draft = KnowledgeCapability().build_answer(evidence)

        self.assertIn("第九条", draft.answer_text)
        self.assertIn("论文", draft.answer_text)
        self.assertIn("第一作者", draft.answer_text)
        self.assertIn("第一、二作者", draft.answer_text)
        self.assertNotIn("相关依据为", draft.answer_text)
        self.assertNotEqual(draft.presentation_kind, "document_identity")
