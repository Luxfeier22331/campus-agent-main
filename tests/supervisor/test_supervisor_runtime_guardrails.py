from __future__ import annotations

import unittest
from pathlib import Path

SUPERVISOR_CORE = Path("packages/supervisor-core/src/campus_supervisor_core")
BRIDGE_PARSER = Path(
    "apps/supervisor-core-worker/src/campus_supervisor_core_worker/api_request_parsing.py"
)
WORKER_CORE = Path("apps/supervisor-core-worker/src/campus_supervisor_core_worker")


class SupervisorRuntimeGuardrailTest(unittest.TestCase):
    def test_python_routing_does_not_reintroduce_structured_payload_planner(self) -> None:
        routing_path = SUPERVISOR_CORE / "routing.py"
        self.assertFalse(routing_path.exists())

    def test_eval_runner_does_not_reintroduce_python_legacy_routing(self) -> None:
        runner_source = Path("packages/evals/src/campus_evals/intent_runner.py").read_text(
            encoding="utf-8"
        )

        forbidden_fragments = (
            "python-legacy",
            "campus_supervisor_core.routing",
            "route_request",
            "evaluate_intent_case",
        )
        for fragment in forbidden_fragments:
            with self.subTest(fragment=fragment):
                self.assertNotIn(fragment, runner_source)

    def test_supervisor_core_package_does_not_parse_bridge_runtime_decisions(self) -> None:
        for path in SUPERVISOR_CORE.rglob("*.py"):
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=str(path)):
                self.assertNotIn("runtime_decisions", source)
                self.assertNotIn("routing_frame", source)
                self.assertNotIn("supervisor_bridge_v2", source)

    def test_supervisor_agent_does_not_fallback_to_python_routing(self) -> None:
        agent_source = (SUPERVISOR_CORE / "agent.py").read_text(encoding="utf-8")

        self.assertNotIn("route_request", agent_source)
        self.assertNotIn("frame_specialist_request", agent_source)
        self.assertNotIn("RoutingDecision", agent_source)
        self.assertNotIn("preplanned_routing_decision", agent_source)
        self.assertNotIn("finalize_routing_decision", agent_source)
        self.assertIn("preplanned specialist request is required", agent_source)

    def test_supervisor_framing_helper_is_deleted_from_production_core(self) -> None:
        self.assertFalse((SUPERVISOR_CORE / "framing.py").exists())

    def test_bridge_parser_is_v4_only_and_requires_go_runtime_handoff(
        self,
    ) -> None:
        parser_source = BRIDGE_PARSER.read_text(encoding="utf-8")

        self.assertIn('"supervisor_bridge_v4"', parser_source)
        self.assertNotIn('"supervisor_bridge_v3"', parser_source)
        self.assertNotIn('"supervisor_bridge_v2"', parser_source)
        self.assertIn("runtime_decisions.routing_frame", parser_source)
        self.assertIn("runtime_decisions.handoff", parser_source)
        self.assertIn("runtime_decisions.handoff.specialist_request", parser_source)
        self.assertNotIn("terminal_envelope", parser_source)
        self.assertNotIn("RoutingDecision", parser_source)
        self.assertNotIn("runtime_decisions.handoff.specialist_payload", parser_source)
        self.assertNotIn("legacy", parser_source.casefold())

    def test_supervisor_core_public_api_has_no_runtime_routing_or_audit_sink(self) -> None:
        init_source = (SUPERVISOR_CORE / "__init__.py").read_text(encoding="utf-8")

        self.assertNotIn("RoutingDecision", init_source)
        self.assertNotIn("preplanned_routing_decision", init_source)
        self.assertNotIn("audit_sink", init_source)
        self.assertNotIn("build_audit_record", init_source)
        self.assertNotIn("build_error_audit_record", init_source)

    def test_supervisor_core_runtime_audit_helpers_are_deleted(self) -> None:
        forbidden_paths = (
            SUPERVISOR_CORE / "audit.py",
            WORKER_CORE / "audit.py",
        )
        for path in forbidden_paths:
            with self.subTest(path=str(path)):
                self.assertFalse(path.exists())

    def test_python_bridge_api_does_not_emit_runtime_audit_records(self) -> None:
        api_source = Path(
            "apps/supervisor-core-worker/src/campus_supervisor_core_worker/api.py"
        ).read_text(encoding="utf-8")

        self.assertNotIn("build_audit_record", api_source)
        self.assertNotIn("build_error_audit_record", api_source)

    def test_supervisor_terminal_prompt_stack_is_deleted_from_production_core(self) -> None:
        forbidden_paths = (
            SUPERVISOR_CORE / "prompt_execution.py",
            SUPERVISOR_CORE / "prompt_packets.py",
            SUPERVISOR_CORE / "prompts" / "registry.py",
        )
        for path in forbidden_paths:
            with self.subTest(path=str(path)):
                self.assertFalse(path.exists())

    def test_supervisor_core_legacy_policy_helpers_are_deleted(self) -> None:
        forbidden_paths = (
            SUPERVISOR_CORE / "intent.py",
            SUPERVISOR_CORE / "scope_policy.py",
            SUPERVISOR_CORE / "query_policy.py",
            SUPERVISOR_CORE / "validation.py",
            SUPERVISOR_CORE / "context.py",
            SUPERVISOR_CORE / "tool_policy.py",
        )
        for path in forbidden_paths:
            with self.subTest(path=str(path)):
                self.assertFalse(path.exists())

    def test_supervisor_response_has_no_legacy_intent_observability_helper(self) -> None:
        response_source = (SUPERVISOR_CORE / "response.py").read_text(encoding="utf-8")

        self.assertNotIn("attach_intent_observability", response_source)
        self.assertNotIn("intent_frame", response_source)

    def test_python_bridge_does_not_publish_cancel_runtime_counters(self) -> None:
        api_source = Path(
            "apps/supervisor-core-worker/src/campus_supervisor_core_worker/api.py"
        ).read_text(encoding="utf-8")

        self.assertNotIn("active_executions", api_source)
        self.assertNotIn("cancel_requested_count", api_source)
        self.assertNotIn("def status(", api_source)
