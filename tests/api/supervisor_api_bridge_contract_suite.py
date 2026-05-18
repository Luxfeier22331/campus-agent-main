from .supervisor_api_bridge_support import *


class SupervisorApiBridgeContractTest(SupervisorApiBridgeBaseTest):
    def test_bridge_answer_route_accepts_v6_agent_response_contract(self) -> None:
        captured_requests = []

        def fake_agent(request):
            captured_requests.append(request)
            return AgentResponse(
                target=request.target,
                status="completed",
                answer_text="Agent response returned to Go finalizer.",
                confidence="high",
            )

        body = _bridge_v6_payload(
            user_goal="保研政策怎么准备？",
            request_id="req-v6-agent-response",
            trace_id="trace-v6-agent-response",
        )
        body["bridge_version"] = "supervisor_bridge_v6"
        body["response_contract"] = "agent_response"
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            ),
            agent_handler=fake_agent,
        )

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body=body,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["x-supervisor-bridge-kind"], "agent_response")
        self.assertEqual(response.json_body["target"], "rag-agent")
        self.assertEqual(response.json_body["status"], "completed")
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(captured_requests[0].target, "rag-agent")

    def test_bridge_answer_route_rejects_bridge_v4_after_agent_response_hardcut(
        self,
    ) -> None:
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
                **_bridge_v6_payload(request_id="req-v4-rejected"),
                "bridge_version": "supervisor_bridge_v4",
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("supervisor_bridge_v6", response.json_body["error"]["message"])

    def test_bridge_answer_route_accepts_supervisor_request_payload(self) -> None:
        captured_requests = []

        def fake_agent(request):
            captured_requests.append(request)
            return AgentResponse(
                target=request.target,
                status="completed",
                answer_text="Projected context reached supervisor.",
                confidence="high",
            )

        app = create_bridge_app(
            settings=ApiSettings(
                app_name="campus-agent-v2",
                bridge_shared_secret="bridge-secret",
            ),
            agent_handler=fake_agent,
        )

        body = _bridge_v6_payload(
            user_goal="保研政策怎么准备？",
            conversation_id="conv-001",
            request_id="req-001",
            trace_id="trace-001",
            context={
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
        )
        body["requested_scope"] = {
            "corpus": "regulations",
            "collection": "student_rules",
        }
        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body=body,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["x-supervisor-bridge-kind"],
            "agent_response",
        )
        self.assertEqual(response.json_body["status"], "completed")
        self.assertEqual(response.json_body["target"], "rag-agent")
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(captured_requests[0].trace.trace_id, "trace-001")
        self.assertEqual(captured_requests[0].context.actor.user_id, "student@example.edu")

    def test_bridge_answer_route_rejects_legacy_payload_without_bridge_v6_marker(self) -> None:
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

    def test_bridge_answer_rejects_non_string_actor_projection_fields(self) -> None:
        captured_requests = []
        context = {
            "actor": {
                "user_id": 12345,
            },
            "authorization": {
                "retrieval_filter": {
                    "entitlement_groups": [],
                    "visibility_level": "public",
                    "policy_projection_version": "phase1-authorization-projection-v1",
                },
            },
        }
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            ),
            agent_handler=lambda request: (
                captured_requests.append(request)
                or AgentResponse(
                    target=request.target,
                    status="completed",
                    answer_text="unexpected",
                    confidence="high",
                )
            ),
        )

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body=_bridge_v6_payload(
                request_id="req-reject-non-string-actor",
                actor={"user_id": "student@example.edu"},
                context=context,
            ),
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("context.actor.user_id", response.json_body["error"]["message"])
        self.assertEqual(captured_requests, [])

    def test_bridge_answer_rejects_non_string_requested_scope_fields(self) -> None:
        captured_requests = []
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            ),
            agent_handler=lambda request: (
                captured_requests.append(request)
                or AgentResponse(
                    target=request.target,
                    status="completed",
                    answer_text="unexpected",
                    confidence="high",
                )
            ),
        )
        body = _bridge_v6_payload(
            request_id="req-reject-non-string-scope",
        )
        body["requested_scope"] = {
            "corpus": 12345,
            "collection": "student_rules",
        }

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body=body,
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("requested_scope.corpus", response.json_body["error"]["message"])
        self.assertEqual(captured_requests, [])

    def test_bridge_answer_preserves_selected_notice_ref_session_projection(self) -> None:
        captured_requests = []
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
            "session": {
                "selected_notice_ref": {
                    "notice_id": "notice:internal:355119",
                    "source_family": "internal_notice_restricted",
                    "title": "奖学金评定通知",
                    "target_surface": "regulations/institutional_rules",
                },
                "turn_count": 2,
            },
        }
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            ),
            agent_handler=lambda request: (
                captured_requests.append(request)
                or AgentResponse(
                    target=request.target,
                    status="completed",
                    answer_text="ok",
                    confidence="high",
                )
            ),
        )

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body=_bridge_v6_payload(
                request_id="req-selected-notice-ref",
                context=context,
            ),
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(captured_requests), 1)
        selected_notice_ref = captured_requests[0].context.session.selected_notice_ref
        self.assertIsNotNone(selected_notice_ref)
        self.assertEqual(selected_notice_ref.notice_id, "notice:internal:355119")
        self.assertEqual(selected_notice_ref.source_family, "internal_notice_restricted")
        self.assertEqual(selected_notice_ref.title, "奖学金评定通知")
        self.assertEqual(selected_notice_ref.target_surface, "regulations/institutional_rules")

    def test_bridge_answer_rejects_unsupported_nested_agent_payload_fields(self) -> None:
        captured_requests = []
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            ),
            agent_handler=lambda request: (
                captured_requests.append(request)
                or AgentResponse(
                    target=request.target,
                    status="completed",
                    answer_text="unexpected",
                    confidence="high",
                )
            ),
        )

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body=_bridge_v6_payload_with_handoff(
                user_goal="明天去丰台的班车",
                request_id="req-reject-unsupported-nested-payload",
                trace_id="trace-reject-unsupported-nested-payload",
                effective_capability="campus_services",
                lane="campus_services",
                handoff_target="campus-services-agent",
                payload_kind="transport_schedule_lookup",
                allowed_tools=["transport_schedule_lookup"],
                payload={
                    "query_text": "明天去丰台的班车",
                    "intent": "timetable",
                    "route_selector": {
                        "destination_campus": "fengtai",
                        "unexpected_selector_field": "must fail closed",
                    },
                    "snapshot_query": {"mode": "current"},
                },
            ),
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn(
            "route_selector.unexpected_selector_field", response.json_body["error"]["message"]
        )
        self.assertEqual(captured_requests, [])
