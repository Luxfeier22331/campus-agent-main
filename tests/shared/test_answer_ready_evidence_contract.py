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

        self.assertIsInstance(result, AnswerReadyEvidenceValidationResult)
        self.assertEqual(result.status, "passed")
        self.assertEqual(result.severity, "release_blocking")
        self.assertEqual(result.issues, ())

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
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "category_overview",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "category:appeal",
                "category_id": "appeal",
                "category_registry_version": "policy_category_registry.v1",
                "audience": "student",
                "member_policy_document_ids": ["appeal-rule-1"],
                "member_policy_titles": ["学生申诉处理办法"],
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
            },
            content_role="policy_list",
            unit_type="category_overview",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("category_overview_registry_version_missing", result.issues)
        self.assertIn("category_overview_audience_missing", result.issues)
        self.assertIn("category_overview_missing_member_document_ids", result.issues)
        self.assertIn("category_overview_missing_member_titles", result.issues)


if __name__ == "__main__":
    unittest.main()
