from __future__ import annotations

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
    canonical_regulation_procedure_actor,
    load_student_rules_discovery_config,
    regulation_categories_for_document,
    resolve_regulation_action_type,
    resolve_regulation_condition_group_subject,
    resolve_regulation_condition_subject,
    resolve_regulation_group_subject,
)


class RegulationSemanticRegistryFoundationSuite:
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

    def test_shared_condition_subject_resolution_ignores_incompatible_explicit_subject_for_procedure_step(
        self,
    ) -> None:
        assignment = resolve_regulation_condition_subject(
            text="学生申诉处理委员会应当对原处理或者处分决定是否合法进行审查。",
            answer_role="procedure_step",
            explicit_condition_subject="generic_condition",
        )

        self.assertEqual(assignment.value, "application_procedure")
        self.assertEqual(assignment.provenance, "answer_role:procedure_step")

    def test_shared_condition_subject_resolution_ignores_incompatible_group_subject_for_condition_clause(
        self,
    ) -> None:
        assignment = resolve_regulation_condition_subject(
            text="超过规定申诉时限的;",
            answer_role="eligibility_condition",
            condition_group_subject="application_procedure",
            section_path=("第三章 申诉与受理",),
        )

        self.assertNotEqual(assignment.value, "application_procedure")

    def test_shared_condition_subject_resolution_ignores_incompatible_group_subject_for_exclusion_clause(
        self,
    ) -> None:
        assignment = resolve_regulation_condition_subject(
            text="所评学年有下列情况之一者,不得参评国家励志奖学金:",
            answer_role="exclusion_rule",
            condition_group_subject="audience_scope",
        )

        self.assertNotEqual(assignment.value, "audience_scope")

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

    def test_exclusion_intro_resolution_uses_intro_compatible_generic_condition_subject(
        self,
    ) -> None:
        assignment = resolve_regulation_condition_subject(
            text="学生有下列情形之一，给予退学处理：",
            answer_role="eligibility_intro",
            intro_target_roles=("exclusion_rule",),
        )

        self.assertEqual(assignment.value, "generic_condition")
        self.assertEqual(assignment.provenance, "intro_target_roles:exclusion_rule")

    def test_exclusion_rule_resolution_does_not_overmatch_paper_publication_from_generic_thesis_restriction(
        self,
    ) -> None:
        assignment = resolve_regulation_condition_subject(
            text="毕业论文的指导教师不得担任本论文的答辩专家。",
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
