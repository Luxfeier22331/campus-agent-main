from __future__ import annotations

import unittest

from campus_shared.regulation_semantic_registry import (
    REGULATION_CONDITION_SUBJECT_DEFINITIONS,
    REGULATION_PROCEDURE_ACTION_DEFINITIONS,
    canonical_regulation_condition_subject,
    canonical_regulation_procedure_action,
    load_student_rules_discovery_config,
    regulation_categories_for_document,
    resolve_regulation_condition_subject,
    resolve_regulation_procedure_action,
)


class RegulationSemanticRegistryTest(unittest.TestCase):
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

    def test_shared_taxonomy_definitions_carry_governance_metadata(self) -> None:
        procedure = REGULATION_PROCEDURE_ACTION_DEFINITIONS["submit_materials"]
        subject = REGULATION_CONDITION_SUBJECT_DEFINITIONS["application_procedure"]

        self.assertEqual(procedure.action_id, "submit_materials")
        self.assertTrue(procedure.description)
        self.assertEqual(procedure.expected_answer_roles, ("procedure_step",))
        self.assertTrue(procedure.release_blocking)

        self.assertEqual(subject.subject_id, "application_procedure")
        self.assertTrue(subject.description)
        self.assertIn("procedure_step", subject.expected_answer_roles)
        self.assertTrue(subject.release_blocking)

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

    def test_shared_condition_subject_resolution_canonicalizes_explicit_alias(self) -> None:
        assignment = resolve_regulation_condition_subject(
            text="申请人应当品行端正。",
            answer_role="eligibility_condition",
            explicit_condition_subject="general_eligibility",
        )

        self.assertEqual(assignment.value, "generic_condition")
        self.assertEqual(assignment.provenance, "metadata:condition_subject")

    def test_shared_procedure_action_resolution_prefers_explicit_metadata(self) -> None:
        assignment = resolve_regulation_procedure_action(
            text="统一受理、协调处理、统一答复向学校提出的信息公开申请。",
            actor="office",
            explicit_action="office_review",
        )

        self.assertEqual(canonical_regulation_procedure_action(assignment.value), "office_review")
        self.assertEqual(assignment.provenance, "metadata:procedure_action")


if __name__ == "__main__":
    unittest.main()
