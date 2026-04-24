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

    def test_supervisor_shell_docker_build_uses_configurable_go_module_proxy(self) -> None:
        dockerfile_path = ROOT / "apps/go-shell/Dockerfile"
        compose_path = ROOT / "infra/local/docker-compose.supervisor-runtime.yml"
        script_path = ROOT / "infra/local/start-supervisor-runtime.sh"

        dockerfile = dockerfile_path.read_text(encoding="utf-8")
        compose = compose_path.read_text(encoding="utf-8")
        script = script_path.read_text(encoding="utf-8")

        self.assertIn("ARG GOPROXY=https://proxy.golang.org,direct", dockerfile)
        self.assertIn("ARG GOSUMDB=sum.golang.org", dockerfile)
        self.assertIn("ENV GOPROXY=${GOPROXY}", dockerfile)
        self.assertIn("GOSUMDB=${GOSUMDB}", dockerfile)
        self.assertIn("COPY apps/go-shell/go.mod apps/go-shell/go.sum ./", dockerfile)
        self.assertIn("RUN go mod download", dockerfile)
        self.assertLess(
            dockerfile.index("RUN go mod download"),
            dockerfile.index("COPY apps/go-shell ./"),
        )

        self.assertIn("GO_SHELL_DOCKER_GOPROXY", compose)
        self.assertIn("https://goproxy.cn,direct", compose)
        self.assertIn("GO_SHELL_DOCKER_GOSUMDB", compose)
        self.assertNotIn("GOSUMDB=off", compose)

        self.assertIn('"GO_SHELL_DOCKER_GOPROXY"', script)
        self.assertIn('"GO_SHELL_DOCKER_GOSUMDB"', script)
        self.assertNotIn("GOSUMDB=off", script)


if __name__ == "__main__":
    unittest.main()
