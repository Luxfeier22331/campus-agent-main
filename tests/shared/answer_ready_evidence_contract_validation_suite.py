from __future__ import annotations

from campus_shared.answer_ready_evidence_contract import (
    AnswerReadyEvidenceValidationResult,
    validate_answer_ready_evidence_metadata,
)


class AnswerReadyEvidenceContractValidationSuite:
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

    def test_v3_validation_allows_specialized_intro_subject_without_generic_role_conflict(
        self,
    ) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "eligibility_intro",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-a:article-2",
                "condition_group_id": "doc-a:article-2:rank_threshold",
                "condition_subject": "rank_threshold",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "metadata:introduced_condition_subject",
                "intro_scope": "eligibility_group",
                "introduced_condition_group_id": "doc-a:article-2:rank_threshold",
                "intro_target_roles": ("eligibility_condition",),
                "is_answer_bearing": False,
            },
            content_role="eligibility",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "passed")
        self.assertNotIn("answer_ready_condition_subject_role_conflict", result.issues)

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
