from __future__ import annotations

import unittest

from campus_contracts import CapabilityRequest, KnowledgeScope, RagRequestPayload
from campus_ingestion_core.curriculum_program_semester_facts_projection import (
    build_curriculum_program_semester_fact_document_id,
)
from campus_knowledge_capability.curriculum_query_planning import (
    plan_curriculum_course_query,
    plan_curriculum_query,
)
from campus_knowledge_capability.institutional_rules_query_planning import (
    plan_institutional_rules_query,
)
from campus_knowledge_capability.query_planning import plan_student_handbook_query
from campus_knowledge_capability.retrieval_intent import (
    retrieval_intent_for_official_web_stable_reference,
)
from campus_knowledge_capability.service_pipeline import build_rag_pipeline_context


class KnowledgeCapabilityRetrievalIntentPlanningTest(unittest.TestCase):
    def test_handbook_category_discovery_exposes_policy_list_intent(self) -> None:
        plan = plan_student_handbook_query("有哪些本科生可以申请的奖学金")

        intent = plan.retrieval_intent

        self.assertEqual(intent.kind, "policy_list")
        self.assertEqual(intent.expected.answer_kind, "policy_list")
        self.assertEqual(intent.target.corpus, "regulations")
        self.assertEqual(intent.target.collection, "student_rules")
        self.assertEqual(intent.target.category_id, "scholarship")
        self.assertEqual(
            intent.target.category_member_document_ids, plan.category_member_document_ids
        )
        self.assertEqual(intent.expected.coverage_policy, "category_member_coverage")

    def test_handbook_specific_clause_and_judgment_intents_are_distinct(self) -> None:
        clause_plan = plan_student_handbook_query("国奖第九条怎么要求论文和著作？")
        judgment_plan = plan_student_handbook_query("成绩没前十还能评国奖吗？")

        self.assertEqual(clause_plan.retrieval_intent.kind, "specific_clause_lookup")
        self.assertEqual(clause_plan.retrieval_intent.expected.answer_kind, "specific_clause")
        self.assertEqual(clause_plan.retrieval_intent.target.article_nos, ("9",))
        self.assertEqual(clause_plan.retrieval_intent.target.focus_terms, ("论文", "著作"))

        self.assertEqual(judgment_plan.retrieval_intent.kind, "eligibility_judgment")
        self.assertEqual(
            judgment_plan.retrieval_intent.expected.answer_kind,
            "eligibility_judgment",
        )
        self.assertEqual(judgment_plan.retrieval_intent.target.focus_terms, ("前10", "前30"))
        self.assertEqual(
            judgment_plan.retrieval_intent.target.condition_subject,
            "rank_threshold",
        )
        self.assertEqual(
            judgment_plan.retrieval_intent.expected.evidence_roles[:2],
            ("exception_rule", "eligibility_condition"),
        )

    def test_exact_policy_title_with_article_suffix_keeps_target_document(self) -> None:
        plan = plan_student_handbook_query("普通高等学校学生管理规定 第二十四条")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(
            plan.target_document_ids,
            ("handbook:d0a1db59ed9a8b00c4349200916edae208d876f6",),
        )
        self.assertEqual(plan.retrieval_intent.kind, "specific_clause_lookup")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "specific_clause")
        self.assertEqual(plan.retrieval_intent.target.article_nos, ("24",))
        self.assertIn("procedure_step", plan.retrieval_intent.expected.evidence_roles)
        self.assertEqual(plan.retrieval_intent.clarification_reason, "")

    def test_author_order_polluted_national_scholarship_query_is_judgment_intent(self) -> None:
        plan = plan_student_handbook_query(
            "民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？"
        )

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(
            plan.target_document_ids,
            ("handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",),
        )
        self.assertEqual(plan.retrieval_intent.kind, "eligibility_judgment")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "eligibility_judgment")
        self.assertEqual(plan.retrieval_intent.target.condition_subject, "paper_or_publication")
        self.assertIn("第一作者", plan.focused_query_text)
        self.assertIn("第一、二作者", plan.focused_query_text)

    def test_sparse_dormitory_fixed_phrases_resolve_to_condition_intents(self) -> None:
        lighting_plan = plan_student_handbook_query("宿舍照明")
        appliance_plan = plan_student_handbook_query("电器使用管理")

        self.assertEqual(lighting_plan.status, "resolved")
        self.assertEqual(
            lighting_plan.target_document_ids,
            ("handbook:2ec80263a9e7b11379281349196ceb96afa44c3b",),
        )
        self.assertEqual(lighting_plan.retrieval_intent.kind, "condition_table")
        self.assertEqual(lighting_plan.retrieval_intent.target.condition_subject, "deadline")

        self.assertEqual(appliance_plan.status, "resolved")
        self.assertEqual(
            appliance_plan.target_document_ids,
            ("handbook:a633b4ce84d8d92e1d98f97c57491ec24e8be834",),
        )
        self.assertEqual(appliance_plan.retrieval_intent.kind, "condition_table")
        self.assertEqual(appliance_plan.retrieval_intent.target.condition_subject, "")
        self.assertIn("exclusion_rule", appliance_plan.retrieval_intent.expected.evidence_roles)

    def test_exact_policy_title_with_selection_terms_stays_document_identity_intent(self) -> None:
        for query in (
            "中央民族大学十佳大学生评选办法",
            "中央民族大学本科学生先进班集体评选办法",
            "中央民族大学优秀本科毕业生评选办法",
        ):
            plan = plan_student_handbook_query(query)
            with self.subTest(query=query):
                self.assertEqual(plan.status, "resolved")
                self.assertEqual(plan.retrieval_intent.kind, "policy_object_lookup")
                self.assertEqual(plan.retrieval_intent.expected.answer_kind, "policy_object")
                self.assertEqual(
                    plan.retrieval_intent.expected.selection_policy,
                    "document_identity_first",
                )

    def test_governing_document_query_uses_document_identity_intent(self) -> None:
        plan = plan_student_handbook_query("学生安全教育和事故管理按哪个规定执行")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(plan.retrieval_intent.kind, "policy_object_lookup")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "policy_object")
        self.assertEqual(
            plan.retrieval_intent.target.document_ids,
            ("handbook:53a0861781aba2462c1db5dba0059babe2341f3b",),
        )
        self.assertEqual(
            plan.retrieval_intent.expected.selection_policy,
            "document_identity_first",
        )

    def test_national_scholarship_paper_judgment_targets_publication_condition(
        self,
    ) -> None:
        plan = plan_student_handbook_query("论文能不能算国奖条件")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(plan.retrieval_intent.kind, "eligibility_judgment")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "eligibility_judgment")
        self.assertEqual(
            plan.retrieval_intent.target.condition_subject,
            "paper_or_publication",
        )
        self.assertEqual(
            plan.retrieval_intent.expected.evidence_roles[:1],
            ("example_evidence",),
        )
        self.assertIn("发表", plan.focused_query_text)

    def test_handbook_procedure_and_condition_intents_are_distinct(self) -> None:
        procedure_plan = plan_student_handbook_query("学生证丢了怎么办")
        condition_plan = plan_student_handbook_query("学位有什么要求")

        self.assertEqual(procedure_plan.retrieval_intent.kind, "procedure_steps")
        self.assertEqual(procedure_plan.retrieval_intent.expected.answer_kind, "procedure_steps")

        self.assertEqual(condition_plan.retrieval_intent.kind, "condition_table")
        self.assertEqual(condition_plan.retrieval_intent.expected.answer_kind, "condition_table")

    def test_discipline_relief_operation_query_uses_procedure_intent(self) -> None:
        plan = plan_student_handbook_query("处分怎么消")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(plan.retrieval_intent.kind, "procedure_steps")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "procedure_steps")
        self.assertEqual(
            plan.retrieval_intent.target.condition_subject,
            "application_procedure",
        )
        self.assertEqual(
            plan.retrieval_intent.expected.evidence_roles[:1],
            ("procedure_step",),
        )

    def test_single_member_category_query_resolves_to_specific_policy_intent(self) -> None:
        plan = plan_student_handbook_query("公费医疗报销需要什么材料")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(plan.task_kind, "specific_policy_lookup")
        self.assertEqual(plan.category_id, "public_medical")
        self.assertEqual(
            plan.resolved_policy_document_id,
            "handbook:b85de1cb327a26dc63488e247403ae3126d524be",
        )
        self.assertEqual(plan.retrieval_intent.kind, "condition_table")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "condition_table")
        self.assertEqual(
            plan.retrieval_intent.target.document_ids,
            ("handbook:b85de1cb327a26dc63488e247403ae3126d524be",),
        )
        self.assertEqual(
            plan.retrieval_intent.target.condition_subject,
            "material_requirement",
        )

    def test_material_requirement_intent_admits_supporting_detail_evidence(self) -> None:
        plan = plan_student_handbook_query("申请解除处分需要提交哪些材料")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(plan.retrieval_intent.kind, "condition_table")
        self.assertEqual(
            plan.retrieval_intent.target.condition_subject,
            "material_requirement",
        )
        self.assertIn("supporting_detail", plan.retrieval_intent.expected.evidence_roles)

    def test_hearing_application_query_targets_hearing_policy_intent(self) -> None:
        plan = plan_student_handbook_query("学生什么时候可以申请听证")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(
            plan.resolved_policy_document_id, "handbook:1b7c532ecdbc8afe1820d2c55dfba911d891e37a"
        )
        self.assertEqual(plan.retrieval_intent.kind, "condition_table")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "condition_table")
        self.assertEqual(plan.retrieval_intent.target.condition_subject, "deadline")
        self.assertIn("time_constraint", plan.retrieval_intent.expected.evidence_roles)
        self.assertIn("听证申请", plan.focused_query_text)
        self.assertIn("10日内", plan.focused_query_text)

    def test_appeal_after_discipline_query_preserves_written_appeal_focus(self) -> None:
        plan = plan_student_handbook_query("学生对处分决定不服应该按什么程序申诉")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(
            plan.resolved_policy_document_id,
            "handbook:1e404fb7e280b32c46f09280590255c57e6bd72d",
        )
        self.assertEqual(plan.retrieval_intent.kind, "procedure_steps")
        self.assertEqual(
            plan.retrieval_intent.target.condition_subject,
            "application_procedure",
        )
        self.assertIn("time_constraint", plan.retrieval_intent.expected.evidence_roles)
        self.assertIn("书面申诉", plan.focused_query_text)
        self.assertIn("10日内", plan.focused_query_text)

    def test_reissue_procedure_intent_admits_adjacent_material_and_time_evidence(self) -> None:
        plan = plan_student_handbook_query("学生证丢了怎么办")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(plan.retrieval_intent.kind, "procedure_steps")
        self.assertIn("procedure_step", plan.retrieval_intent.expected.evidence_roles)
        self.assertIn("material_requirement", plan.retrieval_intent.expected.evidence_roles)
        self.assertIn("time_constraint", plan.retrieval_intent.expected.evidence_roles)

    def test_multi_member_category_specific_award_condition_query_fails_closed_as_clarification(
        self,
    ) -> None:
        plan = plan_student_handbook_query("奖学金申请条件是什么")

        self.assertEqual(plan.status, "needs_clarification")
        self.assertEqual(plan.task_kind, "specific_policy_lookup")
        self.assertEqual(plan.category_id, "scholarship")
        self.assertEqual(plan.retrieval_intent.kind, "clarification_required")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "clarification")
        self.assertEqual(plan.retrieval_intent.clarification_reason, "category_policy_ambiguous")

    def test_multi_member_category_overview_condition_query_uses_condition_intent(self) -> None:
        plan = plan_student_handbook_query("申请奖学金需要满足什么条件")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(plan.task_kind, "specific_policy_lookup")
        self.assertEqual(plan.category_id, "scholarship")
        self.assertEqual(plan.retrieval_intent.kind, "condition_table")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "condition_table")
        self.assertEqual(
            plan.retrieval_intent.expected.coverage_policy,
            "category_member_coverage",
        )
        self.assertEqual(
            plan.retrieval_intent.expected.selection_policy,
            "one_answer_ready_source_per_member",
        )
        self.assertEqual(
            plan.retrieval_intent.target.category_member_document_ids,
            plan.category_member_document_ids,
        )

    def test_attendance_absence_threshold_query_uses_condition_intent_without_clarification(
        self,
    ) -> None:
        plan = plan_student_handbook_query("旷课多少学时会按违纪处理")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(plan.task_kind, "specific_policy_lookup")
        self.assertEqual(
            plan.target_document_ids,
            (
                "handbook:9350d885657d7409e524e73666b828b826f07191",
                "handbook:e53d05ae90e91f1c45843c50c3a777f774a88afc",
            ),
        )
        self.assertEqual(plan.retrieval_intent.kind, "condition_table")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "condition_table")
        self.assertEqual(
            plan.retrieval_intent.target.document_ids,
            (
                "handbook:9350d885657d7409e524e73666b828b826f07191",
                "handbook:e53d05ae90e91f1c45843c50c3a777f774a88afc",
            ),
        )
        self.assertEqual(
            plan.retrieval_intent.target.condition_subject,
            "attendance_absence_threshold",
        )
        self.assertEqual(
            plan.retrieval_intent.expected.coverage_policy,
            "condition_subject_alignment",
        )
        self.assertEqual(plan.retrieval_intent.expected.selection_policy, "answer_role_first")
        self.assertIn("旷课", plan.retrieval_intent.critical_terms)
        self.assertNotIn("procedure_step", plan.retrieval_intent.expected.evidence_roles)

    def test_disciplinary_relief_how_long_query_uses_condition_intent_not_procedure(
        self,
    ) -> None:
        plan = plan_student_handbook_query("被处分后多久可以申请解除处分")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(plan.retrieval_intent.kind, "condition_table")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "condition_table")
        self.assertEqual(
            plan.retrieval_intent.target.condition_subject,
            "discipline_relief_condition",
        )
        self.assertIn("考察期", plan.retrieval_intent.critical_terms)
        self.assertIn("考察期", plan.focused_query_text)
        self.assertIn("条件", plan.focused_query_text)
        self.assertNotIn("procedure_step", plan.retrieval_intent.expected.evidence_roles)

    def test_disciplinary_relief_exclusion_query_uses_exclusion_condition_intent(
        self,
    ) -> None:
        plan = plan_student_handbook_query("哪些情况不能解除处分")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(plan.retrieval_intent.kind, "condition_table")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "condition_table")
        self.assertEqual(
            plan.retrieval_intent.target.condition_subject,
            "discipline_relief_exclusion",
        )
        self.assertEqual(plan.retrieval_intent.expected.evidence_roles, ("exclusion_rule",))
        self.assertIn("不予", plan.focused_query_text)
        self.assertIn("情形", plan.focused_query_text)
        self.assertNotIn("procedure_step", plan.retrieval_intent.expected.evidence_roles)

    def test_amount_query_prefers_table_fact_role_over_quota_conditions(self) -> None:
        plan = plan_student_handbook_query("专业奖学金一等奖金额是多少？")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(plan.retrieval_intent.kind, "condition_table")
        self.assertEqual(
            plan.retrieval_intent.target.condition_subject,
            "amount_or_quota",
        )
        self.assertEqual(
            plan.retrieval_intent.expected.evidence_roles[:2],
            ("table_fact", "eligibility_condition"),
        )
        self.assertIn("金额", plan.focused_query_text)
        self.assertNotIn("名额", plan.focused_query_text)
        self.assertNotIn("比例", plan.focused_query_text)

    def test_curriculum_named_document_total_credit_query_uses_fact_lookup_intent(self) -> None:
        plan = plan_curriculum_query("民族学本科人才培养方案总学分要求是多少")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(plan.retrieval_intent.kind, "curriculum_fact_lookup")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "curriculum_fact")
        self.assertEqual(
            plan.retrieval_intent.target.document_ids,
            ("curriculum:民族学本科人才培养方案",),
        )

    def test_curriculum_semester_course_query_uses_program_semester_fact_intent_target(
        self,
    ) -> None:
        plan = plan_curriculum_query("法学民族实验班培养方案里第四学期有什么课")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(plan.intent_kind, "course_list")
        self.assertEqual(plan.retrieval_intent.kind, "curriculum_fact_lookup")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "curriculum_fact")
        self.assertEqual(plan.retrieval_intent.target.corpus, "curriculum")
        self.assertEqual(plan.retrieval_intent.target.collection, "program_semester_facts")
        self.assertEqual(
            plan.retrieval_intent.target.document_ids,
            (
                build_curriculum_program_semester_fact_document_id(
                    "curriculum:法学（民族实验班）本科人才培养方案",
                    "第四学期",
                ),
            ),
        )
        self.assertIn(
            "semester_course_list",
            plan.retrieval_intent.expected.evidence_roles,
        )

    def test_handbook_clarification_exposes_clarification_intent(self) -> None:
        plan = plan_student_handbook_query("奖学金怎么申请？")

        self.assertEqual(plan.retrieval_intent.kind, "clarification_required")
        self.assertEqual(plan.retrieval_intent.clarification_reason, "ambiguous_procedure")

    def test_institutional_public_service_plan_exposes_policy_list_intent(self) -> None:
        plan = plan_institutional_rules_query("校园网密码怎么改")

        self.assertEqual(plan.retrieval_intent.kind, "policy_list")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "policy_list")
        self.assertEqual(plan.retrieval_intent.target.corpus, "regulations")
        self.assertEqual(plan.retrieval_intent.target.collection, "institutional_rules")
        self.assertEqual(plan.retrieval_intent.target.category_id, "public_service")
        self.assertEqual(
            plan.retrieval_intent.target.category_member_document_ids,
            plan.target_document_ids,
        )

    def test_institutional_governance_plan_exposes_policy_object_intent(self) -> None:
        plan = plan_institutional_rules_query("学术委员会章程是什么")

        self.assertEqual(plan.retrieval_intent.kind, "policy_object_lookup")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "policy_object")
        self.assertEqual(
            plan.retrieval_intent.expected.evidence_roles,
            ("document_identity",),
        )
        self.assertEqual(
            plan.retrieval_intent.expected.selection_policy,
            "document_identity_first",
        )
        self.assertEqual(plan.retrieval_intent.target.collection, "institutional_rules")
        self.assertEqual(plan.retrieval_intent.target.document_ids, plan.target_document_ids)
        self.assertEqual(plan.retrieval_intent.target.category_member_document_ids, ())

    def test_institutional_exact_released_title_uses_policy_object_intent_without_static_group(
        self,
    ) -> None:
        title = "中央民族大学丰台校区就医管理办法（暂行）"
        plan = plan_institutional_rules_query(title)

        self.assertEqual(plan.task_kind, "specific_policy_lookup")
        self.assertEqual(plan.retrieval_intent.kind, "policy_object_lookup")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "policy_object")
        self.assertEqual(plan.retrieval_intent.target.collection, "institutional_rules")
        self.assertEqual(
            plan.retrieval_intent.target.document_ids,
            ("institutional_regulation:muc:中央民族大学丰台校区就医管理办法-暂行:ff711d1185f9",),
        )
        self.assertEqual(plan.retrieval_intent.target.document_titles, (title,))
        self.assertEqual(plan.retrieval_intent.target.category_member_document_ids, ())

    def test_institutional_title_with_condition_terms_stays_policy_object_intent(self) -> None:
        title = "中央民族大学本科毕业论文（设计）工作管理办法"
        plan = plan_institutional_rules_query(title)

        self.assertEqual(plan.mode, "title_targeted")
        self.assertEqual(plan.task_kind, "specific_policy_lookup")
        self.assertEqual(plan.retrieval_intent.kind, "policy_object_lookup")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "policy_object")
        self.assertEqual(
            plan.retrieval_intent.target.document_ids,
            (
                "institutional_regulation:muc:"
                "中央民族大学本科毕业论文-设计-工作管理办法:a7716c82cbe1",
            ),
        )
        self.assertEqual(plan.retrieval_intent.target.document_titles, (title,))
        self.assertEqual(plan.retrieval_intent.target.category_member_document_ids, ())

    def test_institutional_exact_title_with_selection_terms_stays_policy_object_intent(
        self,
    ) -> None:
        title = "中央民族大学优秀研究生导师、优秀研究生导师团队评选办法（试行）"
        plan = plan_institutional_rules_query(title)

        self.assertEqual(plan.mode, "title_targeted")
        self.assertEqual(plan.task_kind, "specific_policy_lookup")
        self.assertEqual(plan.retrieval_intent.kind, "policy_object_lookup")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "policy_object")
        self.assertEqual(
            plan.retrieval_intent.target.document_ids,
            (
                "institutional_regulation:muc:"
                "中央民族大学优秀研究生导师-优秀研究生导师团队评选办法-试行:8c293d7d2b82",
            ),
        )
        self.assertEqual(plan.retrieval_intent.target.document_titles, (title,))
        self.assertEqual(plan.retrieval_intent.target.category_member_document_ids, ())

    def test_institutional_known_title_with_scope_question_targets_document_condition(
        self,
    ) -> None:
        plan = plan_institutional_rules_query(
            "中央民族大学毕业生就业奖励办法适用于2019届及以后毕业生吗"
        )

        self.assertEqual(plan.mode, "title_targeted")
        self.assertEqual(
            plan.target_document_ids,
            ("institutional_regulation:muc:中央民族大学毕业生就业奖励办法:f16e569519f7",),
        )
        self.assertEqual(plan.retrieval_intent.kind, "eligibility_judgment")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "eligibility_judgment")
        self.assertEqual(plan.retrieval_intent.target.condition_subject, "audience_scope")
        self.assertEqual(plan.retrieval_intent.target.document_ids, plan.target_document_ids)

    def test_institutional_three_assists_alias_targets_single_policy_object(self) -> None:
        plan = plan_institutional_rules_query("研究生助教助研助管工作应该依据哪份管理办法？")

        self.assertEqual(plan.mode, "title_targeted")
        self.assertEqual(
            plan.target_document_ids,
            ("institutional_regulation:muc:中央民族大学研究生-三助-工作管理办法:49319e7c44d3",),
        )
        self.assertEqual(plan.retrieval_intent.kind, "policy_object_lookup")
        self.assertEqual(plan.retrieval_intent.target.document_ids, plan.target_document_ids)
        self.assertEqual(
            plan.retrieval_intent.target.document_titles,
            ("中央民族大学研究生“三助”工作管理办法",),
        )

    def test_institutional_public_service_deadline_query_exposes_typed_condition_intent(
        self,
    ) -> None:
        plan = plan_institutional_rules_query("二级网站安全问题要多久上报")

        self.assertEqual(plan.target_document_ids, ("official_web_regulation:ce565b348ca6ee31",))
        self.assertEqual(plan.retrieval_intent.kind, "condition_table")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "condition_table")
        self.assertEqual(plan.retrieval_intent.target.collection, "institutional_rules")
        self.assertEqual(
            plan.retrieval_intent.target.document_ids,
            ("official_web_regulation:ce565b348ca6ee31",),
        )
        self.assertEqual(plan.retrieval_intent.target.condition_subject, "deadline")
        self.assertIn("time_constraint", plan.retrieval_intent.expected.evidence_roles)

    def test_explicit_institutional_rules_scope_uses_institutional_retrieval_intent(self) -> None:
        pipeline = build_rag_pipeline_context(
            CapabilityRequest(
                capability="knowledge",
                user_goal="二级网站安全问题要多久上报",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="institutional_rules")
                ),
            ),
            prompt_executor=None,
        )

        self.assertIsNotNone(pipeline.retrieval_intent)
        assert pipeline.retrieval_intent is not None
        self.assertEqual(pipeline.retrieval_intent.kind, "condition_table")
        self.assertEqual(pipeline.retrieval_intent.expected.answer_kind, "condition_table")
        self.assertEqual(
            pipeline.retrieval_intent.target.document_ids,
            ("official_web_regulation:ce565b348ca6ee31",),
        )
        self.assertEqual(pipeline.retrieval_intent.target.condition_subject, "deadline")

    def test_curriculum_plan_exposes_curriculum_fact_intent(self) -> None:
        plan = plan_curriculum_query("计算机科学与技术培养方案总学分是多少")

        self.assertEqual(plan.retrieval_intent.kind, "curriculum_fact_lookup")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "curriculum_fact")
        self.assertEqual(plan.retrieval_intent.target.corpus, "curriculum")
        self.assertEqual(plan.retrieval_intent.target.collection, "curriculum_plan")

    def test_curriculum_title_only_query_exposes_reference_intent(self) -> None:
        plan = plan_curriculum_query("民族学本科人才培养方案")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(plan.intent_kind, "generic")
        self.assertEqual(plan.retrieval_intent.kind, "curriculum_document_lookup")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "curriculum_document")
        self.assertEqual(plan.retrieval_intent.target.corpus, "curriculum")
        self.assertEqual(plan.retrieval_intent.target.collection, "curriculum_plan")
        self.assertEqual(plan.retrieval_intent.target.document_ids, plan.target_document_ids)

    def test_curriculum_course_plan_exposes_curriculum_fact_intent(self) -> None:
        plan = plan_curriculum_course_query("思政课第几学期开")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.retrieval_intent.kind, "curriculum_fact_lookup")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "curriculum_fact")
        self.assertEqual(plan.retrieval_intent.target.collection, "course_facts")
        self.assertEqual(plan.retrieval_intent.target.document_ids, ())
        self.assertEqual(plan.retrieval_intent.critical_terms, ("schedule",))

    def test_official_web_stable_reference_exposes_reference_intent(self) -> None:
        intent = retrieval_intent_for_official_web_stable_reference(
            query_text="中央民族大学学校简介",
            scope=KnowledgeScope(corpus="official_web", collection="stable_reference"),
        )

        self.assertEqual(intent.kind, "official_reference_lookup")
        self.assertEqual(intent.expected.answer_kind, "official_reference")
        self.assertEqual(intent.target.corpus, "official_web")
        self.assertEqual(intent.target.collection, "stable_reference")

    def test_explicit_student_rules_scope_never_leaves_retrieval_intent_unset(self) -> None:
        pipeline = build_rag_pipeline_context(
            CapabilityRequest(
                capability="knowledge",
                user_goal="学校几点开门",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            prompt_executor=None,
        )

        self.assertIsNotNone(pipeline.retrieval_intent)
        assert pipeline.retrieval_intent is not None
        self.assertEqual(pipeline.retrieval_intent.kind, "general_fact_lookup")
        self.assertEqual(pipeline.retrieval_intent.expected.answer_kind, "general_fact")
        self.assertEqual(pipeline.retrieval_intent.target.corpus, "regulations")
        self.assertEqual(pipeline.retrieval_intent.target.collection, "student_rules")

    def test_explicit_curriculum_scope_never_leaves_retrieval_intent_unset(self) -> None:
        pipeline = build_rag_pipeline_context(
            CapabilityRequest(
                capability="knowledge",
                user_goal="学校几点开门",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            prompt_executor=None,
        )

        self.assertIsNotNone(pipeline.retrieval_intent)
        assert pipeline.retrieval_intent is not None
        self.assertEqual(pipeline.retrieval_intent.kind, "curriculum_fact_lookup")
        self.assertEqual(pipeline.retrieval_intent.expected.answer_kind, "curriculum_fact")
        self.assertEqual(pipeline.retrieval_intent.target.corpus, "curriculum")
        self.assertEqual(pipeline.retrieval_intent.target.collection, "curriculum_plan")


if __name__ == "__main__":
    unittest.main()
