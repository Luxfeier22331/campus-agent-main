from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    AgentRequest,
    AgentResponse,
    ContextProjection,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagRequestPayload,
    RagResultPayload,
    TraceContext,
    VersionQuery,
)
from campus_supervisor_agent_worker.agent_dispatch import (
    AgentDispatcher,
    ExecutionCancelledError,
    MissingAgentDelegateError,
    dispatch_agent_request,
)


def _make_rag_completed_response() -> AgentResponse:
    return AgentResponse(
        target="rag-agent",
        status="completed",
        answer_text="The library is open from 08:00 to 22:00.",
        confidence="high",
        result=RagResultPayload(
            evidence=EvidenceBundle(
                query_text="library hours",
                corpus="regulations",
                collection="student_rules",
                sources=(
                    EvidenceSource(
                        doc_id="handbook:test-001",
                        revision_track="source-faithful",
                        version_id="v1:test-001",
                        chunk_id="handbook:test-001:source-faithful:v1:test-001:chunk-0001",
                        anchor={"page_start": 12, "page_end": 12},
                        canonical_url="https://campus.example/handbook/test-001",
                        latest_url="https://campus.example/handbook/test-001",
                        source_channel="pdf_ocr",
                        collection="student_rules",
                        is_current=False,
                        snippet="The library is open from 08:00 to 22:00.",
                        score=0.96,
                    ),
                ),
            )
        ),
    )


def _knowledge_agent_request(
    *,
    scope: KnowledgeScope | None = None,
    version_query: VersionQuery | None = None,
) -> AgentRequest:
    return AgentRequest(
        target="rag-agent",
        user_goal="library hours",
        request_id="req-001",
        trace=TraceContext(trace_id="trace-001"),
        actor=ActorContext(user_id="student-001"),
        context=ContextProjection(actor=ActorContext(user_id="student-001")),
        payload=RagRequestPayload(
            scope=scope,
            version_query=version_query or VersionQuery(),
        ),
    )


class AgentDispatchTest(unittest.TestCase):
    def test_dispatch_agent_request_delegates_go_preplanned_rag_request(self) -> None:
        captured_requests: list[AgentRequest] = []
        request = _knowledge_agent_request(
            scope=KnowledgeScope(corpus="regulations", collection="student_rules")
        )

        def fake_rag_agent(request: AgentRequest) -> AgentResponse:
            captured_requests.append(request)
            return _make_rag_completed_response()

        response = dispatch_agent_request(
            request,
            agent_delegates={"rag-agent": fake_rag_agent},
        )

        self.assertEqual(response.target, "rag-agent")
        self.assertEqual(response.status, "completed")
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(
            captured_requests[0].payload,
            RagRequestPayload(
                scope=KnowledgeScope(
                    corpus="regulations",
                    collection="student_rules",
                )
            ),
        )

    def test_dispatch_agent_request_preserves_explicit_version_query(self) -> None:
        captured_requests: list[AgentRequest] = []
        version_query = VersionQuery(
            mode="compare",
            version_id="v1:student-handbook",
            compare_to_version_id="v2:student-handbook",
        )
        request = _knowledge_agent_request(
            scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            version_query=version_query,
        )

        response = dispatch_agent_request(
            request,
            agent_delegates={
                "rag-agent": lambda inner_request: (
                    captured_requests.append(inner_request) or _make_rag_completed_response()
                )
            },
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(captured_requests[0].payload.version_query, version_query)

    def test_dispatch_agent_request_stops_before_delegate_when_cancelled(self) -> None:
        delegate_called = False

        def fake_rag_agent(_request: AgentRequest) -> AgentResponse:
            nonlocal delegate_called
            delegate_called = True
            return _make_rag_completed_response()

        with self.assertRaises(ExecutionCancelledError):
            dispatch_agent_request(
                _knowledge_agent_request(),
                agent_delegates={"rag-agent": fake_rag_agent},
                cancellation_checker=lambda: True,
            )

        self.assertFalse(delegate_called)

    def test_dispatch_agent_request_raises_missing_delegate(self) -> None:
        with self.assertRaisesRegex(
            MissingAgentDelegateError,
            "missing delegate for agent target: rag-agent",
        ):
            dispatch_agent_request(
                _knowledge_agent_request(),
                agent_delegates={},
            )

    def test_dispatcher_uses_injected_agent_delegate_map(self) -> None:
        delegates = {"rag-agent": lambda _request: _make_rag_completed_response()}
        dispatcher = AgentDispatcher(agent_delegates=delegates)

        self.assertIs(dispatcher.agent_delegates, delegates)

    def test_dispatcher_rejects_workflow_graph_execution(self) -> None:
        dispatcher = AgentDispatcher(agent_delegates={})

        self.assertFalse(hasattr(dispatcher, "run_workflow"))
        self.assertFalse(hasattr(dispatcher, "dispatch_chain"))


if __name__ == "__main__":
    unittest.main()
