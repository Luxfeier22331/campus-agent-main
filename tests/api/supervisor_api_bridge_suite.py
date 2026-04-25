from __future__ import annotations

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import patch

from campus_contracts import (
    CampusNoticeDiscoverPayload,
    SupervisorRequest,
    SupervisorResponse,
    TransportScheduleLookupPayload,
)
from campus_supervisor_core import InvalidSupervisorRequestError
from campus_supervisor_core.intent import IntentFrame
from campus_supervisor_core.routing import RoutingDecision
from campus_supervisor_core_worker.app import create_bridge_app
from campus_supervisor_core_worker.settings import ApiSettings


def _bridge_v2_payload(
    *,
    user_goal: str = "test",
    request_id: str = "req-001",
    trace_id: str = "trace-001",
    effective_capability: str = "knowledge",
    lane: str = "rag",
    context: dict[str, object] | None = None,
    version_query: dict[str, object] | None = None,
) -> dict[str, object]:
    if context is None:
        context = {
            "actor": {
                "user_id": "student@example.edu",
            },
            "authorization": {
                "retrieval_filter": {
                    "entitlement_groups": [],
                    "visibility_level": "public",
                    "policy_projection_version": "phase1-authorization-projection-v1",
                },
            },
        }
    if version_query is None:
        version_query = {"mode": "current"}
    return {
        "bridge_version": "supervisor_bridge_v2",
        "user_goal": user_goal,
        "request_id": request_id,
        "trace": {"trace_id": trace_id},
        "requested_capability": effective_capability,
        "effective_capability": effective_capability,
        "lane": lane,
        "context": context,
        "version_query": version_query,
        "runtime_decisions": {
            "effective_capability": effective_capability,
            "lane": lane,
        },
    }


def _bridge_v2_payload_with_preplanned_handoff(
    *,
    user_goal: str,
    request_id: str,
    trace_id: str,
    effective_capability: str,
    lane: str,
    preplanned_target: str,
    payload_kind: str,
    payload: dict[str, object],
    allowed_tools: list[str],
    context: dict[str, object] | None = None,
) -> dict[str, object]:
    body = _bridge_v2_payload(
        user_goal=user_goal,
        request_id=request_id,
        trace_id=trace_id,
        effective_capability=effective_capability,
        lane=lane,
        context=context,
    )
    body["runtime_decisions"] = {
        "effective_capability": effective_capability,
        "lane": lane,
        "planning_outcome": "preplanned",
        "preplanned_target": preplanned_target,
        "allowed_tools": allowed_tools,
        "specialist_payload": {
            "kind": payload_kind,
            "payload": payload,
        },
    }
    return body


class SupervisorApiBridgeTest(unittest.TestCase):
    def test_bridge_answer_route_accepts_supervisor_request_payload(self) -> None:
        captured_requests: list[SupervisorRequest] = []

        def fake_supervisor(request: SupervisorRequest) -> SupervisorResponse:
            captured_requests.append(request)
            return SupervisorResponse(
                selected_target="rag-agent",
                status="completed",
                answer_text="Projected context reached supervisor.",
                confidence="high",
            )

        app = create_bridge_app(
            settings=ApiSettings(
                app_name="campus-agent-v2",
                bridge_shared_secret="bridge-secret",
            ),
            supervisor_handler=fake_supervisor,
        )

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body={
                "bridge_version": "supervisor_bridge_v2",
                "user_goal": "保研政策怎么准备？",
                "conversation_id": "conv-001",
                "request_id": "req-001",
                "trace": {"trace_id": "trace-001"},
                "context": {
                    "actor": {
                        "user_id": "student@example.edu",
                        "principal_id": "principal-001",
                        "principal_type": "student",
                        "roles": ["student"],
                    },
                    "authorization": {
                        "principal_id": "principal-001",
                        "entitlement_groups": ["students", "library"],
                        "visibility_scope": "north",
                        "retrieval_filter": {
                            "entitlement_groups": ["students", "library"],
                            "visibility_level": "public",
                            "visibility_scope": "north",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                        },
                    },
                },
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
                "requested_capability": "knowledge",
                "effective_capability": "knowledge",
                "lane": "rag",
                "version_query": {
                    "mode": "current",
                },
                "runtime_decisions": {
                    "effective_capability": "knowledge",
                    "lane": "rag",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["x-supervisor-bridge-kind"],
            "supervisor_response",
        )
        self.assertEqual(response.json_body["status"], "completed")
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(captured_requests[0].trace.trace_id, "trace-001")
        self.assertEqual(captured_requests[0].context.actor.user_id, "student@example.edu")

    def test_bridge_answer_route_rejects_legacy_payload_without_bridge_v2_marker(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            )
        )

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body={
                "user_goal": "保研政策怎么准备？",
                "request_id": "req-legacy",
                "trace": {"trace_id": "trace-legacy"},
                "requested_capability": "knowledge",
                "context": {
                    "actor": {
                        "user_id": "student@example.edu",
                    },
                    "authorization": {
                        "retrieval_filter": {
                            "entitlement_groups": [],
                            "visibility_level": "public",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                        },
                    },
                },
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("bridge_version", response.json_body["error"]["message"])

    def test_bridge_answer_route_maps_v2_effective_capability_to_supervisor_request(
        self,
    ) -> None:
        captured_requests: list[SupervisorRequest] = []

        def fake_supervisor(request: SupervisorRequest) -> SupervisorResponse:
            captured_requests.append(request)
            return SupervisorResponse(
                selected_target="campus-services-agent",
                status="completed",
                answer_text="ok",
                confidence="high",
            )

        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            ),
            supervisor_handler=fake_supervisor,
        )

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body={
                "bridge_version": "supervisor_bridge_v2",
                "user_goal": "校车时刻表",
                "request_id": "req-v2-effective",
                "trace": {"trace_id": "trace-v2-effective"},
                "effective_capability": "campus_services",
                "lane": "campus_services",
                "context": {
                    "actor": {
                        "user_id": "student@example.edu",
                    },
                    "authorization": {
                        "retrieval_filter": {
                            "entitlement_groups": [],
                            "visibility_level": "public",
                            "policy_projection_version": "phase1-authorization-projection-v1",
                        },
                    },
                },
                "version_query": {
                    "mode": "current",
                },
                "runtime_decisions": {
                    "effective_capability": "campus_services",
                    "lane": "campus_services",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(captured_requests[0].requested_capability, "campus_services")

    def test_bridge_answer_route_requires_bridge_auth(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            )
        )

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            json_body={},
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json_body["error"]["code"], "unauthorized")

    def test_bridge_answer_route_returns_bridge_invalid_request_header(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            )
        )

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body={
                "user_goal": "test",
                "trace": {"trace_id": "trace-001"},
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertEqual(
            response.headers["x-supervisor-bridge-kind"],
            "bridge_invalid_request",
        )

    def test_bridge_answer_route_returns_supervisor_error_header(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            ),
            supervisor_handler=lambda request: (_ for _ in ()).throw(
                InvalidSupervisorRequestError(
                    "requested_scope is not allowed for place_lookup requests"
                )
            ),
        )

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body=_bridge_v2_payload(request_id="req-supervisor-error"),
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            response.headers["x-supervisor-bridge-kind"],
            "supervisor_error",
        )
        self.assertEqual(response.json_body["error"]["code"], "invalid_supervisor_request")

    def test_bridge_readyz_requires_bridge_auth(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            )
        )

        response = app.handle("GET", "/internal/bridge/readyz")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json_body["error"]["code"], "unauthorized")

    def test_bridge_cancel_route_marks_active_execution_cancel_requested(self) -> None:
        started = threading.Event()
        release = threading.Event()
        answer_responses = []

        def fake_supervisor(request: SupervisorRequest) -> SupervisorResponse:
            started.set()
            release.wait(timeout=1.0)
            return SupervisorResponse(
                selected_target="rag-agent",
                status="completed",
                answer_text="completed after cancel signal",
                confidence="medium",
            )

        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            ),
            supervisor_handler=fake_supervisor,
        )

        thread = threading.Thread(
            target=lambda: answer_responses.append(
                app.handle(
                    "POST",
                    "/internal/bridge/supervisor/answer",
                    headers={"x-supervisor-bridge-auth": "bridge-secret"},
                    json_body=_bridge_v2_payload(
                        user_goal="图书馆开门吗",
                        request_id="req-active-cancel",
                        trace_id="trace-active-cancel",
                    ),
                )
            )
        )
        thread.start()
        self.assertTrue(started.wait(timeout=1.0))

        response = app.handle(
            "POST",
            "/internal/bridge/execution/cancel",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body={
                "request_id": "req-active-cancel",
                "reason": "user_requested",
            },
        )

        release.set()
        thread.join(timeout=1.0)
        app.close()

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json_body["status"], "cancel_requested")
        self.assertEqual(response.json_body["request_id"], "req-active-cancel")
        self.assertEqual(answer_responses[0].status_code, 499)
        self.assertEqual(answer_responses[0].json_body["error"]["code"], "execution_cancelled")

    def test_bridge_answer_wires_configured_campus_services_query_service(self) -> None:
        query_requests: list[dict[str, object]] = []

        class QueryHandler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                content_length = int(self.headers.get("content-length", "0"))
                query_requests.append(
                    {
                        "path": self.path,
                        "auth": self.headers.get("x-supervisor-query-auth"),
                        "body": json.loads(self.rfile.read(content_length).decode("utf-8")),
                    }
                )
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "query_text": "最近一版校车时刻表是什么时候发布的",
                            "intent": "schedule_snapshot_metadata",
                            "outcome": "resolved_current",
                            "queried_time_anchor": "2026-04-24T10:30:00+08:00",
                            "schedule_snapshot": {
                                "snapshot_id": "snapshot:bus:2026-04-20",
                                "published_at": "2026-04-20T18:00:00+08:00",
                                "source_ref": "notice:bus-schedule-2026-04-20",
                            },
                        }
                    ).encode("utf-8")
                )

            def log_message(self, format: str, *args: object) -> None:
                return

        query_server = HTTPServer(("127.0.0.1", 0), QueryHandler)
        thread = threading.Thread(target=query_server.serve_forever, daemon=True)
        thread.start()
        app = None
        try:
            app = create_bridge_app(
                settings=ApiSettings(
                    bridge_shared_secret="bridge-secret",
                    structured_query_base_url=f"http://127.0.0.1:{query_server.server_port}",
                    structured_query_shared_secret="query-secret",
                    structured_query_timeout_seconds=0.75,
                )
            )
            with patch(
                "campus_supervisor_core.agent.route_request",
                return_value=RoutingDecision(
                    target="campus-services-agent",
                    primary_corpus=None,
                    primary_collection=None,
                    intent_frame=IntentFrame(
                        capability="knowledge",
                        task_kind="knowledge_lookup",
                        domain_candidates=("campus_services",),
                        missing_slots=(),
                        risk_level="low",
                        needs_clarification=False,
                        suggested_next_action="delegate",
                        scope_class="in_scope",
                    ),
                    specialist_payload=TransportScheduleLookupPayload(
                        query_text="最近一版校车时刻表是什么时候发布的",
                        intent="schedule_snapshot_metadata",
                    ),
                    allowed_tools=("transport_schedule_lookup",),
                ),
            ):
                response = app.handle(
                    "POST",
                    "/internal/bridge/supervisor/answer",
                    headers={"x-supervisor-bridge-auth": "bridge-secret"},
                    json_body=_bridge_v2_payload(
                        user_goal="最近一版校车时刻表是什么时候发布的",
                        request_id="req-campus-services-query",
                        trace_id="trace-campus-services-query",
                        effective_capability="campus_services",
                        lane="campus_services",
                    ),
                )
        finally:
            if app is not None:
                app.close()
            query_server.shutdown()
            query_server.server_close()
            thread.join(timeout=1.0)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json_body["selected_target"], "campus-services-agent")
        self.assertEqual(response.json_body["status"], "completed")
        self.assertEqual(len(query_requests), 1)
        self.assertEqual(
            query_requests[0]["path"],
            "/internal/query/campus-services/transport-schedule",
        )
        self.assertEqual(query_requests[0]["auth"], "query-secret")
        self.assertEqual(query_requests[0]["body"]["intent"], "schedule_snapshot_metadata")

    def test_bridge_answer_uses_go_preplanned_structured_handoff_without_python_routing(
        self,
    ) -> None:
        query_requests: list[dict[str, object]] = []

        class QueryHandler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                content_length = int(self.headers.get("content-length", "0"))
                query_requests.append(json.loads(self.rfile.read(content_length).decode("utf-8")))
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "query_text": "最早的班车几点",
                            "intent": "first_departure",
                            "outcome": "resolved_current",
                            "queried_time_anchor": "2026-04-25T08:00:00+08:00",
                            "resolved_route": {
                                "route_id": "route:fengtai",
                                "display_name": "海淀-丰台班车",
                                "service_family": "intercampus_commute",
                            },
                            "service_status": "running",
                            "selected_departure": {
                                "departure_at": "2026-04-26T07:30:00+08:00",
                            },
                        }
                    ).encode("utf-8")
                )

            def log_message(self, format: str, *args: object) -> None:
                return

        query_server = HTTPServer(("127.0.0.1", 0), QueryHandler)
        thread = threading.Thread(target=query_server.serve_forever, daemon=True)
        thread.start()
        app = None
        try:
            app = create_bridge_app(
                settings=ApiSettings(
                    bridge_shared_secret="bridge-secret",
                    structured_query_base_url=f"http://127.0.0.1:{query_server.server_port}",
                    structured_query_shared_secret="query-secret",
                    structured_query_timeout_seconds=0.75,
                )
            )
            with patch(
                "campus_supervisor_core.agent.route_request",
                side_effect=AssertionError("Python routing must not build preplanned payload"),
            ):
                response = app.handle(
                    "POST",
                    "/internal/bridge/supervisor/answer",
                    headers={"x-supervisor-bridge-auth": "bridge-secret"},
                    json_body=_bridge_v2_payload_with_preplanned_handoff(
                        user_goal="最早的班车几点",
                        request_id="req-go-preplanned-transport",
                        trace_id="trace-go-preplanned-transport",
                        effective_capability="campus_services",
                        lane="campus_services",
                        preplanned_target="campus-services-agent",
                        payload_kind="transport_schedule_lookup",
                        allowed_tools=["transport_schedule_lookup"],
                        payload={
                            "query_text": "最早的班车几点",
                            "intent": "first_departure",
                            "snapshot_query": {"mode": "current"},
                            "service_time_query": {
                                "date_mode": "tomorrow",
                                "daypart": "morning",
                            },
                        },
                    ),
                )
        finally:
            if app is not None:
                app.close()
            query_server.shutdown()
            query_server.server_close()
            thread.join(timeout=1.0)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json_body["selected_target"], "campus-services-agent")
        self.assertEqual(len(query_requests), 1)
        self.assertEqual(query_requests[0]["intent"], "first_departure")
        self.assertEqual(query_requests[0]["service_time_query"]["date_mode"], "tomorrow")

    def test_bridge_answer_wires_configured_notice_query_service(self) -> None:
        query_requests: list[dict[str, object]] = []

        class QueryHandler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                content_length = int(self.headers.get("content-length", "0"))
                query_requests.append(
                    {
                        "path": self.path,
                        "auth": self.headers.get("x-supervisor-query-auth"),
                        "body": json.loads(self.rfile.read(content_length).decode("utf-8")),
                    }
                )
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "query_text": "家具采购",
                            "outcome": "resolved_current",
                            "source_families": ["internal_notice_restricted"],
                            "notice_cards": [
                                {
                                    "notice_id": "355222",
                                    "title": "中央民族大学丰台校区家具采购项目比选公告",
                                    "source_family": "internal_notice_restricted",
                                    "source_url": "https://portal.example.edu/notices/355222",
                                }
                            ],
                            "queried_time_anchor": "2026-04-24T10:30:00+08:00",
                        }
                    ).encode("utf-8")
                )

            def log_message(self, format: str, *args: object) -> None:
                return

        query_server = HTTPServer(("127.0.0.1", 0), QueryHandler)
        thread = threading.Thread(target=query_server.serve_forever, daemon=True)
        thread.start()
        app = None
        try:
            app = create_bridge_app(
                settings=ApiSettings(
                    bridge_shared_secret="bridge-secret",
                    structured_query_base_url=f"http://127.0.0.1:{query_server.server_port}",
                    structured_query_shared_secret="query-secret",
                    structured_query_timeout_seconds=0.75,
                )
            )
            with patch(
                "campus_supervisor_core.agent.route_request",
                return_value=RoutingDecision(
                    target="notice-agent",
                    primary_corpus=None,
                    primary_collection=None,
                    intent_frame=IntentFrame(
                        capability="notice",
                        task_kind="notice_lookup",
                        domain_candidates=("notice",),
                        missing_slots=(),
                        risk_level="low",
                        needs_clarification=False,
                        suggested_next_action="delegate",
                        scope_class="in_scope",
                    ),
                    specialist_payload=CampusNoticeDiscoverPayload(
                        query_text="家具采购",
                        source_families=("internal_notice_restricted",),
                    ),
                    allowed_tools=("campus_notice_discover",),
                ),
            ):
                response = app.handle(
                    "POST",
                    "/internal/bridge/supervisor/answer",
                    headers={"x-supervisor-bridge-auth": "bridge-secret"},
                    json_body=_bridge_v2_payload(
                        user_goal="找一下家具采购通知",
                        request_id="req-notice-query",
                        trace_id="trace-notice-query",
                        effective_capability="notice",
                        lane="notice",
                        context={
                            "actor": {
                                "user_id": "student@example.edu",
                            },
                            "authorization": {
                                "principal_id": "principal-001",
                                "entitlement_groups": ["students"],
                                "retrieval_filter": {
                                    "entitlement_groups": ["students"],
                                    "visibility_level": "restricted",
                                    "policy_projection_version": "phase1-authorization-projection-v1",
                                },
                            },
                        },
                    ),
                )
        finally:
            if app is not None:
                app.close()
            query_server.shutdown()
            query_server.server_close()
            thread.join(timeout=1.0)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json_body["selected_target"], "notice-agent")
        self.assertEqual(response.json_body["status"], "completed")
        self.assertEqual(len(query_requests), 1)
        self.assertEqual(query_requests[0]["path"], "/internal/query/notices/discover")
        self.assertEqual(query_requests[0]["auth"], "query-secret")
        self.assertEqual(query_requests[0]["body"]["payload"]["query_text"], "家具采购")
        self.assertEqual(
            query_requests[0]["body"]["access_context"]["authorization"]["retrieval_filter"][
                "visibility_level"
            ],
            "restricted",
        )
