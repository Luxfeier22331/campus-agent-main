from __future__ import annotations

import unittest
from pathlib import Path

from scripts.supervisor_runtime_process_smoke import (
    build_process_smoke_plan,
    process_spec_to_artifact,
)


class SupervisorRuntimeProcessSmokeTest(unittest.TestCase):
    def test_build_process_smoke_plan_uses_direct_local_processes(self) -> None:
        plan = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            api_port=19080,
            worker_port=19081,
        )

        commands = {command.label: command for command in plan.processes}
        self.assertEqual(
            commands["supervisor-agent-worker"].command,
            (
                "uv",
                "run",
                "--all-packages",
                "python",
                "-m",
                "campus_supervisor_agent_worker.bridge_server",
            ),
        )
        self.assertEqual(
            commands["supervisor-api"].command,
            ("go", "run", "./cmd/supervisor-api"),
        )
        self.assertEqual(commands["supervisor-api"].cwd, Path("/repo/apps/supervisor-api"))
        self.assertEqual(
            commands["supervisor-api"].env["SUPERVISOR_AGENT_WORKER_BASE_URL"],
            "http://127.0.0.1:19081",
        )
        command_words = [word for process in plan.processes for word in process.command]
        self.assertNotIn("docker", command_words)
        self.assertNotIn("wrangler", command_words)

    def test_process_smoke_artifact_redacts_secret_env_values(self) -> None:
        plan = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
        )

        artifact = process_spec_to_artifact(plan.processes[1])

        self.assertEqual(artifact["env"]["API_WORKER_SHARED_SECRET"], "<redacted>")
        self.assertEqual(
            artifact["env"]["SUPERVISOR_AGENT_WORKER_SHARED_SECRET"],
            "<redacted>",
        )
        self.assertEqual(
            artifact["env"]["SUPERVISOR_AGENT_WORKER_BASE_URL"],
            "http://127.0.0.1:18081",
        )

    def test_profiles_select_distinct_answer_payloads_and_expectations(self) -> None:
        closed = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="closed_gate",
        )
        terminal = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="terminal_fail_close",
        )
        rag = build_process_smoke_plan(
            repo_root=Path("/repo"),
            output_dir=Path("/tmp/smoke"),
            profile="rag_delegate",
        )

        self.assertEqual(closed.expected_status, 503)
        self.assertIn("structured_runtime_closed", closed.expected_body_tokens)
        self.assertEqual(terminal.expected_status, 200)
        self.assertEqual(terminal.answer_payload["requested_capability"], "knowledge")
        self.assertIn("product_scope_boundary", terminal.expected_body_tokens)
        self.assertEqual(rag.expected_status, 200)
        self.assertIn("workflow_trace_summary", rag.expected_body_tokens)
        self.assertIn("agent_execution_projection", rag.expected_body_tokens)
        self.assertIn("agent_plan", rag.expected_body_tokens)
        self.assertEqual(rag.answer_payload["requested_capability"], "knowledge")

    def test_answer_probe_uses_process_smoke_timeout_budget(self) -> None:
        import inspect

        from scripts.supervisor_runtime_process_smoke import _post_json

        parameters = inspect.signature(_post_json).parameters

        self.assertIn("timeout_seconds", parameters)


if __name__ == "__main__":
    unittest.main()
