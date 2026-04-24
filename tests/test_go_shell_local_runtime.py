import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class GoShellLocalRuntimeTest(unittest.TestCase):
    def test_local_runtime_start_script_loads_repo_env_and_rewrites_container_dsns(self) -> None:
        script_path = ROOT / "infra/local/start-supervisor-runtime.sh"
        self.assertTrue(script_path.exists())

        script = script_path.read_text(encoding="utf-8")

        self.assertIn("${repo_root}/.env", script)
        self.assertIn("process.loadEnvFile", script)
        self.assertIn("DOCUMENT_REGISTRY_DATABASE_URL", script)
        self.assertIn("CAMPUS_SHARED_POSTGRES_URL", script)
        self.assertIn("SUPERVISOR_API_EXECUTION_AUDIT_URL", script)
        self.assertIn("host.docker.internal", script)
        self.assertIn("read -r -d '' env_key", script)
        self.assertNotIn("eval ", script)
        self.assertIn('"${docker_bin}" compose', script)
        self.assertIn("docker-compose.supervisor-runtime.yml", script)


if __name__ == "__main__":
    unittest.main()
