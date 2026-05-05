from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_contracts import (
    AcademicCalendarLookupPayload,
    ActorContext,
    AgentRequest,
    AgentResponse,
    CampusNoticeDiscoverPayload,
    CampusNoticeGetPayload,
    ContactDirectoryLookupPayload,
    ContextProjection,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    PlaceLookupPayload,
    RagRequestPayload,
    RagResultPayload,
    ServiceGuideLookupPayload,
    ServiceStatusLookupPayload,
    TraceContext,
    TransportScheduleLookupPayload,
    VersionQuery,
)
from campus_supervisor_agent_worker.agent_dispatch import (
    AgentDispatcher,
    AgentSpecAdmissionError,
    ExecutionCancelledError,
    MissingAgentDelegateError,
    ToolAdmissionError,
    dispatch_agent_request,
)
from campus_supervisor_agent_worker.tool_spec_registry import load_tool_spec_registry


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

    def test_dispatch_agent_request_rejects_wrong_family_allowed_tool_before_delegate(
        self,
    ) -> None:
        delegate_called = False
        request = AgentRequest(
            target="notice-agent",
            user_goal="找校历通知",
            payload=CampusNoticeDiscoverPayload(query_text="校历通知"),
            allowed_tools=("service_status_lookup",),
        )

        def fake_notice_agent(_request: AgentRequest) -> AgentResponse:
            nonlocal delegate_called
            delegate_called = True
            return AgentResponse(target="notice-agent", status="completed")

        with self.assertRaisesRegex(ToolAdmissionError, "allowed_tools"):
            dispatch_agent_request(
                request,
                agent_delegates={"notice-agent": fake_notice_agent},
            )

        self.assertFalse(delegate_called)

    def test_dispatch_agent_request_rejects_extra_allowed_tools_before_delegate(self) -> None:
        request = AgentRequest(
            target="campus-services-agent",
            user_goal="校车什么时候发车",
            payload=TransportScheduleLookupPayload(
                query_text="校车什么时候发车",
                intent="next_departure",
            ),
            allowed_tools=("transport_schedule_lookup", "service_status_lookup"),
        )

        with self.assertRaisesRegex(ToolAdmissionError, "transport_schedule_lookup"):
            dispatch_agent_request(
                request,
                agent_delegates={
                    "campus-services-agent": lambda _request: AgentResponse(
                        target="campus-services-agent",
                        status="completed",
                    )
                },
            )

    def test_dispatch_agent_request_rejects_closed_agent_before_delegate(self) -> None:
        delegate_called = False
        request = AgentRequest(
            target="navigation-agent",
            user_goal="北楼在哪里",
            payload=PlaceLookupPayload(query_text="北楼在哪里"),
        )

        def fake_navigation_agent(_request: AgentRequest) -> AgentResponse:
            nonlocal delegate_called
            delegate_called = True
            return AgentResponse(target="navigation-agent", status="completed")

        with self.assertRaisesRegex(AgentSpecAdmissionError, "navigation-agent"):
            dispatch_agent_request(
                request,
                agent_delegates={"navigation-agent": fake_navigation_agent},
            )

        self.assertFalse(delegate_called)

    def test_dispatcher_uses_injected_tool_spec_registry_for_admission(self) -> None:
        with tempfile.TemporaryDirectory() as fixture_dir:
            fixture_path = _tool_spec_fixture_with_inactive_tool(
                "service_status_lookup",
                Path(fixture_dir),
            )
            registry = load_tool_spec_registry(fixture_path)
        delegate_called = False
        dispatcher = AgentDispatcher(
            agent_delegates={},
            tool_registry=registry,
        )
        request = AgentRequest(
            target="campus-services-agent",
            user_goal="图书馆今天开门吗",
            payload=ServiceStatusLookupPayload(subject_query="图书馆今天开门吗"),
            allowed_tools=("service_status_lookup",),
        )

        def fake_delegate(_request: AgentRequest) -> AgentResponse:
            nonlocal delegate_called
            delegate_called = True
            return AgentResponse(target="campus-services-agent", status="completed")

        dispatcher.agent_delegates["campus-services-agent"] = fake_delegate

        with self.assertRaisesRegex(ToolAdmissionError, "ToolSpec"):
            dispatcher.dispatch(request)

        self.assertFalse(delegate_called)

    def test_dispatcher_accepts_each_active_structured_handoff_tool_from_tool_spec(self) -> None:
        registry = load_tool_spec_registry()
        cases = {
            "service_status_lookup": (
                "campus-services-agent",
                ServiceStatusLookupPayload(subject_query="图书馆"),
            ),
            "service_guide_lookup": (
                "campus-services-agent",
                ServiceGuideLookupPayload(service_query="校园卡补办", guide_focus="procedure"),
            ),
            "transport_schedule_lookup": (
                "campus-services-agent",
                TransportScheduleLookupPayload(query_text="校车", intent="next_departure"),
            ),
            "contact_directory_lookup": (
                "campus-services-agent",
                ContactDirectoryLookupPayload(query_text="校园卡电话", contact_focus="phone"),
            ),
            "academic_calendar_lookup": (
                "calendar-agent",
                AcademicCalendarLookupPayload(
                    query_text="校历",
                    academic_year_label="2026",
                    date_hint="春季学期",
                ),
            ),
            "campus_notice_discover": (
                "notice-agent",
                CampusNoticeDiscoverPayload(query_text="校历"),
            ),
            "campus_notice_get": (
                "notice-agent",
                CampusNoticeGetPayload(notice_id="notice:2026-calendar"),
            ),
        }

        for tool in registry.structured_handoff_tools():
            self.assertIn(tool.name, cases)
            target, payload = cases[tool.name]
            with self.subTest(tool=tool.name):
                request = AgentRequest(
                    target=target,
                    user_goal="test",
                    payload=payload,
                    allowed_tools=(tool.name,),
                )
                response = dispatch_agent_request(
                    request,
                    agent_delegates={
                        target: lambda inner_request: AgentResponse(
                            target=inner_request.target,
                            status="completed",
                        )
                    },
                    tool_registry=registry,
                )

                self.assertEqual(response.status, "completed")

    def test_rag_internal_retrieval_tool_is_not_exposed_as_allowed_tool(self) -> None:
        registry = load_tool_spec_registry()

        self.assertEqual(
            registry.expected_allowed_tools_for_request(_knowledge_agent_request()),
            (),
        )
        self.assertEqual(registry.structured_tool_names_for_target("rag-agent"), ())

    def test_dispatcher_uses_injected_agent_delegate_map(self) -> None:
        delegates = {"rag-agent": lambda _request: _make_rag_completed_response()}
        dispatcher = AgentDispatcher(agent_delegates=delegates)

        self.assertIs(dispatcher.agent_delegates, delegates)

    def test_dispatcher_rejects_workflow_graph_execution(self) -> None:
        dispatcher = AgentDispatcher(agent_delegates={})

        self.assertFalse(hasattr(dispatcher, "run_workflow"))
        self.assertFalse(hasattr(dispatcher, "dispatch_chain"))


def _tool_spec_fixture_with_inactive_tool(tool_name: str, fixture_dir: Path) -> Path:
    source_path = Path("configs/runtime/tools.v1.json")
    payload = json.loads(source_path.read_text(encoding="utf-8"))
    for tool in payload["tools"]:
        if tool["name"] == tool_name:
            tool["active"] = False
            break
    else:  # pragma: no cover - fixture regression guard
        raise AssertionError(f"missing tool fixture: {tool_name}")
    path = fixture_dir / "tools.v1.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


if __name__ == "__main__":
    unittest.main()
