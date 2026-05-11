from __future__ import annotations

import json
import unittest
from dataclasses import replace
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.answer_ready_component_eval import (
    ANSWER_READY_COMPONENT_CASES_PATH,
    AnswerReadyComponentCaseSet,
    AnswerReadyComponentObservationSet,
    ObservedAnswerReadyComponents,
    evaluate_answer_ready_component_cases,
    load_answer_ready_component_cases,
    load_answer_ready_component_observations,
)


def _aligned_observations() -> dict[str, ObservedAnswerReadyComponents]:
    return {
        "student_discipline_relief_procedure": ObservedAnswerReadyComponents(
            task_kind="procedure_lookup",
            query_polarity="positive",
            answer_role="procedure_step",
            retrieved_document_ids=("handbook:6f147355748d2d2f181c310f8d1e0da908f2f1a8",),
            ranked_evidence_roles=("procedure_step",),
            selected_evidence_roles=("procedure_step",),
            draft_kind="procedure_steps",
            grounding_support_present=True,
            condition_subject="application_procedure",
            selected_condition_subjects=("application_procedure",),
            selected_polarities=("positive",),
            release_contract_status="passed",
            release_contract_failure_classes=(),
        ),
        "student_scholarship_discovery": ObservedAnswerReadyComponents(
            task_kind="category_discovery",
            query_polarity="neutral",
            answer_role="category_overview",
            retrieved_document_ids=(
                "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
                "handbook:1f17ba6234c15963648b3d74656d78621cad77a7",
            ),
            ranked_evidence_roles=("category_overview",),
            selected_evidence_roles=("category_overview",),
            draft_kind="policy_list",
            grounding_support_present=True,
            condition_subject="audience_scope",
            selected_condition_subjects=("audience_scope",),
            selected_polarities=("neutral",),
            release_contract_status="passed",
            release_contract_failure_classes=(),
        ),
        "student_scholarship_amount_table_fact": ObservedAnswerReadyComponents(
            task_kind="eligibility_judgment",
            query_polarity="positive",
            answer_role="table_fact",
            retrieved_document_ids=("handbook:60c8b33801e2e59e6db2210719592a6252e3516d",),
            ranked_evidence_roles=("table_fact",),
            selected_evidence_roles=("table_fact",),
            draft_kind="condition_table",
            grounding_support_present=True,
            condition_subject="amount_or_quota",
            selected_condition_subjects=("amount_or_quota",),
            selected_polarities=("positive",),
            release_contract_status="passed",
            release_contract_failure_classes=(),
        ),
        "student_national_scholarship_rank": ObservedAnswerReadyComponents(
            task_kind="eligibility_judgment",
            query_polarity="positive",
            answer_role="exception_rule",
            retrieved_document_ids=("handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",),
            ranked_evidence_roles=("exception_rule", "eligibility_condition"),
            selected_evidence_roles=("exception_rule",),
            draft_kind="eligibility_judgment",
            grounding_support_present=True,
            condition_subject="rank_threshold",
            selected_condition_subjects=("rank_threshold",),
            selected_polarities=("positive",),
            release_contract_status="passed",
            release_contract_failure_classes=(),
        ),
        "student_national_scholarship_paper": ObservedAnswerReadyComponents(
            task_kind="eligibility_judgment",
            query_polarity="positive",
            answer_role="example_evidence",
            retrieved_document_ids=("handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",),
            ranked_evidence_roles=("example_evidence", "eligibility_condition"),
            selected_evidence_roles=("example_evidence",),
            draft_kind="eligibility_judgment",
            grounding_support_present=True,
            condition_subject="paper_or_publication",
            selected_condition_subjects=("paper_or_publication",),
            selected_polarities=("positive",),
            release_contract_status="passed",
            release_contract_failure_classes=(),
        ),
        "student_scholarship_apply_ambiguous": ObservedAnswerReadyComponents(
            task_kind="ambiguous_procedure",
            query_polarity="neutral",
            answer_role="clarification",
            retrieved_document_ids=(),
            ranked_evidence_roles=(),
            selected_evidence_roles=(),
            draft_kind="clarification",
            grounding_support_present=False,
            condition_subject="application_procedure",
            selected_condition_subjects=(),
            selected_polarities=(),
            release_contract_status="passed",
            release_contract_failure_classes=(),
        ),
        "student_discipline_relief_exclusion": ObservedAnswerReadyComponents(
            task_kind="restriction_lookup",
            query_polarity="negative",
            answer_role="exclusion_rule",
            retrieved_document_ids=("handbook:6f147355748d2d2f181c310f8d1e0da908f2f1a8",),
            ranked_evidence_roles=("exclusion_rule",),
            selected_evidence_roles=("exclusion_rule",),
            draft_kind="condition_table",
            grounding_support_present=True,
            condition_subject="discipline_relief_exclusion",
            selected_condition_subjects=("discipline_relief_exclusion",),
            selected_polarities=("negative",),
            release_contract_status="passed",
            release_contract_failure_classes=(),
        ),
        "student_card_reissue": ObservedAnswerReadyComponents(
            task_kind="procedure_lookup",
            query_polarity="positive",
            answer_role="procedure_step",
            retrieved_document_ids=("handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",),
            ranked_evidence_roles=("procedure_step",),
            selected_evidence_roles=("procedure_step",),
            draft_kind="procedure_steps",
            grounding_support_present=True,
            condition_subject="application_procedure",
            selected_condition_subjects=("application_procedure",),
            selected_polarities=("positive",),
            release_contract_status="passed",
            release_contract_failure_classes=(),
        ),
        "student_rules_no_hit": ObservedAnswerReadyComponents(
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
        "institutional_appeal_procedure": ObservedAnswerReadyComponents(
            task_kind="procedure_lookup",
            query_polarity="positive",
            answer_role="procedure_step",
            retrieved_document_ids=("official_web_regulation:91431d30da51d124",),
            ranked_evidence_roles=("procedure_step",),
            selected_evidence_roles=("procedure_step",),
            draft_kind="procedure_steps",
            grounding_support_present=True,
            condition_subject="application_procedure",
            selected_condition_subjects=("application_procedure",),
            selected_polarities=("positive",),
            release_contract_status="passed",
            release_contract_failure_classes=(),
        ),
        "institutional_appeal_deadline": ObservedAnswerReadyComponents(
            task_kind="eligibility_judgment",
            query_polarity="positive",
            answer_role="time_constraint",
            retrieved_document_ids=("official_web_regulation:ce565b348ca6ee31",),
            ranked_evidence_roles=("time_constraint", "eligibility_condition"),
            selected_evidence_roles=("time_constraint",),
            draft_kind="condition_table",
            grounding_support_present=True,
            condition_subject="deadline",
            selected_condition_subjects=("deadline",),
            selected_polarities=("positive",),
            release_contract_status="passed",
            release_contract_failure_classes=(),
        ),
        "institutional_material_requirement": ObservedAnswerReadyComponents(
            task_kind="procedure_lookup",
            query_polarity="positive",
            answer_role="material_requirement",
            retrieved_document_ids=("official_web_regulation:e350a6f1f7c0fdb2",),
            ranked_evidence_roles=("material_requirement",),
            selected_evidence_roles=("material_requirement",),
            draft_kind="condition_table",
            grounding_support_present=True,
            condition_subject="material_requirement",
            selected_condition_subjects=("material_requirement",),
            selected_polarities=("positive",),
            release_contract_status="passed",
            release_contract_failure_classes=(),
        ),
        "institutional_category_discovery": ObservedAnswerReadyComponents(
            task_kind="category_discovery",
            query_polarity="neutral",
            answer_role="category_overview",
            retrieved_document_ids=(
                "official_web_regulation:0a420e3fe367027c",
                "official_web_regulation:b23aa5f14642eb92",
            ),
            ranked_evidence_roles=("category_overview",),
            selected_evidence_roles=("category_overview",),
            draft_kind="policy_list",
            grounding_support_present=True,
            condition_subject="audience_scope",
            selected_condition_subjects=("audience_scope",),
            selected_polarities=("neutral",),
            release_contract_status="passed",
            release_contract_failure_classes=(),
        ),
        "institutional_rules_no_hit": ObservedAnswerReadyComponents(
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
    }


class AnswerReadyComponentEvalRunnerTest(unittest.TestCase):
    def test_load_answer_ready_component_cases_from_fixture(self) -> None:
        case_set = load_answer_ready_component_cases()

        self.assertTrue(ANSWER_READY_COMPONENT_CASES_PATH.exists())
        self.assertIsInstance(case_set, AnswerReadyComponentCaseSet)
        self.assertEqual(case_set.schema_version, 1)
        self.assertEqual(case_set.case_family, "answer_ready_component_eval.v1")
        self.assertGreaterEqual(len(case_set.cases), 10)
        self.assertIn(
            "student_discipline_relief_procedure", {case.case_id for case in case_set.cases}
        )
        self.assertIn(
            "student_scholarship_apply_ambiguous", {case.case_id for case in case_set.cases}
        )
        self.assertIn(
            "student_scholarship_amount_table_fact", {case.case_id for case in case_set.cases}
        )
        self.assertIn(
            "student_national_scholarship_rank", {case.case_id for case in case_set.cases}
        )
        self.assertIn(
            "student_national_scholarship_paper", {case.case_id for case in case_set.cases}
        )
        self.assertIn("student_card_reissue", {case.case_id for case in case_set.cases})
        self.assertIn("student_rules_no_hit", {case.case_id for case in case_set.cases})
        self.assertIn(
            "student_discipline_relief_exclusion", {case.case_id for case in case_set.cases}
        )
        self.assertIn("institutional_appeal_procedure", {case.case_id for case in case_set.cases})
        self.assertIn("institutional_appeal_deadline", {case.case_id for case in case_set.cases})
        self.assertIn("institutional_category_discovery", {case.case_id for case in case_set.cases})
        self.assertIn("institutional_rules_no_hit", {case.case_id for case in case_set.cases})

    def test_load_answer_ready_component_observations_from_mapping_payload(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "observations.json"
            path.write_text(
                json.dumps(
                    {
                        "observations": {
                            "student_discipline_relief_procedure": {
                                "task_kind": "specific_policy_lookup",
                                "query_polarity": "positive",
                                "answer_role": "procedure_step",
                                "retrieved_document_ids": ["handbook:discipline-relief"],
                                "ranked_evidence_roles": ["procedure_step"],
                                "selected_evidence_roles": ["procedure_step"],
                                "draft_kind": "procedure_steps",
                                "grounding_support_present": True,
                                "condition_subject": "application_procedure",
                                "selected_condition_subjects": ["application_procedure"],
                                "selected_polarities": ["positive"],
                                "release_contract_status": "passed",
                                "release_contract_failure_classes": [],
                            }
                        }
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            observations = load_answer_ready_component_observations(path)

        self.assertIsInstance(observations, AnswerReadyComponentObservationSet)
        self.assertIn("student_discipline_relief_procedure", observations.observations)
        self.assertIsInstance(
            observations.observations["student_discipline_relief_procedure"],
            ObservedAnswerReadyComponents,
        )

    def test_load_answer_ready_component_observations_returns_empty_set_for_none_path(
        self,
    ) -> None:
        observations = load_answer_ready_component_observations(None)

        self.assertIsInstance(observations, AnswerReadyComponentObservationSet)
        self.assertEqual(observations.schema_version, 1)
        self.assertEqual(observations.observations, {})

    def test_evaluate_answer_ready_component_cases_reports_missing_observation(self) -> None:
        case_set = load_answer_ready_component_cases()

        report = evaluate_answer_ready_component_cases(case_set.cases[:1], {})

        self.assertFalse(report.passed)
        self.assertEqual(report.failed_count, 1)
        self.assertEqual(report.primary_failure_stage_counts["missing_observation"], 1)
        self.assertEqual(report.scope_failure_counts["student_rules"], 1)
        self.assertEqual(report.gate_failure_counts["query_conditioned"], 1)
        self.assertEqual(report.results[0].primary_failure_class, "missing_observation")
        self.assertEqual(report.results[0].secondary_failure_class, "")

    def test_evaluate_answer_ready_component_cases_reports_all_pass_for_aligned_observations(
        self,
    ) -> None:
        case_set = load_answer_ready_component_cases()
        observations = _aligned_observations()

        with TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "component-report.json"
            report = evaluate_answer_ready_component_cases(
                case_set.cases,
                observations,
                output_path=output_path,
            )
            payload = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertTrue(report.passed)
        self.assertEqual(report.total, len(case_set.cases))
        self.assertEqual(report.failed_count, 0)
        self.assertEqual(report.primary_failure_stage_counts, {})
        self.assertEqual(report.secondary_failure_stage_counts, {})
        self.assertEqual(report.scope_failure_counts, {})
        self.assertEqual(report.gate_failure_counts, {})
        self.assertEqual(payload["summary"]["failed"], 0)
        self.assertEqual(payload["summary"]["primary_failure_stage_counts"], {})
        self.assertEqual(payload["summary"]["scope_failure_counts"], {})
        deadline_result = next(
            item
            for item in payload["results"]
            if item["case_id"] == "institutional_appeal_deadline"
        )
        self.assertEqual(deadline_result["primary_failure_class"], "")

    def test_evaluate_answer_ready_component_cases_reports_institutional_deadline_failure_attribution(
        self,
    ) -> None:
        case_set = load_answer_ready_component_cases()
        observations = _aligned_observations()
        observations["institutional_appeal_deadline"] = replace(
            observations["institutional_appeal_deadline"],
            ranked_evidence_roles=("eligibility_condition",),
            selected_evidence_roles=("eligibility_condition",),
            release_contract_status="missing",
            release_contract_failure_classes=("chunk_contract_missing",),
        )

        with TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "component-report.json"
            report = evaluate_answer_ready_component_cases(
                case_set.cases,
                observations,
                output_path=output_path,
            )
            payload = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertFalse(report.passed)
        self.assertEqual(report.total, len(case_set.cases))
        self.assertEqual(report.failed_count, 1)
        self.assertEqual(report.primary_failure_stage_counts["ranking_mismatch"], 1)
        self.assertEqual(report.secondary_failure_stage_counts["release_contract_missing"], 1)
        self.assertEqual(report.scope_failure_counts["institutional_rules"], 1)
        self.assertEqual(report.gate_failure_counts["query_conditioned"], 1)
        self.assertEqual(report.gate_failure_counts["static_gate"], 1)
        self.assertEqual(payload["summary"]["failed"], 1)
        self.assertEqual(payload["summary"]["primary_failure_stage_counts"]["ranking_mismatch"], 1)
        self.assertEqual(payload["summary"]["scope_failure_counts"]["institutional_rules"], 1)
        deadline_result = next(
            item
            for item in payload["results"]
            if item["case_id"] == "institutional_appeal_deadline"
        )
        self.assertEqual(deadline_result["primary_failure_class"], "ranking_mismatch")

    def test_evaluate_answer_ready_component_cases_uses_release_contract_for_static_gate(
        self,
    ) -> None:
        case_set = load_answer_ready_component_cases()
        observations = _aligned_observations()
        observations["student_discipline_relief_procedure"] = replace(
            observations["student_discipline_relief_procedure"],
            release_contract_status="missing",
            release_contract_failure_classes=("chunk_contract_missing",),
        )

        report = evaluate_answer_ready_component_cases(case_set.cases, observations)

        self.assertFalse(report.passed)
        self.assertEqual(report.failed_count, 1)
        self.assertEqual(report.primary_failure_stage_counts["release_contract_missing"], 1)
        self.assertEqual(report.scope_failure_counts["student_rules"], 1)
        self.assertEqual(report.gate_failure_counts["static_gate"], 1)
        failure = next(
            result
            for result in report.results
            if result.case_id == "student_discipline_relief_procedure"
        )
        self.assertEqual(failure.primary_failure_class, "release_contract_missing")
        self.assertEqual(failure.secondary_failure_class, "")

    def test_evaluate_answer_ready_component_cases_attributes_typed_draft_invalid_to_draft_stage(
        self,
    ) -> None:
        case_set = load_answer_ready_component_cases()
        observations = _aligned_observations()
        observations["student_discipline_relief_procedure"] = replace(
            observations["student_discipline_relief_procedure"],
            grounding_support_present=False,
            no_answer_reason="typed_answer_draft_invalid",
        )

        report = evaluate_answer_ready_component_cases(case_set.cases, observations)

        self.assertFalse(report.passed)
        self.assertEqual(report.failed_count, 1)
        self.assertEqual(report.primary_failure_stage_counts["draft_contract_mismatch"], 1)
        self.assertEqual(report.scope_failure_counts["student_rules"], 1)
        self.assertEqual(report.gate_failure_counts["query_conditioned"], 1)
        failure = next(
            result
            for result in report.results
            if result.case_id == "student_discipline_relief_procedure"
        )
        self.assertEqual(failure.primary_failure_class, "draft_contract_mismatch")
        self.assertEqual(failure.secondary_failure_class, "")


if __name__ == "__main__":
    unittest.main()
