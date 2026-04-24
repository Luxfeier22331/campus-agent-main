import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class SupervisorApiLocalRuntimeTest(unittest.TestCase):
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

    def test_supervisor_api_docker_build_uses_configurable_go_module_proxy(self) -> None:
        dockerfile_path = ROOT / "apps/supervisor-api/Dockerfile"
        compose_path = ROOT / "infra/local/docker-compose.supervisor-runtime.yml"
        script_path = ROOT / "infra/local/start-supervisor-runtime.sh"

        dockerfile = dockerfile_path.read_text(encoding="utf-8")
        compose = compose_path.read_text(encoding="utf-8")
        script = script_path.read_text(encoding="utf-8")

        self.assertIn("ARG GOPROXY=https://proxy.golang.org,direct", dockerfile)
        self.assertIn("ARG GOSUMDB=sum.golang.org", dockerfile)
        self.assertIn("ENV GOPROXY=${GOPROXY}", dockerfile)
        self.assertIn("GOSUMDB=${GOSUMDB}", dockerfile)
        self.assertIn("COPY apps/supervisor-api/go.mod apps/supervisor-api/go.sum ./", dockerfile)
        self.assertIn("RUN go mod download", dockerfile)
        self.assertLess(
            dockerfile.index("RUN go mod download"),
            dockerfile.index("COPY apps/supervisor-api ./"),
        )

        self.assertIn("SUPERVISOR_API_DOCKER_GOPROXY", compose)
        self.assertIn("https://goproxy.cn,direct", compose)
        self.assertIn("SUPERVISOR_API_DOCKER_GOSUMDB", compose)
        self.assertNotIn("GOSUMDB=off", compose)

        self.assertIn('"SUPERVISOR_API_DOCKER_GOPROXY"', script)
        self.assertIn('"SUPERVISOR_API_DOCKER_GOSUMDB"', script)
        self.assertNotIn("GOSUMDB=off", script)

    def test_local_runtime_wires_structured_query_from_go_api_to_core_worker(self) -> None:
        compose_path = ROOT / "infra/local/docker-compose.supervisor-runtime.yml"
        script_path = ROOT / "infra/local/start-supervisor-runtime.sh"

        compose = compose_path.read_text(encoding="utf-8")
        script = script_path.read_text(encoding="utf-8")

        self.assertIn("SUPERVISOR_STRUCTURED_QUERY_BASE_URL: http://supervisor-api:8000", compose)
        self.assertIn("SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET", compose)
        self.assertIn("SUPERVISOR_STRUCTURED_QUERY_PROJECTION_PATH", compose)
        self.assertIn("INTERNAL_NOTICE_READ_MODEL_DATABASE_URL", compose)
        self.assertIn("OBJECT_STORE_ENDPOINT", compose)
        self.assertIn('"SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET"', script)
        self.assertIn('"OBJECT_STORE_ENDPOINT"', script)


if __name__ == "__main__":
    unittest.main()
