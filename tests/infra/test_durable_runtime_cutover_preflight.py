from __future__ import annotations

import json
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "check_durable_runtime_cutover_preflight.py"


VALID_STAGING_ENV = textwrap.dedent(
    """
    STAGING_EXECUTION_GATEWAY_BASE_URL=https://exec-staging.mucwiki-edge.link
    STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime@example/campus_agent
    STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry@example/campus_agent
    STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://raw@example/campus_agent
    STAGING_INGESTION_OBJECT_STORE_ENDPOINT=https://5943f31433be5dd57beb3bb92bd1c660.r2.cloudflarestorage.com
    STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging
    STAGING_INGESTION_OBJECT_STORE_REGION=auto
    STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=access
    STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=secret
    STAGING_INGESTION_QDRANT_URL=http://127.0.0.1:6333
    STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
    STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY=qdrant-read
    STAGING_INGESTION_EMBEDDING_PROVIDER=gitee
    STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1
    STAGING_INGESTION_EMBEDDING_API_KEY=embedding-key
    STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
    STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
    STAGING_INGESTION_SPARSE_PROVIDER=qdrant
    STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
    STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
    STAGING_INGESTION_SPARSE_LANGUAGE=none
    AXIOM_ENDPOINT=https://us-east-1.aws.edge.axiom.co
    OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT=https://o4511127794155520.ingest.us.sentry.io/api/4511351503454208/integration/otlp
    OTEL_COLLECTOR_SENTRY_AUTH_VALUE=sentry sentry_key=03ac022c1d762aa1882d3fdbc27915f9
    OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT=https://us-east-1.aws.edge.axiom.co
    OTEL_COLLECTOR_AXIOM_AUTH_HEADER=Bearer axiom-ingest-token
    OTEL_COLLECTOR_AXIOM_EVENTS_DATASET=campus-agent-runtime
    EXECUTION_GATEWAY_METRICS_BEARER_TOKEN=metrics
    SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
    SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
    EXECUTION_GATEWAY_DURABLE_RUNTIME_DATABASE_URL=postgresql://durable@example/campus_agent
    TEMPORAL_POSTGRES_PASSWORD=temporal-postgres-password
    EXECUTION_GATEWAY_TEMPORAL_ADDRESS=temporal:7233
    EXECUTION_GATEWAY_TEMPORAL_NAMESPACE=campus-agent-staging
    EXECUTION_GATEWAY_TEMPORAL_TASK_QUEUE=campus-agent.workflow
    EXECUTION_GATEWAY_TEMPORAL_WORKER_IDENTITY=staging:execution-gateway:001
    EXECUTION_GATEWAY_TEMPORAL_WORKFLOW_ID_SALT=workflow-salt
    EXECUTION_GATEWAY_TEMPORAL_START_TIMEOUT_MS=5000
    """
).strip()

LOCAL_MINIO_STAGING_ENV = (
    VALID_STAGING_ENV.replace(
        "STAGING_INGESTION_OBJECT_STORE_ENDPOINT=https://5943f31433be5dd57beb3bb92bd1c660.r2.cloudflarestorage.com",
        "STAGING_INGESTION_OBJECT_STORE_ENDPOINT=http://127.0.0.1:9000",
    )
    .replace(
        "STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging",
        "STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived",
    )
    .replace(
        "STAGING_INGESTION_OBJECT_STORE_REGION=auto",
        "STAGING_INGESTION_OBJECT_STORE_REGION=us-east-1",
    )
)


def run_preflight(
    files: dict[str, str], env: dict[str, str] | None = None
) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for relative, content in files.items():
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        return subprocess.run(
            [
                "python",
                str(SCRIPT),
                "--repo-root",
                str(root),
                "--json",
            ],
            check=False,
            env={**(env or {})},
            stderr=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True,
        )


class DurableRuntimeCutoverPreflightTest(unittest.TestCase):
    def test_root_package_exposes_cutover_preflight_script(self) -> None:
        package_json = json.loads((REPO_ROOT / "package.json").read_text())

        self.assertEqual(
            package_json["scripts"]["durable:cutover:preflight"],
            "uv run --all-packages python -m scripts.check_durable_runtime_cutover_preflight",
        )

    def test_staging_runbook_uses_current_preflight_cli_shape(self) -> None:
        runbook = (
            REPO_ROOT / "docs" / "runbooks" / "execution-gateway-staging-operations.md"
        ).read_text()

        self.assertIn("pnpm durable:cutover:preflight --json", runbook)
        self.assertNotIn("pnpm durable:cutover:preflight -- --json", runbook)
        self.assertIn("CLOUDFLARE_API_TOKEN", runbook)
        self.assertIn("PATH=/home/deploy/.local/bin:/usr/local/bin:/usr/bin:/bin", runbook)

    def test_rejects_missing_cloudflare_token_and_durable_data_plane_env(self) -> None:
        result = run_preflight(
            {
                ".env.staging.local": textwrap.dedent(
                    """
                    EXECUTION_GATEWAY_DURABLE_RUNTIME_DATABASE_URL=postgresql://durable@example/campus_agent
                    TEMPORAL_POSTGRES_PASSWORD=temporal-postgres-password
                    EXECUTION_GATEWAY_TEMPORAL_ADDRESS=temporal:7233
                    EXECUTION_GATEWAY_TEMPORAL_NAMESPACE=campus-agent-staging
                    EXECUTION_GATEWAY_TEMPORAL_TASK_QUEUE=campus-agent.workflow
                    EXECUTION_GATEWAY_TEMPORAL_WORKER_IDENTITY=staging:execution-gateway:001
                    EXECUTION_GATEWAY_TEMPORAL_WORKFLOW_ID_SALT=workflow-salt
                    EXECUTION_GATEWAY_TEMPORAL_START_TIMEOUT_MS=5000
                    """
                ).strip(),
                "apps/app-api/.dev.vars": "EXECUTION_GATEWAY_SHARED_SECRET=worker-secret\n",
            }
        )

        self.assertNotEqual(result.returncode, 0)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["status"], "blocked")
        self.assertIn("CLOUDFLARE_API_TOKEN", payload["blockers"])
        self.assertIn("STAGING_INGESTION_OBJECT_STORE_ENDPOINT", payload["blockers"])
        self.assertIn("STAGING_INGESTION_QDRANT_URL", payload["blockers"])
        self.assertIn("STAGING_INGESTION_EMBEDDING_API_KEY", payload["blockers"])
        self.assertIn("OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT", payload["blockers"])
        self.assertIn("OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT", payload["blockers"])

    def test_passes_when_cutover_inputs_are_explicit(self) -> None:
        result = run_preflight(
            {
                ".env.staging.local": VALID_STAGING_ENV,
                "apps/app-api/.dev.vars": "EXECUTION_GATEWAY_SHARED_SECRET=worker-secret\n",
            },
            env={"CLOUDFLARE_API_TOKEN": "cf-token"},
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["status"], "ready")
        self.assertEqual(payload["blockers"], [])

    def test_accepts_local_minio_profile_for_isolated_temporal_proof(self) -> None:
        result = run_preflight(
            {
                ".env.staging.local": LOCAL_MINIO_STAGING_ENV,
                "apps/app-api/.dev.vars": "EXECUTION_GATEWAY_SHARED_SECRET=worker-secret\n",
            },
            env={"CLOUDFLARE_API_TOKEN": "cf-token"},
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["status"], "ready")
        self.assertEqual(payload["blockers"], [])

    def test_rejects_ambiguous_object_store_profile(self) -> None:
        invalid_env = LOCAL_MINIO_STAGING_ENV.replace(
            "STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived",
            "STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging",
        )
        result = run_preflight(
            {
                ".env.staging.local": invalid_env,
                "apps/app-api/.dev.vars": "EXECUTION_GATEWAY_SHARED_SECRET=worker-secret\n",
            },
            env={"CLOUDFLARE_API_TOKEN": "cf-token"},
        )

        self.assertNotEqual(result.returncode, 0)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["status"], "blocked")
        self.assertIn("STAGING_INGESTION_OBJECT_STORE_PROFILE", payload["blockers"])

    def test_rejects_invalid_cutover_contract_values(self) -> None:
        invalid_env = (
            VALID_STAGING_ENV.replace(
                "EXECUTION_GATEWAY_TEMPORAL_WORKER_IDENTITY=staging:execution-gateway:001",
                "EXECUTION_GATEWAY_TEMPORAL_WORKER_IDENTITY=worker-1",
            )
            .replace(
                "STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25",
                "STAGING_INGESTION_SPARSE_MODEL=fastembed/bm25",
            )
            .replace(
                "STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging",
                "STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived",
            )
            .replace(
                "STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560",
                "STAGING_INGESTION_EMBEDDING_DIMENSIONS=1536",
            )
        )
        result = run_preflight(
            {
                ".env.staging.local": invalid_env,
                "apps/app-api/.dev.vars": "EXECUTION_GATEWAY_SHARED_SECRET=worker-secret\n",
            },
            env={"CLOUDFLARE_API_TOKEN": "cf-token"},
        )

        self.assertNotEqual(result.returncode, 0)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["status"], "blocked")
        self.assertIn("STAGING_INGESTION_OBJECT_STORE_PROFILE", payload["blockers"])
        self.assertIn("STAGING_INGESTION_EMBEDDING_DIMENSIONS", payload["blockers"])
        self.assertIn("STAGING_INGESTION_SPARSE_MODEL", payload["blockers"])
        self.assertIn("EXECUTION_GATEWAY_TEMPORAL_WORKER_IDENTITY", payload["blockers"])

    def test_rejects_retired_pg_loop_env(self) -> None:
        invalid_env = VALID_STAGING_ENV + "\nEXECUTION_GATEWAY_DURABLE_WORKER_LOOP_ENABLED=true\n"
        result = run_preflight(
            {
                ".env.staging.local": invalid_env,
                "apps/app-api/.dev.vars": "EXECUTION_GATEWAY_SHARED_SECRET=worker-secret\n",
            },
            env={"CLOUDFLARE_API_TOKEN": "cf-token"},
        )

        self.assertNotEqual(result.returncode, 0)
        payload = json.loads(result.stdout)
        self.assertIn("EXECUTION_GATEWAY_DURABLE_WORKER_LOOP_ENABLED", payload["blockers"])

    def test_rejects_invalid_observability_sink_contract(self) -> None:
        invalid_env = (
            VALID_STAGING_ENV.replace(
                "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT=https://us-east-1.aws.edge.axiom.co",
                "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT=https://us-east-1.aws.edge.axiom.co/v1/traces",
            )
            .replace(
                "OTEL_COLLECTOR_AXIOM_EVENTS_DATASET=campus-agent-runtime",
                "OTEL_COLLECTOR_AXIOM_EVENTS_DATASET=campus-agent-metrics",
            )
            .replace(
                "OTEL_COLLECTOR_SENTRY_AUTH_VALUE=sentry sentry_key=03ac022c1d762aa1882d3fdbc27915f9",
                "OTEL_COLLECTOR_SENTRY_AUTH_VALUE=Bearer sentry-token",
            )
        )
        result = run_preflight(
            {
                ".env.staging.local": invalid_env,
                "apps/app-api/.dev.vars": "EXECUTION_GATEWAY_SHARED_SECRET=worker-secret\n",
            },
            env={"CLOUDFLARE_API_TOKEN": "cf-token"},
        )

        self.assertNotEqual(result.returncode, 0)
        payload = json.loads(result.stdout)
        self.assertIn("OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT", payload["blockers"])
        self.assertIn("OTEL_COLLECTOR_AXIOM_EVENTS_DATASET", payload["blockers"])
        self.assertIn("OTEL_COLLECTOR_SENTRY_AUTH_VALUE", payload["blockers"])


if __name__ == "__main__":
    unittest.main()
