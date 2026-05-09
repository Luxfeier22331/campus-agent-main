from __future__ import annotations

from campus_shared.answer_ready_evidence_contract import validate_answer_ready_evidence_metadata


class AnswerReadyEvidenceContractConflictSuite:
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

    def test_v3_validation_fails_when_procedure_actor_uses_generic_fallback_actor(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "procedure_step",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-c:article-8",
                "clause_unit_id": "doc-c:article-8:1",
                "condition_subject": "application_procedure",
                "condition_group_subject": "application_procedure",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "answer_role:procedure_step",
                "condition_group_id": "doc-c:article-8:application_procedure",
                "condition_polarity": "positive",
                "procedure_step_index": 1,
                "procedure_actor": "responsible_party",
                "procedure_action": "submit_materials",
                "procedure_action_taxonomy_version": "procedure_action.v1",
                "procedure_action_provenance": "metadata:procedure_action",
            },
            content_role="procedure",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_procedure_actor_generic_fallback", result.issues)

    def test_v3_validation_fails_when_procedure_action_uses_generic_fallback_action(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="student_rules",
            metadata={
                "answer_role": "procedure_step",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "doc-c:article-9",
                "clause_unit_id": "doc-c:article-9:1",
                "condition_subject": "application_procedure",
                "condition_group_subject": "application_procedure",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "answer_role:procedure_step",
                "condition_group_id": "doc-c:article-9:application_procedure",
                "condition_polarity": "positive",
                "procedure_step_index": 1,
                "procedure_actor": "student",
                "procedure_action": "procedure_step",
                "procedure_action_taxonomy_version": "procedure_action.v1",
                "procedure_action_provenance": "resolved:procedure_step",
            },
            content_role="procedure",
            unit_type="article_body",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_procedure_action_generic_fallback", result.issues)

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
