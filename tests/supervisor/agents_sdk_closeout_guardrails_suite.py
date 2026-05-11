from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(".")
SDK_SOURCE_DIR = REPO_ROOT / "apps/supervisor-agent-worker/src/campus_supervisor_agent_worker"
RAG_AGENT_SOURCE_DIR = REPO_ROOT / "packages/rag-agent/src/campus_rag_agent"
WORKSTREAM_DIR = REPO_ROOT / ".planning/workstreams/agents-sdk-domain-agent-adapter-pilot"


class AgentsSdkCloseoutGuardrailsTest(unittest.TestCase):
    def test_sdk_runtime_defaults_on_with_repo_registry_admission_only(self) -> None:
        settings_source = (SDK_SOURCE_DIR / "settings.py").read_text(encoding="utf-8")
        delegates_source = (SDK_SOURCE_DIR / "agent_delegates.py").read_text(encoding="utf-8")

        self.assertRegex(settings_source, r"agents_sdk_runtime_enabled:\s*bool\s*=\s*True")
        self.assertRegex(
            settings_source,
            r'"SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED",\s*default=True',
        )
        self.assertNotIn(
            'settings.agents_sdk_runtime_allowed_tools == ("campus_notice_get",)', delegates_source
        )
        self.assertIn("ToolExecutionSession", delegates_source)
        self.assertIn("build_default_tool_execution_session", delegates_source)
        self.assertNotIn("execute_notice_sdk_tool(", delegates_source)
        self.assertNotIn("execute_campus_services_sdk_tool(", delegates_source)
        self.assertNotIn("run_notice_get_internal_request(", delegates_source)
        self.assertNotIn("agents_sdk_runtime_allowed_targets", settings_source)
        self.assertNotIn("agents_sdk_runtime_allowed_tools", settings_source)
        self.assertNotIn("SUPERVISOR_AGENTS_SDK_" + "ALLOWED_TARGETS", settings_source)
        self.assertNotIn("SUPERVISOR_AGENTS_SDK_" + "ALLOWED_TOOLS", settings_source)
        self.assertNotIn("agents_sdk_runtime_allowed_targets", delegates_source)
        self.assertNotIn("agents_sdk_runtime_allowed_tools", delegates_source)

    def test_domain_agent_execution_is_owned_by_admitted_executor_module(self) -> None:
        delegates_source = (SDK_SOURCE_DIR / "agent_delegates.py").read_text(encoding="utf-8")
        executor_source = (SDK_SOURCE_DIR / "admitted_agent_execution.py").read_text(
            encoding="utf-8"
        )

        self.assertIn("AdmittedAgentExecutor", delegates_source)
        self.assertNotIn("def _execute_domain_agent_request", delegates_source)
        self.assertNotIn("def _is_sdk_admitted_structured_request", delegates_source)
        self.assertNotIn("def _is_internal_function_request", delegates_source)
        self.assertNotIn("build_agents_sdk_tool_descriptors(", delegates_source)
        self.assertIn("def execute(", executor_source)
        self.assertIn("sdk_agent_execution", executor_source)
        self.assertNotIn("single_tool_structured_handoff", executor_source)

    def test_rag_sdk_hardcut_keeps_explicit_runner_and_no_nullable_worker_runtime(self) -> None:
        delegates_source = (SDK_SOURCE_DIR / "agent_delegates.py").read_text(encoding="utf-8")
        rag_service_source = (RAG_AGENT_SOURCE_DIR / "service.py").read_text(encoding="utf-8")
        rag_synthesis_source = (RAG_AGENT_SOURCE_DIR / "service_answer_synthesis.py").read_text(
            encoding="utf-8"
        )

        self.assertNotIn("_build_unavailable_rag_sdk_runner", delegates_source)
        self.assertIn("raise _runtime_config_error", delegates_source)
        self.assertIn("_RAG_SDK_RUNNER_NOT_PROVIDED", rag_service_source)
        self.assertIn("rag_sdk_runtime_unavailable", rag_synthesis_source)
        self.assertNotIn("rag_sdk_runner: RagSdkRunner | None = None", rag_service_source)

    def test_realistic_chain_eval_uses_explicit_inprocess_rag_delegate(self) -> None:
        eval_source = (
            REPO_ROOT / "packages/evals/src/campus_evals/rag_realistic_chain_validation.py"
        ).read_text(encoding="utf-8")

        self.assertIn("_delegate_to_rag_agent_for_realistic_eval", eval_source)
        self.assertIn("rag_sdk_runner=_realistic_eval_sdk_runner", eval_source)
        self.assertNotIn("from campus_rag_agent import delegate_to_rag_agent", eval_source)

    def test_sdk_source_does_not_admit_hosted_or_stateful_tool_surfaces(self) -> None:
        forbidden_patterns = {
            "hosted_mcp": r"\b(hosted_mcp|HostedMCPTool|MCPServer)\b",
            "web_search": r"\b(web_search|WebSearchTool)\b",
            "file_search": r"\b(file_search|FileSearchTool)\b",
            "computer_or_code_execution": r"\b(ComputerTool|computer_use|CodeInterpreterTool)\b",
            "filesystem_or_shell": r"\b(subprocess|os\.system|Popen|shell=True)\b",
            "object_store": r"\b(boto3|Minio|S3ObjectStore|object_store)\b",
            "collector_ingestion_index": r"\b(campus_ingestion|collector|index_build|release_index)\b",
            "raw_sql": r"\b(psycopg|sqlalchemy|raw_sql)\b",
        }
        for path in sorted(SDK_SOURCE_DIR.glob("agents_sdk_*.py")):
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=str(path)):
                for name, pattern in forbidden_patterns.items():
                    self.assertIsNone(
                        re.search(pattern, source),
                        f"{path} admits forbidden SDK surface: {name}",
                    )

    def test_contracts_and_evals_do_not_expose_sdk_native_or_raw_projection_truth(self) -> None:
        checked_roots = (
            REPO_ROOT / "packages/contracts/src/campus_contracts",
            REPO_ROOT / "packages/evals/src/campus_evals",
        )
        forbidden_patterns = {
            "sdk_native_graph": r"\b(AgentGraph|AgentHandoff|RunResult|FunctionTool)\b",
            "raw_sdk_trace_keys": r"\b(raw_model_output|sdk_run_state|trace_url)\b",
        }
        for root in checked_roots:
            for path in sorted(root.glob("*.py")):
                source = path.read_text(encoding="utf-8")
                with self.subTest(path=str(path)):
                    for name, pattern in forbidden_patterns.items():
                        self.assertIsNone(
                            re.search(pattern, source),
                            f"{path} exposes forbidden SDK/raw surface: {name}",
                        )

    def test_workstream_closeout_records_completed_posture_and_reopen_rule(self) -> None:
        readme = (WORKSTREAM_DIR / "README.md").read_text(encoding="utf-8")
        state = (WORKSTREAM_DIR / "STATE.md").read_text(encoding="utf-8")
        roadmap = (WORKSTREAM_DIR / "ROADMAP.md").read_text(encoding="utf-8")
        registry = (REPO_ROOT / ".planning/WORKSTREAMS.md").read_text(encoding="utf-8")

        self.assertIn("status: completed", readme)
        self.assertIn("Status:** Completed", state)
        self.assertIn("**Phase 8: Closeout Guardrails And Docs** — completed", roadmap)
        self.assertNotIn(
            "| `agents sdk domain-agent adapter pilot` | `agents-sdk-domain-agent-adapter-pilot`",
            _active_section(registry),
        )
        completed_section = _completed_section(registry)
        self.assertIn("agents-sdk-domain-agent-adapter-pilot", completed_section)
        self.assertIn("ToolSpec / Go allowed-tools derivation is bypassed", completed_section)
        self.assertIn("SDK raw traces or native types leak", completed_section)


def _active_section(registry: str) -> str:
    return registry.split("## Active", maxsplit=1)[1].split("## Completed", maxsplit=1)[0]


def _completed_section(registry: str) -> str:
    return registry.split("## Completed", maxsplit=1)[1].split("## Deferred", maxsplit=1)[0]


if __name__ == "__main__":
    unittest.main()
