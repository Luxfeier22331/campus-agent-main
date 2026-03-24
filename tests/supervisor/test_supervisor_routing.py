from __future__ import annotations

import unittest

from campus_contracts import ActorContext, DelegateToRagAgentRequest, KnowledgeScope, TraceContext
from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.routing import route_request


class SupervisorRoutingTest(unittest.TestCase):
    def test_route_request_selects_rag_specialist_for_regulations_student_handbook(self) -> None:
        request = DelegateToRagAgentRequest(
            user_goal="library hours",
            conversation_id="conv-001",
            request_id="req-001",
            trace=TraceContext(trace_id="trace-001"),
            actor=ActorContext(user_id="student-001", groups=("students",)),
            scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
        )

        decision = route_request(SupervisorRequestContext.from_request(request))

        self.assertEqual(decision.target, "rag-specialist")
        self.assertEqual(decision.primary_corpus, "regulations")
        self.assertEqual(decision.primary_collection, "student_handbook")

    def test_route_request_rejects_non_query_enabled_corpus(self) -> None:
        request = DelegateToRagAgentRequest(
            user_goal="graduation requirements",
            scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan"),
        )

        with self.assertRaisesRegex(
            ValueError,
            "phase-1 query-serving only supports regulations/student_handbook",
        ):
            route_request(SupervisorRequestContext.from_request(request))


if __name__ == "__main__":
    unittest.main()
