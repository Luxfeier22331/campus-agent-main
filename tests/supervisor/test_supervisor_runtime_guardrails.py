from __future__ import annotations

import re
import unittest
from pathlib import Path

SUPERVISOR_CORE_PACKAGE = Path("packages/supervisor-core")
WORKER_CORE = Path("apps/supervisor-agent-worker/src/campus_supervisor_agent_worker")
BRIDGE_V6_PARSER = WORKER_CORE / "bridge_v6_parser.py"
AGENT_DISPATCH = WORKER_CORE / "agent_dispatch.py"
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
SUPERVISOR_API_GO = Path("apps/supervisor-api/internal")


class SupervisorRuntimeGuardrailTest(unittest.TestCase):
    def test_standalone_supervisor_core_package_is_retired(self) -> None:
        self.assertFalse(SUPERVISOR_CORE_PACKAGE.exists())

    def test_old_supervisor_core_worker_runtime_names_are_not_active(self) -> None:
        scanned_paths = (
            *Path("apps").rglob("*"),
            *Path("packages").rglob("*"),
            *Path("tests").rglob("*"),
            *Path("infra").rglob("*"),
            Path("README.md"),
            Path("pyproject.toml"),
        )
        forbidden_fragments = (
            "apps/supervisor-core-worker",
            "supervisor-core-worker",
            "campus-supervisor-core-worker",
            "campus_supervisor_core_worker",
            "SUPERVISOR_CORE_WORKER",
        )
        text_suffixes = {
            "",
            ".Dockerfile",
            ".go",
            ".json",
            ".md",
            ".py",
            ".sh",
            ".toml",
            ".ts",
            ".tsx",
            ".yml",
            ".yaml",
        }
        for path in scanned_paths:
            if not path.is_file() or path.suffix not in text_suffixes:
                continue
            if path == Path("tests/supervisor/test_supervisor_runtime_guardrails.py"):
                continue
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=str(path)):
                for fragment in forbidden_fragments:
                    self.assertNotIn(fragment, source)

    def test_python_routing_does_not_reintroduce_structured_payload_planner(self) -> None:
        forbidden_paths = (
            SUPERVISOR_CORE_PACKAGE / "src" / "campus_supervisor_core" / "routing.py",
            WORKER_CORE / "routing.py",
            WORKER_CORE / "structured_payload_planner.py",
        )
        for path in forbidden_paths:
            with self.subTest(path=str(path)):
                self.assertFalse(path.exists())

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

    def test_agent_dispatch_helper_does_not_parse_bridge_runtime_decisions(self) -> None:
        dispatch_source = AGENT_DISPATCH.read_text(encoding="utf-8")

        self.assertNotIn("runtime_decisions", dispatch_source)
        self.assertNotIn("routing_frame", dispatch_source)
        self.assertNotIn("supervisor_bridge_v2", dispatch_source)

    def test_agent_dispatcher_does_not_fallback_to_python_routing(self) -> None:
        dispatcher_source = AGENT_DISPATCH.read_text(encoding="utf-8")

        self.assertNotIn("route_request", dispatcher_source)
        self.assertNotIn("frame_agent_request", dispatcher_source)
        self.assertNotIn("RoutingDecision", dispatcher_source)
        self.assertNotIn("preplanned_routing_decision", dispatcher_source)
        self.assertNotIn("finalize_routing_decision", dispatcher_source)
        self.assertIn("class AgentDispatcher", dispatcher_source)
        self.assertNotIn("def handle(", dispatcher_source)

    def test_worker_agent_dispatch_does_not_import_agent_packages(self) -> None:
        forbidden_fragments = (
            "campus_rag_agent",
            "campus_navigation_agent",
            "campus_services_agent",
            "campus_notice_agent",
        )
        dispatch_source = AGENT_DISPATCH.read_text(encoding="utf-8")
        for fragment in forbidden_fragments:
            with self.subTest(fragment=fragment):
                self.assertNotIn(fragment, dispatch_source)

    def test_python_worker_only_imports_agent_facades_and_prompt_runtime(self) -> None:
        allowed_imports_by_path = {
            WORKER_CORE / "agent_delegates.py": (
                "campus_navigation_agent",
                "campus_notice_agent",
                "campus_rag_agent.service",
                "campus_services_agent",
            ),
            WORKER_CORE / "prompt_executor.py": (
                "campus_rag_agent.prompt_execution",
                "campus_rag_agent.prompt_packets",
                "campus_rag_agent.prompts.registry",
            ),
            WORKER_CORE / "prompt_stack.py": (
                "campus_rag_agent.prompt_packets",
                "campus_rag_agent.prompts.registry",
            ),
        }
        forbidden_fragments = (
            "campus_retrieval_core",
            "campus_ingestion_core",
            "campus_rag_agent.agent",
            "campus_rag_agent.retrieval_plan",
            "campus_rag_agent.service_retrieval",
        )

        for path in WORKER_CORE.rglob("*.py"):
            source = path.read_text(encoding="utf-8")
            allowed_imports = allowed_imports_by_path.get(path, ())
            with self.subTest(path=str(path)):
                for fragment in forbidden_fragments:
                    if fragment in allowed_imports:
                        continue
                    self.assertNotIn(fragment, source)

    def test_go_supervisor_api_runtime_modules_remain_split_by_concern(self) -> None:
        line_limits = {
            SUPERVISOR_API_GO / "runtimepolicy" / "policy.go": 260,
            SUPERVISOR_API_GO / "structuredquery" / "service_guide.go": 220,
            SUPERVISOR_API_GO / "structuredquery" / "runtime.go": 360,
            SUPERVISOR_API_GO / "httpapi" / "structured_direct.go": 380,
            SUPERVISOR_API_GO / "executionaudit" / "emitter.go": 380,
            SUPERVISOR_API_GO / "observability" / "metrics_prometheus.go": 360,
        }
        for path, limit in line_limits.items():
            with self.subTest(path=str(path)):
                self.assertTrue(path.exists())
                self.assertLessEqual(len(path.read_text(encoding="utf-8").splitlines()), limit)

    def test_supervisor_core_legacy_agent_entrypoint_is_deleted(self) -> None:
        self.assertFalse(
            (SUPERVISOR_CORE_PACKAGE / "src" / "campus_supervisor_core" / "agent.py").exists()
        )

    def test_supervisor_framing_helper_is_deleted_from_production_core(self) -> None:
        self.assertFalse((WORKER_CORE / "framing.py").exists())

    def test_bridge_parser_is_v6_only_and_requires_go_runtime_handoff(
        self,
    ) -> None:
        parser_source = BRIDGE_V6_PARSER.read_text(encoding="utf-8")

        self.assertIn('"supervisor_bridge_v6"', parser_source)
        self.assertIn('"agent_response"', parser_source)
        self.assertNotIn('"supervisor_bridge_v4"', parser_source)
        self.assertNotIn('"supervisor_bridge_v3"', parser_source)
        self.assertNotIn('"supervisor_bridge_v2"', parser_source)
        self.assertIn("runtime_decisions.routing_frame", parser_source)
        self.assertIn("runtime_decisions.handoff", parser_source)
        self.assertIn("runtime_decisions.handoff.agent_request", parser_source)
        self.assertNotIn("terminal_envelope", parser_source)
        self.assertNotIn("RoutingDecision", parser_source)
        self.assertNotIn("runtime_decisions.handoff.agent_payload", parser_source)
        self.assertNotIn("legacy", parser_source.casefold())

    def test_worker_internal_agent_handoff_names_do_not_use_specialist_aliases(self) -> None:
        forbidden_fragments_by_path = {
            WORKER_CORE / "api.py": (
                "preplanned_agent_request",
                "preplanned_specialist_request",
                "runtime_specialist_request",
            ),
            WORKER_CORE / "bridge_v6_parser.py": (
                "preplanned_agent_request",
                "runtime_specialist_request",
                "def _parse_specialist_request",
                "def _assert_specialist_request_matches_supervisor_request",
            ),
            WORKER_CORE / "app.py": (
                "preplanned_agent_request",
                "preplanned_specialist_request",
                "specialist_request:",
                "lambda specialist_request",
            ),
            WORKER_CORE / "agent_delegates.py": ("preplanned_agent_request",),
        }
        for path, forbidden_fragments in forbidden_fragments_by_path.items():
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=str(path)):
                for fragment in forbidden_fragments:
                    self.assertNotIn(fragment, source)

    def test_supervisor_agent_handoff_suite_replaces_agent_policy_suite(self) -> None:
        self.assertFalse(Path("tests/supervisor/supervisor_core_agent_policy_suite.py").exists())
        self.assertFalse(Path("tests/supervisor/supervisor_core_agent_handoff_suite.py").exists())
        self.assertTrue(Path("tests/supervisor/agent_handoff_suite.py").exists())

    def test_worker_agent_dispatch_public_api_has_no_runtime_routing_or_audit_sink(self) -> None:
        dispatch_source = AGENT_DISPATCH.read_text(encoding="utf-8")

        self.assertNotIn("RoutingDecision", dispatch_source)
        self.assertNotIn("preplanned_routing_decision", dispatch_source)
        self.assertNotIn("audit_sink", dispatch_source)
        self.assertNotIn("build_audit_record", dispatch_source)
        self.assertNotIn("build_error_audit_record", dispatch_source)

    def test_supervisor_core_runtime_audit_helpers_are_deleted(self) -> None:
        forbidden_paths = (
            SUPERVISOR_CORE_PACKAGE / "src" / "campus_supervisor_core" / "audit.py",
            WORKER_CORE / "audit.py",
        )
        for path in forbidden_paths:
            with self.subTest(path=str(path)):
                self.assertFalse(path.exists())

    def test_python_bridge_api_does_not_emit_runtime_audit_records(self) -> None:
        api_source = Path(
            "apps/supervisor-agent-worker/src/campus_supervisor_agent_worker/api.py"
        ).read_text(encoding="utf-8")

        self.assertNotIn("build_audit_record", api_source)
        self.assertNotIn("build_error_audit_record", api_source)

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

    def test_go_runtime_intent_signals_are_policy_artifact_backed(self) -> None:
        forbidden_signal_tables = re.compile(r"(?m)^var\s+\w*Signals\s*=\s*\[\]string")
        scanned_paths = tuple(
            path
            for directory in (
                Path("apps/supervisor-api/internal/execution"),
                Path("apps/supervisor-api/internal/structuredplanning"),
            )
            for path in directory.glob("*.go")
            if not path.name.endswith("_test.go")
        )
        for path in scanned_paths:
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=str(path)):
                self.assertIsNone(forbidden_signal_tables.search(source))

    def test_supervisor_response_has_no_legacy_intent_observability_helper(self) -> None:
        self.assertFalse((WORKER_CORE / "response.py").exists())

    def test_supervisor_core_finalization_helpers_are_deleted(self) -> None:
        self.assertFalse((WORKER_CORE / "policy.py").exists())
        for path in (AGENT_DISPATCH, WORKER_CORE / "api.py", WORKER_CORE / "app.py"):
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=str(path)):
                self.assertNotIn("SupervisorResponse", source)
                self.assertNotIn("finalize_agent_response", source)
                self.assertNotIn("assemble_response", source)
                self.assertNotIn("build_supervisor_observability", source)
                self.assertNotIn("def handle_request", source)
                self.assertNotIn(" handle_request(", source)
                self.assertNotIn("class SupervisorAgent(", source)
                self.assertNotIn("SupervisorAgent.handle", source)
                self.assertNotIn("handle_agent_request", source)
                self.assertNotIn("SpecialistDelegate", source)
                self.assertNotIn("MissingSpecialistDelegateError", source)
                self.assertNotIn("InvalidSupervisorRequestError", source)
                self.assertNotIn("DisallowedKnowledgeScopeError", source)
                self.assertNotIn("SupervisorError", source)

    def test_active_python_runtime_no_longer_imports_supervisor_core_package(self) -> None:
        scanned_paths = (
            *WORKER_CORE.rglob("*.py"),
            *Path("tests/api").rglob("*.py"),
            *Path("tests/supervisor").rglob("*.py"),
            Path("tests/test_workspace_layout.py"),
        )
        for path in scanned_paths:
            if path == Path("tests/supervisor/test_supervisor_runtime_guardrails.py"):
                continue
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=str(path)):
                self.assertNotIn("from campus_supervisor_core import", source)
                self.assertNotIn("from campus_supervisor_core.", source)
                self.assertNotIn("import campus_supervisor_core", source)

    def test_active_docs_and_codebase_maps_do_not_reference_retired_supervisor_aliases(
        self,
    ) -> None:
        scanned_paths = (
            *Path("docs/contracts").glob("*.md"),
            *Path("docs/decisions").glob("*.md"),
            Path("docs/reference/qa-assistant-and-harness-gap-review.md"),
            *Path(".planning/codebase").glob("*.md"),
            *Path(".planning/todos/pending").glob("*.md"),
        )

        for path in scanned_paths:
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=str(path)):
                self.assertNotIn("supervisor-core", source)
                self.assertNotIn("packages/supervisor-core", source)
                self.assertNotIn("campus_supervisor_core", source)
                self.assertNotIn("rag-specialist", source)
                self.assertNotIn("navigation-specialist", source)
                self.assertNotIn("availability-specialist", source)
                self.assertNotIn("SpecialistRequest", source)
                self.assertNotIn("SpecialistResponse", source)

    def test_active_agent_instructions_do_not_reference_retired_supervisor_core(self) -> None:
        scanned_paths = (
            Path("AGENTS.md"),
            Path("apps/supervisor-api/AGENTS.md"),
            Path("apps/supervisor-agent-worker/AGENTS.md"),
            Path("packages/rag-agent/AGENTS.md"),
        )

        for path in scanned_paths:
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=str(path)):
                self.assertNotIn("supervisor-core", source)
                self.assertNotIn("packages/supervisor-core", source)

    def test_operator_selected_target_fixtures_do_not_use_retired_supervisor_core(
        self,
    ) -> None:
        scanned_paths = (
            *Path("apps/app-api/test").rglob("*.ts"),
            *Path("apps/protected-panel-web/test").rglob("*.ts"),
        )

        for path in scanned_paths:
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=str(path)):
                self.assertNotIn('selectedTarget: "supervisor-core"', source)
                self.assertNotIn("selectedTarget=supervisor-core", source)

    def test_python_bridge_does_not_publish_cancel_runtime_counters(self) -> None:
        api_source = WORKER_API.read_text(encoding="utf-8")

        self.assertNotIn("active_executions", api_source)
        self.assertNotIn("cancel_requested_count", api_source)
        self.assertNotIn("def status(", api_source)

    def test_worker_runtime_names_are_agent_worker_specific(self) -> None:
        app_source = WORKER_APP.read_text(encoding="utf-8")
        runtime_source = WORKER_AGENT_RUNTIME.read_text(encoding="utf-8")

        self.assertIn("class SupervisorAgentWorkerApp", app_source)
        self.assertIn("class AgentWorkerRuntime", runtime_source)
        self.assertNotIn("class SupervisorApiApp", app_source)
        self.assertNotIn("class AgentOSRuntime", app_source)
        self.assertNotIn("class AgentOSRuntime", runtime_source)
        self.assertNotIn("flush_audit", app_source)

    def test_worker_cancel_state_is_named_as_flag_store_not_runtime_registry(self) -> None:
        cancel_source = WORKER_CANCEL_FLAGS.read_text(encoding="utf-8")
        app_source = WORKER_APP.read_text(encoding="utf-8")

        self.assertIn("class CancelFlagStore", cancel_source)
        self.assertIn("CancelFlagStore", app_source)
        self.assertNotIn("ExecutionCancelRegistry", cancel_source)
        self.assertNotIn("ExecutionCancelRegistry", app_source)
        self.assertNotIn("CancelRecord", cancel_source)
        self.assertNotIn("CancelRecord", app_source)

    def test_bridge_v6_parser_is_the_direct_worker_request_parser(self) -> None:
        self.assertFalse((WORKER_CORE / "api_request_parsing.py").exists())
        self.assertTrue(BRIDGE_V6_PARSER.exists())
        self.assertTrue((WORKER_CORE / "bridge_payload_codecs.py").exists())
        self.assertFalse((WORKER_CORE / "bridge_context_codecs.py").exists())
        parser_source = BRIDGE_V6_PARSER.read_text(encoding="utf-8")
        self.assertNotIn("def _parse_bridge_supervisor_request", parser_source)
        self.assertNotIn("def _task_kind_for_capability", parser_source)
        self.assertNotIn("def _domain_candidates_for_target", parser_source)

    def test_bridge_context_codecs_are_split_by_projection_family(self) -> None:
        parser_source = BRIDGE_V6_PARSER.read_text(encoding="utf-8")

        self.assertFalse((WORKER_CORE / "bridge_context_codecs.py").exists())
        self.assertTrue(WORKER_BRIDGE_ACTOR_CODECS.exists())
        self.assertTrue(WORKER_BRIDGE_AUTHORIZATION_CODECS.exists())
        self.assertTrue(WORKER_BRIDGE_MEMORY_CODECS.exists())
        self.assertTrue(WORKER_BRIDGE_SESSION_CODECS.exists())
        self.assertTrue(WORKER_BRIDGE_TRACE_CODECS.exists())
        self.assertNotIn(
            "from campus_supervisor_agent_worker.bridge_context_codecs import", parser_source
        )

    def test_worker_app_runtime_assembly_is_split_from_bridge_app_factory(self) -> None:
        app_source = WORKER_APP.read_text(encoding="utf-8")

        self.assertTrue(WORKER_AGENT_DELEGATES.exists())
        self.assertTrue(WORKER_AGENT_RUNTIME.exists())
        self.assertNotIn("campus_rag_agent", app_source)
        self.assertNotIn("campus_navigation_agent", app_source)
        self.assertNotIn("campus_services_agent", app_source)
        self.assertNotIn("campus_notice_agent", app_source)
        self.assertNotIn("PromptRuntimeProviderConfig", app_source)
        self.assertNotIn("build_prompt_runtime_http_client", app_source)
        self.assertNotIn("def _build_agent_delegates", app_source)
        self.assertNotIn("def _build_prompt_runtime_assets", app_source)

    def test_bridge_api_surface_is_split_from_readiness_and_cancel_store(self) -> None:
        api_source = WORKER_API.read_text(encoding="utf-8")

        self.assertTrue(WORKER_CANCEL_FLAGS.exists())
        self.assertTrue(WORKER_BRIDGE_READINESS.exists())
        self.assertNotIn("class CancelFlag", api_source)
        self.assertNotIn("class CancelFlagStore", api_source)
        self.assertNotIn("def readyz(", api_source)
        self.assertNotIn("def healthz(", api_source)
        self.assertNotIn("def _resolve_prompt_runtime_settings", api_source)
        self.assertNotIn("def _default_prompt_http_pool_status", api_source)
