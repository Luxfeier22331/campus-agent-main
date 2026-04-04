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

    def test_route_request_selects_availability_specialist_from_explicit_capability_hint(self) -> None:
        request = SupervisorRequest(
            user_goal="官网现在能打开吗？",
            conversation_id="conv-availability",
            request_id="req-availability",
            trace=TraceContext(trace_id="trace-availability"),
            actor=ActorContext(user_id="student-001"),
            requested_capability="availability",
            availability_target_id="official-homepage",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "availability-specialist")
        self.assertIsNone(decision.primary_corpus)
        self.assertIsNone(decision.primary_collection)
        self.assertEqual(decision.intent_frame.capability, "availability")
        self.assertEqual(decision.intent_frame.suggested_next_action, "delegate")

    def test_route_request_keeps_availability_branch_independent_from_knowledge_scope_rules(self) -> None:
        request = SupervisorRequest(
            user_goal="service portal reachable?",
            requested_capability="availability",
            availability_target_id="service-catalog",
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "availability-specialist")
        self.assertIsNone(decision.primary_corpus)
        self.assertIsNone(decision.primary_collection)
        self.assertEqual(decision.intent_frame.task_kind, "availability_check")

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

    def test_route_request_rejects_conflicting_knowledge_and_availability_hints(self) -> None:
        request = SupervisorRequest(
            user_goal="官网能打开吗，顺便告诉我开馆时间",
            requested_scope=KnowledgeScope(
                corpus="regulations",
                collection="student_handbook",
            ),
            availability_target_id="official-homepage",
        )

        with self.assertRaisesRegex(
            InvalidSupervisorRequestError,
            "requested_scope and availability_target_id cannot be combined",
        ):
            route_request(SupervisorRequestContext.from_request(request))


if __name__ == "__main__":
    unittest.main()
