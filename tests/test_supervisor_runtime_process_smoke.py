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


if __name__ == "__main__":
    unittest.main()
