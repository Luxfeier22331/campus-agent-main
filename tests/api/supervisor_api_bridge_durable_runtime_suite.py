from __future__ import annotations

from dataclasses import asdict

from campus_contracts import CapabilityResponse
from campus_supervisor_agent_worker.api import build_bridge_routes
from campus_supervisor_agent_worker.settings import ApiSettings

from .supervisor_api_bridge_support import (
    SupervisorApiBridgeBaseTest,
    _bridge_v6_payload,
)


class SupervisorApiBridgeSemanticExecutionTest(SupervisorApiBridgeBaseTest):
    def test_semantic_execution_route_requires_step_execution_metadata(self) -> None:
        route = _semantic_execution_route(
            capability_handler=lambda _request, _agent_request: CapabilityResponse(
                target="knowledge",
                status="ok",
                content="unused",
            )
        )

        response = route.handler(
            {"x-supervisor-bridge-auth": "secret"},
            {
                "bridge_version": "semantic_bridge_execution_v1",
                "run_id": "run-semantic-missing",
                "execution": _bridge_v6_payload(request_id="req-semantic-missing"),
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("step_execution_id", response.json_body["error"]["message"])

    def test_semantic_execution_route_dispatches_agent_request_with_step_context(self) -> None:
        seen: dict[str, object] = {}

        def _handler(request, agent_request):
            seen["request_id"] = request.request_id
            seen["agent_request_id"] = agent_request.request_id
            seen["workflow_context"] = asdict(agent_request.workflow_context)
            return CapabilityResponse(
                target=agent_request.target,
                status="completed",
                answer_text="semantic answer",
                confidence="high",
            )

        route = _semantic_execution_route(capability_handler=_handler)
        response = route.handler(
            {"x-supervisor-bridge-auth": "secret"},
            {
                "bridge_version": "semantic_bridge_execution_v1",
                "run_id": "run-semantic-001",
                "step_execution_id": "step-execution-semantic-001",
                "step_id": "primary",
                "lane": "rag",
                "worker_id": "worker-semantic-001",
                "attempt": 1,
                "execution": _bridge_v6_payload(request_id="req-semantic-001"),
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["x-supervisor-bridge-kind"], "semantic_capability_response")
        self.assertEqual(response.json_body["answer_text"], "semantic answer")
        self.assertEqual(seen["request_id"], "req-semantic-001")
        self.assertEqual(seen["agent_request_id"], "req-semantic-001")
        workflow_context = seen["workflow_context"]
        self.assertIsInstance(workflow_context, dict)
        self.assertEqual(workflow_context["workflow_run_ref"], "run-semantic-001")
        self.assertEqual(workflow_context["step_id"], "primary")


def _semantic_execution_route(*, capability_handler):
    settings = ApiSettings(bridge_shared_secret="secret")
    routes = build_bridge_routes(settings, capability_handler=capability_handler)
    for route in routes:
        if route.method == "POST" and route.path == "/internal/bridge/semantic/execution":
            return route
    raise AssertionError("semantic execution route not found")
