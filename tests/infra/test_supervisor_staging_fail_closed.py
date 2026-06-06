from __future__ import annotations

import textwrap
import unittest

from tests.execution_control_staging_preflight_support import run_common_script_with_env


class SupervisorStagingFailClosedTest(unittest.TestCase):
    def test_staging_runtime_rejects_missing_worker_shared_secret(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            app_api_dev_vars="APP_API_INTERNAL_SHARED_SECRET=app-internal-secret\nSUPERVISOR_AGENT_WORKER_BASE_URL=http://127.0.0.1:27052\n",
            staging_env=textwrap.dedent(
                """
                STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime@staging-db.example.com:5432/campus_agent
                STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry@staging-registry.example.com:5432/campus_agent
                STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://raw-registry@staging-raw-registry.example.com:5432/campus_agent
                STAGING_INGESTION_OBJECT_STORE_ENDPOINT=https://s3.staging.example.com
                STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access
                STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret
                STAGING_INGESTION_OBJECT_STORE_REGION=auto
                STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging
                STAGING_INGESTION_QDRANT_URL=http://127.0.0.1:6333
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                STAGING_INGESTION_EMBEDDING_PROVIDER=gitee
                STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1
                STAGING_INGESTION_EMBEDDING_API_KEY=embedding-key
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=qdrant
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token
                EXECUTION_CONTROL_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                EXECUTION_CONTROL_DURABLE_RUNTIME_DATABASE_URL=postgresql://durable@staging-db.example.com:5432/campus_agent
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("API_WORKER_SHARED_SECRET is required", result.stderr)

    def test_staging_runtime_rejects_repo_local_data_plane_without_explicit_staging_env(
        self,
    ) -> None:
        result = run_common_script_with_env(
            repo_env=textwrap.dedent(
                """
                CAMPUS_SHARED_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent
                DOCUMENT_REGISTRY_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/campus_agent
                OBJECT_STORE_ENDPOINT=http://localhost:9000
                QDRANT_URL=https://root-qdrant.example.com
                """
            ).strip(),
            staging_env=textwrap.dedent(
                """
                EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token
                EXECUTION_CONTROL_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                EXECUTION_CONTROL_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                EXECUTION_CONTROL_DURABLE_RUNTIME_DATABASE_URL=postgresql://durable@staging-db.example.com:5432/campus_agent
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("execution-control staging data-plane env is invalid", result.stderr)
        self.assertIn("STAGING_INGESTION_SHARED_POSTGRES_URL is required", result.stderr)
        self.assertIn(
            "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL is required",
            result.stderr,
        )
        self.assertIn(
            "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL is required",
            result.stderr,
        )
        self.assertIn("STAGING_INGESTION_OBJECT_STORE_ENDPOINT is required", result.stderr)
        self.assertIn(
            "STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED is required",
            result.stderr,
        )
        self.assertIn("STAGING_INGESTION_QDRANT_URL is required", result.stderr)

    def test_staging_runtime_rejects_supabase_pooler_without_sslmode_require(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env=textwrap.dedent(
                """
                STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://postgres.project:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
                STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://postgres.project:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
                STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://postgres.project:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
                STAGING_INGESTION_OBJECT_STORE_ENDPOINT=https://s3.staging.example.com
                STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access
                STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret
                STAGING_INGESTION_OBJECT_STORE_REGION=auto
                STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging
                STAGING_INGESTION_QDRANT_URL=https://qdrant.staging.example.com
                STAGING_INGESTION_EMBEDDING_PROVIDER=gitee
                STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1
                STAGING_INGESTION_EMBEDDING_API_KEY=embedding-key
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=qdrant
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token
                EXECUTION_CONTROL_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                EXECUTION_CONTROL_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                EXECUTION_CONTROL_DURABLE_RUNTIME_DATABASE_URL=postgresql://durable@staging-db.example.com:5432/campus_agent
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("execution-control staging data-plane env is invalid", result.stderr)
        self.assertIn(
            "STAGING_INGESTION_SHARED_POSTGRES_URL must include sslmode=require",
            result.stderr,
        )
        self.assertIn(
            "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL must include sslmode=require",
            result.stderr,
        )
        self.assertIn(
            "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL must include sslmode=require",
            result.stderr,
        )

    def test_staging_runtime_rejects_legacy_registry_collection_names(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env=textwrap.dedent(
                """
                STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime@staging-db.example.com:5432/campus_agent
                STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry@staging-registry.example.com:5432/campus_agent
                STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://raw-registry@staging-raw-registry.example.com:5432/campus_agent
                STAGING_INGESTION_OBJECT_STORE_ENDPOINT=https://s3.staging.example.com
                STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access
                STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret
                STAGING_INGESTION_OBJECT_STORE_REGION=auto
                STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging
                STAGING_INGESTION_QDRANT_URL=https://qdrant.staging.example.com
                STAGING_INGESTION_EMBEDDING_PROVIDER=gitee
                STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1
                STAGING_INGESTION_EMBEDDING_API_KEY=embedding-key
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=qdrant
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token
                EXECUTION_CONTROL_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                EXECUTION_CONTROL_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                EXECUTION_CONTROL_DURABLE_RUNTIME_DATABASE_URL=postgresql://durable@staging-db.example.com:5432/campus_agent
                """
            ).strip(),
            registry_audit_payload="legacy",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "execution-control staging registry collection rename is incomplete", result.stderr
        )
        self.assertIn("student_handbook -> student_rules", result.stderr)
        self.assertIn("legacy rows remain", result.stderr)

    def test_staging_runtime_rejects_not_ready_rag_runtime(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env=textwrap.dedent(
                """
                STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime@staging-db.example.com:5432/campus_agent
                STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry@staging-registry.example.com:5432/campus_agent
                STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://raw-registry@staging-raw-registry.example.com:5432/campus_agent
                STAGING_INGESTION_OBJECT_STORE_ENDPOINT=https://s3.staging.example.com
                STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access
                STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret
                STAGING_INGESTION_OBJECT_STORE_REGION=auto
                STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging
                STAGING_INGESTION_QDRANT_URL=https://qdrant.staging.example.com
                STAGING_INGESTION_EMBEDDING_PROVIDER=gitee
                STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1
                STAGING_INGESTION_EMBEDDING_API_KEY=embedding-key
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=qdrant
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token
                EXECUTION_CONTROL_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                EXECUTION_CONTROL_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                EXECUTION_CONTROL_DURABLE_RUNTIME_DATABASE_URL=postgresql://durable@staging-db.example.com:5432/campus_agent
                """
            ).strip(),
            rag_runtime_payload="blocked",
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("execution-control staging RAG runtime is not ready", result.stderr)
        self.assertIn("qdrant_ready=not_ready", result.stderr)
        self.assertIn("regulations/student_rules: qdrant_endpoint_not_ready", result.stderr)


if __name__ == "__main__":
    unittest.main()
