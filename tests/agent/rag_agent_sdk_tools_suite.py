from __future__ import annotations

import unittest

from campus_contracts import AgentRequest, EvidenceBundle, KnowledgeScope, RagRequestPayload
from campus_rag_agent.rag_sdk_tools import (
    RagSdkToolError,
    RagSdkToolExecutionContext,
    execute_retrieve_evidence_tool,
)
from campus_rag_agent.service_planner_stage import execute_rag_planner_stage
from campus_retrieval_core import RetrievalPlan, RetrievalScope, RetrievalSelector

from tests.agent.rag_agent_test_support import _make_handbook_source


class RagAgentSdkToolsTest(unittest.TestCase):
    def test_retrieve_evidence_tool_returns_bounded_projection_from_admitted_plan(self) -> None:
        request = _request("公费医疗报销需要什么材料")
        plan = _plan(request)
        evidence = _evidence()
        context = RagSdkToolExecutionContext(
            request=request,
            retrieval_plan=plan,
            evidence=evidence,
            admitted_query_slot_ids=("indexed-lookup",),
        )

        result = execute_retrieve_evidence_tool(
            context,
            {"query_slot_id": "indexed-lookup", "retrieval_intent": "requirement"},
        )

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["source_count"], 1)
        self.assertEqual(result["anchors"][0]["source_id"], "handbook:medical")
        self.assertNotIn("raw_prompt", result)
        self.assertNotIn("retrieval_plan", result)

    def test_retrieve_evidence_tool_defaults_single_admitted_slot_when_model_omits_slot(
        self,
    ) -> None:
        request = _request("中央民族大学本科学生国家奖学金评审办法")
        plan = _plan(request)
        context = RagSdkToolExecutionContext(
            request=request,
            retrieval_plan=plan,
            evidence=_evidence(),
            admitted_query_slot_ids=("indexed-lookup",),
        )

        result = execute_retrieve_evidence_tool(
            context,
            {"retrieval_intent": "specific_policy_lookup"},
        )

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["query_slot_id"], "indexed-lookup")

    def test_retrieve_evidence_tool_coerces_invalid_single_admitted_slot_to_only_slot(
        self,
    ) -> None:
        request = _request("中央民族大学本科学生国家奖学金评审办法")
        plan = _plan(request)
        context = RagSdkToolExecutionContext(
            request=request,
            retrieval_plan=plan,
            evidence=_evidence(),
            admitted_query_slot_ids=("indexed-lookup",),
        )

        result = execute_retrieve_evidence_tool(
            context,
            {
                "query_slot_id": "specific_policy_lookup",
                "retrieval_intent": "specific_policy_lookup",
            },
        )

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["query_slot_id"], "indexed-lookup")

    def test_retrieve_evidence_tool_rejects_missing_slot_when_multiple_slots_are_admitted(
        self,
    ) -> None:
        context = RagSdkToolExecutionContext(
            request=_request("比较当前办法和历史办法"),
            retrieval_plan=_multi_slot_plan(_request("比较当前办法和历史办法")),
            evidence=_evidence(),
            admitted_query_slot_ids=("compare-current-lookup", "compare-other-lookup"),
        )

        with self.assertRaisesRegex(RagSdkToolError, "rag_sdk_query_slot_not_admitted"):
            execute_retrieve_evidence_tool(
                context,
                {"retrieval_intent": "specific_policy_lookup"},
            )

    def test_retrieve_evidence_tool_rejects_unadmitted_query_slot_when_multiple_slots_exist(
        self,
    ) -> None:
        context = RagSdkToolExecutionContext(
            request=_request("比较当前办法和历史办法"),
            retrieval_plan=_multi_slot_plan(_request("比较当前办法和历史办法")),
            evidence=_evidence(),
            admitted_query_slot_ids=("compare-current-lookup", "compare-other-lookup"),
        )

        with self.assertRaisesRegex(RagSdkToolError, "rag_sdk_query_slot_not_admitted"):
            execute_retrieve_evidence_tool(
                context,
                {"query_slot_id": "new-expanded-query", "retrieval_intent": "requirement"},
            )

    def test_retrieve_evidence_tool_rejects_model_supplied_scope_or_selector(self) -> None:
        context = RagSdkToolExecutionContext(
            request=_request("公费医疗报销需要什么材料"),
            retrieval_plan=_plan(_request("公费医疗报销需要什么材料")),
            evidence=_evidence(),
            admitted_query_slot_ids=("indexed-lookup",),
        )

        with self.assertRaisesRegex(RagSdkToolError, "rag_sdk_scope_widening_rejected"):
            execute_retrieve_evidence_tool(
                context,
                {
                    "query_slot_id": "indexed-lookup",
                    "retrieval_intent": "requirement",
                    "corpus": "official_web",
                    "collection": "muc_public_pages",
                    "target_document_ids": ["handbook:other"],
                },
            )

    def test_retrieve_evidence_tool_rejects_selector_drift_against_plan(self) -> None:
        plan = _plan(_request("公费医疗报销需要什么材料"))
        widened = RetrievalPlan(
            plan_id=plan.plan_id,
            query_mode=plan.query_mode,
            admitted_scopes=plan.admitted_scopes,
            budget=plan.budget,
            source_trust_policy=plan.source_trust_policy,
            steps=(
                *plan.steps,
                plan.steps[0].__class__(
                    step_id="expanded",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="扩大查询",
                    selector=RetrievalSelector(target_document_ids=("handbook:other",)),
                    budget=plan.steps[0].budget,
                ),
            ),
        )
        context = RagSdkToolExecutionContext(
            request=_request("公费医疗报销需要什么材料"),
            retrieval_plan=widened,
            evidence=_evidence(),
            admitted_query_slot_ids=("expanded",),
        )

        with self.assertRaisesRegex(RagSdkToolError, "rag_sdk_selector_not_admitted"):
            execute_retrieve_evidence_tool(
                context,
                {"query_slot_id": "expanded", "retrieval_intent": "requirement"},
            )


def _request(user_goal: str) -> AgentRequest:
    return AgentRequest(
        target="rag-agent",
        user_goal=user_goal,
        payload=RagRequestPayload(
            scope=KnowledgeScope(corpus="regulations", collection="student_rules")
        ),
    )


def _plan(request: AgentRequest):
    result = execute_rag_planner_stage(
        request=request,
        effective_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
        user_goal=request.user_goal,
        effective_user_goal=request.user_goal,
        handbook_plan=None,
        curriculum_plan=None,
        curriculum_course_plan=None,
        curriculum_program_family_plan=None,
    )
    assert result.retrieval_plan is not None
    return result.retrieval_plan


def _multi_slot_plan(request: AgentRequest) -> RetrievalPlan:
    plan = _plan(request)
    return RetrievalPlan(
        plan_id=plan.plan_id,
        query_mode=plan.query_mode,
        admitted_scopes=plan.admitted_scopes,
        budget=plan.budget,
        source_trust_policy=plan.source_trust_policy,
        steps=(
            plan.steps[0].__class__(
                step_id="compare-current-lookup",
                step_type=plan.steps[0].step_type,
                scope=plan.steps[0].scope,
                query_text=plan.steps[0].query_text,
                selector=plan.steps[0].selector,
                budget=plan.steps[0].budget,
            ),
            plan.steps[0].__class__(
                step_id="compare-other-lookup",
                step_type=plan.steps[0].step_type,
                scope=plan.steps[0].scope,
                query_text=plan.steps[0].query_text,
                selector=plan.steps[0].selector,
                budget=plan.steps[0].budget,
            ),
        ),
    )


def _evidence() -> EvidenceBundle:
    return EvidenceBundle(
        query_text="公费医疗报销需要什么材料",
        corpus="regulations",
        collection="student_rules",
        sources=(
            _make_handbook_source(
                doc_id="handbook:medical",
                title="中央民族大学学生公费医疗管理办法",
                snippet="学生申请公费医疗报销时，应提交门诊收费票据、诊断证明和本人校园卡信息。",
                score=0.91,
                chunk_id_suffix="medical-support-1",
                content_role="requirement",
                is_answer_bearing=True,
            ),
        ),
    )


if __name__ == "__main__":
    unittest.main()
