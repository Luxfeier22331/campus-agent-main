# ruff: noqa: F405
from __future__ import annotations

import unittest

from campus_rag_agent.query_planning import plan_student_handbook_query
from campus_rag_agent.retrieval_intent import (
    RetrievalIntent,
    RetrievalIntentExpectation,
    RetrievalIntentTarget,
)

from tests.agent.rag_agent_answer_quality_regression_suite_support import *


class RagAgentConditionOverviewSynthesisTest(unittest.TestCase):
    def test_multi_policy_answer_synthesizes_dimensions_before_sources(self) -> None:
        member_doc_ids = (
            "policy:student-support",
            "policy:merit-support",
            "policy:special-support",
        )
        evidence = EvidenceBundle(
            query_text="申请校级资助项目需要满足什么条件",
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="policy:student-support",
                        title="学生资助项目评审办法",
                        snippet="申请学生资助项目应当热爱祖国,遵纪守法,诚实守信。",
                        score=0.94,
                        chunk="student-support-condition",
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
                        doc_id="policy:merit-support",
                        title="优秀学生资助项目评审细则",
                        snippet="申请优秀学生资助项目应当学习成绩优良,综合测评排名靠前。",
                        score=0.93,
                        chunk="merit-support-condition",
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
                        doc_id="policy:special-support",
                        title="专项资助项目管理办法",
                        snippet="申请专项资助项目还应符合具体项目要求,并按通知提交相关证明材料。",
                        score=0.92,
                        chunk="special-support-condition",
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
                category_id="student_support",
                category_member_document_ids=member_doc_ids,
                condition_subject="generic_condition",
            ),
        )

        draft = RagAgent().build_answer(evidence, retrieval_intent=retrieval_intent)

        self.assertTrue(draft.answer_text.startswith("申请校级资助项目需要满足"))
        self.assertIn("条件维度", draft.answer_text)
        self.assertIn("思想品德与诚信", draft.answer_text)
        self.assertIn("学习与综合表现", draft.answer_text)
        self.assertIn("项目专项要求", draft.answer_text)
        self.assertLess(
            draft.answer_text.index("需要满足"),
            draft.answer_text.index("分制度依据"),
        )
        self.assertLess(
            draft.answer_text.index("分制度依据"),
            draft.answer_text.index("学生资助项目评审办法 第六条"),
        )
        self.assertIn("条件维度", draft.answer_text)
        self.assertLess(
            draft.answer_text.index("分制度依据"),
            draft.answer_text.index("学生资助项目评审办法 第六条"),
        )
        self.assertIn("学生资助项目评审办法 第六条", draft.answer_text)
        self.assertIn("优秀学生资助项目评审细则 第八条", draft.answer_text)
        self.assertIn("专项资助项目管理办法 第十条", draft.answer_text)

    def test_threshold_answer_starts_with_direct_threshold_framing(self) -> None:
        title = "学生违纪处分实施办法"
        evidence = EvidenceBundle(
            query_text="旷课多少学时会按违纪处理",
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="policy:attendance-discipline",
                        title=title,
                        snippet="一学期累计旷课16节以下者,给予学院通报批评处分。",
                        score=0.96,
                        chunk="absence-threshold-1",
                        detail_label="第三十三条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="supporting_detail",
                        condition_subject="attendance_absence_threshold",
                        condition_group_subject="attendance_absence_threshold",
                        condition_polarity="neutral",
                        semantic_role="supporting_detail",
                        claim_type="policy_clause",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="policy:attendance-discipline",
                        title=title,
                        snippet="一学期累计旷课达50节(含)以上者,可以给予开除学籍处分。",
                        score=0.95,
                        chunk="absence-threshold-2",
                        detail_label="第三十三条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="supporting_detail",
                        condition_subject="attendance_absence_threshold",
                        condition_group_subject="attendance_absence_threshold",
                        condition_polarity="neutral",
                        semantic_role="supporting_detail",
                        claim_type="policy_clause",
                    ),
                ),
            ),
        )
        retrieval_intent = RetrievalIntent(
            kind="condition_table",
            normalized_query=evidence.query_text,
            expected=RetrievalIntentExpectation(
                answer_kind="condition_table",
                evidence_roles=("supporting_detail",),
                coverage_policy="condition_subject_alignment",
                selection_policy="answer_role_first",
            ),
            target=RetrievalIntentTarget(
                corpus="regulations",
                collection="student_rules",
                document_ids=("policy:attendance-discipline",),
                condition_subject="attendance_absence_threshold",
            ),
        )

        draft = RagAgent().build_answer(evidence, retrieval_intent=retrieval_intent)

        self.assertTrue(
            draft.answer_text.startswith(
                "制度原文没有使用“学时”，而是按“节”统计；"
                "一学期累计旷课16节以下即进入违纪处理分档"
            )
        )
        self.assertLess(
            draft.answer_text.index("完整分档"),
            draft.answer_text.index("依据"),
        )
        self.assertNotIn("最低命中分档", draft.answer_text)
        self.assertIn("制度原文没有使用“学时”", draft.answer_text)
        self.assertIn("按“节”统计", draft.answer_text)
        self.assertIn("16节以下", draft.answer_text)
        self.assertIn("50节(含)以上", draft.answer_text)
        self.assertIn("依据学生违纪处分实施办法 第三十三条", draft.answer_text)
        self.assertEqual(draft.answer_text.count("学生违纪处分实施办法 第三十三条"), 1)
        self.assertNotIn("相关条件包括", draft.answer_text)

    def test_threshold_answer_uses_original_query_when_retrieval_query_is_focused(
        self,
    ) -> None:
        title = "学生违纪处分实施办法"
        evidence = EvidenceBundle(
            query_text="中央民族大学学生违纪处分实施办法 旷课 学时 课时 节 考勤",
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="policy:attendance-discipline",
                        title=title,
                        snippet="一学期累计旷课16节以下者,给予学院通报批评处分。",
                        score=0.96,
                        chunk="absence-threshold-1",
                        detail_label="第三十三条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="supporting_detail",
                        condition_subject="attendance_absence_threshold",
                        condition_group_subject="attendance_absence_threshold",
                        condition_polarity="neutral",
                        semantic_role="supporting_detail",
                        claim_type="policy_clause",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="policy:attendance-discipline",
                        title=title,
                        snippet="一学期累计旷课达16-23节者,给予警告处分。",
                        score=0.95,
                        chunk="absence-threshold-2",
                        detail_label="第三十三条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="supporting_detail",
                        condition_subject="attendance_absence_threshold",
                        condition_group_subject="attendance_absence_threshold",
                        condition_polarity="neutral",
                        semantic_role="supporting_detail",
                        claim_type="policy_clause",
                    ),
                ),
            ),
        )
        retrieval_intent = RetrievalIntent(
            kind="condition_table",
            normalized_query="旷课多少学时会按违纪处理",
            expected=RetrievalIntentExpectation(
                answer_kind="condition_table",
                evidence_roles=("supporting_detail",),
                coverage_policy="condition_subject_alignment",
                selection_policy="answer_role_first",
            ),
            target=RetrievalIntentTarget(
                corpus="regulations",
                collection="student_rules",
                document_ids=("policy:attendance-discipline",),
                condition_subject="attendance_absence_threshold",
            ),
        )

        draft = RagAgent().build_answer(
            evidence,
            retrieval_intent=retrieval_intent,
            query_text="旷课多少学时会按违纪处理",
        )

        self.assertTrue(
            draft.answer_text.startswith(
                "制度原文没有使用“学时”，而是按“节”统计；"
                "一学期累计旷课16节以下即进入违纪处理分档"
            )
        )
        self.assertIn("依据学生违纪处分实施办法 第三十三条", draft.answer_text)

    def test_threshold_answer_dedupes_repeated_chunk_rows(self) -> None:
        title = "学生违纪处分实施办法"
        threshold_chunk = replace(
            _make_policy_source(
                doc_id="policy:attendance-discipline",
                title=title,
                snippet=(
                    "一学期累计旷课16节以下者,给予学院通报批评处分。\n"
                    "一学期累计旷课达16-23节者,给予警告处分。\n"
                    "一学期累计旷课达24-31节者,给予严重警告处分。\n"
                    "一学期累计旷课达32-39节者,给予记过处分。\n"
                    "一学期累计旷课达40-49节者,给予留校察看处分。\n"
                    "一学期累计旷课达50节(含)以上者,可以给予开除学籍处分。"
                ),
                score=0.96,
                chunk="absence-threshold-all",
                detail_label="第三十三条",
            ),
            anchor=_answer_ready_anchor(
                answer_role="supporting_detail",
                condition_subject="attendance_absence_threshold",
                condition_group_subject="attendance_absence_threshold",
                condition_polarity="neutral",
                semantic_role="supporting_detail",
                claim_type="policy_clause",
            ),
        )
        evidence = EvidenceBundle(
            query_text="旷课多少学时会按违纪处理",
            corpus="regulations",
            collection="student_rules",
            sources=(threshold_chunk,),
        )
        retrieval_intent = RetrievalIntent(
            kind="condition_table",
            normalized_query=evidence.query_text,
            expected=RetrievalIntentExpectation(
                answer_kind="condition_table",
                evidence_roles=("supporting_detail",),
                coverage_policy="condition_subject_alignment",
                selection_policy="answer_role_first",
            ),
            target=RetrievalIntentTarget(
                corpus="regulations",
                collection="student_rules",
                document_ids=("policy:attendance-discipline",),
                condition_subject="attendance_absence_threshold",
            ),
        )

        draft = RagAgent().build_answer(evidence, retrieval_intent=retrieval_intent)

        self.assertEqual(len(draft.supporting_sources), 1)
        self.assertEqual(draft.supporting_sources[0].chunk_id, threshold_chunk.chunk_id)
        self.assertEqual(len(draft.supporting_contexts), 1)
        self.assertEqual(draft.answer_text.count("学生违纪处分实施办法 第三十三条"), 1)
        self.assertIn("16节以下", draft.answer_text)
        self.assertIn("50节(含)以上", draft.answer_text)

    def test_amount_condition_intent_orders_table_fact_before_quota_conditions(
        self,
    ) -> None:
        title = "中央民族大学本科学生专业奖学金评定办法"
        eligibility_source = replace(
            _make_policy_source(
                doc_id="policy:professional-scholarship",
                title=title,
                snippet=(
                    "专业一等奖学金从班内综合测评排名前10%以内评选,"
                    "按应参评学生人数的5%评定。"
                ),
                score=0.95,
                chunk="professional-scholarship-quota-condition",
                detail_label="第十二条",
            ),
            anchor=_answer_ready_anchor(
                answer_role="eligibility_condition",
                condition_subject="amount_or_quota",
                condition_group_subject="amount_or_quota",
                condition_polarity="positive",
                semantic_role="condition",
                claim_type="condition",
            ),
        )
        table_source = replace(
            _make_policy_source(
                doc_id="policy:professional-scholarship",
                title=title,
                snippet=(
                    "学校为本科学生专业奖学金获得者颁发荣誉证书和奖金。"
                    "其中,专业一等奖学奖金奖励标准为2000元,"
                    "专业二等奖学奖金奖励标准为1200元。"
                ),
                score=0.91,
                chunk="professional-scholarship-amount-fact",
                detail_label="第十六条",
            ),
            content_kind="table_unit",
            content_role="table_fact",
            anchor=_answer_ready_anchor(
                answer_role="table_fact",
                condition_subject="amount_or_quota",
                condition_group_subject="amount_or_quota",
                condition_polarity="positive",
                semantic_role="table_fact",
                claim_type="amount_or_quota",
                table_fact_type="amount_or_quota",
            ),
        )
        evidence = EvidenceBundle(
            query_text="专业奖学金一等奖金额是多少？",
            corpus="regulations",
            collection="student_rules",
            sources=(eligibility_source, table_source),
        )
        retrieval_intent = RetrievalIntent(
            kind="condition_table",
            normalized_query=evidence.query_text,
            expected=RetrievalIntentExpectation(
                answer_kind="condition_table",
                evidence_roles=("table_fact", "eligibility_condition"),
                coverage_policy="condition_subject_alignment",
                selection_policy="answer_role_first",
            ),
            target=RetrievalIntentTarget(
                corpus="regulations",
                collection="student_rules",
                document_ids=("policy:professional-scholarship",),
                condition_subject="amount_or_quota",
            ),
        )

        draft = RagAgent().build_answer(evidence, retrieval_intent=retrieval_intent)

        self.assertEqual(draft.supporting_sources[0].chunk_id, table_source.chunk_id)
        self.assertIn("2000元", draft.answer_text)

    def test_rank_judgment_intent_orders_exception_rule_before_procedure_rows(
        self,
    ) -> None:
        title = "中央民族大学本科学生国家奖学金评审办法"
        procedure_source = replace(
            _make_policy_source(
                doc_id="policy:national-scholarship",
                title=title,
                snippet="学院按照学生申请、班级评议、学院审核的程序推荐国家奖学金候选人。",
                score=0.95,
                chunk="national-scholarship-procedure",
                detail_label="第十二条",
            ),
            content_role="procedure",
            anchor=_answer_ready_anchor(
                answer_role="procedure_step",
                condition_subject="application_procedure",
                condition_group_subject="application_procedure",
                condition_polarity="positive",
                semantic_role="procedure_step",
                claim_type="procedure",
            ),
        )
        exception_source = replace(
            _make_policy_source(
                doc_id="policy:national-scholarship",
                title=title,
                snippet=(
                    "学习成绩排名或综合考评成绩排名超出前10%,但均位于前30%的学生,"
                    "必须在道德风尚、学术研究等某一方面表现特别优秀。"
                ),
                score=0.82,
                chunk="national-scholarship-rank-exception",
                detail_label="第九条",
            ),
            anchor=_answer_ready_anchor(
                answer_role="exception_rule",
                condition_subject="rank_threshold",
                condition_group_subject="rank_threshold",
                condition_polarity="positive",
                semantic_role="exception_rule",
                claim_type="condition",
            ),
        )
        evidence = EvidenceBundle(
            query_text="成绩没前十还能评国奖吗",
            corpus="regulations",
            collection="student_rules",
            sources=(procedure_source, exception_source),
        )
        retrieval_intent = RetrievalIntent(
            kind="eligibility_judgment",
            normalized_query=evidence.query_text,
            expected=RetrievalIntentExpectation(
                answer_kind="eligibility_judgment",
                evidence_roles=("exception_rule", "eligibility_condition"),
                coverage_policy="condition_subject_alignment",
                selection_policy="answer_role_first",
            ),
            target=RetrievalIntentTarget(
                corpus="regulations",
                collection="student_rules",
                document_ids=("policy:national-scholarship",),
                condition_subject="rank_threshold",
            ),
        )

        draft = RagAgent().build_answer(evidence, retrieval_intent=retrieval_intent)

        self.assertEqual(draft.supporting_sources[0].chunk_id, exception_source.chunk_id)
        self.assertIn("前30%", draft.answer_text)

    def test_negative_relief_condition_intent_orders_exclusion_rule_before_intro_rows(
        self,
    ) -> None:
        title = "中央民族大学解除学生纪律处分实施办法"
        intro_source = replace(
            _make_policy_source(
                doc_id="policy:discipline-relief",
                title=title,
                snippet="学生申请解除处分应当提交书面申请,并经过学院审核。",
                score=0.95,
                chunk="discipline-relief-intro",
                detail_label="第七条",
            ),
            anchor=_answer_ready_anchor(
                answer_role="eligibility_intro",
                condition_subject="generic_condition",
                condition_group_subject="generic_condition",
                condition_polarity="positive",
                semantic_role="eligibility_intro",
                claim_type="condition",
            ),
        )
        exclusion_source = replace(
            _make_policy_source(
                doc_id="policy:discipline-relief",
                title=title,
                snippet="有再次违纪、考试作弊或未通过考察的情形,不予解除处分。",
                score=0.82,
                chunk="discipline-relief-exclusion",
                detail_label="第六条",
            ),
            anchor=_answer_ready_anchor(
                answer_role="exclusion_rule",
                condition_subject="discipline_relief_exclusion",
                condition_group_subject="discipline_relief_exclusion",
                condition_polarity="negative",
                semantic_role="exclusion_rule",
                claim_type="cannot_do",
            ),
        )
        evidence = EvidenceBundle(
            query_text="哪些情况不能解除处分",
            corpus="regulations",
            collection="student_rules",
            sources=(intro_source, exclusion_source),
        )
        retrieval_intent = RetrievalIntent(
            kind="condition_table",
            normalized_query=evidence.query_text,
            expected=RetrievalIntentExpectation(
                answer_kind="condition_table",
                evidence_roles=("exclusion_rule",),
                coverage_policy="condition_subject_alignment",
                selection_policy="answer_role_first",
            ),
            target=RetrievalIntentTarget(
                corpus="regulations",
                collection="student_rules",
                document_ids=("policy:discipline-relief",),
                condition_subject="discipline_relief_exclusion",
            ),
        )

        draft = RagAgent().build_answer(evidence, retrieval_intent=retrieval_intent)

        self.assertEqual(draft.supporting_sources[0].chunk_id, exclusion_source.chunk_id)
        self.assertIn("不予解除处分", draft.answer_text)

    def test_discipline_relief_duration_query_starts_with_waiting_periods(self) -> None:
        title = "中央民族大学解除学生纪律处分实施办法"
        evidence = EvidenceBundle(
            query_text="被处分后多久可以申请解除处分",
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="policy:discipline-relief",
                        title=title,
                        snippet=(
                            "在校期间受到警告、严重警告、记过、留校察看处分的学生,"
                            "在受处分后表现优秀,经考察符合要求的,可以申请解除处分。"
                            "其中,受警告、严重警告处分的学生,考察期满6个月后可申请解除处分;"
                            "受记过、留校察看处分的学生,考察期满12个月后可申请解除处分。"
                        ),
                        score=0.96,
                        chunk="discipline-relief-duration",
                        detail_label="第三条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="discipline_relief_condition",
                        condition_group_subject="discipline_relief_condition",
                        condition_polarity="positive",
                        semantic_role="eligibility_condition",
                        claim_type="condition",
                    ),
                ),
            ),
        )

        draft = RagAgent().build_answer(
            evidence,
            retrieval_intent=plan_student_handbook_query(evidence.query_text).retrieval_intent,
        )

        self.assertTrue(draft.answer_text.startswith("被处分后申请解除处分的等待期"))
        self.assertLess(draft.answer_text.index("6个月"), draft.answer_text.index(title))
        self.assertLess(draft.answer_text.index("12个月"), draft.answer_text.index(title))
        self.assertNotIn("完整依据", draft.answer_text)
        self.assertNotIn("在校期间受到", draft.answer_text)

    def test_discipline_relief_duration_query_supports_written_month_units(self) -> None:
        title = "中央民族大学解除学生纪律处分实施办法"
        evidence = EvidenceBundle(
            query_text="被处分后多久可以申请解除处分",
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="policy:discipline-relief",
                        title=title,
                        snippet=(
                            "第三条 受警告、严重警告、记过处分者，从处分决定生效之日起经过六个月"
                            "考察期后，可以申请解除处分；受留校察看处分者，须经过十二个月考察期后"
                            "方可申请解除处分。"
                        ),
                        score=0.96,
                        chunk="discipline-relief-written-duration",
                        detail_label="第三条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="discipline_relief_condition",
                        condition_group_subject="discipline_relief_condition",
                        condition_polarity="positive",
                        semantic_role="eligibility_condition",
                        claim_type="condition",
                    ),
                ),
            ),
        )

        draft = RagAgent().build_answer(
            evidence,
            retrieval_intent=plan_student_handbook_query(evidence.query_text).retrieval_intent,
        )

        self.assertTrue(draft.answer_text.startswith("被处分后申请解除处分的等待期"))
        self.assertEqual(len(draft.supporting_sources), 1)
        self.assertIn("六个月", draft.answer_text)
        self.assertIn("十二个月", draft.answer_text)

    def test_discipline_relief_duration_query_prefers_duration_even_with_extra_conditions(
        self,
    ) -> None:
        title = "中央民族大学解除学生纪律处分实施办法"
        evidence = EvidenceBundle(
            query_text="被处分后多久可以申请解除处分",
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="policy:discipline-relief",
                        title=title,
                        snippet=(
                            "在校期间受到警告、严重警告、记过、留校察看处分的学生,"
                            "在受处分后表现优秀,经考察符合要求的,可以申请解除处分。"
                            "其中,受警告、严重警告处分的学生,考察期满6个月后可申请解除处分;"
                            "受记过、留校察看处分的学生,考察期满12个月后可申请解除处分。"
                        ),
                        score=0.96,
                        chunk="discipline-relief-duration",
                        detail_label="第三条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="discipline_relief_condition",
                        condition_group_subject="discipline_relief_condition",
                        condition_polarity="positive",
                        semantic_role="eligibility_condition",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="policy:discipline-relief",
                        title=title,
                        snippet="学生申请解除处分应当表现良好,并经过班级评议、学院审核。",
                        score=0.93,
                        chunk="discipline-relief-condition",
                        detail_label="第四条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="discipline_relief_condition",
                        condition_group_subject="discipline_relief_condition",
                        condition_polarity="positive",
                        semantic_role="eligibility_condition",
                        claim_type="condition",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="policy:discipline-relief",
                        title=title,
                        snippet="学生申请解除处分还应当在考察期内无新的违纪行为。",
                        score=0.92,
                        chunk="discipline-relief-no-reoffense",
                        detail_label="第七条",
                    ),
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="discipline_relief_condition",
                        condition_group_subject="discipline_relief_condition",
                        condition_polarity="positive",
                        semantic_role="eligibility_condition",
                        claim_type="condition",
                    ),
                ),
            ),
        )

        draft = RagAgent().build_answer(
            evidence,
            retrieval_intent=plan_student_handbook_query(evidence.query_text).retrieval_intent,
        )

        self.assertTrue(draft.answer_text.startswith("被处分后申请解除处分的等待期"))
        self.assertEqual(len(draft.supporting_sources), 1)
        self.assertTrue(draft.supporting_sources[0].chunk_id.endswith(":discipline-relief-duration"))
        self.assertEqual(len(draft.supporting_contexts), 1)
        self.assertIn("6个月", draft.answer_text)
        self.assertIn("12个月", draft.answer_text)
        self.assertNotIn("学习勤奋", draft.answer_text)
        self.assertNotIn("班级评议", draft.answer_text)
        self.assertNotIn("学院审核", draft.answer_text)

    def test_conduct_grade_does_not_create_amount_or_quota_dimension(self) -> None:
        evidence = EvidenceBundle(
            query_text="申请奖学金需要满足什么条件",
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="policy:conduct-award",
                        title="品行奖学金评审办法",
                        snippet="申请品行奖学金应当诚实守信,品行测评等级为优秀。",
                        score=0.94,
                        chunk="conduct-award-condition",
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
                        doc_id="policy:academic-award",
                        title="学业奖学金评审办法",
                        snippet="申请学业奖学金应当学习成绩优良,综合测评排名靠前。",
                        score=0.93,
                        chunk="academic-award-condition",
                        detail_label="第七条",
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
                category_member_document_ids=("policy:conduct-award", "policy:academic-award"),
                condition_subject="generic_condition",
            ),
        )

        draft = RagAgent().build_answer(evidence, retrieval_intent=retrieval_intent)

        self.assertIn("思想品德与诚信", draft.answer_text)
        self.assertIn("学习与综合表现", draft.answer_text)
        self.assertNotIn("名额金额与等级", draft.answer_text)


if __name__ == "__main__":
    unittest.main()
