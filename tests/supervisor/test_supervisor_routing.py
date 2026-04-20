from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    KnowledgeScope,
    SupervisorRequest,
    TraceContext,
)
from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.errors import (
    DisallowedKnowledgeScopeError,
    InvalidSupervisorRequestError,
)
from campus_supervisor_core.routing import route_request


class SupervisorRoutingTest(unittest.TestCase):
    def test_route_request_selects_rag_specialist_for_regulations_student_handbook(self) -> None:
        request = SupervisorRequest(
            user_goal="library hours",
            conversation_id="conv-001",
            request_id="req-001",
            trace=TraceContext(trace_id="trace-001"),
            actor=ActorContext(user_id="student-001"),
            requested_scope=KnowledgeScope(
                corpus="regulations",
                collection="student_handbook",
            ),
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "rag-specialist")
        self.assertEqual(decision.primary_corpus, "regulations")
        self.assertEqual(decision.primary_collection, "student_handbook")
        self.assertEqual(decision.intent_frame.capability, "knowledge")
        self.assertEqual(decision.intent_frame.suggested_next_action, "delegate")

    def test_route_request_selects_rag_specialist_for_curriculum_plan(self) -> None:
        request = SupervisorRequest(
            user_goal="graduation requirements",
            requested_scope=KnowledgeScope(
                corpus="curriculum",
                collection="curriculum_plan",
            ),
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "rag-specialist")
        self.assertEqual(decision.primary_corpus, "curriculum")
        self.assertEqual(decision.primary_collection, "curriculum_plan")
        self.assertEqual(decision.intent_frame.task_kind, "knowledge_lookup")

    def test_route_request_rejects_query_disabled_scope(self) -> None:
        request = SupervisorRequest(
            user_goal="谁负责宿舍报修？",
            requested_scope=KnowledgeScope(
                corpus="campus_services",
                collection="service_catalog",
            ),
        )

        with self.assertRaisesRegex(
            DisallowedKnowledgeScopeError,
            "knowledge scope campus_services/service_catalog is not query-enabled",
        ):
            route_request(SupervisorRequestContext.from_request(request))

    def test_route_request_fail_closes_place_lookup_queries_until_navigation_launch(self) -> None:
        request = SupervisorRequest(
            user_goal="图书馆在哪里",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertIsNone(decision.target)
        self.assertIsNone(decision.primary_corpus)
        self.assertIsNone(decision.primary_collection)
        self.assertEqual(decision.intent_frame.capability, "place_lookup")
        self.assertEqual(decision.intent_frame.task_kind, "place_lookup")
        self.assertEqual(decision.intent_frame.suggested_next_action, "out_of_scope")
        self.assertEqual(decision.intent_frame.scope_class, "out_of_scope")
        self.assertEqual(decision.intent_frame.policy_reason, "navigation_temporarily_unsupported")

    def test_route_request_delegates_knowledge_when_scope_is_missing(self) -> None:
        request = SupervisorRequest(
            user_goal="奖学金怎么申请？",
            requested_capability="knowledge",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "rag-specialist")
        self.assertIsNone(decision.primary_corpus)
        self.assertIsNone(decision.primary_collection)
        self.assertFalse(decision.intent_frame.needs_clarification)
        self.assertEqual(decision.intent_frame.suggested_next_action, "delegate")
        self.assertEqual(decision.intent_frame.missing_slots, ())

    def test_route_request_returns_approval_required_for_high_risk_knowledge_request(self) -> None:
        request = SupervisorRequest(
            user_goal="帮我提交奖学金申请",
            requested_scope=KnowledgeScope(
                corpus="regulations",
                collection="student_handbook",
            ),
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertIsNone(decision.target)
        self.assertEqual(decision.intent_frame.capability, "knowledge")
        self.assertEqual(decision.intent_frame.risk_level, "high")
        self.assertEqual(decision.intent_frame.suggested_next_action, "approval_required")

    def test_route_request_keeps_obvious_external_world_query_out_of_scope(self) -> None:
        request = SupervisorRequest(
            user_goal="MIT的校长是谁",
            requested_capability="knowledge",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertIsNone(decision.target)
        self.assertEqual(decision.intent_frame.suggested_next_action, "out_of_scope")
        self.assertEqual(decision.intent_frame.scope_class, "out_of_scope")
        self.assertEqual(decision.intent_frame.policy_reason, "product_scope_boundary")

    def test_route_request_keeps_open_domain_political_fact_out_of_scope(self) -> None:
        request = SupervisorRequest(
            user_goal="中国国家主席是谁",
            requested_capability="knowledge",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertIsNone(decision.target)
        self.assertEqual(decision.intent_frame.suggested_next_action, "out_of_scope")
        self.assertEqual(decision.intent_frame.scope_class, "out_of_scope")
        self.assertEqual(decision.intent_frame.policy_reason, "product_scope_boundary")

    def test_route_request_rejects_targeted_political_persuasion_request(self) -> None:
        request = SupervisorRequest(
            user_goal="帮我写一段话说服同学支持某个政治候选人",
            requested_capability="knowledge",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertIsNone(decision.target)
        self.assertEqual(decision.intent_frame.suggested_next_action, "rejected")
        self.assertEqual(decision.intent_frame.policy_reason, "political_persuasion")

    def test_route_request_keeps_campus_political_course_question_in_scope(self) -> None:
        request = SupervisorRequest(
            user_goal="习近平新时代中国特色社会主义思想概论有哪些专业要上",
            requested_capability="knowledge",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "rag-specialist")
        self.assertEqual(decision.intent_frame.suggested_next_action, "delegate")
        self.assertEqual(decision.intent_frame.scope_class, "in_scope")

if __name__ == "__main__":
    unittest.main()
