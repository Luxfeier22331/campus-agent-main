from __future__ import annotations

import unittest

from campus_contracts import AgentRequest, EvidenceBundle, KnowledgeScope, RagRequestPayload
from campus_evals.rag_stage_diagnostics import build_rag_stage_diagnostic_case
from campus_rag_agent.service_stage_diagnostics import build_rag_stage_activity_summaries

from tests.agent.rag_agent_test_support import (
    _default_grounded_runner_for_evidence,
    _make_handbook_source,
    _make_official_web_source,
    delegate_to_rag_agent,
)


class RagStageDiagnosticsSuite(unittest.TestCase):
    def test_build_rag_stage_diagnostic_case_projects_single_sample_stage_chain(self) -> None:
        evidence = _medical_evidence()
        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="公费医疗报销需要什么材料",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
            rag_sdk_runner=_default_grounded_runner_for_evidence(evidence),
        )

        diagnostics = build_rag_stage_diagnostic_case(
            case_id="student-rules-medical-materials",
            user_goal="公费医疗报销需要什么材料",
            response=response,
        )

        self.assertEqual(diagnostics["case_id"], "student-rules-medical-materials")
        self.assertEqual(
            diagnostics["stage_order"],
            (
                "intent",
                "plan",
                "retrieval",
                "rerank",
                "selection",
                "typed_answer",
                "synthesis",
                "grounding",
            ),
        )
        self.assertEqual(diagnostics["intent"]["kind"], "condition_table")
        self.assertEqual(diagnostics["intent"]["answer_kind"], "condition_table")
        self.assertEqual(diagnostics["intent"]["condition_subject"], "material_requirement")
        self.assertEqual(diagnostics["plan"]["query_mode"], "current")
        self.assertEqual(
            diagnostics["plan"]["step_count"],
            len(diagnostics["retrieval"]["step_ids"]),
        )
        self.assertGreaterEqual(diagnostics["plan"]["step_count"], 1)
        self.assertEqual(
            diagnostics["plan"]["need_ids"],
            ("need:1:condition_table",),
        )
        self.assertEqual(diagnostics["retrieval"]["terminal_state"], "completed")
        self.assertFalse(diagnostics["rerank"]["enabled"])
        self.assertEqual(diagnostics["selection"]["supporting_evidence_count"], 2)
        self.assertEqual(diagnostics["typed_answer"]["kind"], "condition_table")
        self.assertEqual(diagnostics["typed_answer"]["validation_verdict"], "valid")
        self.assertIn("presentation_kind", diagnostics["typed_answer"])
        self.assertIn("presentation_path", diagnostics["typed_answer"])
        self.assertEqual(diagnostics["synthesis"]["semantic_outcome"], "grounded_answer")
        self.assertIn("presentation_kind", diagnostics["synthesis"])
        self.assertIn("presentation_path", diagnostics["synthesis"])
        self.assertEqual(diagnostics["grounding"]["verdict"], "grounded")

    def test_build_rag_stage_diagnostic_case_projects_short_answer_presentation(self) -> None:
        evidence = EvidenceBundle(
            query_text="中央民族大学学校简介",
            corpus="official_web",
            collection="stable_reference",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    title="学校简介",
                    snippet=(
                        "标题：学校简介 | 章节：学校概况 "
                        "中央民族大学是党和国家为解决民族问题、培养各民族干部和高级专门人才而创建的一所特色鲜明的高等院校。"
                        "学校前身是中国共产党1941年9月在延安创办的延安民族学院。"
                    ),
                    score=0.91,
                    chunk_id_suffix="school-profile-stage-diag",
                    content_role="primary_content",
                    collection="stable_reference",
                ),
            ),
        )
        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="中央民族大学学校简介",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="official_web", collection="stable_reference")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
            rag_sdk_runner=_default_grounded_runner_for_evidence(evidence),
        )

        diagnostics = build_rag_stage_diagnostic_case(
            case_id="official-web-school-profile",
            user_goal="中央民族大学学校简介",
            response=response,
        )

        self.assertEqual(diagnostics["typed_answer"]["presentation_kind"], "brief_reference")
        self.assertEqual(diagnostics["typed_answer"]["presentation_path"], "")
        self.assertEqual(diagnostics["typed_answer"]["diagnostic_reason"], "")
        self.assertEqual(diagnostics["synthesis"]["presentation_kind"], "brief_reference")
        self.assertEqual(diagnostics["synthesis"]["presentation_path"], "")

    def test_stage_activities_do_not_fabricate_plan_id_or_query_mode_when_retrieval_not_run(
        self,
    ) -> None:
        evidence = _medical_evidence()

        activities = build_rag_stage_activity_summaries(
            request_id="req-no-retrieval",
            evidence=evidence,
            retrieved_evidence=None,
            retrieval_execution_result=None,
            retrieval_adequacy=None,
            semantic_outcome="needs_clarification",
            no_answer_reason="",
            fail_close_reason="",
            grounding_verdict="",
            prompt_runtime_state="clarification_required",
        )

        planner = activities[0]
        retrieval = activities[1]
        self.assertEqual(planner.plan_id, "")
        self.assertEqual(planner.query_mode, "")
        self.assertEqual(planner.stage_status, "not_run")
        self.assertEqual(retrieval.plan_id, "")
        self.assertEqual(retrieval.query_mode, "")
        self.assertEqual(retrieval.stage_status, "not_run")


def _medical_evidence():
    return EvidenceBundle(
        query_text="公费医疗报销需要什么材料",
        corpus="regulations",
        collection="student_rules",
        sources=(
            _make_handbook_source(
                doc_id="handbook:b85de1cb327a26dc63488e247403ae3126d524be",
                title="中央民族大学学生公费医疗管理办法",
                snippet="学生申请公费医疗报销时，应提交门诊收费票据、诊断证明和本人校园卡信息。",
                score=0.91,
                chunk_id_suffix="medical-materials",
                content_role="requirement",
                is_answer_bearing=True,
                semantic_role="material_requirement",
                polarity="positive",
                claim_type="condition",
            ),
            _make_handbook_source(
                doc_id="handbook:b85de1cb327a26dc63488e247403ae3126d524be",
                title="中央民族大学学生公费医疗管理办法",
                snippet="报销材料经校医院审核后，按学校公费医疗管理办法办理。",
                score=0.88,
                chunk_id_suffix="medical-review",
                content_role="procedure",
                is_answer_bearing=True,
                semantic_role="procedure_step",
                polarity="positive",
                action_type="medical_reimbursement",
                claim_type="procedure_step",
            ),
        ),
    )


if __name__ == "__main__":
    unittest.main()
