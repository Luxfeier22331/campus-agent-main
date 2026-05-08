from __future__ import annotations

import unittest

from campus_shared.regulation_semantic_patterns import (
    RegulationSemanticsRegistry,
    infer_negative_semantic_role,
    infer_regulation_body_content_role,
    infer_table_fact_type,
    load_default_regulation_semantics_registry,
    looks_like_condition_claim_text,
    looks_like_deadline_constraint_text,
    looks_like_requirement_text,
    starts_example_list,
    starts_procedure_list,
)
from campus_shared.regulation_semantic_registry import (
    REGULATION_CONDITION_SUBJECT_DEFINITIONS,
    REGULATION_PROCEDURE_ACTION_DEFINITIONS,
    REGULATION_PROCEDURE_ACTOR_DEFINITIONS,
    canonical_regulation_condition_subject,
    canonical_regulation_procedure_action,
    canonical_regulation_procedure_actor,
    load_student_rules_discovery_config,
    regulation_categories_for_document,
    resolve_regulation_action_type,
    resolve_regulation_answer_role,
    resolve_regulation_condition_group_subject,
    resolve_regulation_condition_subject,
    resolve_regulation_expected_polarity,
    resolve_regulation_group_intro_kind,
    resolve_regulation_group_subject,
    resolve_regulation_heading_role_hint,
    resolve_regulation_intro_list_role_hint,
    resolve_regulation_intro_scope,
    resolve_regulation_intro_subject,
    resolve_regulation_procedure_action,
    resolve_regulation_procedure_actor,
    resolve_regulation_procedure_materials,
    resolve_regulation_procedure_next_actor,
    resolve_regulation_section_subject_hint,
)


class RegulationSemanticRegistryTest(unittest.TestCase):
    def test_shared_regulation_semantic_patterns_owner_exposes_default_registry(self) -> None:
        registry = load_default_regulation_semantics_registry()

        self.assertIsInstance(registry, RegulationSemanticsRegistry)
        self.assertIn("具体表现如下", registry.example_list_markers)
        self.assertIn("程序如下", registry.procedure_intro_markers)
        self.assertIn("不予", registry.negative_polarity_keywords)
        self.assertIn("截止", registry.deadline_keywords)

    def test_shared_regulation_semantic_pattern_helpers_cover_common_regulation_cues(self) -> None:
        self.assertTrue(starts_example_list("具体表现如下："))
        self.assertTrue(starts_procedure_list("按如下程序办理："))
        self.assertEqual(
            infer_negative_semantic_role("有下列情形之一的，不予解除处分"),
            "exception",
        )
        self.assertTrue(looks_like_requirement_text("学生应当提交申请材料"))
        self.assertTrue(looks_like_condition_claim_text("符合条件者可以申请"))
        self.assertTrue(looks_like_deadline_constraint_text("应在规定期限前完成"))
        self.assertEqual(
            infer_table_fact_type(
                text="奖学金等级 | 奖励金额 | 名额\n一等奖 | 3000元 | 10人",
                metadata={"caption_lines": ("专业奖学金标准",)},
            ),
            "amount_or_quota",
        )

    def test_shared_regulation_body_content_role_covers_common_clause_types(self) -> None:
        cases = (
            ("适用范围", "总则", "本办法适用于全日制本科生。", "scope_rule"),
            ("办理时间", "办理时间", "每周一至周五 8:00-17:00 办理。", "time_rule"),
            ("申诉期限", "申诉期限", "学生应在规定期限前完成申请。", "deadline"),
            ("申请条件", "申请条件", "凡符合条件者均可申请。", "eligibility"),
            ("术语释义", "术语释义", "本办法所称学生是指我校全日制在校生。", "definition"),
            ("办理程序", "办理程序", "（一）学生提交申请。\n（二）学院审核。", "procedure"),
            ("材料要求", "材料要求", "学生应当提交申请材料。", "requirement"),
        )

        for detail_label, section_leaf, text, expected in cases:
            with self.subTest(detail_label=detail_label, expected=expected):
                self.assertEqual(
                    infer_regulation_body_content_role(
                        detail_label=detail_label,
                        section_leaf=section_leaf,
                        text=text,
                    ),
                    expected,
                )

    def test_shared_student_rules_registry_covers_non_scholarship_categories(self) -> None:
        discovery = load_student_rules_discovery_config()
        categories_by_id = {category.category_id: category for category in discovery.categories}

        self.assertIn("scholarship", categories_by_id)
        self.assertIn("student_status", categories_by_id)
        self.assertIn("discipline", categories_by_id)
        self.assertIn("student_card_affairs", categories_by_id)
        self.assertIn("dormitory_management", categories_by_id)

        self.assertEqual(categories_by_id["student_status"].audience, "本科生")
        self.assertEqual(categories_by_id["discipline"].audience, "学生")
        self.assertEqual(
            categories_by_id["student_card_affairs"].overview_document_id,
            "handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",
        )

    def test_single_document_can_belong_to_multiple_category_overviews(self) -> None:
        categories = regulation_categories_for_document(
            collection="student_rules",
            document_id="handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",
        )

        self.assertEqual(
            tuple(category.category_id for category in categories),
            ("student_status", "student_card_affairs"),
        )

    def test_institutional_rules_registry_exposes_shared_category_overview_membership(self) -> None:
        categories = regulation_categories_for_document(
            collection="institutional_rules",
            document_id="official_web_regulation:0a420e3fe367027c",
        )

        self.assertEqual(
            tuple(category.category_id for category in categories), ("public_service",)
        )
        category = categories[0]
        self.assertEqual(category.display_name, "校园服务制度")
        self.assertEqual(category.audience, "校园成员")
        self.assertEqual(
            category.overview_document_id,
            "official_web_regulation:0a420e3fe367027c",
        )
        self.assertIn(
            "official_web_regulation:7c62688242b9f47b",
            category.member_policy_document_ids,
        )

    def test_shared_taxonomy_definitions_carry_governance_metadata(self) -> None:
        procedure = REGULATION_PROCEDURE_ACTION_DEFINITIONS["submit_materials"]
        actor = REGULATION_PROCEDURE_ACTOR_DEFINITIONS["student"]
        subject = REGULATION_CONDITION_SUBJECT_DEFINITIONS["application_procedure"]
        rank_threshold = REGULATION_CONDITION_SUBJECT_DEFINITIONS["rank_threshold"]
        academic_performance = REGULATION_CONDITION_SUBJECT_DEFINITIONS["academic_performance"]
        generic_condition = REGULATION_CONDITION_SUBJECT_DEFINITIONS["generic_condition"]

        self.assertEqual(procedure.action_id, "submit_materials")
        self.assertTrue(procedure.description)
        self.assertEqual(procedure.expected_answer_roles, ("procedure_step",))
        self.assertTrue(procedure.release_blocking)

        self.assertEqual(actor.actor_id, "student")
        self.assertTrue(actor.description)
        self.assertEqual(actor.expected_answer_roles, ("procedure_step",))
        self.assertTrue(actor.release_blocking)

        self.assertEqual(subject.subject_id, "application_procedure")
        self.assertTrue(subject.description)
        self.assertIn("procedure_step", subject.expected_answer_roles)
        self.assertTrue(subject.release_blocking)
        self.assertIn("table_fact", rank_threshold.expected_answer_roles)
        self.assertIn("table_fact", academic_performance.expected_answer_roles)
        self.assertIn("table_fact", generic_condition.expected_answer_roles)

    def test_shared_condition_subject_canonicalization_handles_legacy_aliases(self) -> None:
        self.assertEqual(
            canonical_regulation_condition_subject("discipline_relief_procedure"),
            "application_procedure",
        )
        self.assertEqual(
            canonical_regulation_condition_subject("general_eligibility"),
            "generic_condition",
        )
        self.assertEqual(
            canonical_regulation_condition_subject("rank_threshold"),
            "rank_threshold",
        )

    def test_shared_procedure_actor_canonicalization_handles_registry_aliases(self) -> None:
        self.assertEqual(canonical_regulation_procedure_actor("申请人"), "applicant")
        self.assertEqual(canonical_regulation_procedure_actor("学生本人"), "student")
        self.assertEqual(canonical_regulation_procedure_actor("教务处"), "academic_affairs_office")
        self.assertEqual(canonical_regulation_procedure_actor("college"), "college")

    def test_shared_condition_subject_resolution_canonicalizes_explicit_alias(self) -> None:
        assignment = resolve_regulation_condition_subject(
            text="申请人应当品行端正。",
            answer_role="eligibility_condition",
            explicit_condition_subject="general_eligibility",
        )

        self.assertEqual(assignment.value, "generic_condition")
        self.assertEqual(assignment.provenance, "metadata:condition_subject")

    def test_shared_condition_subject_resolution_prefers_structured_group_subject(self) -> None:
        assignment = resolve_regulation_condition_subject(
            text="受到留校察看处分。",
            answer_role="exclusion_rule",
            condition_group_subject="discipline_relief_exclusion",
        )

        self.assertEqual(assignment.value, "discipline_relief_exclusion")
        self.assertEqual(assignment.provenance, "metadata:condition_group_subject")

    def test_shared_condition_subject_resolution_prefers_structured_intro_subject(self) -> None:
        assignment = resolve_regulation_condition_subject(
            text="参评本科学生国家奖学金还须具备以下条件之一:",
            answer_role="eligibility_intro",
            intro_target_roles=("exception_rule", "example_evidence"),
            introduced_condition_subject="rank_threshold",
        )

        self.assertEqual(assignment.value, "rank_threshold")
        self.assertEqual(assignment.provenance, "metadata:introduced_condition_subject")

    def test_shared_condition_subject_resolution_maps_time_intro_target_roles(self) -> None:
        assignment = resolve_regulation_condition_subject(
            text="申诉期限如下:",
            answer_role="eligibility_intro",
            intro_target_roles=("time_constraint",),
        )

        self.assertEqual(assignment.value, "deadline")
        self.assertEqual(assignment.provenance, "intro_target_roles:time_constraint")

    def test_shared_condition_subject_resolution_maps_generic_policy_table_to_academic_performance(
        self,
    ) -> None:
        assignment = resolve_regulation_condition_subject(
            text="最低毕业学分 | 培养方案要求",
            answer_role="table_fact",
            table_fact_type="generic_policy_table",
        )

        self.assertEqual(assignment.value, "academic_performance")
        self.assertEqual(
            assignment.provenance,
            "table_fact_type:generic_policy_table+keyword:学分培养要求",
        )

    def test_shared_group_subject_resolution_supports_security_mixed_clause_head(self) -> None:
        assignment = resolve_regulation_group_subject(
            text="信息系统建设须达到学校安全等级要求",
            answer_role="eligibility_condition",
        )

        self.assertEqual(
            assignment.value,
            "security_or_confidentiality_requirement",
        )
        self.assertEqual(
            assignment.provenance,
            "keyword:安全保密要求",
        )

    def test_shared_group_subject_resolution_supports_discipline_exclusion_group(self) -> None:
        assignment = resolve_regulation_group_subject(
            text="受到留校察看处分",
            answer_role="exclusion_rule",
            action_type="lift_discipline",
        )

        self.assertEqual(assignment.value, "discipline_relief_exclusion")
        self.assertEqual(
            assignment.provenance,
            "action_type:lift_discipline+answer_role:exclusion_rule",
        )

    def test_shared_condition_group_subject_resolution_prefers_explicit_group_subject(
        self,
    ) -> None:
        assignment = resolve_regulation_condition_group_subject(
            text="在核心期刊上发表高水平论文。",
            answer_role="example_evidence",
            fallback_condition_subject="paper_or_publication",
            explicit_condition_group_subject="rank_threshold",
        )

        self.assertEqual(assignment.value, "rank_threshold")
        self.assertEqual(assignment.provenance, "metadata:condition_group_subject")

    def test_shared_condition_group_subject_resolution_maps_table_fact_type_without_condition_subject(
        self,
    ) -> None:
        assignment = resolve_regulation_condition_group_subject(
            text="公示期限 | 5个工作日",
            answer_role="table_fact",
            table_fact_type="timeline_or_deadline",
        )

        self.assertEqual(assignment.value, "deadline")
        self.assertEqual(assignment.provenance, "table_fact_type:timeline_or_deadline")

    def test_shared_condition_group_subject_resolution_uses_intro_target_roles(self) -> None:
        assignment = resolve_regulation_condition_group_subject(
            text="申诉期限如下:",
            answer_role="eligibility_intro",
            intro_target_roles=("time_constraint",),
            fallback_condition_subject="generic_condition",
        )

        self.assertEqual(assignment.value, "deadline")
        self.assertEqual(assignment.provenance, "intro_target_roles:time_constraint")

    def test_shared_action_type_resolution_supports_discipline_context_from_prefix_text(
        self,
    ) -> None:
        assignment = resolve_regulation_action_type(
            text="考察期未满。",
            context_text="有下列情形之一的，不予解除处分:",
        )

        self.assertEqual(assignment.value, "lift_discipline")
        self.assertEqual(assignment.provenance, "context_text:lift_discipline")

    def test_shared_action_type_resolution_supports_discipline_context_from_document_title(
        self,
    ) -> None:
        assignment = resolve_regulation_action_type(
            text="学生本人提交申请材料。",
            section_path=("解除程序",),
            document_title="中央民族大学解除学生纪律处分实施办法",
        )

        self.assertEqual(assignment.value, "lift_discipline")
        self.assertEqual(assignment.provenance, "section_path+document_title:lift_discipline")

    def test_shared_action_type_resolution_does_not_promote_generic_discipline_reference(
        self,
    ) -> None:
        assignment = resolve_regulation_action_type(
            text="所评学年有下列情况之一者,不得参评国家励志奖学金: 受到纪律处分。",
        )

        self.assertEqual(assignment.value, "")
        self.assertEqual(assignment.provenance, "")

    def test_shared_condition_subject_resolution_supports_discipline_context_from_title_and_section(
        self,
    ) -> None:
        assignment = resolve_regulation_condition_subject(
            text="考察期未满。",
            answer_role="exclusion_rule",
            section_path=("解除程序",),
            document_title="中央民族大学解除学生纪律处分实施办法",
        )

        self.assertEqual(assignment.value, "discipline_relief_exclusion")
        self.assertEqual(
            assignment.provenance,
            "action_type:lift_discipline+answer_role:exclusion_rule",
        )

    def test_shared_condition_subject_resolution_does_not_promote_audience_scope_from_title_context(
        self,
    ) -> None:
        assignment = resolve_regulation_condition_subject(
            text=(
                "中央民族大学毕业生学费和国家助学贷款代偿暂行实施办法 / "
                "一、学费和国家助学贷款代偿资助的基本内容 / 第二条 "
                "本办法中的毕业生是指我校全日制本专科生、研究生、第二学士学位应届毕业生。"
                "定向、委培以及在校期间已享受免除学费政策的学生除外。"
            ),
            answer_role="exception_rule",
            section_path=("一、学费和国家助学贷款代偿资助的基本内容",),
        )

        self.assertEqual(assignment.value, "generic_condition")
        self.assertEqual(assignment.provenance, "answer_role:generic_condition")

    def test_exclusion_rule_resolution_prefers_restriction_subject_over_positive_domain_keywords(
        self,
    ) -> None:
        assignment = resolve_regulation_condition_subject(
            text="所评学年有下列情况之一者,不得参评国家励志奖学金: 受到纪律处分。",
            answer_role="exclusion_rule",
        )

        self.assertEqual(assignment.value, "generic_restriction")
        self.assertEqual(assignment.provenance, "answer_role:exclusion_rule")

    def test_exclusion_rule_resolution_keeps_discipline_relief_exclusion_when_action_type_present(
        self,
    ) -> None:
        assignment = resolve_regulation_condition_subject(
            text="有下列情形之一的，不予解除处分: 受到留校察看处分。",
            answer_role="exclusion_rule",
            action_type="lift_discipline",
        )

        self.assertEqual(assignment.value, "discipline_relief_exclusion")
        self.assertEqual(
            assignment.provenance,
            "action_type:lift_discipline+answer_role:exclusion_rule",
        )

    def test_generic_policy_table_resolution_falls_back_to_rank_threshold_when_table_mentions_gpa(
        self,
    ) -> None:
        assignment = resolve_regulation_condition_subject(
            text="平均学分绩点 | 百分制成绩对照表\n4.0 | 90-100",
            answer_role="table_fact",
            table_fact_type="generic_policy_table",
        )

        self.assertEqual(assignment.value, "rank_threshold")
        self.assertEqual(
            assignment.provenance, "table_fact_type:generic_policy_table+keyword:绩点成绩"
        )

    def test_exception_rule_resolution_does_not_treat_exam_material_reference_as_material_requirement(
        self,
    ) -> None:
        assignment = resolve_regulation_condition_subject(
            text=(
                "携带与考试内容相关的材料或者存储与考试内容相关资料的电子设备参加考试的"
                "(开卷考试中考试工作人员另有说明的除外);"
            ),
            answer_role="exception_rule",
        )

        self.assertEqual(assignment.value, "generic_condition")
        self.assertEqual(assignment.provenance, "answer_role:generic_condition")

    def test_condition_subject_resolution_prefers_sports_competition_over_generic_competition(
        self,
    ) -> None:
        assignment = resolve_regulation_condition_subject(
            text="在体育竞赛中获得全国比赛前三名。",
            answer_role="example_evidence",
        )

        self.assertEqual(assignment.value, "sports_competition")
        self.assertEqual(assignment.provenance, "keyword:体育比赛")

    def test_condition_subject_resolution_prefers_arts_competition_over_generic_competition(
        self,
    ) -> None:
        assignment = resolve_regulation_condition_subject(
            text="在文艺比赛中获得省部级以上奖励。",
            answer_role="example_evidence",
        )

        self.assertEqual(assignment.value, "arts_competition")
        self.assertEqual(assignment.provenance, "keyword:文艺比赛")

    def test_shared_procedure_action_resolution_prefers_explicit_metadata(self) -> None:
        assignment = resolve_regulation_procedure_action(
            text="统一受理、协调处理、统一答复向学校提出的信息公开申请。",
            actor="office",
            explicit_action="office_review",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "office_review")
        self.assertEqual(assignment.provenance, "metadata:procedure_action")

    def test_shared_procedure_action_resolution_supports_guidance_duty_steps(self) -> None:
        assignment = resolve_regulation_procedure_action(
            text="负责指导学生开展项目研究。",
            actor="instructor",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "process")
        self.assertEqual(assignment.provenance, "keyword:指导职责流程")

    def test_shared_procedure_action_resolution_prefers_college_review_over_student_object_submit(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_action(
            text="学院审核学生提交的申请材料。",
            actor="college",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "college_review")
        self.assertEqual(assignment.provenance, "keyword:审核+actor:college")

    def test_shared_procedure_action_resolution_prefers_office_review_over_student_object_submit(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_action(
            text="学生处审核学生提交的申请材料。",
            actor="student_affairs_office",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "office_review")
        self.assertEqual(
            assignment.provenance,
            "keyword:审核+actor:student_affairs_office",
        )

    def test_shared_procedure_action_resolution_does_not_treat_handling_decision_as_process(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_action(
            text="学生应当在收到处理决定后5个工作日内提出申诉。",
            actor="student",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "appeal")
        self.assertEqual(assignment.provenance, "keyword:申诉听证")

    def test_shared_procedure_actor_resolution_prefers_explicit_metadata_alias(self) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="申请人提交材料。",
            explicit_actor="申请人",
        )

        self.assertEqual(assignment.value, "applicant")
        self.assertEqual(assignment.provenance, "metadata:procedure_actor")

    def test_shared_procedure_actor_resolution_supports_student_rule_procedure_clause(self) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="1. 学生本人提交解除处分申请材料。",
        )

        self.assertEqual(assignment.value, "student")
        self.assertEqual(assignment.provenance, "keyword:学生")

    def test_shared_procedure_actor_resolution_supports_institutional_office_clause(self) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="统一受理、协调处理、统一答复向学校提出的信息公开申请。",
        )

        self.assertEqual(assignment.value, "office")
        self.assertEqual(assignment.provenance, "keyword:学校部门职责")

    def test_shared_procedure_actor_resolution_prefers_student_affairs_office_over_student(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="学生处受理学生提交的申请材料。",
        )

        self.assertEqual(assignment.value, "student_affairs_office")
        self.assertEqual(assignment.provenance, "keyword:学生处")

    def test_shared_procedure_actor_resolution_prefers_academic_affairs_office_over_student(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="教务处审核学生提交的补办申请。",
        )

        self.assertEqual(assignment.value, "academic_affairs_office")
        self.assertEqual(assignment.provenance, "keyword:教务处")

    def test_shared_procedure_actor_resolution_prefers_college_over_student_object(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="学院审核学生提交的申请材料。",
        )

        self.assertEqual(assignment.value, "college")
        self.assertEqual(assignment.provenance, "keyword:学院单位")

    def test_shared_procedure_actor_resolution_prefers_instructor_over_student_object(
        self,
    ) -> None:
        assignment = resolve_regulation_procedure_actor(
            text="指导教师审核学生提交的项目申请材料。",
        )

        self.assertEqual(assignment.value, "instructor")
        self.assertEqual(assignment.provenance, "keyword:教师")

    def test_shared_procedure_next_actor_resolution_supports_college_followup(self) -> None:
        assignment = resolve_regulation_procedure_next_actor(
            text="学生提交后由学院审核。",
        )

        self.assertEqual(assignment.value, "college")
        self.assertEqual(assignment.provenance, "keyword:学院")

    def test_shared_intro_list_role_hint_resolves_material_list_variants(self) -> None:
        for text in (
            "申请材料如下:",
            "申诉人应提交以下材料：",
            "补充材料如下：",
        ):
            with self.subTest(text=text):
                assignment = resolve_regulation_intro_list_role_hint(text)
                self.assertEqual(assignment.value, "material_requirement")
                self.assertTrue(assignment.provenance.startswith("text:material_intro"))

    def test_shared_intro_list_role_hint_resolves_time_list_variants(self) -> None:
        for text in (
            "申诉期限如下:",
            "申诉应在下列期限内提出：",
            "补充期限如下：",
        ):
            with self.subTest(text=text):
                assignment = resolve_regulation_intro_list_role_hint(text)
                self.assertEqual(assignment.value, "time_constraint")
                self.assertTrue(assignment.provenance.startswith("text:time_intro"))

    def test_shared_intro_list_role_hint_distinguishes_procedure_list(self) -> None:
        assignment = resolve_regulation_intro_list_role_hint("按如下程序办理:")

        self.assertEqual(assignment.value, "procedure_step")
        self.assertTrue(assignment.provenance.startswith("text:procedure_intro"))

    def test_shared_group_intro_kind_resolves_condition_intro_variants(self) -> None:
        for text in (
            "符合下列条件之一:",
            "参评学生还应符合下列条件之一：",
            "同时,还须具备以下条件之一:",
        ):
            with self.subTest(text=text):
                assignment = resolve_regulation_group_intro_kind(text)
                self.assertEqual(assignment.value, "condition_group_intro")
                self.assertTrue(assignment.provenance.startswith("text:condition_group_intro"))

    def test_shared_group_intro_kind_resolves_exclusion_intro_variants(self) -> None:
        for text in (
            "有下列情形之一:",
            "有以下情形之一：",
            "有下列情形之一的，不予解除处分:",
        ):
            with self.subTest(text=text):
                assignment = resolve_regulation_group_intro_kind(text)
                self.assertEqual(assignment.value, "exclusion_group_intro")
                self.assertTrue(assignment.provenance.startswith("text:exclusion_group_intro"))

    def test_shared_group_intro_kind_reuses_typed_list_intros(self) -> None:
        material = resolve_regulation_group_intro_kind("申请材料如下:")
        time = resolve_regulation_group_intro_kind("申诉期限如下：")

        self.assertEqual(material.value, "material_list_intro")
        self.assertTrue(material.provenance.startswith("text:material_intro"))
        self.assertEqual(time.value, "time_list_intro")
        self.assertTrue(time.provenance.startswith("text:time_intro"))

    def test_shared_intro_scope_resolution_prefers_target_roles(self) -> None:
        material = resolve_regulation_intro_scope(
            text="申请材料如下:",
            intro_target_roles=("material_requirement",),
        )
        time = resolve_regulation_intro_scope(
            text="申诉期限如下:",
            intro_target_roles=("time_constraint",),
        )
        procedure = resolve_regulation_intro_scope(
            text="按如下程序办理:",
            intro_target_roles=("procedure_step",),
        )
        eligibility = resolve_regulation_intro_scope(
            text="符合下列条件之一:",
            intro_target_roles=("exception_rule", "example_evidence"),
        )

        self.assertEqual(material.value, "material_list")
        self.assertEqual(material.provenance, "intro_target_roles:material_requirement")
        self.assertEqual(time.value, "time_list")
        self.assertEqual(time.provenance, "intro_target_roles:time_constraint")
        self.assertEqual(procedure.value, "procedure_list")
        self.assertEqual(procedure.provenance, "intro_target_roles:procedure_step")
        self.assertEqual(eligibility.value, "eligibility_group")
        self.assertEqual(eligibility.provenance, "intro_target_roles:eligibility_group")

    def test_shared_intro_scope_resolution_supports_text_fallback(self) -> None:
        procedure = resolve_regulation_intro_scope(
            text="办理程序如下:",
            intro_target_roles=(),
        )
        generic = resolve_regulation_intro_scope(
            text="符合下列条件之一:",
            intro_target_roles=(),
        )

        self.assertEqual(procedure.value, "procedure_list")
        self.assertEqual(procedure.provenance, "text:procedure_list")
        self.assertEqual(generic.value, "eligibility_group")
        self.assertEqual(generic.provenance, "fallback:eligibility_group")

    def test_shared_procedure_materials_resolution_extracts_controlled_material_markers(
        self,
    ) -> None:
        materials = resolve_regulation_procedure_materials(
            "学生补办学生证时，必须提出书面申请，并填写补办申请表后到学生处办理。"
        )
        relief_materials = resolve_regulation_procedure_materials(
            "学生提交解除处分申请表，经学院审核后报学生处。"
        )

        self.assertEqual(
            materials,
            ("书面申请", "补办申请表"),
        )
        self.assertEqual(relief_materials, ("解除处分申请表",))

    def test_shared_intro_subject_resolution_prefers_target_roles(self) -> None:
        material = resolve_regulation_intro_subject(
            intro_target_roles=("material_requirement",),
            fallback_condition_subject="generic_condition",
        )
        time = resolve_regulation_intro_subject(
            intro_target_roles=("time_constraint",),
            fallback_condition_subject="generic_condition",
        )
        procedure = resolve_regulation_intro_subject(
            intro_target_roles=("procedure_step",),
            fallback_condition_subject="generic_condition",
        )
        generic = resolve_regulation_intro_subject(
            intro_target_roles=("exception_rule", "example_evidence"),
            fallback_condition_subject="rank_threshold",
        )

        self.assertEqual(material.value, "material_requirement")
        self.assertEqual(material.provenance, "intro_target_roles:material_requirement")
        self.assertEqual(time.value, "deadline")
        self.assertEqual(time.provenance, "intro_target_roles:time_constraint")
        self.assertEqual(procedure.value, "application_procedure")
        self.assertEqual(procedure.provenance, "intro_target_roles:procedure_step")
        self.assertEqual(generic.value, "rank_threshold")
        self.assertEqual(generic.provenance, "fallback:condition_subject")

    def test_shared_expected_polarity_resolution_tracks_answer_role_and_table_type(self) -> None:
        self.assertEqual(
            resolve_regulation_expected_polarity(
                answer_role="exclusion_rule",
                table_fact_type="",
            ).value,
            "negative",
        )
        self.assertEqual(
            resolve_regulation_expected_polarity(
                answer_role="procedure_step",
                table_fact_type="",
            ).value,
            "positive",
        )
        self.assertEqual(
            resolve_regulation_expected_polarity(
                answer_role="table_fact",
                table_fact_type="generic_policy_table",
            ).value,
            "neutral",
        )
        self.assertEqual(
            resolve_regulation_expected_polarity(
                answer_role="table_fact",
                table_fact_type="timeline_or_deadline",
            ).value,
            "positive",
        )

    def test_shared_section_subject_hint_resolves_material_deadline_procedure_and_audience(
        self,
    ) -> None:
        self.assertEqual(
            resolve_regulation_section_subject_hint(
                section_path=("第三章 申诉材料",),
                answer_role="material_requirement",
                text="提交书面申请。",
            ).value,
            "material_requirement",
        )
        self.assertEqual(
            resolve_regulation_section_subject_hint(
                section_path=("第三章 申诉期限",),
                answer_role="time_constraint",
                text="应在5个工作日内提出。",
            ).value,
            "deadline",
        )
        self.assertEqual(
            resolve_regulation_section_subject_hint(
                section_path=("解除程序",),
                answer_role="procedure_step",
                text="学生本人提交申请材料。",
            ).value,
            "application_procedure",
        )
        self.assertEqual(
            resolve_regulation_section_subject_hint(
                section_path=("适用对象",),
                answer_role="eligibility_condition",
                text="本办法适用于本科生。",
            ).value,
            "audience_scope",
        )

    def test_shared_heading_role_hint_resolves_procedure_category_headings(self) -> None:
        for text in (
            "认定程序",
            "评选程序",
            "办理程序",
            "程序如下：",
            "材料报送情况",
        ):
            with self.subTest(text=text):
                assignment = resolve_regulation_heading_role_hint(text)
                self.assertEqual(assignment.value, "procedure_step")
                self.assertTrue(assignment.provenance.startswith("text:procedure_heading"))

    def test_shared_heading_role_hint_resolves_material_and_time_category_headings(self) -> None:
        material = resolve_regulation_heading_role_hint("申诉材料")
        time = resolve_regulation_heading_role_hint("申诉期限")

        self.assertEqual(material.value, "material_requirement")
        self.assertTrue(material.provenance.startswith("text:material_heading"))
        self.assertEqual(time.value, "time_constraint")
        self.assertTrue(time.provenance.startswith("text:time_heading"))

    def test_shared_heading_role_hint_resolves_generic_category_heading(self) -> None:
        assignment = resolve_regulation_heading_role_hint("免试生类别")

        self.assertEqual(assignment.value, "eligibility_intro")
        self.assertTrue(assignment.provenance.startswith("text:generic_heading"))

    def test_shared_answer_role_resolution_supports_procedure_scope_single_step(self) -> None:
        assignment = resolve_regulation_answer_role(
            text=(
                "(2)学生根据认定结果填写“中央民族大学交换学生课程学分成绩认定申请表”,"
                "并将填好后的表交给所在院系主管教学院长(主任)审查、签字,并加盖院系公章。"
            ),
            prefix_text="认定程序",
        )

        self.assertEqual(assignment.value, "procedure_step")
        self.assertEqual(assignment.provenance, "matched_procedure_marker")

    def test_shared_answer_role_resolution_supports_selection_review_step(self) -> None:
        assignment = resolve_regulation_answer_role(
            text=(
                "（二）研究生院复评。院系将初评结果汇总，附参评材料盖公章后报至研究生院，"
                "由研究生院完成材料复审及评选工作。"
            ),
            prefix_text="评选程序",
        )

        self.assertEqual(assignment.value, "procedure_step")
        self.assertEqual(assignment.provenance, "matched_procedure_marker")

    def test_shared_answer_role_resolution_distinguishes_material_and_time_intro(self) -> None:
        material = resolve_regulation_answer_role(text="申诉人应提交以下材料：")
        deadline = resolve_regulation_answer_role(text="申诉应在下列期限内提出：")

        self.assertEqual(material.value, "eligibility_intro")
        self.assertEqual(material.provenance, "matched_material_intro_marker")
        self.assertEqual(deadline.value, "eligibility_intro")
        self.assertEqual(deadline.provenance, "matched_time_intro_marker")


if __name__ == "__main__":
    unittest.main()
