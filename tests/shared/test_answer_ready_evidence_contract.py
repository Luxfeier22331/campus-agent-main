from __future__ import annotations

import unittest

import campus_shared
from campus_shared.answer_ready_evidence_contract import (
    ANSWER_READY_CONDITION_GROUP_SUBJECTS,
    ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
    ANSWER_READY_INTERNAL_ATTRIBUTE_FIELDS,
    ANSWER_READY_PROCEDURE_ACTIONS,
    AnswerReadyEvidenceValidationResult,
    answer_ready_contract_rules_for_scope,
    validate_answer_ready_evidence_metadata,
)
from campus_shared.regulation_semantic_registry import (
    REGULATION_CONDITION_SUBJECT_DEFINITIONS,
    REGULATION_PROCEDURE_ACTION_DEFINITIONS,
    load_regulation_discovery_config,
)


class AnswerReadyEvidenceContractTest(unittest.TestCase):
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

    def test_v3_validation_accepts_typed_procedure_step(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "procedure_step",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:article-1",
                "clause_unit_id": "doc-a:article-1:1",
                "condition_group_id": "doc-a:article-1:application_procedure",
                "condition_group_subject": "application_procedure",
                "condition_subject": "application_procedure",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "answer_role:procedure_step",
                "condition_polarity": "positive",
                "procedure_step_index": 1,
                "procedure_actor": "student",
                "procedure_action": "submit_materials",
                "procedure_action_taxonomy_version": "procedure_action.v1",
                "procedure_action_provenance": "keyword:提交+材料",
            },
            content_role="procedure",
            unit_type="article_body",
        )

        self.assertIsInstance(result, AnswerReadyEvidenceValidationResult)
        self.assertEqual(result.status, "passed")
        self.assertEqual(result.severity, "release_blocking")
        self.assertEqual(result.issues, ())

    def test_v3_validation_fails_when_condition_polarity_is_missing_for_procedure_step(
        self,
    ) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "procedure_step",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:article-1",
                "clause_unit_id": "doc-a:article-1:1",
                "condition_group_id": "doc-a:article-1:application_procedure",
                "condition_subject": "application_procedure",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "answer_role:procedure_step",
                "procedure_step_index": 1,
                "procedure_actor": "student",
                "procedure_action": "submit_materials",
                "procedure_action_taxonomy_version": "procedure_action.v1",
                "procedure_action_provenance": "keyword:提交+材料",
            },
            content_role="procedure",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_condition_polarity_missing", result.issues)

    def test_v3_validation_fails_when_condition_group_subject_is_missing_for_procedure_step(
        self,
    ) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "procedure_step",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:article-1",
                "clause_unit_id": "doc-a:article-1:1",
                "condition_group_id": "doc-a:article-1:application_procedure",
                "condition_subject": "application_procedure",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "answer_role:procedure_step",
                "condition_polarity": "positive",
                "procedure_step_index": 1,
                "procedure_actor": "student",
                "procedure_action": "submit_materials",
                "procedure_action_taxonomy_version": "procedure_action.v1",
                "procedure_action_provenance": "keyword:提交+材料",
            },
            content_role="procedure",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_condition_group_subject_missing", result.issues)

    def test_v3_validation_accepts_table_fact_group_id_resolved_from_shared_owner(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "table_fact",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:table-3",
                "condition_group_id": "doc-a:table-3:deadline",
                "table_fact_type": "timeline_or_deadline",
                "condition_subject": "deadline",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "table_fact_type:timeline_or_deadline",
                "condition_polarity": "positive",
            },
            content_role="table_fact",
            unit_type="table_row",
        )

        self.assertEqual(result.status, "passed")

    def test_v3_validation_fails_when_clause_identity_is_missing_for_clause_labeled_answer_ready_chunk(
        self,
    ) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "eligibility_condition",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:article-2",
                "condition_subject": "rank_threshold",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "metadata:condition_subject",
                "condition_group_id": "doc-a:article-2:rank_threshold",
                "provision_label": "（二）",
            },
            content_role="eligibility",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_clause_unit_id_missing", result.issues)

    def test_v3_validation_fails_missing_role_specific_fields(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "eligibility_intro",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "inst-doc:section-1",
            },
            content_role="eligibility",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertEqual(result.severity, "release_blocking")
        self.assertIn("answer_ready_condition_group_id_missing", result.issues)
        self.assertIn("answer_ready_condition_subject_missing", result.issues)
        self.assertIn("answer_ready_condition_subject_taxonomy_version_missing", result.issues)
        self.assertIn("answer_ready_condition_subject_provenance_missing", result.issues)
        self.assertIn("answer_ready_intro_scope_missing", result.issues)
        self.assertIn("answer_ready_introduced_condition_group_id_missing", result.issues)
        self.assertIn("answer_ready_intro_target_roles_missing", result.issues)

    def test_v3_validation_fails_missing_semantic_provenance_for_answer_ready_fields(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "procedure_step",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:article-1",
                "condition_subject": "application_procedure",
                "condition_group_id": "doc-a:article-1:application_procedure",
                "procedure_step_index": 1,
                "procedure_actor": "student",
                "procedure_action": "submit_materials",
                "procedure_action_taxonomy_version": "procedure_action.v1",
            },
            content_role="procedure",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_condition_subject_taxonomy_version_missing", result.issues)
        self.assertIn("answer_ready_condition_subject_provenance_missing", result.issues)
        self.assertIn("answer_ready_procedure_action_provenance_missing", result.issues)

    def test_v3_validation_fails_when_bridge_only_group_keys_leak_into_final_metadata(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "eligibility_intro",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:article-8",
                "condition_subject": "material_requirement",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "metadata:introduced_condition_subject",
                "condition_group_id": "doc-a:article-8:material_requirement",
                "condition_group_key": "material_requirement",
                "intro_scope": "material_list",
                "introduced_condition_group_id": "doc-a:article-8:material_requirement",
                "introduced_condition_group_key": "material_requirement",
                "intro_target_roles": ["material_requirement"],
                "is_answer_bearing": False,
            },
            content_role="eligibility",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_condition_group_key_leaked", result.issues)
        self.assertIn("answer_ready_introduced_condition_group_key_leaked", result.issues)

    def test_v3_validation_fails_unknown_answer_role(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "one_off_chinese_cue",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "inst-doc:section-1",
            },
            content_role="eligibility",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertEqual(result.severity, "release_blocking")
        self.assertIn("answer_ready_answer_role_unknown", result.issues)

    def test_v3_validation_fails_unknown_taxonomy_versions(self) -> None:
        condition_subject_result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "eligibility_condition",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:article-2",
                "clause_unit_id": "doc-a:article-2:1",
                "condition_subject": "rank_threshold",
                "condition_group_id": "doc-a:article-2:rank_threshold",
                "condition_subject_taxonomy_version": "condition_subject.experimental",
                "condition_subject_provenance": "metadata:condition_subject",
                "condition_polarity": "positive",
            },
            content_role="eligibility",
            unit_type="article_body",
        )
        procedure_result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "procedure_step",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:article-1",
                "condition_group_id": "doc-a:article-1:application_procedure",
                "procedure_step_index": 1,
                "procedure_actor": "student",
                "procedure_action": "submit_materials",
                "procedure_action_taxonomy_version": "procedure_action.experimental",
            },
            content_role="procedure",
            unit_type="article_body",
        )
        category_result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "category_overview",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "category:appeal",
                "category_id": "appeal",
                "category_registry_version": "policy_category_registry.experimental",
                "audience": "student",
                "member_policy_document_ids": ["appeal-rule-1"],
                "member_policy_titles": ["学生申诉处理办法"],
            },
            content_role="policy_list",
            unit_type="category_overview",
        )

        self.assertEqual(condition_subject_result.status, "failed")
        self.assertIn(
            "answer_ready_condition_subject_taxonomy_version_unknown",
            condition_subject_result.issues,
        )
        self.assertEqual(procedure_result.status, "failed")
        self.assertIn(
            "answer_ready_procedure_action_taxonomy_version_unknown",
            procedure_result.issues,
        )
        self.assertEqual(category_result.status, "failed")
        self.assertIn("category_overview_registry_version_unknown", category_result.issues)

    def test_v3_validation_fails_when_answer_role_and_polarity_conflict(self) -> None:
        exclusion_result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "exclusion_rule",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:article-9",
                "clause_unit_id": "doc-a:article-9:2",
                "condition_subject": "discipline_relief_exclusion",
                "condition_group_id": "doc-a:article-9:discipline_relief_exclusion",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "metadata:condition_subject",
                "condition_polarity": "positive",
            },
            content_role="eligibility",
            unit_type="article_body",
        )
        procedure_result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "procedure_step",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-b:article-4",
                "clause_unit_id": "doc-b:article-4:1",
                "condition_subject": "application_procedure",
                "condition_group_id": "doc-b:article-4:application_procedure",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "answer_role:procedure_step",
                "condition_polarity": "negative",
                "procedure_step_index": 1,
                "procedure_actor": "student",
                "procedure_action": "submit_materials",
                "procedure_action_taxonomy_version": "procedure_action.v1",
                "procedure_action_provenance": "metadata:procedure_action",
            },
            content_role="procedure",
            unit_type="article_body",
        )

        self.assertEqual(exclusion_result.status, "failed")
        self.assertIn("answer_ready_polarity_role_conflict", exclusion_result.issues)
        self.assertEqual(procedure_result.status, "failed")
        self.assertIn("answer_ready_polarity_role_conflict", procedure_result.issues)

    def test_v3_validation_fails_when_intro_is_marked_as_answer_bearing(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "eligibility_intro",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:article-7",
                "condition_subject": "generic_condition",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "answer_role:eligibility_intro",
                "condition_group_id": "doc-a:article-7:group-01:generic_condition",
                "intro_scope": "article",
                "introduced_condition_group_id": "doc-a:article-7:group-01:generic_condition",
                "intro_target_roles": ["eligibility_condition", "exception_rule"],
                "is_answer_bearing": True,
            },
            content_role="eligibility",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_intro_answer_bearing_conflict", result.issues)

    def test_v3_validation_fails_when_intro_lacks_explicit_non_answer_bearing_status(
        self,
    ) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "eligibility_intro",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:article-7",
                "condition_subject": "generic_condition",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "answer_role:eligibility_intro",
                "condition_group_id": "doc-a:article-7:group-01:generic_condition",
                "intro_scope": "eligibility_group",
                "introduced_condition_group_id": "doc-a:article-7:group-01:generic_condition",
                "intro_target_roles": ["eligibility_condition", "exception_rule"],
            },
            content_role="eligibility",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_intro_answer_bearing_missing", result.issues)

    def test_v3_validation_fails_when_intro_scope_conflicts_with_target_roles(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "eligibility_intro",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:article-8",
                "condition_subject": "material_requirement",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "metadata:introduced_condition_subject",
                "condition_group_id": "doc-a:article-8:material_requirement",
                "intro_scope": "eligibility_group",
                "introduced_condition_group_id": "doc-a:article-8:material_requirement",
                "intro_target_roles": ["material_requirement"],
                "is_answer_bearing": False,
            },
            content_role="eligibility",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_intro_scope_target_role_conflict", result.issues)

    def test_v3_validation_fails_when_intro_target_roles_are_unknown(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "eligibility_intro",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:article-8",
                "condition_subject": "generic_condition",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "metadata:introduced_condition_subject",
                "condition_group_id": "doc-a:article-8:group-01:generic_condition",
                "intro_scope": "eligibility_group",
                "introduced_condition_group_id": "doc-a:article-8:group-01:generic_condition",
                "intro_target_roles": ["one_off_chinese_cue"],
                "is_answer_bearing": False,
            },
            content_role="eligibility",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_intro_target_roles_unknown", result.issues)

    def test_v3_validation_fails_when_intro_group_id_conflicts_with_condition_subject(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "eligibility_intro",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-b:article-12",
                "condition_subject": "deadline",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "metadata:introduced_condition_subject",
                "condition_group_id": "doc-b:article-12:deadline",
                "intro_scope": "time_list",
                "introduced_condition_group_id": "doc-b:article-12:material_requirement",
                "intro_target_roles": ["time_constraint"],
            },
            content_role="eligibility",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_intro_group_subject_conflict", result.issues)

    def test_v3_validation_fails_when_intro_condition_group_ids_do_not_match(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "eligibility_intro",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-b:article-12",
                "condition_subject": "deadline",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "metadata:introduced_condition_subject",
                "condition_group_id": "doc-b:article-12:group-01:deadline",
                "intro_scope": "time_list",
                "introduced_condition_group_id": "doc-b:article-12:group-02:deadline",
                "intro_target_roles": ["time_constraint"],
                "is_answer_bearing": False,
            },
            content_role="eligibility",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_intro_condition_group_id_conflict", result.issues)

    def test_v3_validation_fails_when_intro_group_id_points_to_different_parent(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "eligibility_intro",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-b:article-12",
                "condition_subject": "deadline",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "metadata:introduced_condition_subject",
                "condition_group_id": "doc-b:article-12:deadline",
                "intro_scope": "time_list",
                "introduced_condition_group_id": "doc-b:article-99:deadline",
                "intro_target_roles": ["time_constraint"],
                "is_answer_bearing": False,
            },
            content_role="eligibility",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_intro_group_parent_conflict", result.issues)

    def test_v3_validation_fails_when_intro_condition_subject_conflicts_with_target_roles(
        self,
    ) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "eligibility_intro",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-b:article-12",
                "condition_subject": "material_requirement",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "metadata:introduced_condition_subject",
                "condition_group_id": "doc-b:article-12:material_requirement",
                "intro_scope": "time_list",
                "introduced_condition_group_id": "doc-b:article-12:deadline",
                "intro_target_roles": ["time_constraint"],
                "is_answer_bearing": False,
            },
            content_role="eligibility",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_intro_condition_subject_conflict", result.issues)

    def test_v3_validation_fails_when_condition_group_id_conflicts_with_condition_subject(
        self,
    ) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "eligibility_condition",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:article-10",
                "clause_unit_id": "doc-a:article-10:1",
                "condition_subject": "rank_threshold",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "keyword:排名综测",
                "condition_group_id": "doc-a:article-10:paper_or_publication",
                "condition_polarity": "positive",
            },
            content_role="eligibility",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_condition_group_subject_conflict", result.issues)

    def test_v3_validation_fails_when_condition_group_id_points_to_different_parent(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "eligibility_condition",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:article-10",
                "clause_unit_id": "doc-a:article-10:1",
                "condition_subject": "rank_threshold",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "keyword:排名综测",
                "condition_group_id": "doc-a:article-11:rank_threshold",
                "condition_polarity": "positive",
            },
            content_role="eligibility",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_condition_group_parent_conflict", result.issues)

    def test_v3_validation_fails_when_procedure_group_id_conflicts_with_subject(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "procedure_step",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-b:article-6",
                "clause_unit_id": "doc-b:article-6:2",
                "condition_subject": "application_procedure",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "answer_role:procedure_step",
                "condition_group_id": "doc-b:article-6:deadline",
                "condition_polarity": "positive",
                "procedure_step_index": 2,
                "procedure_actor": "college",
                "procedure_action": "college_review",
                "procedure_action_taxonomy_version": "procedure_action.v1",
                "procedure_action_provenance": "keyword:审核+actor:college",
            },
            content_role="procedure",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_condition_group_subject_conflict", result.issues)

    def test_v3_validation_accepts_child_subject_that_differs_from_group_subject(self) -> None:
        example_result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "example_evidence",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:article-12",
                "clause_unit_id": "doc-a:article-12:2",
                "condition_subject": "paper_or_publication",
                "condition_group_subject": "rank_threshold",
                "condition_group_id": "doc-a:article-12:group-01:rank_threshold",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "answer_role:example_evidence",
                "condition_polarity": "positive",
            },
            content_role="eligibility",
            unit_type="article_body",
        )
        procedure_result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "procedure_step",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-b:article-7",
                "clause_unit_id": "doc-b:article-7:1",
                "condition_subject": "application_procedure",
                "condition_group_subject": "security_or_confidentiality_requirement",
                "condition_group_id": (
                    "doc-b:article-7:group-01:security_or_confidentiality_requirement"
                ),
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "answer_role:procedure_step",
                "condition_polarity": "positive",
                "procedure_step_index": 1,
                "procedure_actor": "office",
                "procedure_action": "office_review",
                "procedure_action_taxonomy_version": "procedure_action.v1",
                "procedure_action_provenance": "metadata:procedure_action",
            },
            content_role="procedure",
            unit_type="article_body",
        )

        self.assertEqual(example_result.status, "passed")
        self.assertEqual(procedure_result.status, "passed")

    def test_v3_validation_fails_when_condition_group_subject_is_unknown(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "example_evidence",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:article-12",
                "clause_unit_id": "doc-a:article-12:2",
                "condition_subject": "paper_or_publication",
                "condition_group_subject": "one_off_chinese_cue",
                "condition_group_id": "doc-a:article-12:group-01:one_off_chinese_cue",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "answer_role:example_evidence",
                "condition_polarity": "positive",
            },
            content_role="eligibility",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_condition_group_subject_unknown", result.issues)

    def test_v3_validation_fails_when_condition_subject_and_answer_role_conflict(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "eligibility_condition",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-b:article-11",
                "clause_unit_id": "doc-b:article-11:1",
                "condition_subject": "discipline_relief_exclusion",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "metadata:condition_subject",
                "condition_group_id": "doc-b:article-11:discipline_relief_exclusion",
                "condition_polarity": "positive",
            },
            content_role="eligibility",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_condition_subject_role_conflict", result.issues)

    def test_v3_validation_fails_when_procedure_action_and_answer_role_conflict(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "eligibility_condition",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-c:article-5",
                "clause_unit_id": "doc-c:article-5:1",
                "condition_subject": "generic_condition",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "metadata:condition_subject",
                "condition_group_id": "doc-c:article-5:generic_condition",
                "condition_polarity": "positive",
                "procedure_action": "submit_materials",
                "procedure_action_taxonomy_version": "procedure_action.v1",
                "procedure_action_provenance": "metadata:procedure_action",
            },
            content_role="eligibility",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_procedure_action_role_conflict", result.issues)

    def test_v3_validation_fails_when_procedure_actor_is_unknown(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "procedure_step",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-c:article-6",
                "clause_unit_id": "doc-c:article-6:1",
                "condition_subject": "application_procedure",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "answer_role:procedure_step",
                "condition_group_id": "doc-c:article-6:application_procedure",
                "condition_polarity": "positive",
                "procedure_step_index": 1,
                "procedure_actor": "one_off_actor",
                "procedure_action": "submit_materials",
                "procedure_action_taxonomy_version": "procedure_action.v1",
                "procedure_action_provenance": "metadata:procedure_action",
            },
            content_role="procedure",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_procedure_actor_unknown", result.issues)

    def test_v3_validation_fails_when_procedure_next_actor_is_unknown(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "procedure_step",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-c:article-7",
                "clause_unit_id": "doc-c:article-7:1",
                "condition_subject": "application_procedure",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "answer_role:procedure_step",
                "condition_group_id": "doc-c:article-7:application_procedure",
                "condition_polarity": "positive",
                "procedure_step_index": 1,
                "procedure_actor": "student",
                "procedure_action": "submit_materials",
                "procedure_action_taxonomy_version": "procedure_action.v1",
                "procedure_action_provenance": "metadata:procedure_action",
                "procedure_next_actor": "unknown_followup_actor",
            },
            content_role="procedure",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_procedure_next_actor_unknown", result.issues)

    def test_v3_validation_classifies_legacy_v2_as_legacy_not_target_pass(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "eligibility_condition",
                "evidence_contract_version": "answer_ready_evidence.v2",
                "parent_unit_id": "doc-a:article-2",
                "condition_subject": "rank_threshold",
                "condition_group_id": "doc-a:article-2:rank_threshold",
            },
            content_role="eligibility",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "legacy")
        self.assertEqual(result.severity, "legacy_old_index")
        self.assertIn("answer_ready_evidence_contract_version_legacy", result.issues)

    def test_category_overview_requires_generalized_member_registry_fields(self) -> None:
        discovery = load_regulation_discovery_config("institutional_rules")
        category = next(
            item for item in discovery.categories if item.category_id == "public_service"
        )
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "category_overview",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": f"category:{category.category_id}",
                "condition_subject": "audience_scope",
                "condition_group_subject": "audience_scope",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "category_registry:audience_scope",
                "condition_group_id": f"category:{category.category_id}:audience_scope",
                "category_id": category.category_id,
                "condition_polarity": "neutral",
                "category_registry_version": "policy_category_registry.v1",
                "audience": category.audience,
                "member_policy_document_ids": list(category.member_policy_document_ids),
                "member_policy_titles": [
                    discovery.policy_titles_by_document_id[document_id]
                    for document_id in category.member_policy_document_ids
                ],
            },
            content_role="policy_list",
            unit_type="category_overview",
        )

        self.assertEqual(result.status, "passed")

    def test_category_overview_fails_without_member_registry_fields(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "category_overview",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "category:appeal",
                "category_id": "appeal",
                "condition_polarity": "neutral",
            },
            content_role="policy_list",
            unit_type="category_overview",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("category_overview_registry_version_missing", result.issues)
        self.assertIn("category_overview_audience_missing", result.issues)
        self.assertIn("category_overview_missing_member_document_ids", result.issues)
        self.assertIn("category_overview_missing_member_titles", result.issues)

    def test_category_overview_fails_without_typed_condition_subject_contract(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "category_overview",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "category:appeal",
                "condition_polarity": "neutral",
                "category_id": "appeal",
                "category_registry_version": "policy_category_registry.v1",
                "audience": "校园成员",
                "member_policy_document_ids": ["official_web_regulation:0a420e3fe367027c"],
                "member_policy_titles": ["中央民族大学校园卡管理办法"],
            },
            content_role="policy_list",
            unit_type="category_overview",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_condition_subject_missing", result.issues)
        self.assertIn(
            "answer_ready_condition_subject_taxonomy_version_missing",
            result.issues,
        )
        self.assertIn("answer_ready_condition_subject_provenance_missing", result.issues)

    def test_category_overview_fails_when_registry_membership_is_inconsistent(self) -> None:
        discovery = load_regulation_discovery_config("institutional_rules")
        category = next(
            item for item in discovery.categories if item.category_id == "public_service"
        )
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "category_overview",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": f"category:{category.category_id}",
                "category_id": category.category_id,
                "condition_polarity": "neutral",
                "category_registry_version": "policy_category_registry.v1",
                "audience": "错误受众",
                "member_policy_document_ids": ["official_web_regulation:not-in-registry"],
                "member_policy_titles": ["不在 registry 中的制度"],
            },
            content_role="policy_list",
            unit_type="category_overview",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("category_overview_audience_registry_conflict", result.issues)
        self.assertIn("category_overview_member_documents_registry_conflict", result.issues)

    def test_category_overview_fails_when_registry_titles_are_inconsistent(self) -> None:
        discovery = load_regulation_discovery_config("institutional_rules")
        category = next(
            item for item in discovery.categories if item.category_id == "public_service"
        )
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "category_overview",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": f"category:{category.category_id}",
                "category_id": category.category_id,
                "condition_polarity": "neutral",
                "category_registry_version": "policy_category_registry.v1",
                "audience": category.audience,
                "member_policy_document_ids": list(category.member_policy_document_ids),
                "member_policy_titles": ["错误标题"] * len(category.member_policy_document_ids),
            },
            content_role="policy_list",
            unit_type="category_overview",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("category_overview_member_titles_registry_conflict", result.issues)

    def test_category_overview_fails_when_category_id_is_unknown(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "category_overview",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "category:not_registered",
                "category_id": "not_registered",
                "condition_polarity": "neutral",
                "category_registry_version": "policy_category_registry.v1",
                "audience": "校园成员",
                "member_policy_document_ids": ["official_web_regulation:0a420e3fe367027c"],
                "member_policy_titles": ["中央民族大学校园卡管理办法"],
            },
            content_role="policy_list",
            unit_type="category_overview",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("category_overview_category_id_unknown", result.issues)

    def test_category_overview_fails_without_group_contract(self) -> None:
        discovery = load_regulation_discovery_config("institutional_rules")
        category = next(
            item for item in discovery.categories if item.category_id == "public_service"
        )
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "category_overview",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": f"category:{category.category_id}",
                "condition_subject": "audience_scope",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "category_registry:audience_scope",
                "condition_polarity": "neutral",
                "category_id": category.category_id,
                "category_registry_version": "policy_category_registry.v1",
                "audience": category.audience,
                "member_policy_document_ids": list(category.member_policy_document_ids),
                "member_policy_titles": [
                    discovery.policy_titles_by_document_id[document_id]
                    for document_id in category.member_policy_document_ids
                ],
            },
            content_role="policy_list",
            unit_type="category_overview",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_condition_group_id_missing", result.issues)


if __name__ == "__main__":
    unittest.main()
