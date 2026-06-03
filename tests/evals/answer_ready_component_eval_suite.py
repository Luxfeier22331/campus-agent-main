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
        self.assertEqual(result.secondary_failure_class, "")
        self.assertEqual(result.failure_classes, ("intent_mismatch",))
        self.assertEqual(result.failure_gate_classifications, ("query_conditioned",))

    def test_component_eval_reports_retrieval_miss_for_missing_expected_document(self) -> None:
        result = evaluate_answer_ready_component_case(
            _case(),
            _observed(retrieved_document_ids=("handbook:other",)),
        )

        self.assertFalse(result.passed)
        self.assertEqual(result.primary_failure_class, "retrieval_miss")
        self.assertEqual(result.secondary_failure_class, "")
        self.assertEqual(result.failure_classes, ("retrieval_miss",))
        self.assertEqual(result.failure_gate_classifications, ("query_conditioned",))

    def test_component_eval_reports_ranking_mismatch_when_answer_ready_role_is_not_top(
        self,
    ) -> None:
        result = evaluate_answer_ready_component_case(
            _case(),
            _observed(ranked_evidence_roles=("exclusion_rule", "procedure_step")),
        )

        self.assertFalse(result.passed)
        self.assertEqual(result.primary_failure_class, "ranking_mismatch")
        self.assertEqual(result.secondary_failure_class, "")
        self.assertEqual(result.failure_classes, ("ranking_mismatch",))
        self.assertEqual(result.failure_gate_classifications, ("query_conditioned",))

    def test_component_eval_prefers_specific_answer_role_over_generic_allowed_top_role(
        self,
    ) -> None:
        result = evaluate_answer_ready_component_case(
            AnswerReadyComponentCase(
                case_id="institutional-appeal-deadline",
                query="申诉有时间限制吗",
                collection="institutional_rules",
                expected_task_kind="eligibility_judgment",
                expected_query_polarity="positive",
                expected_answer_role="time_constraint",
                expected_condition_subject="deadline",
                expected_condition_polarity="positive",
                expected_document_ids=("official-web-regulation-appeal-deadline-test",),
                expected_top_evidence_roles=("time_constraint", "eligibility_condition"),
                expected_draft_kind="condition_table",
                expected_grounding=True,
            ),
            ObservedAnswerReadyComponents(
                task_kind="eligibility_judgment",
                query_polarity="positive",
                answer_role="time_constraint",
                condition_subject="deadline",
                retrieved_document_ids=("official-web-regulation-appeal-deadline-test",),
                ranked_evidence_roles=("eligibility_condition",),
                selected_evidence_roles=("eligibility_condition",),
                selected_condition_subjects=("deadline",),
                selected_polarities=("positive",),
                draft_kind="condition_table",
                grounding_support_present=True,
            ),
        )

        self.assertFalse(result.passed)
        self.assertEqual(result.primary_failure_class, "ranking_mismatch")
        self.assertEqual(result.secondary_failure_class, "")
        self.assertEqual(result.failure_classes, ("ranking_mismatch",))
        self.assertEqual(result.failure_gate_classifications, ("query_conditioned",))

    def test_component_eval_reports_selection_not_answer_ready_for_wrong_selected_role(
        self,
    ) -> None:
        result = evaluate_answer_ready_component_case(
            _case(),
            _observed(selected_evidence_roles=("exclusion_rule",)),
        )

        self.assertFalse(result.passed)
        self.assertEqual(result.primary_failure_class, "selection_not_answer_ready")
        self.assertEqual(result.secondary_failure_class, "")
        self.assertEqual(result.failure_classes, ("selection_not_answer_ready",))
        self.assertEqual(result.failure_gate_classifications, ("query_conditioned",))

    def test_component_eval_reports_semantic_contract_mismatch_for_selected_subject_and_polarity(
        self,
    ) -> None:
        result = evaluate_answer_ready_component_case(
            _case(),
            _observed(
                selected_condition_subjects=("generic_condition",),
                selected_polarities=("negative",),
            ),
        )

        self.assertFalse(result.passed)
        self.assertEqual(result.primary_failure_class, "semantic_contract_mismatch")
        self.assertEqual(result.secondary_failure_class, "")
        self.assertEqual(result.failure_classes, ("semantic_contract_mismatch",))
        self.assertEqual(result.failure_gate_classifications, ("query_conditioned",))

    def test_component_eval_reports_draft_contract_mismatch(self) -> None:
        result = evaluate_answer_ready_component_case(
            _case(),
            _observed(draft_kind="condition_table"),
        )

        self.assertFalse(result.passed)
        self.assertEqual(result.primary_failure_class, "draft_contract_mismatch")
        self.assertEqual(result.secondary_failure_class, "")
        self.assertEqual(result.failure_classes, ("draft_contract_mismatch",))
        self.assertEqual(result.failure_gate_classifications, ("query_conditioned",))

    def test_component_eval_projects_typed_draft_invalid_as_draft_contract_mismatch(
        self,
    ) -> None:
        result = evaluate_answer_ready_component_case(
            _case(),
            _observed(
                no_answer_reason="typed_answer_draft_invalid",
                grounding_support_present=False,
            ),
        )

        self.assertFalse(result.passed)
        self.assertEqual(result.primary_failure_class, "draft_contract_mismatch")
        self.assertEqual(result.secondary_failure_class, "")
        self.assertEqual(result.failure_classes, ("draft_contract_mismatch",))
        self.assertEqual(result.failure_gate_classifications, ("query_conditioned",))

    def test_component_eval_reports_grounding_mismatch(self) -> None:
        result = evaluate_answer_ready_component_case(
            _case(),
            _observed(grounding_support_present=False),
        )

        self.assertFalse(result.passed)
        self.assertEqual(result.primary_failure_class, "grounding_mismatch")
        self.assertEqual(result.secondary_failure_class, "")
        self.assertEqual(result.failure_classes, ("grounding_mismatch",))
        self.assertEqual(result.failure_gate_classifications, ("query_conditioned",))

    def test_component_eval_passes_when_required_answer_ready_components_match(
        self,
    ) -> None:
        result = evaluate_answer_ready_component_case(
            _case(),
            _observed(),
        )

        self.assertTrue(result.passed)
        self.assertEqual(result.primary_failure_class, "")
        self.assertEqual(result.secondary_failure_class, "")
        self.assertEqual(result.failure_classes, ())
        self.assertEqual(result.failure_gate_classifications, ())

    def test_component_eval_reports_release_contract_missing_after_query_stages(self) -> None:
        result = evaluate_answer_ready_component_case(
            _case(),
            _observed(
                release_contract_status="missing",
                release_contract_failure_classes=("chunk_contract_missing",),
            ),
        )

        self.assertFalse(result.passed)
        self.assertEqual(result.primary_failure_class, "release_contract_missing")
        self.assertEqual(result.secondary_failure_class, "")
        self.assertEqual(result.failure_classes, ("release_contract_missing",))
        self.assertEqual(result.failure_gate_classifications, ("static_gate",))

    def test_component_eval_reports_primary_and_secondary_failure_classes_in_stage_order(
        self,
    ) -> None:
        result = evaluate_answer_ready_component_case(
            _case(),
            _observed(
                ranked_evidence_roles=("exclusion_rule", "procedure_step"),
                draft_kind="condition_table",
            ),
        )

        self.assertFalse(result.passed)
        self.assertEqual(result.primary_failure_class, "ranking_mismatch")
        self.assertEqual(result.secondary_failure_class, "draft_contract_mismatch")
        self.assertEqual(
            result.failure_classes,
            ("ranking_mismatch", "draft_contract_mismatch"),
        )
        self.assertEqual(
            result.failure_gate_classifications,
            ("query_conditioned", "query_conditioned"),
        )

    def test_component_eval_passes_when_all_stage_assertions_match(self) -> None:
        result = evaluate_answer_ready_component_case(_case(), _observed())

        self.assertTrue(result.passed)
        self.assertEqual(result.primary_failure_class, "")
        self.assertEqual(result.secondary_failure_class, "")
        self.assertEqual(result.failure_classes, ())
        self.assertEqual(result.failure_gate_classifications, ())

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
                expected_condition_polarity="positive",
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
        self.assertEqual(result.secondary_failure_class, "")

    def test_component_eval_passes_for_ambiguous_scholarship_clarification_case(self) -> None:
        result = evaluate_answer_ready_component_case(
            AnswerReadyComponentCase(
                case_id="student-scholarship-apply-ambiguous",
                query="奖学金怎么申请",
                collection="student_rules",
                expected_task_kind="ambiguous_procedure",
                expected_query_polarity="neutral",
                expected_answer_role="clarification",
                expected_condition_subject="application_procedure",
                expected_top_evidence_roles=(),
                expected_draft_kind="clarification",
                expected_grounding=False,
            ),
            ObservedAnswerReadyComponents(
                task_kind="ambiguous_procedure",
                query_polarity="neutral",
                answer_role="clarification",
                condition_subject="application_procedure",
                retrieved_document_ids=(),
                ranked_evidence_roles=(),
                selected_evidence_roles=(),
                selected_condition_subjects=(),
                selected_polarities=(),
                draft_kind="clarification",
                grounding_support_present=False,
                release_contract_status="passed",
                release_contract_failure_classes=(),
            ),
        )

        self.assertTrue(result.passed)
        self.assertEqual(result.primary_failure_class, "")
        self.assertEqual(result.secondary_failure_class, "")

    def test_component_eval_passes_for_student_scholarship_amount_table_fact_case(self) -> None:
        result = evaluate_answer_ready_component_case(
            AnswerReadyComponentCase(
                case_id="student-scholarship-amount-table-fact",
                query="专业奖学金一等奖金额是多少？",
                collection="student_rules",
                expected_task_kind="specific_policy_lookup",
                expected_query_polarity="positive",
                expected_answer_role="table_fact",
                expected_condition_subject="amount_or_quota",
                expected_condition_polarity="positive",
                expected_document_ids=("handbook:professional-scholarship",),
                expected_top_evidence_roles=("table_fact",),
                expected_draft_kind="condition_table",
                expected_grounding=True,
            ),
            ObservedAnswerReadyComponents(
                task_kind="specific_policy_lookup",
                query_polarity="positive",
                answer_role="table_fact",
                condition_subject="amount_or_quota",
                retrieved_document_ids=("handbook:professional-scholarship",),
                ranked_evidence_roles=("table_fact",),
                selected_evidence_roles=("table_fact",),
                selected_condition_subjects=("amount_or_quota",),
                selected_polarities=("positive",),
                draft_kind="condition_table",
                grounding_support_present=True,
                release_contract_status="passed",
                release_contract_failure_classes=(),
            ),
        )

        self.assertTrue(result.passed)
        self.assertEqual(result.primary_failure_class, "")
        self.assertEqual(result.secondary_failure_class, "")

    def test_component_eval_passes_for_student_rules_no_hit_case(self) -> None:
        result = evaluate_answer_ready_component_case(
            AnswerReadyComponentCase(
                case_id="student-rules-no-hit",
                query="校内宇宙签证办理处",
                collection="student_rules",
                expected_task_kind="unsupported_or_no_hit",
                expected_query_polarity="neutral",
                expected_answer_role="unsupported",
                expected_top_evidence_roles=(),
                expected_draft_kind="unsupported",
                expected_grounding=False,
            ),
            ObservedAnswerReadyComponents(
                task_kind="unsupported_or_no_hit",
                query_polarity="neutral",
                answer_role="unsupported",
                retrieved_document_ids=(),
                ranked_evidence_roles=(),
                selected_evidence_roles=(),
                draft_kind="unsupported",
                grounding_support_present=False,
                condition_subject="",
                selected_condition_subjects=(),
                selected_polarities=(),
                release_contract_status="passed",
                release_contract_failure_classes=(),
            ),
        )

        self.assertTrue(result.passed)
        self.assertEqual(result.primary_failure_class, "")
        self.assertEqual(result.secondary_failure_class, "")


def _case() -> AnswerReadyComponentCase:
    return AnswerReadyComponentCase(
        case_id="discipline-relief-procedure",
        query="处分怎么消",
        collection="student_rules",
        expected_task_kind="specific_policy_lookup",
        expected_query_polarity="positive",
        expected_answer_role="procedure_step",
        expected_condition_subject="discipline_relief_procedure",
        expected_condition_polarity="positive",
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
        "no_answer_reason": "",
        "release_contract_status": "passed",
        "release_contract_failure_classes": (),
    }
    values.update(overrides)
    return ObservedAnswerReadyComponents(**values)


if __name__ == "__main__":
    unittest.main()
