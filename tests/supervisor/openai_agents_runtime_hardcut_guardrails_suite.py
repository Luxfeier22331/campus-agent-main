from __future__ import annotations

import unittest
from pathlib import Path

REPO_ROOT = Path(".")
WORKER_SOURCE = REPO_ROOT / "apps/supervisor-agent-worker/src/campus_supervisor_agent_worker"
RAG_SOURCE = REPO_ROOT / "packages/rag-agent/src/campus_rag_agent"


class OpenAIAgentsRuntimeHardcutGuardrailsTest(unittest.TestCase):
    def test_old_rag_sdk_runner_module_and_class_are_deleted(self) -> None:
        self.assertFalse((WORKER_SOURCE / "rag_agents_sdk_openai_runner.py").exists())
        for path in (
            WORKER_SOURCE / "agent_delegates.py",
            WORKER_SOURCE / "openai_agents_rag_runtime.py",
        ):
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=str(path)):
                self.assertNotIn("OpenAIRagAgentsSdkRunner", source)
                self.assertNotIn("rag_agents_sdk_openai_runner", source)
                self.assertNotIn("rag-agent-internal-sdk-loop", source)

    def test_rollout_runtime_modes_are_not_reintroduced_to_rag_service(self) -> None:
        checked_files = (
            RAG_SOURCE / "service.py",
            RAG_SOURCE / "service_answer_synthesis.py",
            RAG_SOURCE / "rag_sdk_models.py",
            WORKER_SOURCE / "agent_delegates.py",
        )
        forbidden = (
            "RagSdkRolloutMode",
            "rag_sdk_rollout_mode",
            "fallback_only",
            "should_attempt_rag_sdk",
            "should_return_rag_sdk_response",
            "run_agents_sdk_runner_shell",
        )
        for path in checked_files:
            source = path.read_text(encoding="utf-8")
            with self.subTest(path=str(path)):
                for fragment in forbidden:
                    self.assertNotIn(fragment, source)

    def test_worker_sdk_runtime_surface_uses_native_openai_agents_names(self) -> None:
        delegates = (WORKER_SOURCE / "agent_delegates.py").read_text(encoding="utf-8")
        rag_runtime = (WORKER_SOURCE / "openai_agents_rag_runtime.py").read_text(encoding="utf-8")

        self.assertIn("OpenAIAgentsRagRuntime", delegates)
        self.assertIn("OpenAIAgentsRagRuntime", rag_runtime)
        self.assertIn("OpenAIAgentsNativeRuntime", rag_runtime)
        self.assertNotIn("AgentsSdkRunner", delegates)
        self.assertNotIn("AgentsSdkRunRequest", delegates)
        self.assertNotIn("AgentsSdkRunResult", delegates)


if __name__ == "__main__":
    unittest.main()
