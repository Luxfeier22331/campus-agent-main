from __future__ import annotations

from dataclasses import asdict

from campus_contracts import AgentResponse
from campus_supervisor_agent_worker.api import build_bridge_routes
from campus_supervisor_agent_worker.settings import ApiSettings

from .execution_gateway_bridge_support import (
    SupervisorApiBridgeBaseTest,
    _bridge_v6_payload,
)


class SupervisorApiBridgeDurableRuntimeTest(SupervisorApiBridgeBaseTest):
    def test_durable_execution_route_requires_lease_metadata(self) -> None:
        route = _durable_execution_route(
            agent_handler=lambda _request, _agent_request: AgentResponse(
                target="rag-agent",
                status="ok",
                content="unused",
            )
        )

        response = route.handler(
            {"x-supervisor-bridge-auth": "secret"},
            {
                "bridge_version": "supervisor_durable_worker_v1",
                "run_id": "run-durable-missing",
                "execution": _bridge_v6_payload(request_id="req-durable-missing"),
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("lease_id", response.json_body["error"]["message"])

    def test_durable_execution_route_dispatches_agent_request_with_lease_context(self) -> None:
        seen: dict[str, object] = {}

        def _handler(request, agent_request):
            seen["request_id"] = request.request_id
            seen["agent_request_id"] = agent_request.request_id
            seen["workflow_context"] = asdict(agent_request.workflow_context)
            return AgentResponse(
                target=agent_request.target,
                status="completed",
                answer_text="durable answer",
                confidence="high",
            )

        route = _durable_execution_route(agent_handler=_handler)
        response = route.handler(
            {"x-supervisor-bridge-auth": "secret"},
            {
                "bridge_version": "supervisor_durable_worker_v1",
                "run_id": "run-durable-001",
                "lease_id": "lease-durable-001",
                "step_id": "primary",
                "lane": "rag",
                "worker_id": "worker-durable-001",
                "attempt": 1,
                "execution": _bridge_v6_payload(request_id="req-durable-001"),
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["x-supervisor-bridge-kind"], "durable_agent_response")
        self.assertEqual(response.json_body["answer_text"], "durable answer")
        self.assertEqual(seen["request_id"], "req-durable-001")
        self.assertEqual(seen["agent_request_id"], "req-durable-001")
        workflow_context = seen["workflow_context"]
        self.assertIsInstance(workflow_context, dict)
        self.assertEqual(workflow_context["workflow_run_ref"], "run-durable-001")
        self.assertEqual(workflow_context["step_id"], "primary")


def _durable_execution_route(*, agent_handler):
    settings = ApiSettings(bridge_shared_secret="secret")
    routes = build_bridge_routes(settings, agent_handler=agent_handler)
    for route in routes:
        if route.method == "POST" and route.path == "/internal/bridge/durable/execution":
            return route
    raise AssertionError("durable execution route not found")
