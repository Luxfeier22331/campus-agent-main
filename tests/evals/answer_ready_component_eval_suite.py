from __future__ import annotations

import unittest

from campus_evals.answer_ready_component_eval import (
    AnswerReadyComponentCase,
    ObservedAnswerReadyComponents,
    evaluate_answer_ready_component_case,
)


class AnswerReadyComponentEvalTest(unittest.TestCase):
    def test_component_eval_reports_intent_mismatch_before_downstream_failures(self) -> None:
        result = evaluate_answer_ready_component_case(
            _case(),
            ObservedAnswerReadyComponents(
                task_kind="ambiguous_procedure",
                query_polarity="positive",
                answer_role="procedure_step",
                retrieved_document_ids=(),
                ranked_evidence_roles=(),
                selected_evidence_roles=(),
                draft_kind="unsupported",
                grounding_support_present=False,
            ),
        )

        self.assertFalse(result.passed)
        self.assertEqual(result.primary_failure_class, "intent_mismatch")
        self.assertEqual(result.failure_classes, ("intent_mismatch",))

    def test_component_eval_reports_retrieval_miss_for_missing_expected_document(self) -> None:
        result = evaluate_answer_ready_component_case(
            _case(),
            _observed(retrieved_document_ids=("handbook:other",)),
        )

        self.assertFalse(result.passed)
        self.assertEqual(result.primary_failure_class, "retrieval_miss")
        self.assertEqual(result.failure_classes, ("retrieval_miss",))

    def test_component_eval_reports_ranking_mismatch_when_answer_ready_role_is_not_top(
        self,
    ) -> None:
        result = evaluate_answer_ready_component_case(
            _case(),
            _observed(ranked_evidence_roles=("exclusion_rule", "procedure_step")),
        )

        self.assertFalse(result.passed)
        self.assertEqual(result.primary_failure_class, "ranking_mismatch")
        self.assertEqual(result.failure_classes, ("ranking_mismatch",))

    def test_component_eval_reports_selection_not_answer_ready_for_wrong_selected_role(
        self,
    ) -> None:
        result = evaluate_answer_ready_component_case(
            _case(),
            _observed(selected_evidence_roles=("exclusion_rule",)),
        )

        self.assertFalse(result.passed)
        self.assertEqual(result.primary_failure_class, "selection_not_answer_ready")
        self.assertEqual(result.failure_classes, ("selection_not_answer_ready",))

    def test_component_eval_reports_draft_contract_mismatch(self) -> None:
        result = evaluate_answer_ready_component_case(
            _case(),
            _observed(draft_kind="condition_table"),
        )

        self.assertFalse(result.passed)
        self.assertEqual(result.primary_failure_class, "draft_contract_mismatch")
        self.assertEqual(result.failure_classes, ("draft_contract_mismatch",))

    def test_component_eval_reports_grounding_mismatch(self) -> None:
        result = evaluate_answer_ready_component_case(
            _case(),
            _observed(grounding_support_present=False),
        )

        self.assertFalse(result.passed)
        self.assertEqual(result.primary_failure_class, "grounding_mismatch")
        self.assertEqual(result.failure_classes, ("grounding_mismatch",))

    def test_component_eval_passes_when_all_stage_assertions_match(self) -> None:
        result = evaluate_answer_ready_component_case(_case(), _observed())

        self.assertTrue(result.passed)
        self.assertEqual(result.primary_failure_class, "")
        self.assertEqual(result.failure_classes, ())

    def test_component_eval_passes_for_student_card_reissue_procedure_case(self) -> None:
        result = evaluate_answer_ready_component_case(
            AnswerReadyComponentCase(
                case_id="student-card-reissue",
                query="学生证丢了怎么补",
                collection="student_rules",
                expected_task_kind="specific_policy_lookup",
                expected_query_polarity="positive",
                expected_answer_role="procedure_step",
                expected_condition_subject="application_procedure",
                expected_document_ids=("handbook:student-card-reissue",),
                expected_top_evidence_roles=("procedure_step",),
                expected_draft_kind="procedure_steps",
                expected_grounding=True,
            ),
            ObservedAnswerReadyComponents(
                task_kind="specific_policy_lookup",
                query_polarity="positive",
                answer_role="procedure_step",
                condition_subject="application_procedure",
                retrieved_document_ids=("handbook:student-card-reissue",),
                ranked_evidence_roles=("procedure_step", "procedure_step"),
                selected_evidence_roles=("procedure_step",),
                selected_condition_subjects=("application_procedure",),
                selected_polarities=("positive",),
                draft_kind="procedure_steps",
                grounding_support_present=True,
            ),
        )

        self.assertTrue(result.passed)
        self.assertEqual(result.primary_failure_class, "")


def _case() -> AnswerReadyComponentCase:
    return AnswerReadyComponentCase(
        case_id="discipline-relief-procedure",
        query="处分怎么消",
        collection="student_rules",
        expected_task_kind="specific_policy_lookup",
        expected_query_polarity="positive",
        expected_answer_role="procedure_step",
        expected_condition_subject="discipline_relief_procedure",
        expected_document_ids=("handbook:discipline-relief",),
        expected_top_evidence_roles=("procedure_step",),
        expected_draft_kind="procedure_steps",
        expected_grounding=True,
    )


def _observed(**overrides: object) -> ObservedAnswerReadyComponents:
    values: dict[str, object] = {
        "task_kind": "specific_policy_lookup",
        "query_polarity": "positive",
        "answer_role": "procedure_step",
        "condition_subject": "discipline_relief_procedure",
        "retrieved_document_ids": ("handbook:discipline-relief",),
        "ranked_evidence_roles": ("procedure_step", "exclusion_rule"),
        "selected_evidence_roles": ("procedure_step",),
        "selected_condition_subjects": ("discipline_relief_procedure",),
        "selected_polarities": ("positive",),
        "draft_kind": "procedure_steps",
        "grounding_support_present": True,
    }
    values.update(overrides)
    return ObservedAnswerReadyComponents(**values)


if __name__ == "__main__":
    unittest.main()
