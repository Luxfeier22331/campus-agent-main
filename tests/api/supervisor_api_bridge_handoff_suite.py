from campus_contracts import ServiceGuideLookupPayload

from .supervisor_api_bridge_support import *


class SupervisorApiBridgeHandoffTest(SupervisorApiBridgeBaseTest):
    def test_bridge_answer_route_maps_go_effective_capability_to_capability_request(
        self,
    ) -> None:
        captured_requests = []

        def fake_agent(request):
            captured_requests.append(request)
            return CapabilityResponse(
                capability=request.capability,
                status="completed",
                answer_text="ok",
                confidence="high",
            )

        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            ),
            capability_handler=fake_agent,
        )

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body=_capability_execution_payload(
                user_goal="校车时刻表",
                request_id="req-v2-effective",
                trace_id="trace-v2-effective",
                effective_capability="campus_services",
                lane="campus_services",
            ),
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(captured_requests[0].capability, "campus_services")

    def test_bridge_answer_rejects_terminal_frame_because_go_handles_terminal_directly(
        self,
    ) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            )
        )
        body = _capability_execution_payload(
            user_goal="MIT的校长是谁",
            request_id="req-go-policy-out-of-scope",
            trace_id="trace-go-policy-out-of-scope",
            effective_capability="knowledge",
            lane="rag",
        )
        body["runtime_decisions"] = {
            "schema_version": "capability-execution-runtime-decisions-v1",
            "effective_capability": "knowledge",
            "lane": "rag",
            "scope_gate": {
                "decision": "out_of_scope",
                "reason": "product_scope_boundary",
                "matched_signal": "MIT",
            },
            "policy_gate": {
                "decision": "out_of_scope",
                "reason": "product_scope_boundary",
                "risk_level": "low",
                "matched_signal": "MIT",
            },
            "context_preflight": {
                "state": "not_follow_up",
                "reference_type": "none",
                "missing_slots": [],
                "resolved_slots": {},
                "matched_signal": "",
                "ambiguity_reason": "",
            },
            "tool_policy": {
                "policy_version": "runtime-policy-v1",
            },
            "runtime_decision_summary": {
                "schema_version": "runtime-decision-summary-v1",
                "scope_gate_decision": "out_of_scope",
                "policy_gate_decision": "out_of_scope",
                "context_preflight_state": "not_follow_up",
                "routing_next_action": "out_of_scope",
                "planning_outcome": "not_preplanned",
            },
            "routing_frame": {
                "capability": "knowledge",
                "task_kind": "knowledge_lookup",
                "domain_candidates": ["out_of_scope"],
                "missing_slots": [],
                "risk_level": "low",
                "needs_clarification": False,
                "suggested_next_action": "out_of_scope",
                "personalization_mode": "generic",
                "clarification_subject": "",
                "scope_class": "out_of_scope",
                "policy_reason": "product_scope_boundary",
                "launch_state": "closed",
                "scope_reason": "product_scope_boundary",
                "matched_signal": "MIT",
                "classifier_version": "go-runtime-policy-v2",
                "schema_version": "intent-schema-1.0.0",
                "routing_confidence": "high",
                "ambiguity_signal": "",
                "context_resolution_state": "not_follow_up",
                "context_reference_type": "none",
                "resolved_slots": {},
                "ambiguity_reason": "",
            },
            "terminal_envelope": {
                "selected_capability": None,
                "status": "no_answer",
                "answer_text": "Go terminal envelope says this is outside the product scope.",
                "follow_up_question": "",
                "confidence": "low",
                "observability": {
                    "retrieval_attempted": False,
                    "candidate_count": 0,
                    "retrieved_source_count": 0,
                    "citation_expected": False,
                    "citation_count": 0,
                    "citation_missing": False,
                    "refusal_class": "out_of_scope",
                    "semantic_outcome": "out_of_scope",
                    "scope_class": "out_of_scope",
                    "policy_reason": "product_scope_boundary",
                    "acl_decision": "allowed",
                    "fail_closed": True,
                },
            },
        }

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body=body,
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("handoff", response.json_body["error"]["message"])

    def test_bridge_answer_rejects_legacy_payload_without_go_routing_frame(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            )
        )
        body = _capability_execution_payload(
            user_goal="保研政策怎么准备？",
            request_id="req-missing-runtime-frame",
        )
        body["runtime_decisions"] = {
            "schema_version": "capability-execution-runtime-decisions-v1",
            "effective_capability": "knowledge",
            "lane": "rag",
            "runtime_decision_summary": {
                "schema_version": "runtime-decision-summary-v1",
                "planning_outcome": "not_preplanned",
            },
        }

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body=body,
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("routing_frame", response.json_body["error"]["message"])

    def test_bridge_answer_rejects_delegate_frame_without_go_handoff(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            )
        )

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body=_capability_execution_payload(
                user_goal="学生手册请假制度怎么规定？",
                request_id="req-missing-handoff",
                trace_id="trace-missing-handoff",
                preplan_delegate=False,
            ),
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("handoff", response.json_body["error"]["message"])

    def test_bridge_answer_rejects_delegate_handoff_without_go_workflow_plan(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            )
        )
        body = _capability_execution_payload_with_handoff(
            user_goal="宿舍入住怎么办理",
            request_id="req-missing-workflow-plan",
            trace_id="trace-missing-workflow-plan",
            effective_capability="campus_services",
            lane="campus_services",
            handoff_capability="campus_services",
            payload_kind="service_guide_lookup",
            allowed_tools=["service_guide_lookup"],
            payload={
                "service_query": "宿舍入住怎么办理",
                "guide_focus": "procedure",
                "audience": "student",
            },
        )
        runtime_decisions = body["runtime_decisions"]
        assert isinstance(runtime_decisions, dict)
        runtime_decisions.pop("workflow_plan", None)

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body=body,
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("workflow_plan", response.json_body["error"]["message"])

    def test_bridge_answer_rejects_workflow_plan_selected_step_drift(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            )
        )
        body = _capability_execution_payload_with_handoff(
            user_goal="宿舍入住怎么办理",
            request_id="req-workflow-plan-drift",
            trace_id="trace-workflow-plan-drift",
            effective_capability="campus_services",
            lane="campus_services",
            handoff_capability="campus_services",
            payload_kind="service_guide_lookup",
            allowed_tools=["service_guide_lookup"],
            payload={
                "service_query": "宿舍入住怎么办理",
                "guide_focus": "procedure",
                "audience": "student",
            },
        )
        runtime_decisions = body["runtime_decisions"]
        assert isinstance(runtime_decisions, dict)
        workflow_plan = runtime_decisions["workflow_plan"]
        assert isinstance(workflow_plan, dict)
        steps = workflow_plan["steps"]
        assert isinstance(steps, list)
        steps[0]["allowed_tools"] = ["transport_schedule_lookup"]

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body=body,
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("tool_not_admitted", response.json_body["error"]["message"])

    def test_bridge_answer_rejects_terminal_frame_without_delegate_handoff(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            )
        )
        body = _capability_execution_payload(
            user_goal="MIT的校长是谁",
            request_id="req-missing-terminal-envelope",
            trace_id="trace-missing-terminal-envelope",
            preplan_delegate=False,
        )
        runtime_decisions = body["runtime_decisions"]
        assert isinstance(runtime_decisions, dict)
        routing_frame = runtime_decisions["routing_frame"]
        assert isinstance(routing_frame, dict)
        routing_frame["suggested_next_action"] = "out_of_scope"
        routing_frame["scope_class"] = "out_of_scope"
        routing_frame["policy_reason"] = "product_scope_boundary"
        summary = runtime_decisions["runtime_decision_summary"]
        assert isinstance(summary, dict)
        summary["routing_next_action"] = "out_of_scope"

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body=body,
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("handoff", response.json_body["error"]["message"])

    def test_bridge_parser_parses_go_preplanned_knowledge_handoff(self) -> None:
        body = _capability_execution_payload_with_handoff(
            user_goal="学生手册请假制度怎么规定？",
            request_id="req-go-preplanned-knowledge",
            trace_id="trace-go-preplanned-knowledge",
            effective_capability="knowledge",
            lane="rag",
            handoff_capability="knowledge",
            payload_kind="rag_request",
            allowed_tools=[],
            payload={
                "scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
                "version_query": {
                    "mode": "compare",
                    "version_id": "v1:student-handbook",
                    "compare_to_version_id": "v2:student-handbook",
                },
            },
        )
        body["requested_scope"] = {
            "corpus": "regulations",
            "collection": "student_rules",
        }
        body["version_query"] = {
            "mode": "compare",
            "version_id": "v1:student-handbook",
            "compare_to_version_id": "v2:student-handbook",
        }

        envelope = parse_capability_execution_envelope(body)

        self.assertEqual(envelope.request.requested_capability, "knowledge")
        self.assertIsNotNone(envelope.capability_request)
        assert envelope.capability_request is not None
        self.assertEqual(envelope.capability_request.capability, "knowledge")
        self.assertEqual(
            envelope.capability_request.payload,
            RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                version_query=VersionQuery(
                    mode="compare",
                    version_id="v1:student-handbook",
                    compare_to_version_id="v2:student-handbook",
                ),
            ),
        )

    def test_bridge_parser_parses_go_preplanned_service_guide_handoff(self) -> None:
        body = _capability_execution_payload_with_handoff(
            user_goal="宿舍入住怎么办理",
            request_id="req-go-preplanned-service-guide",
            trace_id="trace-go-preplanned-service-guide",
            effective_capability="campus_services",
            lane="campus_services",
            handoff_capability="campus_services",
            payload_kind="service_guide_lookup",
            allowed_tools=["service_guide_lookup"],
            payload={
                "service_query": "宿舍入住怎么办理",
                "guide_focus": "procedure",
                "temporal_query": {"mode": "current"},
                "audience": "unknown",
            },
        )

        envelope = parse_capability_execution_envelope(body)

        self.assertIsNotNone(envelope.capability_request)
        assert envelope.capability_request is not None
        self.assertEqual(envelope.capability_request.capability, "campus_services")
        self.assertEqual(envelope.capability_request.allowed_tools, ("service_guide_lookup",))
        self.assertEqual(
            envelope.capability_request.payload,
            ServiceGuideLookupPayload(
                service_query="宿舍入住怎么办理",
                guide_focus="procedure",
            ),
        )

    def test_bridge_parser_rejects_service_guide_handoff_without_audience(self) -> None:
        body = _capability_execution_payload_with_handoff(
            user_goal="宿舍入住怎么办理",
            request_id="req-go-preplanned-service-guide-missing-audience",
            trace_id="trace-go-preplanned-service-guide-missing-audience",
            effective_capability="campus_services",
            lane="campus_services",
            handoff_capability="campus_services",
            payload_kind="service_guide_lookup",
            allowed_tools=["service_guide_lookup"],
            payload={
                "service_query": "宿舍入住怎么办理",
                "guide_focus": "procedure",
                "temporal_query": {"mode": "current"},
            },
        )

        with self.assertRaisesRegex(ValueError, "audience must be a non-empty string"):
            parse_capability_execution_envelope(body)
