from __future__ import annotations

import unittest

from campus_contracts import AgentRequest, KnowledgeScope, RagRequestPayload, VersionQuery
from campus_rag_agent.institutional_rules_query_planning import (
    public_service_document_ids,
    staff_governance_document_ids,
)
from campus_rag_agent.service_pipeline import build_rag_pipeline_context
from campus_rag_agent.service_retrieval import (
    build_rag_retrieval_context,
    build_retrieval_plan_for_context,
)


def _build_request(user_goal: str) -> AgentRequest:
    return AgentRequest(
        target="rag-agent",
        user_goal=user_goal,
        payload=RagRequestPayload(
            scope=KnowledgeScope(corpus="regulations", collection="institutional_rules"),
            version_query=VersionQuery(mode="current"),
        ),
    )


class RagAgentInstitutionalRulesConsumptionTest(unittest.TestCase):
    def test_public_service_query_defaults_to_public_service_document_subset(self) -> None:
        request = _build_request("校园网密码怎么改")
        context = build_rag_retrieval_context(
            request=request,
            effective_scope=KnowledgeScope(corpus="regulations", collection="institutional_rules"),
            user_goal=request.user_goal,
            effective_user_goal=request.user_goal,
            handbook_plan=None,
            curriculum_plan=None,
            curriculum_course_plan=None,
            curriculum_program_family_plan=None,
        )

        self.assertIsNotNone(context)
        assert context is not None
        self.assertEqual(set(context.target_document_ids), set(public_service_document_ids()))
        self.assertTrue(
            set(context.target_document_ids).isdisjoint(set(staff_governance_document_ids()))
        )
        plan = build_retrieval_plan_for_context(
            request=request,
            effective_scope=KnowledgeScope(corpus="regulations", collection="institutional_rules"),
            user_goal=request.user_goal,
            retrieval_context=context,
        )
        self.assertEqual(
            set(plan.steps[0].selector.target_document_ids), set(public_service_document_ids())
        )

    def test_specific_governance_title_targets_single_governance_document(self) -> None:
        request = _build_request("学术委员会章程是什么")
        context = build_rag_retrieval_context(
            request=request,
            effective_scope=KnowledgeScope(corpus="regulations", collection="institutional_rules"),
            user_goal=request.user_goal,
            effective_user_goal=request.user_goal,
            handbook_plan=None,
            curriculum_plan=None,
            curriculum_course_plan=None,
            curriculum_program_family_plan=None,
        )

        self.assertIsNotNone(context)
        assert context is not None
        self.assertEqual(
            context.target_document_ids,
            ("official_web_regulation:252e764624d17af1",),
        )

    def test_generic_institutional_rules_query_does_not_default_to_staff_governance(self) -> None:
        request = _build_request("学校有哪些规定")
        context = build_rag_retrieval_context(
            request=request,
            effective_scope=KnowledgeScope(corpus="regulations", collection="institutional_rules"),
            user_goal=request.user_goal,
            effective_user_goal=request.user_goal,
            handbook_plan=None,
            curriculum_plan=None,
            curriculum_course_plan=None,
            curriculum_program_family_plan=None,
        )

        self.assertIsNotNone(context)
        assert context is not None
        self.assertEqual(set(context.target_document_ids), set(public_service_document_ids()))
        self.assertNotEqual(set(context.target_document_ids), set(staff_governance_document_ids()))

    def test_deadline_query_targets_single_public_service_document_and_typed_need(self) -> None:
        request = _build_request("二级网站安全问题要多久上报")
        pipeline = build_rag_pipeline_context(request, prompt_executor=None)

        self.assertIsNotNone(pipeline.retrieval_intent)
        assert pipeline.retrieval_intent is not None
        context = build_rag_retrieval_context(
            request=request,
            effective_scope=KnowledgeScope(corpus="regulations", collection="institutional_rules"),
            user_goal=request.user_goal,
            effective_user_goal=request.user_goal,
            handbook_plan=None,
            curriculum_plan=None,
            curriculum_course_plan=None,
            curriculum_program_family_plan=None,
        )

        self.assertIsNotNone(context)
        assert context is not None
        self.assertEqual(
            context.target_document_ids,
            ("official_web_regulation:ce565b348ca6ee31",),
        )
        plan = build_retrieval_plan_for_context(
            request=request,
            effective_scope=KnowledgeScope(corpus="regulations", collection="institutional_rules"),
            user_goal=request.user_goal,
            retrieval_context=context,
            retrieval_intent=pipeline.retrieval_intent,
        )
        self.assertEqual(
            tuple(step.need_ids for step in plan.steps),
            (("need:1:condition_table",),),
        )
        self.assertEqual(
            tuple(step.selector.target_document_ids for step in plan.steps),
            (("official_web_regulation:ce565b348ca6ee31",),),
        )
        self.assertIsNotNone(plan.steps[0].semantic_hint)
        assert plan.steps[0].semantic_hint is not None
        self.assertEqual(plan.steps[0].semantic_hint.intent_kind, "condition_table")
        self.assertEqual(plan.steps[0].semantic_hint.condition_subject, "deadline")
