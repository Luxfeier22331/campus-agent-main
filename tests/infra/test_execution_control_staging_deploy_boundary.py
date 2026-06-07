from __future__ import annotations

import os
import subprocess
import textwrap
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[2]
STAGING_DIR = ROOT / "infra" / "local" / "staging"


class ExecutionControlStagingDeployBoundaryTest(unittest.TestCase):
    def test_common_defaults_runtime_env_to_ops_owned_path(self) -> None:
        common_script = (STAGING_DIR / "execution-control-staging-common.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn(
            "/srv/docker/campus-agent/staging/env/runtime.env",
            common_script,
        )
        self.assertIn("EXECUTION_CONTROL_STAGING_ENV_FILE", common_script)

    def test_env_loader_requires_external_runtime_env_file(self) -> None:
        result = _run_env_loader_without_runtime_env()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("EXECUTION_CONTROL_STAGING_ENV_FILE is required", result.stderr)
        self.assertIn("/srv/docker/campus-agent/staging/env/runtime.env", result.stderr)

    def test_env_loader_does_not_read_repo_local_env_or_app_api_dev_vars(self) -> None:
        result = _run_env_loader_with_repo_local_secrets_only()

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("API_WORKER_SHARED_SECRET is required", result.stderr)
        self.assertIn("runtime.env", result.stderr)
        self.assertNotIn("repo-local-secret", result.stdout)
        self.assertNotIn("dev-vars-secret", result.stdout)

    def test_compose_wrapper_passes_ops_env_file_to_docker_compose(self) -> None:
        core_script = (STAGING_DIR / "execution-control-staging-core.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("--env-file", core_script)
        self.assertIn('"${execution_control_staging_env_file}"', core_script)

    def test_start_status_and_preflight_enforce_clean_pinned_checkout(self) -> None:
        for relative_path in (
            "start-execution-control-staging.sh",
            "status-execution-control-staging.sh",
            "preflight-execution-control-staging.sh",
        ):
            with self.subTest(script=relative_path):
                script = (STAGING_DIR / relative_path).read_text(encoding="utf-8")
                self.assertIn("execution_control_staging_require_deploy_checkout_clean", script)

    def test_checkout_guard_rejects_dirty_tracked_file(self) -> None:
        result = _run_checkout_guard(
            mutate="""
            printf 'dirty\\n' >> tracked.txt
            """,
            expected_sha="HEAD",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Deploy checkout has tracked modifications", result.stderr)

    def test_checkout_guard_rejects_unexpected_untracked_file(self) -> None:
        result = _run_checkout_guard(
            mutate="""
            printf 'artifact\\n' > unexpected.txt
            """,
            expected_sha="HEAD",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Deploy checkout has unexpected untracked files", result.stderr)

    def test_checkout_guard_rejects_ignored_python_virtualenv_artifact(self) -> None:
        result = _run_checkout_guard(
            mutate="""
            printf '.venv/\\n' >> .git/info/exclude
            mkdir .venv
            """,
            expected_sha="HEAD",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Deploy checkout contains repo-local runtime artifact", result.stderr)
        self.assertIn(".venv", result.stderr)

    def test_checkout_guard_rejects_repo_local_runtime_secret_files(self) -> None:
        result = _run_checkout_guard(
            mutate="""
            printf 'secret\\n' > .env.staging.local
            """,
            expected_sha="HEAD",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Deploy checkout contains repo-local runtime secret file", result.stderr)

    def test_checkout_guard_rejects_wrong_pinned_sha(self) -> None:
        result = _run_checkout_guard(mutate="", expected_sha="0000000000000000000000000000000000000000")

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Deploy checkout HEAD does not match EXECUTION_CONTROL_STAGING_EXPECTED_SHA", result.stderr)

    def test_checkout_guard_requires_pinned_sha(self) -> None:
        result = _run_checkout_guard(mutate="", expected_sha=None)

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("EXECUTION_CONTROL_STAGING_EXPECTED_SHA is required", result.stderr)

    def test_uv_runtime_wrapper_uses_runtime_dir_for_project_environment_and_cache(self) -> None:
        core_script = (STAGING_DIR / "execution-control-staging-core.sh").read_text(
            encoding="utf-8"
        )

        self.assertIn("execution_control_staging_uv_run", core_script)
        self.assertIn("UV_PROJECT_ENVIRONMENT=", core_script)
        self.assertIn("UV_CACHE_DIR=", core_script)
        self.assertIn('${execution_control_staging_runtime_dir}/uv', core_script)


def _copy_staging_modules(target_root: Path) -> Path:
    staging_dir = target_root / "infra" / "local" / "staging"
    staging_dir.mkdir(parents=True)
    for source_path in STAGING_DIR.glob("execution-control-staging-*.sh"):
        (staging_dir / source_path.name).write_text(
            source_path.read_text(encoding="utf-8"),
            encoding="utf-8",
        )
    return staging_dir / "execution-control-staging-common.sh"


def _run_env_loader_without_runtime_env() -> subprocess.CompletedProcess[str]:
    with TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        common_path = _copy_staging_modules(root)
        command = f"""
        set -euo pipefail
        source {common_path}
        execution_control_staging_load_env
        """
        return subprocess.run(
            ["bash", "-lc", textwrap.dedent(command)],
            cwd=root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )


def _run_env_loader_with_repo_local_secrets_only() -> subprocess.CompletedProcess[str]:
    with TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        common_path = _copy_staging_modules(root)
        (root / ".env.staging.local").write_text(
            "EXECUTION_CONTROL_SHARED_SECRET=repo-local-secret\n",
            encoding="utf-8",
        )
        app_api_dir = root / "apps" / "app-api"
        app_api_dir.mkdir(parents=True)
        (app_api_dir / ".dev.vars").write_text(
            "EXECUTION_CONTROL_SHARED_SECRET=dev-vars-secret\n",
            encoding="utf-8",
        )
        runtime_env = root / "ops" / "runtime.env"
        runtime_env.parent.mkdir()
        runtime_env.write_text(
            "\n".join(
                (
                    "STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime@staging-db.example.com:5432/campus_agent",
                    "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry@staging-registry.example.com:5432/campus_agent",
                    "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://raw@staging-raw.example.com:5432/campus_agent",
                    "STAGING_INGESTION_OBJECT_STORE_ENDPOINT=https://s3.staging.example.com",
                    "STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access",
                    "STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret",
                    "STAGING_INGESTION_OBJECT_STORE_REGION=auto",
                    "STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging",
                    "STAGING_INGESTION_QDRANT_URL=https://qdrant.staging.example.com",
                    "STAGING_INGESTION_QDRANT_API_KEY=qdrant-key",
                    "STAGING_INGESTION_EMBEDDING_PROVIDER=gitee",
                    "STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1",
                    "STAGING_INGESTION_EMBEDDING_API_KEY=embedding-key",
                    "STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B",
                    "STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560",
                    "STAGING_INGESTION_SPARSE_PROVIDER=qdrant",
                    "STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25",
                    "STAGING_INGESTION_SPARSE_TOKENIZER=multilingual",
                    "STAGING_INGESTION_SPARSE_LANGUAGE=none",
                    "AXIOM_ENDPOINT=https://us-east-1.aws.edge.axiom.co",
                    "OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT=https://sentry.example.com",
                    "OTEL_COLLECTOR_SENTRY_AUTH_VALUE=sentry sentry_key=key",
                    "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT=https://us-east-1.aws.edge.axiom.co",
                    "OTEL_COLLECTOR_AXIOM_AUTH_HEADER=Bearer axiom",
                    "OTEL_COLLECTOR_AXIOM_EVENTS_DATASET=campus-agent-runtime",
                    "EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token",
                    "SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret",
                    "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret",
                    "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://projection@staging-db.example.com:5432/campus_agent",
                    "TEMPORAL_POSTGRES_PASSWORD=temporal-password",
                    "EXECUTION_CONTROL_TEMPORAL_ADDRESS=temporal:7233",
                    "EXECUTION_CONTROL_TEMPORAL_NAMESPACE=campus-agent-staging",
                    "EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE=campus-agent.workflow",
                    "EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY=staging:execution-control:001",
                    "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY=staging:workflow-worker:001",
                    "EXECUTION_CONTROL_TEMPORAL_RAG_WORKER_IDENTITY=staging:activity-rag:001",
                    "EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY=staging:activity-finalization:001",
                    "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT=workflow-salt",
                    "EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS=5000",
                )
            )
            + "\n",
            encoding="utf-8",
        )
        command = f"""
        set -euo pipefail
        export EXECUTION_CONTROL_STAGING_ENV_FILE={runtime_env}
        source {common_path}
        execution_control_staging_load_env
        execution_control_staging_require_runtime_env
        env | grep 'EXECUTION_CONTROL_SHARED_SECRET\\|API_WORKER_SHARED_SECRET' || true
        """
        return subprocess.run(
            ["bash", "-lc", textwrap.dedent(command)],
            cwd=root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )


def _run_checkout_guard(*, mutate: str, expected_sha: str | None) -> subprocess.CompletedProcess[str]:
    with TemporaryDirectory() as temp_dir:
        root = Path(temp_dir)
        common_path = _copy_staging_modules(root)
        env = os.environ.copy()
        command = f"""
        set -euo pipefail
        git init -q
        git config user.email test@example.com
        git config user.name Test
        printf 'tracked\\n' > tracked.txt
        git add tracked.txt infra/local/staging
        git commit -q -m init
        if [[ {expected_sha is not None!s} == True ]]; then
          if [[ {expected_sha!r} == HEAD ]]; then
            export EXECUTION_CONTROL_STAGING_EXPECTED_SHA="$(git rev-parse HEAD)"
          else
            export EXECUTION_CONTROL_STAGING_EXPECTED_SHA={expected_sha or ''}
          fi
        fi
        {mutate}
        source {common_path}
        execution_control_staging_require_deploy_checkout_clean
        """
        return subprocess.run(
            ["bash", "-lc", textwrap.dedent(command)],
            cwd=root,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )


if __name__ == "__main__":
    unittest.main()
