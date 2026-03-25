from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    AvailabilityCheckPayload,
    KnowledgeScope,
    RagRequestPayload,
    SpecialistRequest,
    TraceContext,
)
from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.routing import route_request


class SupervisorRoutingTest(unittest.TestCase):
    def test_route_request_selects_rag_specialist_for_regulations_student_handbook(self) -> None:
        request = SpecialistRequest(
            target="rag-specialist",
            user_goal="library hours",
            conversation_id="conv-001",
            request_id="req-001",
            trace=TraceContext(trace_id="trace-001"),
            actor=ActorContext(user_id="student-001", groups=("students",)),
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
            ),
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "rag-specialist")
        self.assertEqual(decision.primary_corpus, "regulations")
        self.assertEqual(decision.primary_collection, "student_handbook")

    def test_route_request_selects_availability_specialist_without_inspecting_knowledge_scope(self) -> None:
        request = SpecialistRequest(
            target="availability-specialist",
            user_goal="官网现在能打开吗？",
            conversation_id="conv-availability",
            request_id="req-availability",
            trace=TraceContext(trace_id="trace-availability"),
            actor=ActorContext(user_id="student-001", groups=("students",)),
            payload=AvailabilityCheckPayload(target_id="official-homepage"),
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "availability-specialist")
        self.assertIsNone(decision.primary_corpus)
        self.assertIsNone(decision.primary_collection)

    def test_route_request_keeps_availability_branch_independent_from_rag_scope_rules(self) -> None:
        request = SpecialistRequest(
            target="availability-specialist",
            user_goal="service portal reachable?",
            payload=AvailabilityCheckPayload(target_id="service-catalog"),
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "availability-specialist")
        self.assertIsNone(decision.primary_corpus)
        self.assertIsNone(decision.primary_collection)

    def test_route_request_rejects_non_query_enabled_corpus_on_rag_branch(self) -> None:
        request = SpecialistRequest(
            target="rag-specialist",
            user_goal="graduation requirements",
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
            ),
        )

        with self.assertRaisesRegex(
            ValueError,
            "phase-1 query-serving only supports regulations/student_handbook",
        ):
            route_request(SupervisorRequestContext.from_request(request))


if __name__ == "__main__":
    unittest.main()
