from __future__ import annotations

import campus_shared
from campus_shared.answer_ready_evidence_contract import (
    ANSWER_READY_CONDITION_GROUP_SUBJECTS,
    ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
    ANSWER_READY_INTERNAL_ATTRIBUTE_FIELDS,
    ANSWER_READY_PROCEDURE_ACTIONS,
    answer_ready_contract_rules_for_scope,
    validate_answer_ready_evidence_metadata,
)
from campus_shared.regulation_semantic_registry import (
    REGULATION_CONDITION_SUBJECT_DEFINITIONS,
    REGULATION_PROCEDURE_ACTION_DEFINITIONS,
)


class AnswerReadyEvidenceContractBasicSuite:
    def test_regulation_family_scopes_share_answer_ready_contract_rules(self) -> None:
        for collection in ("student_rules", "institutional_rules"):
            with self.subTest(collection=collection):
                rules = answer_ready_contract_rules_for_scope(
                    corpus="regulations",
                    collection=collection,
                )

                self.assertTrue(rules.applies)
                self.assertTrue(
                    rules.requires_condition_subject(answer_role="eligibility_condition")
                )
                self.assertTrue(
                    rules.requires_condition_group_id(
                        metadata={
                            "answer_role": "procedure_step",
                            "condition_subject": "application_procedure",
                        }
                    )
                )

    def test_non_regulation_family_scopes_do_not_use_this_contract(self) -> None:
        rules = answer_ready_contract_rules_for_scope(
            corpus="curriculum",
            collection="curriculum_plan",
        )

        self.assertFalse(rules.applies)
        self.assertFalse(rules.requires_condition_subject(answer_role="eligibility_condition"))
        self.assertFalse(
            rules.requires_condition_group_id(
                metadata={
                    "answer_role": "procedure_step",
                    "condition_subject": "application_procedure",
                }
            )
        )

    def test_contract_exports_single_version_and_projection_field_set(self) -> None:
        self.assertEqual(ANSWER_READY_EVIDENCE_CONTRACT_VERSION, "answer_ready_evidence.v3")
        self.assertIn("answer_role", ANSWER_READY_INTERNAL_ATTRIBUTE_FIELDS)
        self.assertIn("intro_scope", ANSWER_READY_INTERNAL_ATTRIBUTE_FIELDS)
        self.assertIn("procedure_action", ANSWER_READY_INTERNAL_ATTRIBUTE_FIELDS)
        self.assertIn("safety_or_security_restriction", ANSWER_READY_CONDITION_GROUP_SUBJECTS)
        self.assertIn("generic_restriction", ANSWER_READY_CONDITION_GROUP_SUBJECTS)
        self.assertIn("example_evidence", ANSWER_READY_CONDITION_GROUP_SUBJECTS)

    def test_v3_validation_accepts_time_constraint_answer_role(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "time_constraint",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-b:article-11",
                "clause_unit_id": "doc-b:article-11:1",
                "condition_subject": "deadline",
                "condition_group_id": "doc-b:article-11:deadline",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "section_path:deadline",
                "condition_polarity": "positive",
            },
            content_role="deadline",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "passed")

    def test_v3_validation_accepts_material_requirement_answer_role(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "material_requirement",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-b:article-12",
                "clause_unit_id": "doc-b:article-12:2",
                "condition_subject": "material_requirement",
                "condition_group_id": "doc-b:article-12:material_requirement",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "section_path:materials",
                "condition_polarity": "positive",
            },
            content_role="requirement",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "passed")

    def test_v3_validation_accepts_table_fact_with_neutral_polarity(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "table_fact",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:table-1",
                "condition_subject": "rank_threshold",
                "condition_group_id": "doc-a:table-1:rank_threshold",
                "table_fact_type": "generic_policy_table",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "table_fact_type:generic_policy_table+keyword:绩点成绩",
                "condition_polarity": "neutral",
            },
            content_role="table_fact",
            unit_type="table_unit",
        )

        self.assertEqual(result.status, "passed")

    def test_v3_validation_accepts_typed_table_fact_with_positive_polarity(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "table_fact",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:table-2",
                "condition_subject": "amount_or_quota",
                "condition_group_id": "doc-a:table-2:amount_or_quota",
                "table_fact_type": "amount_or_quota",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "table_fact_type:amount_or_quota",
                "condition_polarity": "positive",
            },
            content_role="table_fact",
            unit_type="table_unit",
        )

        self.assertEqual(result.status, "passed")

    def test_v3_validation_fails_when_table_fact_group_id_is_missing(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "table_fact",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:table-2",
                "condition_subject": "amount_or_quota",
                "table_fact_type": "amount_or_quota",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "table_fact_type:amount_or_quota",
                "condition_polarity": "positive",
            },
            content_role="table_fact",
            unit_type="table_unit",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_condition_group_id_missing", result.issues)

    def test_v3_validation_accepts_definition_with_neutral_polarity(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "definition",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:article-3",
                "condition_polarity": "neutral",
            },
            content_role="definition",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "passed")

    def test_package_facade_exports_v3_governance_constants(self) -> None:
        self.assertEqual(
            campus_shared.ANSWER_READY_ALLOWED_POLARITIES,
            frozenset({"positive", "negative", "neutral"}),
        )
        self.assertIn(
            "category_overview",
            campus_shared.ANSWER_READY_CATEGORY_OVERVIEW_ROLES,
        )
        self.assertEqual(
            campus_shared.ANSWER_READY_PROCEDURE_ACTION_TAXONOMY_VERSION,
            "procedure_action.v1",
        )
        self.assertEqual(
            campus_shared.ANSWER_READY_CATEGORY_REGISTRY_VERSION,
            "policy_category_registry.v1",
        )
        self.assertEqual(
            campus_shared.resolve_regulation_intro_scope(
                text="按如下程序办理:",
                intro_target_roles=("procedure_step",),
            ).value,
            "procedure_list",
        )
        self.assertEqual(
            campus_shared.resolve_regulation_procedure_materials(
                "学生提交解除处分申请表，经学院审核后报学生处。"
            ),
            ("解除处分申请表",),
        )
        self.assertEqual(
            campus_shared.resolve_regulation_intro_subject(
                intro_target_roles=("time_constraint",),
                fallback_condition_subject="generic_condition",
            ).value,
            "deadline",
        )
        self.assertEqual(
            campus_shared.resolve_regulation_expected_polarity(
                answer_role="table_fact",
                table_fact_type="generic_policy_table",
            ).value,
            "neutral",
        )

    def test_contract_allowlists_are_derived_from_shared_taxonomy(self) -> None:
        self.assertTrue(
            frozenset(REGULATION_CONDITION_SUBJECT_DEFINITIONS).issubset(
                ANSWER_READY_CONDITION_GROUP_SUBJECTS
            )
        )
        self.assertEqual(
            ANSWER_READY_PROCEDURE_ACTIONS,
            frozenset(REGULATION_PROCEDURE_ACTION_DEFINITIONS),
        )
