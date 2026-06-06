from __future__ import annotations

import unittest
from pathlib import Path

SUPERVISOR_CORE_PACKAGE = Path("packages/supervisor-core")
WORKER_CORE = Path("apps/supervisor-agent-worker/src/campus_supervisor_agent_worker")
BRIDGE_V6_PARSER = WORKER_CORE / "bridge_v6_parser.py"
WORKER_APP = WORKER_CORE / "app.py"
WORKER_API = WORKER_CORE / "api.py"
WORKER_AGENT_DELEGATES = WORKER_CORE / "agent_delegates.py"
WORKER_AGENT_RUNTIME = WORKER_CORE / "agent_runtime.py"
WORKER_BRIDGE_READINESS = WORKER_CORE / "bridge_readiness.py"
WORKER_CANCEL_FLAGS = WORKER_CORE / "cancel_flags.py"
WORKER_BRIDGE_ACTOR_CODECS = WORKER_CORE / "bridge_actor_codecs.py"
WORKER_BRIDGE_AUTHORIZATION_CODECS = WORKER_CORE / "bridge_authorization_codecs.py"
WORKER_BRIDGE_MEMORY_CODECS = WORKER_CORE / "bridge_memory_codecs.py"
WORKER_BRIDGE_SESSION_CODECS = WORKER_CORE / "bridge_session_codecs.py"
WORKER_BRIDGE_TRACE_CODECS = WORKER_CORE / "bridge_trace_codecs.py"
EXECUTION_GATEWAY_GO = Path("apps/execution-gateway/internal")


class SupervisorRuntimeGuardrailTest(unittest.TestCase):
    def test_standalone_supervisor_core_package_is_retired(self) -> None:
        self.assertFalse(SUPERVISOR_CORE_PACKAGE.exists())

    def test_python_routing_does_not_reintroduce_structured_payload_planner(self) -> None:
        forbidden_paths = (
            SUPERVISOR_CORE_PACKAGE / "src" / "campus_supervisor_core" / "routing.py",
            WORKER_CORE / "routing.py",
            WORKER_CORE / "structured_payload_planner.py",
        )
        for path in forbidden_paths:
            with self.subTest(path=str(path)):
                self.assertFalse(path.exists())

    def test_go_execution_gateway_runtime_modules_remain_split_by_concern(self) -> None:
        expected_modules = (
            EXECUTION_GATEWAY_GO / "runtimepolicy" / "policy.go",
            EXECUTION_GATEWAY_GO / "structuredquery" / "service_guide.go",
            EXECUTION_GATEWAY_GO / "structuredquery" / "runtime.go",
            EXECUTION_GATEWAY_GO / "httpapi" / "structured_direct.go",
            EXECUTION_GATEWAY_GO / "executionaudit" / "emitter.go",
            EXECUTION_GATEWAY_GO / "observability" / "metrics_prometheus.go",
        )
        for path in expected_modules:
            with self.subTest(path=str(path)):
                self.assertTrue(path.exists())

    def test_supervisor_core_legacy_agent_entrypoint_is_deleted(self) -> None:
        self.assertFalse(
            (SUPERVISOR_CORE_PACKAGE / "src" / "campus_supervisor_core" / "agent.py").exists()
        )

    def test_supervisor_framing_helper_is_deleted_from_production_core(self) -> None:
        self.assertFalse((WORKER_CORE / "framing.py").exists())

    def test_supervisor_agent_handoff_suite_replaces_agent_policy_suite(self) -> None:
        self.assertFalse(Path("tests/supervisor/supervisor_core_agent_policy_suite.py").exists())
        self.assertFalse(Path("tests/supervisor/supervisor_core_agent_handoff_suite.py").exists())
        self.assertTrue(Path("tests/supervisor/agent_handoff_suite.py").exists())

    def test_supervisor_core_runtime_audit_helpers_are_deleted(self) -> None:
        forbidden_paths = (
            SUPERVISOR_CORE_PACKAGE / "src" / "campus_supervisor_core" / "audit.py",
            WORKER_CORE / "audit.py",
        )
        for path in forbidden_paths:
            with self.subTest(path=str(path)):
                self.assertFalse(path.exists())

    def test_supervisor_terminal_prompt_stack_is_deleted_from_production_core(self) -> None:
        forbidden_paths = (
            SUPERVISOR_CORE_PACKAGE / "src" / "campus_supervisor_core" / "prompt_execution.py",
            SUPERVISOR_CORE_PACKAGE / "src" / "campus_supervisor_core" / "prompt_packets.py",
            SUPERVISOR_CORE_PACKAGE / "src" / "campus_supervisor_core" / "prompts" / "registry.py",
        )
        for path in forbidden_paths:
            with self.subTest(path=str(path)):
                self.assertFalse(path.exists())

    def test_supervisor_core_legacy_policy_helpers_are_deleted(self) -> None:
        forbidden_paths = (
            WORKER_CORE / "intent.py",
            WORKER_CORE / "scope_policy.py",
            WORKER_CORE / "query_policy.py",
            WORKER_CORE / "validation.py",
            WORKER_CORE / "context.py",
            WORKER_CORE / "tool_policy.py",
        )
        for path in forbidden_paths:
            with self.subTest(path=str(path)):
                self.assertFalse(path.exists())

    def test_supervisor_response_has_no_legacy_intent_observability_helper(self) -> None:
        self.assertFalse((WORKER_CORE / "response.py").exists())

    def test_supervisor_core_finalization_module_is_deleted(self) -> None:
        self.assertFalse((WORKER_CORE / "policy.py").exists())

    def test_worker_runtime_names_are_agent_worker_specific(self) -> None:
        app_source = WORKER_APP.read_text(encoding="utf-8")
        runtime_source = WORKER_AGENT_RUNTIME.read_text(encoding="utf-8")

        self.assertIn("class SupervisorAgentWorkerApp", app_source)
        self.assertIn("class AgentWorkerRuntime", runtime_source)
        self.assertNotIn("class SupervisorApiApp", app_source)

    def test_bridge_v6_parser_is_the_direct_worker_request_parser(self) -> None:
        self.assertFalse((WORKER_CORE / "api_request_parsing.py").exists())
        self.assertTrue(BRIDGE_V6_PARSER.exists())
        self.assertTrue((WORKER_CORE / "bridge_payload_codecs.py").exists())
        self.assertFalse((WORKER_CORE / "bridge_context_codecs.py").exists())

    def test_bridge_context_codecs_are_split_by_projection_family(self) -> None:
        self.assertFalse((WORKER_CORE / "bridge_context_codecs.py").exists())
        self.assertTrue(WORKER_BRIDGE_ACTOR_CODECS.exists())
        self.assertTrue(WORKER_BRIDGE_AUTHORIZATION_CODECS.exists())
        self.assertTrue(WORKER_BRIDGE_MEMORY_CODECS.exists())
        self.assertTrue(WORKER_BRIDGE_SESSION_CODECS.exists())
        self.assertTrue(WORKER_BRIDGE_TRACE_CODECS.exists())

    def test_worker_app_runtime_assembly_is_split_from_bridge_app_factory(self) -> None:
        self.assertTrue(WORKER_AGENT_DELEGATES.exists())
        self.assertTrue(WORKER_AGENT_RUNTIME.exists())

    def test_bridge_api_surface_is_split_from_readiness_and_cancel_store(self) -> None:
        self.assertTrue(WORKER_CANCEL_FLAGS.exists())
        self.assertTrue(WORKER_BRIDGE_READINESS.exists())
