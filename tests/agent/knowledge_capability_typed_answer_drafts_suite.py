from __future__ import annotations

import importlib
import unittest
from dataclasses import replace

from campus_contracts import EvidenceBundle
from campus_knowledge_capability.answer_runtime import KnowledgeCapability
from campus_knowledge_capability.answer_shape import AnswerShape
from campus_knowledge_capability.typed_answer_drafts import (
    validate_typed_answer_draft,
)

from tests.agent.knowledge_capability_answer_quality_regression_suite_support import (
    _make_curriculum_plan_source,
)
from tests.agent.knowledge_capability_test_support import _make_handbook_source
from tests.agent.knowledge_capability_typed_answer_drafts_support import (
    _answer_ready_anchor,
    _retrieval_intent,
)

CASE_MODULES = (
    "tests.agent.knowledge_capability_typed_answer_drafts_suite",
    "tests.agent.knowledge_capability_typed_answer_drafts_tail_suite",
)


def load_tests(
    loader: unittest.TestLoader, tests: unittest.TestSuite, pattern: str | None
) -> unittest.TestSuite:
    suite = unittest.TestSuite()
    for module_name in CASE_MODULES:
        if module_name == __name__:
            suite.addTests(loader.loadTestsFromTestCase(KnowledgeCapabilityTypedAnswerDraftTest))
            continue
        suite.addTests(loader.loadTestsFromModule(importlib.import_module(module_name)))
    return suite


class KnowledgeCapabilityTypedAnswerDraftTest(unittest.TestCase):
    def test_regulation_answer_shape_projects_from_retrieval_intent(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:appeal",
            title="中央民族大学学生申诉处理办法",
            snippet="学生应当在收到处理决定之日起10日内提出申诉。",
            score=0.91,
            chunk_id_suffix="appeal-deadline-intent-shape",
            content_role="deadline",
            is_answer_bearing=True,
        )
        source = replace(
            source,
            anchor=_answer_ready_anchor(
                answer_role="time_constraint",
                condition_subject="deadline",
                condition_polarity="positive",
            ),
        )

        draft = KnowledgeCapability().build_answer(
            EvidenceBundle(
                query_text="中央民族大学学生申诉处理办法",
                corpus="regulations",
                collection="institutional_rules",
                sources=(source,),
            ),
            retrieval_intent=_retrieval_intent(
                kind="condition_table",
                answer_kind="condition_table",
                collection="institutional_rules",
                document_ids=("handbook:appeal",),
                condition_subject="deadline",
            ),
        )

        self.assertEqual(draft.typed_draft.kind, "condition_table")
        self.assertEqual(validate_typed_answer_draft(draft.typed_draft).verdict, "valid")

    def test_retrieval_intent_drives_regulation_selection_without_query_cues(self) -> None:
        generic_source = _make_handbook_source(
            doc_id="handbook:appeal",
            title="中央民族大学学生申诉处理办法",
            snippet="学生申诉应当符合规定条件，并按程序办理。",
            score=0.94,
            chunk_id_suffix="appeal-generic-condition",
            content_role="requirement",
            is_answer_bearing=True,
        )
        generic_source = replace(
            generic_source,
            anchor=_answer_ready_anchor(
                answer_role="eligibility_condition",
                condition_subject="generic_condition",
                condition_polarity="positive",
            ),
        )
        deadline_source = _make_handbook_source(
            doc_id="handbook:appeal",
            title="中央民族大学学生申诉处理办法",
            snippet="学生应当在收到处理决定之日起10日内提出申诉。",
            score=0.88,
            chunk_id_suffix="appeal-deadline-driven-by-intent",
            content_role="deadline",
            is_answer_bearing=True,
        )
        deadline_source = replace(
            deadline_source,
            anchor=_answer_ready_anchor(
                answer_role="time_constraint",
                condition_subject="deadline",
                condition_polarity="positive",
            ),
        )

        draft = KnowledgeCapability().build_answer(
            EvidenceBundle(
                query_text="中央民族大学学生申诉处理办法",
                corpus="regulations",
                collection="institutional_rules",
                sources=(generic_source, deadline_source),
            ),
            retrieval_intent=_retrieval_intent(
                kind="condition_table",
                answer_kind="condition_table",
                collection="institutional_rules",
                document_ids=("handbook:appeal",),
                condition_subject="deadline",
            ),
        )

        self.assertIn("10日内", draft.answer_text)
        self.assertEqual(draft.typed_draft.kind, "condition_table")
        self.assertEqual(draft.typed_draft.rows[0].condition_subject, "deadline")
        self.assertEqual(validate_typed_answer_draft(draft.typed_draft).verdict, "valid")

    def test_policy_object_intent_preserves_short_reference_over_chunk_semantics(self) -> None:
        source = _make_handbook_source(
            doc_id="institutional:medical",
            title="中央民族大学丰台校区就医管理办法（暂行）",
            snippet="为全力做好丰台校区医疗服务保障，切实解决师生就医问题，经学校研究决定。",
            score=0.91,
            chunk_id_suffix="medical-procedure-title-lookup",
            content_role="procedure",
            is_answer_bearing=True,
            semantic_role="procedure_step",
            polarity="positive",
            action_type="medical_service",
            claim_type="procedure",
        )
        source = replace(
            source,
            anchor=_answer_ready_anchor(
                answer_role="procedure_step",
                condition_subject="application_procedure",
                procedure_step_index=1,
                procedure_actor="school",
                procedure_action="provide_service",
            ),
        )

        draft = KnowledgeCapability().build_answer(
            EvidenceBundle(
                query_text="中央民族大学丰台校区就医管理办法（暂行）",
                corpus="regulations",
                collection="institutional_rules",
                sources=(source,),
            ),
            retrieval_intent=_retrieval_intent(
                kind="policy_object_lookup",
                answer_kind="policy_object",
                collection="institutional_rules",
                document_titles=("中央民族大学丰台校区就医管理办法（暂行）",),
            ),
        )

        self.assertEqual(draft.typed_draft.kind, "short_reference")
        self.assertEqual(draft.presentation_kind, "document_identity")
        self.assertIn("相关依据为", draft.answer_text)
        self.assertIn("中央民族大学丰台校区就医管理办法（暂行）", draft.answer_text)
        result = validate_typed_answer_draft(
            draft.typed_draft,
            expected_answer_kind="policy_object",
        )
        self.assertEqual(result.verdict, "valid")

    def test_policy_object_intent_accepts_answer_ready_target_document_body_roles(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:national-grant",
            title="中央民族大学本科生国家助学金评审办法",
            snippet=(
                "学校助学服务中心于每年11月15日前将当年国家助学金政策落实情况"
                "进行认真总结，并报上级主管部门备案。"
            ),
            score=0.91,
            chunk_id_suffix="national-grant-policy-object-body-role",
            content_role="procedure",
            is_answer_bearing=True,
            semantic_role="procedure_step",
            polarity="positive",
            action_type="archive",
            claim_type="procedure",
        )
        source = replace(
            source,
            anchor=_answer_ready_anchor(
                answer_role="procedure_step",
                condition_subject="application_procedure",
                procedure_step_index=1,
                procedure_actor="school",
                procedure_action="archive",
            ),
        )

        draft = KnowledgeCapability().build_answer(
            EvidenceBundle(
                query_text="中央民族大学本科生国家助学金评审办法",
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            ),
            retrieval_intent=_retrieval_intent(
                kind="policy_object_lookup",
                answer_kind="policy_object",
                collection="student_rules",
                document_ids=("handbook:national-grant",),
                evidence_roles=("document_identity",),
                selection_policy="document_identity_first",
            ),
        )

        self.assertEqual(draft.supporting_sources, (source,))
        self.assertEqual(draft.typed_draft.kind, "short_reference")
        self.assertEqual(draft.presentation_kind, "document_identity")
        self.assertIn("相关依据为", draft.answer_text)
        self.assertIn("中央民族大学本科生国家助学金评审办法", draft.answer_text)
        result = validate_typed_answer_draft(
            draft.typed_draft,
            expected_answer_kind="policy_object",
        )
        self.assertEqual(result.verdict, "valid")

    def test_policy_object_intent_scans_past_non_answer_bearing_title_chunks(self) -> None:
        title = "中央民族大学全日制本科学生学士学位授予补充规定"
        weak_sources = tuple(
            _make_handbook_source(
                doc_id="handbook:degree-supplement",
                title=title,
                snippet=f"{title} 文号：民大校发[2013]218号 第{index}项补充说明。",
                score=0.93 - index / 100,
                chunk_id_suffix=f"degree-supplement-weak-{index}",
                content_role="",
                semantic_role="supporting_detail",
                is_answer_bearing=False,
                anchor=_answer_ready_anchor(
                    answer_role="supporting_detail",
                ),
            )
            for index in range(1, 4)
        )
        answer_ready_source = _make_handbook_source(
            doc_id="handbook:degree-supplement",
            title=title,
            snippet=(
                f"{title} 文号：民大校发[2013]218号 本补充规定经校学位评定委员会审议通过公布执行。"
            ),
            score=0.88,
            chunk_id_suffix="degree-supplement-answer-ready",
            content_role="deadline",
            detail_label="五",
            is_answer_bearing=True,
        )
        answer_ready_source = replace(
            answer_ready_source,
            anchor=_answer_ready_anchor(
                answer_role="time_constraint",
                condition_subject="deadline",
                condition_polarity="positive",
            ),
        )

        draft = KnowledgeCapability().build_answer(
            EvidenceBundle(
                query_text=title,
                corpus="regulations",
                collection="student_rules",
                sources=(*weak_sources, answer_ready_source),
            ),
            retrieval_intent=_retrieval_intent(
                kind="policy_object_lookup",
                answer_kind="policy_object",
                collection="student_rules",
                document_ids=("handbook:degree-supplement",),
                evidence_roles=("document_identity",),
                selection_policy="document_identity_first",
            ),
        )

        self.assertEqual(draft.supporting_sources, (answer_ready_source,))
        self.assertEqual(draft.presentation_kind, "document_identity")
        self.assertIn(f"《{title}》", draft.answer_text)
        result = validate_typed_answer_draft(
            draft.typed_draft,
            expected_answer_kind="policy_object",
        )
        self.assertEqual(result.verdict, "valid")

    def test_general_fact_intent_preserves_answer_ready_condition_draft(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:dormitory-lighting",
            title="中央民族大学关于学生宿舍照明的管理规定",
            snippet=(
                "10月至次年5月31日，周日至周四熄灯时间为每天晚上24:00；"
                "6月1日至9月30日学生宿舍不统一熄灯。"
            ),
            score=0.91,
            chunk_id_suffix="dormitory-lighting-time-rule-general-fact",
            content_role="time_rule",
            is_answer_bearing=True,
        )
        source = replace(
            source,
            anchor=_answer_ready_anchor(
                answer_role="time_constraint",
                condition_subject="deadline",
                condition_polarity="positive",
            ),
        )

        draft = KnowledgeCapability().build_answer(
            EvidenceBundle(
                query_text="宿舍照明",
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            ),
            retrieval_intent=_retrieval_intent(
                kind="general_fact_lookup",
                answer_kind="general_fact",
                collection="student_rules",
            ),
        )

        self.assertEqual(draft.typed_draft.kind, "condition_table")
        result = validate_typed_answer_draft(
            draft.typed_draft,
            expected_answer_kind="general_fact",
        )
        self.assertEqual(result.verdict, "valid")
        self.assertEqual(result.claim_supports[0].claim_type, "time_constraint")

    def test_general_fact_intent_preserves_answer_ready_procedure_draft(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:student-card",
            title="中央民族大学本科(预科)学生证管理办法",
            snippet="学生证遗失后，应先到学院挂失，再提交书面申请办理补办手续。",
            score=0.91,
            chunk_id_suffix="student-card-procedure-general-fact",
            content_role="procedure",
            is_answer_bearing=True,
            semantic_role="procedure_step",
            polarity="positive",
            action_type="reissue",
            claim_type="procedure",
        )
        source = replace(
            source,
            anchor=_answer_ready_anchor(
                answer_role="procedure_step",
                condition_subject="application_procedure",
                procedure_step_index=1,
                procedure_actor="student",
                procedure_action="submit_materials",
            ),
        )

        draft = KnowledgeCapability().build_answer(
            EvidenceBundle(
                query_text="学生证",
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            ),
            retrieval_intent=_retrieval_intent(
                kind="general_fact_lookup",
                answer_kind="general_fact",
                collection="student_rules",
            ),
        )

        self.assertEqual(draft.typed_draft.kind, "procedure_steps")
        result = validate_typed_answer_draft(
            draft.typed_draft,
            expected_answer_kind="general_fact",
        )
        self.assertEqual(result.verdict, "valid")
        self.assertEqual(result.claim_supports[0].claim_type, "procedure_step")

    def test_general_summary_uses_short_factual_summary_draft_for_management_query(
        self,
    ) -> None:
        status_source = _make_handbook_source(
            doc_id="handbook:study-abroad",
            title="中央民族大学本科生境外留学管理办法",
            snippet="参加留学项目学生的学籍在外留学期间仍属于中央民族大学。",
            score=0.91,
            chunk_id_suffix="study-abroad-status-summary-draft",
            detail_label="第八条",
            content_role="article_body",
            is_answer_bearing=True,
        )
        status_source = replace(
            status_source,
            anchor=_answer_ready_anchor(
                answer_role="supporting_detail",
                article_no="第八条",
            ),
        )
        credit_source = _make_handbook_source(
            doc_id="handbook:study-abroad",
            title="中央民族大学本科生境外留学管理办法",
            snippet="境外课程及获得的学分按照协议予以转换和承认。",
            score=0.9,
            chunk_id_suffix="study-abroad-credit-summary-draft",
            detail_label="第十一条",
            content_role="eligibility",
            is_answer_bearing=True,
        )
        credit_source = replace(
            credit_source,
            anchor=_answer_ready_anchor(
                answer_role="eligibility_condition",
                condition_subject="generic_condition",
                condition_polarity="positive",
                article_no="第十一条",
            ),
        )
        grade_source = _make_handbook_source(
            doc_id="handbook:study-abroad",
            title="中央民族大学本科生境外留学管理办法",
            snippet="成绩认定采用对应原则，境外课程必须全部转换登录进入学校学生个人成绩单。",
            score=0.89,
            chunk_id_suffix="study-abroad-grade-summary-draft",
            detail_label="第十二条",
            content_role="article_body",
            is_answer_bearing=True,
        )
        grade_source = replace(
            grade_source,
            anchor=_answer_ready_anchor(
                answer_role="supporting_detail",
                article_no="第十二条",
            ),
        )

        draft = KnowledgeCapability().build_answer(
            EvidenceBundle(
                query_text="本科生出国境外留学期间学籍和成绩怎么管理",
                corpus="regulations",
                collection="student_rules",
                sources=(status_source, credit_source, grade_source),
            ),
            answer_shape=AnswerShape.GENERAL_SUMMARY,
        )

        self.assertEqual(draft.typed_draft.kind, "short_factual_summary")
        self.assertLessEqual(len(draft.typed_draft.references), 2)
        self.assertIn("学籍在外留学期间仍属于中央民族大学", draft.answer_text)
        self.assertEqual(validate_typed_answer_draft(draft.typed_draft).verdict, "valid")

    def test_curriculum_fact_intent_allows_multi_source_short_factual_summary(
        self,
    ) -> None:
        sources = tuple(
            _make_curriculum_plan_source(
                doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                chunk_id=f"curriculum:economics:chunk-00{index}",
                source_title="经济学拔尖人才创新班人才培养方案",
                snippet=snippet,
                score=0.9 - index / 100,
                content_kind="table_unit",
                content_role="table_fact",
                is_answer_bearing=True,
            )
            for index, snippet in enumerate(
                (
                    "通识教育 类别 | 课程号 | 课程名称",
                    "学科基础教育 课程号 | 课程名称 | 学分",
                    "专业核心课程 经济学拔尖人才创新班必修的专业核心课程30学分。",
                    "专业选修课程 经济学拔尖人才创新班专业选修课程至少任选7门课程。",
                ),
                start=1,
            )
        )

        draft = KnowledgeCapability().build_answer(
            EvidenceBundle(
                query_text="经济学拔尖人才创新班人才培养方案课程设置怎么安排",
                corpus="curriculum",
                collection="curriculum_plan",
                sources=sources,
            ),
            retrieval_intent=_retrieval_intent(
                kind="curriculum_fact_lookup",
                answer_kind="curriculum_fact",
                corpus="curriculum",
                collection="curriculum_plan",
                document_ids=("curriculum:经济学拔尖人才创新班人才培养方案",),
            ),
        )

        self.assertEqual(draft.typed_draft.kind, "short_factual_summary")
        self.assertEqual(len(draft.typed_draft.references), 4)
        result = validate_typed_answer_draft(
            draft.typed_draft,
            expected_answer_kind="curriculum_fact",
        )
        self.assertEqual(result.verdict, "valid")

    def test_typed_draft_validation_rejects_answer_kind_mismatch_against_retrieval_intent(
        self,
    ) -> None:
        source = _make_handbook_source(
            doc_id="handbook:demerit-relief",
            title="中央民族大学解除学生纪律处分实施办法",
            snippet="学生受处分满考察期后，可以提交解除处分申请表，经学院审核后报学生处。",
            score=0.82,
            chunk_id_suffix="discipline-procedure-intent-mismatch",
            content_role="procedure",
            is_answer_bearing=True,
            semantic_role="procedure_step",
            polarity="positive",
            action_type="lift_discipline",
            claim_type="procedure",
        )
        source = replace(
            source,
            anchor=_answer_ready_anchor(
                answer_role="procedure_step",
                condition_subject="application_procedure",
                procedure_step_index=1,
                procedure_actor="student",
                procedure_action="submit_materials",
                procedure_materials=("解除处分申请表",),
                procedure_next_actor="college",
            ),
        )

        draft = KnowledgeCapability().build_answer(
            EvidenceBundle(
                query_text="中央民族大学解除学生纪律处分实施办法",
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            ),
            answer_shape=AnswerShape.DETAIL_CLAUSE,
        )

        result = validate_typed_answer_draft(
            draft.typed_draft,
            expected_answer_kind="condition_table",
        )

        self.assertEqual(draft.typed_draft.kind, "procedure_steps")
        self.assertEqual(result.verdict, "invalid")
        self.assertEqual(result.failure_reason, "typed_answer_kind_mismatch")

    def test_category_discovery_answer_has_validated_policy_list_draft(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:national-scholarship",
            title="中央民族大学本科学生国家奖学金评审办法",
            snippet="国家奖学金用于奖励特别优秀的全日制本科学生。",
            score=0.83,
            chunk_id_suffix="national-overview",
            content_role="definition",
            is_answer_bearing=True,
        )
        source = replace(
            source,
            anchor=_answer_ready_anchor(
                answer_role="category_overview",
                category_id="scholarship",
                category_audience="本科生",
                category_member_document_ids=("handbook:national-scholarship",),
                category_member_titles=("中央民族大学本科学生国家奖学金评审办法",),
            ),
        )

        draft = KnowledgeCapability().build_answer(
            EvidenceBundle(
                query_text="本科生有哪些奖学金能申请？",
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            ),
            answer_shape=AnswerShape.CATEGORY_DISCOVERY_LIST,
            category_display_name="奖学金",
            audience="本科生",
        )

        self.assertEqual(draft.typed_draft.kind, "policy_list")
        self.assertEqual(len(draft.typed_draft.items), 1)
        self.assertEqual(draft.typed_draft.items[0].source_id, source.doc_id)
        self.assertEqual(draft.typed_draft.items[0].chunk_id, source.chunk_id)
        self.assertIn("国家奖学金", draft.typed_draft.items[0].text)
        self.assertEqual(validate_typed_answer_draft(draft.typed_draft).verdict, "valid")
        self.assertIn("以当年通知/学院细则为准", draft.answer_text)

    def test_category_discovery_policy_list_can_be_completed_from_registry_backed_member_document(
        self,
    ) -> None:
        source = _make_handbook_source(
            doc_id="handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
            title="中央民族大学本科学生国家奖学金评审办法",
            snippet="国家奖学金用于奖励特别优秀的全日制本科学生。",
            score=0.83,
            chunk_id_suffix="national-overview-registry-support",
            content_role="definition",
            is_answer_bearing=True,
        )

        draft = KnowledgeCapability().build_answer(
            EvidenceBundle(
                query_text="本科生有哪些奖学金能申请？",
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            ),
            answer_shape=AnswerShape.CATEGORY_DISCOVERY_LIST,
            category_id="scholarship",
            category_display_name="奖学金",
            audience="本科生",
        )

        self.assertEqual(draft.typed_draft.kind, "policy_list")
        self.assertEqual(len(draft.typed_draft.items), 1)
        self.assertEqual(draft.typed_draft.items[0].category_id, "scholarship")
        self.assertEqual(draft.typed_draft.items[0].audience, "本科生")
        self.assertIn(source.doc_id, draft.typed_draft.items[0].member_document_ids)
        self.assertEqual(validate_typed_answer_draft(draft.typed_draft).verdict, "valid")
        self.assertIn("《中央民族大学本科学生国家奖学金评审办法》", draft.answer_text)

    def test_procedure_answer_has_validated_procedure_steps_draft(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:demerit-relief",
            title="中央民族大学解除学生纪律处分实施办法",
            snippet="学生受处分满考察期后，可以提交解除处分申请表，经学院审核后报学生处。",
            score=0.82,
            chunk_id_suffix="discipline-procedure",
            content_role="procedure",
            is_answer_bearing=True,
            semantic_role="procedure_step",
            polarity="positive",
            action_type="lift_discipline",
            claim_type="procedure",
        )
        source = replace(
            source,
            anchor=_answer_ready_anchor(
                answer_role="procedure_step",
                condition_subject="application_procedure",
                procedure_step_index=1,
                procedure_actor="student",
                procedure_action="submit_materials",
                procedure_materials=("解除处分申请表",),
                procedure_next_actor="college",
            ),
        )

        draft = KnowledgeCapability().build_answer(
            EvidenceBundle(
                query_text="处分怎么消",
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            )
        )

        self.assertEqual(draft.typed_draft.kind, "procedure_steps")
        self.assertEqual(draft.typed_draft.steps[0].source_id, source.doc_id)
        self.assertEqual(draft.typed_draft.steps[0].chunk_id, source.chunk_id)
        self.assertEqual(draft.typed_draft.steps[0].step_index, 1)
        self.assertIn("解除处分申请表", draft.typed_draft.steps[0].excerpt)
        self.assertEqual(validate_typed_answer_draft(draft.typed_draft).verdict, "valid")

    def test_judgment_answer_has_validated_eligibility_judgment_draft(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:national-scholarship",
            title="中央民族大学本科学生国家奖学金评审办法",
            snippet="学习成绩排名与综合考评成绩排名原则上均应位于前10%。",
            score=0.81,
            chunk_id_suffix="rank-threshold",
            content_role="eligibility",
            is_answer_bearing=True,
        )
        source = replace(
            source,
            anchor=_answer_ready_anchor(
                answer_role="eligibility_condition",
                condition_subject="rank_threshold",
                condition_group_id="handbook:unit:article-1:rank_threshold",
                condition_polarity="positive",
            ),
        )

        draft = KnowledgeCapability().build_answer(
            EvidenceBundle(
                query_text="成绩没前十还能评国奖吗",
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            ),
            answer_shape=AnswerShape.JUDGMENT_CLAUSE,
        )

        self.assertEqual(draft.typed_draft.kind, "eligibility_judgment")
        self.assertEqual(draft.typed_draft.judgment.condition_subject, "rank_threshold")
        self.assertEqual(draft.typed_draft.judgment.source_id, source.doc_id)
        self.assertEqual(validate_typed_answer_draft(draft.typed_draft).verdict, "valid")

    def test_judgment_answer_leads_with_direct_applicability_conclusion(self) -> None:
        source = _make_handbook_source(
            doc_id="institutional_regulation:muc:中央民族大学毕业生就业奖励办法:f16e569519f7",
            title="中央民族大学毕业生就业奖励办法",
            snippet=(
                "第十八条 本办法自公布之日起实施，适用于2019届及以后毕业的学生。"
                "原《中央民族大学关于鼓励应届毕业生到西部到基层就业的奖励办法"
                "（修订）》（民大校发〔2012〕126号）同时废止。"
            ),
            score=0.91,
            chunk_id_suffix="graduate-employment-reward-audience-scope",
            detail_label="第十八条",
            content_role="eligibility",
            is_answer_bearing=True,
        )
        source = replace(
            source,
            collection="institutional_rules",
            anchor=_answer_ready_anchor(
                answer_role="eligibility_condition",
                condition_subject="audience_scope",
                condition_group_id=(
                    "institutional_regulation:muc:中央民族大学毕业生就业奖励办法:"
                    "f16e569519f7:article-18:audience_scope"
                ),
                condition_polarity="positive",
                article_no="第十八条",
            ),
        )

        draft = KnowledgeCapability().build_answer(
            EvidenceBundle(
                query_text="中央民族大学毕业生就业奖励办法适用于2019届及以后毕业生吗",
                corpus="regulations",
                collection="institutional_rules",
                sources=(source,),
            ),
            retrieval_intent=_retrieval_intent(
                kind="eligibility_judgment",
                answer_kind="eligibility_judgment",
                collection="institutional_rules",
                document_ids=(source.doc_id,),
                condition_subject="audience_scope",
            ),
        )

        self.assertTrue(
            draft.answer_text.startswith("是，适用于2019届及以后毕业的学生"),
            draft.answer_text,
        )
        self.assertIn("中央民族大学毕业生就业奖励办法", draft.answer_text)
        self.assertIn("第十八条", draft.answer_text)
        self.assertNotIn("同时废止", draft.answer_text)
        self.assertEqual(draft.typed_draft.kind, "eligibility_judgment")
        self.assertEqual(validate_typed_answer_draft(draft.typed_draft).verdict, "valid")
