# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.evals.answer_ready_component_runtime_suite_support import *


class AnswerReadyComponentRuntimeTestPart02(unittest.TestCase):
    def test_builds_negative_restriction_observation_from_runtime_response(self) -> None:
        selected_source = replace(
            _make_handbook_source(
                doc_id="handbook:discipline-relief",
                title="中央民族大学解除学生纪律处分实施办法",
                snippet="有下列情形之一的，不予解除处分。",
                score=0.91,
                chunk_id_suffix="discipline-exclusion",
                content_role="requirement",
                is_answer_bearing=True,
                semantic_role="exclusion_rule",
                polarity="negative",
                action_type="lift_discipline",
                claim_type="cannot_do",
            ),
            anchor=_answer_ready_anchor(
                answer_role="exclusion_rule",
                condition_subject="discipline_relief_exclusion",
                condition_group_id="handbook:discipline-relief:article-4:discipline_relief_exclusion",
                condition_polarity="negative",
            ),
        )
        response = AgentResponse(
            target="rag-agent",
            status="completed",
            answer_text="有规定情形的，不予解除处分。",
            confidence="high",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="student_rules",
                    query_text="哪些情况不能解除处分",
                    sources=(selected_source,),
                ),
                diagnostics=RagResultDiagnostics(
                    retrieved_sources=(selected_source,),
                    claim_supports=(
                        ClaimSupport(
                            claim_type="condition_row",
                            claim_text="不予解除处分的情形",
                            supported=True,
                            support_source_doc_id=selected_source.doc_id,
                            support_snippet=selected_source.snippet,
                        ),
                    ),
                    semantic_outcome="grounded_answer",
                    grounding_verdict="grounded",
                ),
            ),
        )

        observed = build_answer_ready_component_observation(
            query="哪些情况不能解除处分",
            response=response,
        )

        self.assertEqual(observed.task_kind, "restriction_lookup")
        self.assertEqual(observed.query_polarity, "negative")
        self.assertEqual(observed.answer_role, "exclusion_rule")
        self.assertEqual(observed.draft_kind, "condition_table")
        self.assertEqual(observed.condition_subject, "discipline_relief_exclusion")
        self.assertEqual(observed.selected_polarities, ("negative",))

    def test_builds_institutional_judgment_observation_from_selected_role_and_contract_diagnostics(
        self,
    ) -> None:
        selected_source = replace(
            _make_official_web_source(
                doc_id="official-web-regulation-appeal-deadline-test",
                title="中央民族大学学生申诉处理办法",
                snippet="学生申诉应当在收到处理决定之日起 10 日内提出。",
                score=0.93,
                chunk_id_suffix="appeal-deadline",
                content_role="requirement",
                is_answer_bearing=True,
                semantic_role="time_constraint",
                polarity="positive",
                claim_type="time_constraint",
                collection="institutional_rules",
            ),
            anchor=_answer_ready_anchor(
                answer_role="time_constraint",
                condition_subject="deadline",
                condition_group_id="institutional:appeal:deadline",
                condition_polarity="positive",
            ),
        )
        secondary_source = replace(
            _make_official_web_source(
                doc_id="official-web-regulation-appeal-deadline-test",
                title="中央民族大学学生申诉处理办法",
                snippet="申诉需要符合规定条件。",
                score=0.79,
                chunk_id_suffix="appeal-condition",
                content_role="requirement",
                is_answer_bearing=True,
                semantic_role="eligibility_condition",
                polarity="positive",
                claim_type="condition",
                collection="institutional_rules",
            ),
            anchor=_answer_ready_anchor(
                answer_role="eligibility_condition",
                condition_subject="deadline",
                condition_group_id="institutional:appeal:deadline",
                condition_polarity="positive",
            ),
        )
        response = AgentResponse(
            target="rag-agent",
            status="completed",
            answer_text="应当在收到处理决定之日起 10 日内提出申诉。",
            confidence="high",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="institutional_rules",
                    query_text="申诉有时间限制吗",
                    sources=(selected_source,),
                ),
                diagnostics=RagResultDiagnostics(
                    retrieved_sources=(selected_source, secondary_source),
                    claim_supports=(
                        ClaimSupport(
                            claim_type="condition_row",
                            claim_text="应当在收到处理决定之日起 10 日内提出。",
                            supported=True,
                            support_source_doc_id=selected_source.doc_id,
                            support_snippet=selected_source.snippet,
                        ),
                    ),
                    semantic_outcome="grounded_answer",
                    grounding_verdict="grounded",
                ),
            ),
        )

        observed = build_answer_ready_component_observation(
            query="申诉有时间限制吗",
            response=response,
            retrieval_runtime_observations=(
                {
                    "contract_missing": True,
                    "contract_issue_reason": "missing_contract",
                    "missing_contract_fields": ("evidence_contract_version",),
                },
            ),
            release_contract_status="missing",
            release_contract_failure_classes=("chunk_contract_missing",),
        )

        self.assertEqual(observed.task_kind, "eligibility_judgment")
        self.assertEqual(observed.query_polarity, "positive")
        self.assertEqual(observed.answer_role, "time_constraint")
        self.assertEqual(observed.selected_evidence_roles, ("time_constraint",))
        self.assertEqual(observed.draft_kind, "condition_table")
        self.assertEqual(observed.condition_subject, "deadline")
        self.assertEqual(observed.selected_condition_subjects, ("deadline",))
        self.assertEqual(observed.selected_polarities, ("positive",))
        self.assertEqual(observed.release_contract_status, "missing")
        self.assertEqual(
            observed.release_contract_failure_classes,
            ("chunk_contract_missing",),
        )

    def test_time_constraint_claim_support_maps_to_condition_table_draft_kind(self) -> None:
        selected_source = replace(
            _make_official_web_source(
                doc_id="official-web-regulation-appeal-deadline-test",
                title="中央民族大学学生申诉处理办法",
                snippet="学生申诉应当在收到处理决定之日起 10 日内提出。",
                score=0.93,
                chunk_id_suffix="appeal-deadline-typed-claim",
                content_role="requirement",
                is_answer_bearing=True,
                semantic_role="time_constraint",
                polarity="positive",
                claim_type="time_constraint",
                collection="institutional_rules",
            ),
            anchor=_answer_ready_anchor(
                answer_role="time_constraint",
                condition_subject="deadline",
                condition_group_id="institutional:appeal:deadline",
                condition_polarity="positive",
            ),
        )
        response = AgentResponse(
            target="rag-agent",
            status="completed",
            answer_text="应当在收到处理决定之日起 10 日内提出申诉。",
            confidence="high",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="institutional_rules",
                    query_text="申诉有时间限制吗",
                    sources=(selected_source,),
                ),
                diagnostics=RagResultDiagnostics(
                    retrieved_sources=(selected_source,),
                    claim_supports=(
                        ClaimSupport(
                            claim_type="time_constraint",
                            claim_text="应当在收到处理决定之日起 10 日内提出。",
                            supported=True,
                            support_source_doc_id=selected_source.doc_id,
                            support_snippet=selected_source.snippet,
                        ),
                    ),
                    semantic_outcome="grounded_answer",
                    grounding_verdict="grounded",
                ),
            ),
        )

        observed = build_answer_ready_component_observation(
            query="申诉有时间限制吗",
            response=response,
        )

        self.assertEqual(observed.draft_kind, "condition_table")

    def test_builds_institutional_procedure_observation_from_selected_role(self) -> None:
        selected_source = replace(
            _make_official_web_source(
                doc_id="official-web-regulation-appeal-procedure-test",
                title="中央民族大学学生申诉处理办法",
                snippet="校级申诉应当先提交申请，再进入复核和决定程序。",
                score=0.94,
                chunk_id_suffix="appeal-procedure",
                content_role="procedure",
                is_answer_bearing=True,
                semantic_role="procedure_step",
                polarity="positive",
                claim_type="procedure",
                collection="institutional_rules",
            ),
            anchor=_answer_ready_anchor(
                answer_role="procedure_step",
                condition_subject="application_procedure",
                condition_group_id="institutional:appeal:procedure",
                condition_polarity="positive",
                procedure_step_index=1,
                procedure_actor="student",
                procedure_action="submit_materials",
            ),
        )
        response = AgentResponse(
            target="rag-agent",
            status="completed",
            answer_text="先提交申请，再进入复核和决定程序。",
            confidence="high",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="institutional_rules",
                    query_text="校级申诉怎么走流程",
                    sources=(selected_source,),
                ),
                diagnostics=RagResultDiagnostics(
                    retrieved_sources=(selected_source,),
                    claim_supports=(
                        ClaimSupport(
                            claim_type="procedure_step",
                            claim_text="提交申请",
                            supported=True,
                            support_source_doc_id=selected_source.doc_id,
                            support_snippet=selected_source.snippet,
                        ),
                    ),
                    semantic_outcome="grounded_answer",
                    grounding_verdict="grounded",
                ),
            ),
        )

        observed = build_answer_ready_component_observation(
            query="校级申诉怎么走流程",
            response=response,
        )

        self.assertEqual(observed.task_kind, "procedure_lookup")
        self.assertEqual(observed.query_polarity, "positive")
        self.assertEqual(observed.answer_role, "procedure_step")
        self.assertEqual(observed.draft_kind, "procedure_steps")
        self.assertEqual(observed.condition_subject, "application_procedure")

    def test_builds_institutional_unsupported_observation_when_title_only_candidates_fail_closed(
        self,
    ) -> None:
        response = AgentResponse(
            target="rag-agent",
            status="no_answer",
            answer_text="当前未检索到足够依据支持回答这个校级制度问题，请确认它是否属于当前已开放的校级制度范围，或补充更具体的制度名称。",
            confidence="low",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="institutional_rules",
                    query_text="中央民族大学星际通勤飞船管理办法",
                    sources=(),
                ),
                diagnostics=RagResultDiagnostics(
                    retrieved_sources=(),
                    claim_supports=(),
                    semantic_outcome="unsupported_by_evidence",
                    grounding_verdict="unsupported",
                    retrieval_adequacy_verdict="insufficient",
                    retrieval_adequacy_reason="no_supporting_sources",
                    no_answer_reason="",
                ),
            ),
        )

        observed = build_answer_ready_component_observation(
            query="中央民族大学星际通勤飞船管理办法",
            response=response,
        )

        self.assertEqual(observed.task_kind, "unsupported_or_no_hit")
        self.assertEqual(observed.query_polarity, "neutral")
        self.assertEqual(observed.answer_role, "unsupported")
        self.assertEqual(observed.draft_kind, "unsupported")

    def test_collects_runtime_observations_into_case_mapping(self) -> None:
        source = replace(
            _make_handbook_source(
                doc_id="handbook:discipline-relief",
                title="中央民族大学解除学生纪律处分实施办法",
                snippet="学生提交解除处分申请表，经学院审核后报学生处。",
                score=0.92,
                chunk_id_suffix="discipline-procedure",
                content_role="procedure",
                is_answer_bearing=True,
                semantic_role="procedure_step",
                polarity="positive",
                action_type="lift_discipline",
                claim_type="procedure",
            ),
            anchor=_answer_ready_anchor(
                answer_role="procedure_step",
                condition_subject="application_procedure",
                condition_group_id="handbook:discipline-relief:article-3:application_procedure",
                condition_polarity="positive",
            ),
        )
        response = AgentResponse(
            target="rag-agent",
            status="completed",
            answer_text="按规定提交解除处分申请表。",
            confidence="high",
            result=RagResultPayload(
                evidence=EvidenceBundle(
                    corpus="regulations",
                    collection="student_rules",
                    query_text="处分怎么消",
                    sources=(source,),
                ),
                diagnostics=RagResultDiagnostics(
                    retrieved_sources=(source,),
                    claim_supports=(
                        ClaimSupport(
                            claim_type="procedure_step",
                            claim_text="提交解除处分申请表。",
                            supported=True,
                            support_source_doc_id=source.doc_id,
                            support_snippet=source.snippet,
                        ),
                    ),
                    semantic_outcome="grounded_answer",
                    grounding_verdict="grounded",
                ),
            ),
        )

        observation_set = collect_answer_ready_component_runtime_observations(
            (
                AnswerReadyComponentRuntimeArtifact(
                    case_id="student_discipline_relief_procedure",
                    query="处分怎么消",
                    response=response,
                    release_contract_status="passed",
                ),
            )
        )

        self.assertEqual(observation_set.schema_version, 1)
        self.assertIn(
            "student_discipline_relief_procedure",
            observation_set.observations,
        )
        self.assertEqual(
            observation_set.observations["student_discipline_relief_procedure"].draft_kind,
            "procedure_steps",
        )


if __name__ == "__main__":
    unittest.main()
