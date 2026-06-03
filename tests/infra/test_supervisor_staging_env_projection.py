from __future__ import annotations

import json
import textwrap
import unittest

from tests.supervisor_api_staging_preflight_support import run_common_script_with_env


class SupervisorStagingEnvProjectionTest(unittest.TestCase):
    def test_staging_local_env_overrides_repo_env_for_runtime_observability(self) -> None:
        result = run_common_script_with_env(
            repo_env=textwrap.dedent(
                """
                SUPERVISOR_API_OTEL_ENABLED=false
                SUPERVISOR_API_OTEL_METRICS_ENABLED=false
                SUPERVISOR_AGENT_WORKER_OTEL_ENABLED=false
                OTEL_COLLECTOR_AXIOM_EVENTS_DATASET=campus-agent-runtime
                """
            ).strip(),
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
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_API_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                SUPERVISOR_API_OTEL_ENABLED=true
                SUPERVISOR_API_OTEL_METRICS_ENABLED=true
                SUPERVISOR_AGENT_WORKER_OTEL_ENABLED=true
                OTEL_COLLECTOR_AXIOM_EVENTS_DATASET=campus-agent-runtime
                """
            ).strip(),
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(projected["SUPERVISOR_API_OTEL_ENABLED"], "true")
        self.assertEqual(projected["SUPERVISOR_API_OTEL_METRICS_ENABLED"], "true")
        self.assertEqual(projected["SUPERVISOR_AGENT_WORKER_OTEL_ENABLED"], "true")
        self.assertEqual(
            projected["OTEL_COLLECTOR_AXIOM_EVENTS_DATASET"],
            "campus-agent-runtime",
        )

    def test_staging_runtime_projects_explicit_data_plane_env_over_repo_local_env(self) -> None:
        result = run_common_script_with_env(
            repo_env=textwrap.dedent(
                """
                CAMPUS_SHARED_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent
                DOCUMENT_REGISTRY_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/campus_agent
                OBJECT_STORE_ENDPOINT=http://localhost:9000
                QDRANT_URL=https://root-qdrant.example.com
                EMBEDDING_PROVIDER=mock
                EMBEDDING_MODEL=root-model
                SPARSE_PROVIDER=mock
                """
            ).strip(),
            staging_env=textwrap.dedent(
                """
                STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime@staging-db.example.com:5432/campus_agent
                STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry@staging-registry.example.com:5432/campus_agent
                STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://raw-registry@staging-raw-registry.example.com:5432/campus_agent
                STAGING_INGESTION_SHARED_POSTGRES_OPERATOR_URL=postgresql://operator@staging-db.example.com:5432/campus_agent
                STAGING_INGESTION_DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL=postgresql://registry-operator@staging-registry.example.com:5432/campus_agent
                STAGING_INGESTION_RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL=postgresql://raw-registry-operator@staging-raw-registry.example.com:5432/campus_agent
                STAGING_INGESTION_OBJECT_STORE_ENDPOINT=https://s3.staging.example.com
                STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access
                STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret
                STAGING_INGESTION_OBJECT_STORE_REGION=auto
                STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging
                STAGING_INGESTION_QDRANT_URL=https://qdrant.staging.example.com
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                STAGING_INGESTION_QDRANT_TIMEOUT_SECONDS=11
                STAGING_INGESTION_EMBEDDING_PROVIDER=gitee
                STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1
                STAGING_INGESTION_EMBEDDING_API_KEY=embedding-key
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=qdrant
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_API_STAGING_UV_BIN=/opt/campus/bin/uv
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_API_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(
            projected["CAMPUS_SHARED_POSTGRES_URL"],
            "postgresql://runtime@staging-db.example.com:5432/campus_agent",
        )
        self.assertEqual(
            projected["DOCUMENT_REGISTRY_DATABASE_URL"],
            "postgresql://registry@staging-registry.example.com:5432/campus_agent",
        )
        self.assertEqual(
            projected["RAW_ASSET_REGISTRY_DATABASE_URL"],
            "postgresql://raw-registry@staging-raw-registry.example.com:5432/campus_agent",
        )
        self.assertEqual(
            projected["CAMPUS_SHARED_POSTGRES_OPERATOR_URL"],
            "postgresql://operator@staging-db.example.com:5432/campus_agent",
        )
        self.assertEqual(
            projected["DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL"],
            "postgresql://registry-operator@staging-registry.example.com:5432/campus_agent",
        )
        self.assertEqual(
            projected["RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL"],
            "postgresql://raw-registry-operator@staging-raw-registry.example.com:5432/campus_agent",
        )
        self.assertEqual(projected["OBJECT_STORE_ENDPOINT"], "https://s3.staging.example.com")
        self.assertEqual(projected["OBJECT_STORE_DERIVED_ACCESS_KEY"], "derived-access")
        self.assertEqual(projected["OBJECT_STORE_BUCKET_DERIVED"], "campus-rag-derived-staging")
        self.assertEqual(
            projected["SUPERVISOR_NOTICE_BODY_OBJECT_STORE_ENDPOINT"],
            "https://s3.staging.example.com",
        )
        self.assertEqual(
            projected["SUPERVISOR_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY"],
            "derived-access",
        )
        self.assertEqual(
            projected["SUPERVISOR_NOTICE_BODY_OBJECT_STORE_SECRET_KEY"],
            "derived-secret",
        )
        self.assertEqual(projected["SUPERVISOR_NOTICE_BODY_OBJECT_STORE_REGION"], "auto")
        self.assertEqual(
            projected["SUPERVISOR_NOTICE_BODY_OBJECT_STORE_BUCKET"],
            "campus-rag-derived-staging",
        )
        self.assertEqual(projected["QDRANT_URL"], "https://qdrant.staging.example.com")
        self.assertEqual(projected["QDRANT_TIMEOUT_SECONDS"], "11")
        self.assertEqual(projected["EMBEDDING_PROVIDER"], "gitee")
        self.assertEqual(projected["EMBEDDING_BASE_URL"], "https://ai.gitee.com/v1")
        self.assertEqual(projected["EMBEDDING_API_KEY"], "embedding-key")
        self.assertEqual(projected["EMBEDDING_MODEL"], "Qwen3-Embedding-4B")
        self.assertEqual(projected["EMBEDDING_DIMENSIONS"], "2560")
        self.assertEqual(projected["SPARSE_PROVIDER"], "qdrant")
        self.assertEqual(projected["SPARSE_MODEL"], "qdrant/bm25")
        self.assertEqual(projected["SPARSE_TOKENIZER"], "multilingual")
        self.assertEqual(projected["SPARSE_LANGUAGE"], "none")
        self.assertEqual(projected["API_WORKER_SHARED_SECRET"], "worker-secret")
        self.assertEqual(projected["SUPERVISOR_API_STAGING_DATA_PLANE_ERRORS"], "")

    def test_staging_runtime_rejects_missing_staging_embedding_api_key(self) -> None:
        result = run_common_script_with_env(
            repo_env=textwrap.dedent(
                """
                EMBEDDING_API_KEY=generic-embedding-key
                """
            ).strip(),
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
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                STAGING_INGESTION_EMBEDDING_PROVIDER=gitee
                STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=qdrant
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_API_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("supervisor-api staging data-plane env is invalid", result.stderr)
        self.assertIn("STAGING_INGESTION_EMBEDDING_API_KEY is required", result.stderr)

    def test_staging_runtime_rejects_missing_staging_sparse_contract(self) -> None:
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
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                STAGING_INGESTION_EMBEDDING_PROVIDER=gitee
                STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1
                STAGING_INGESTION_EMBEDDING_API_KEY=embedding-key
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=qdrant
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_API_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("supervisor-api staging data-plane env is invalid", result.stderr)
        self.assertIn("STAGING_INGESTION_SPARSE_MODEL is required", result.stderr)
        self.assertIn("STAGING_INGESTION_SPARSE_TOKENIZER is required", result.stderr)
        self.assertIn("STAGING_INGESTION_SPARSE_LANGUAGE is required", result.stderr)

    def test_staging_runtime_rejects_generic_embedding_and_sparse_without_staging_contract(
        self,
    ) -> None:
        result = run_common_script_with_env(
            repo_env=textwrap.dedent(
                """
                EMBEDDING_PROVIDER=gitee
                EMBEDDING_BASE_URL=https://ai.gitee.com/v1
                EMBEDDING_API_KEY=generic-embedding-key
                EMBEDDING_MODEL=Qwen3-Embedding-4B
                EMBEDDING_DIMENSIONS=2560
                SPARSE_PROVIDER=qdrant
                SPARSE_MODEL=qdrant/bm25
                SPARSE_TOKENIZER=multilingual
                SPARSE_LANGUAGE=none
                """
            ).strip(),
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
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_API_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("supervisor-api staging data-plane env is invalid", result.stderr)
        self.assertIn("STAGING_INGESTION_EMBEDDING_PROVIDER is required", result.stderr)
        self.assertIn("STAGING_INGESTION_EMBEDDING_API_KEY is required", result.stderr)
        self.assertIn("STAGING_INGESTION_SPARSE_PROVIDER is required", result.stderr)
        self.assertIn("STAGING_INGESTION_SPARSE_MODEL is required", result.stderr)

    def test_staging_runtime_projects_same_host_self_hosted_data_plane_to_service_dns(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env=textwrap.dedent(
                """
                STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime:secret@127.0.0.1:5432/campus_agent
                STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://runtime:secret@localhost:5432/campus_agent
                STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://runtime:secret@127.0.0.1:5432/campus_agent
                STAGING_INGESTION_OBJECT_STORE_ENDPOINT=http://localhost:9000
                STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access
                STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret
                STAGING_INGESTION_OBJECT_STORE_REGION=auto
                STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging
                STAGING_INGESTION_QDRANT_URL=http://127.0.0.1:6333
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY=qdrant-readonly-key
                STAGING_INGESTION_QDRANT_TIMEOUT_SECONDS=11
                STAGING_INGESTION_EMBEDDING_PROVIDER=gitee
                STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1
                STAGING_INGESTION_EMBEDDING_API_KEY=embedding-key
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=qdrant
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_API_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(
            projected["CAMPUS_SHARED_POSTGRES_URL"],
            "postgresql://runtime:secret@127.0.0.1:5432/campus_agent",
        )
        self.assertEqual(
            projected["DOCUMENT_REGISTRY_DATABASE_URL"],
            "postgresql://runtime:secret@localhost:5432/campus_agent",
        )
        self.assertEqual(
            projected["RAW_ASSET_REGISTRY_DATABASE_URL"],
            "postgresql://runtime:secret@127.0.0.1:5432/campus_agent",
        )
        self.assertEqual(
            projected["CAMPUS_SHARED_POSTGRES_DOCKER_URL"],
            "postgresql://runtime:secret@postgres:5432/campus_agent",
        )
        self.assertEqual(
            projected["DOCUMENT_REGISTRY_DOCKER_DATABASE_URL"],
            "postgresql://runtime:secret@postgres:5432/campus_agent",
        )
        self.assertEqual(
            projected["RAW_ASSET_REGISTRY_DOCKER_DATABASE_URL"],
            "postgresql://runtime:secret@postgres:5432/campus_agent",
        )
        self.assertEqual(projected["OBJECT_STORE_ENDPOINT"], "http://localhost:9000")
        self.assertEqual(projected["OBJECT_STORE_DOCKER_ENDPOINT"], "http://minio:9000")
        self.assertEqual(
            projected["SUPERVISOR_NOTICE_BODY_OBJECT_STORE_ENDPOINT"],
            "http://minio:9000",
        )
        self.assertEqual(
            projected["SUPERVISOR_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY"],
            "derived-access",
        )
        self.assertEqual(
            projected["SUPERVISOR_NOTICE_BODY_OBJECT_STORE_SECRET_KEY"],
            "derived-secret",
        )
        self.assertEqual(projected["SUPERVISOR_NOTICE_BODY_OBJECT_STORE_REGION"], "auto")
        self.assertEqual(
            projected["SUPERVISOR_NOTICE_BODY_OBJECT_STORE_BUCKET"],
            "campus-rag-derived-staging",
        )
        self.assertEqual(projected["QDRANT_URL"], "http://127.0.0.1:6333")
        self.assertEqual(projected["QDRANT_DOCKER_URL"], "http://qdrant:6333")
        self.assertEqual(projected["SUPERVISOR_API_STAGING_LOCAL_POSTGRES_DB"], "campus_agent")
        self.assertEqual(projected["SUPERVISOR_API_STAGING_LOCAL_POSTGRES_USER"], "runtime")
        self.assertEqual(projected["SUPERVISOR_API_STAGING_LOCAL_POSTGRES_PORT"], "5432")
        self.assertEqual(
            projected["SUPERVISOR_API_STAGING_LOCAL_MINIO_ACCESS_KEY"],
            "derived-access",
        )
        self.assertEqual(projected["SUPERVISOR_API_STAGING_DATA_PLANE_ERRORS"], "")

    def test_staging_self_hosted_dependency_detection_uses_host_side_endpoints(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env=textwrap.dedent(
                """
                STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime:secret@127.0.0.1:5432/campus_agent
                STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://runtime:secret@localhost:5432/campus_agent
                STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://runtime:secret@127.0.0.1:5432/campus_agent
                STAGING_INGESTION_OBJECT_STORE_ENDPOINT=http://localhost:9000
                STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access
                STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret
                STAGING_INGESTION_OBJECT_STORE_REGION=auto
                STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging
                STAGING_INGESTION_QDRANT_URL=http://127.0.0.1:6333
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY=qdrant-readonly-key
                STAGING_INGESTION_QDRANT_TIMEOUT_SECONDS=11
                STAGING_INGESTION_EMBEDDING_PROVIDER=gitee
                STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1
                STAGING_INGESTION_EMBEDDING_API_KEY=embedding-key
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=qdrant
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_API_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(projected["SUPERVISOR_API_STAGING_REQUIRES_LOCAL_POSTGRES"], "true")
        self.assertEqual(projected["SUPERVISOR_API_STAGING_REQUIRES_LOCAL_MINIO"], "true")
        self.assertEqual(projected["SUPERVISOR_API_STAGING_REQUIRES_LOCAL_QDRANT"], "true")

    def test_staging_local_postgres_dependency_rejects_mixed_single_node_credentials(
        self,
    ) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env=textwrap.dedent(
                """
                STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime:secret@127.0.0.1:5432/campus_agent
                STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry:secret@localhost:5432/campus_agent
                STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://runtime:secret@127.0.0.1:5432/campus_agent
                STAGING_INGESTION_OBJECT_STORE_ENDPOINT=http://localhost:9000
                STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access
                STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret
                STAGING_INGESTION_OBJECT_STORE_REGION=auto
                STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging
                STAGING_INGESTION_QDRANT_URL=http://127.0.0.1:6333
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY=qdrant-readonly-key
                STAGING_INGESTION_EMBEDDING_PROVIDER=gitee
                STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1
                STAGING_INGESTION_EMBEDDING_API_KEY=embedding-key
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=qdrant
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_API_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("repo-owned local Postgres uses one database/user/password", result.stderr)

    def test_staging_local_minio_dependency_rejects_split_credentials(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env=textwrap.dedent(
                """
                STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime:secret@127.0.0.1:5432/campus_agent
                STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://runtime:secret@localhost:5432/campus_agent
                STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://runtime:secret@127.0.0.1:5432/campus_agent
                STAGING_INGESTION_OBJECT_STORE_ENDPOINT=http://localhost:9000
                STAGING_INGESTION_OBJECT_STORE_ACCESS_KEY=shared-access
                STAGING_INGESTION_OBJECT_STORE_SECRET_KEY=shared-secret
                STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access
                STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret
                STAGING_INGESTION_OBJECT_STORE_REGION=auto
                STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived-staging
                STAGING_INGESTION_QDRANT_URL=http://127.0.0.1:6333
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY=qdrant-readonly-key
                STAGING_INGESTION_EMBEDDING_PROVIDER=gitee
                STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1
                STAGING_INGESTION_EMBEDDING_API_KEY=embedding-key
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=qdrant
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_API_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("repo-owned local MinIO uses one credential pair", result.stderr)

    def test_staging_local_qdrant_dependency_requires_read_only_key(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env=textwrap.dedent(
                """
                STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime:secret@127.0.0.1:5432/campus_agent
                STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://runtime:secret@localhost:5432/campus_agent
                STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://runtime:secret@127.0.0.1:5432/campus_agent
                STAGING_INGESTION_OBJECT_STORE_ENDPOINT=http://localhost:9000
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
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_API_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY is required", result.stderr)

    def test_staging_external_dependency_detection_does_not_force_local_compose(self) -> None:
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
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                STAGING_INGESTION_QDRANT_TIMEOUT_SECONDS=11
                STAGING_INGESTION_EMBEDDING_PROVIDER=gitee
                STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1
                STAGING_INGESTION_EMBEDDING_API_KEY=embedding-key
                STAGING_INGESTION_EMBEDDING_MODEL=Qwen3-Embedding-4B
                STAGING_INGESTION_EMBEDDING_DIMENSIONS=2560
                STAGING_INGESTION_SPARSE_PROVIDER=qdrant
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                SUPERVISOR_API_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_API_STAGING_TUNNEL_TOKEN=tunnel-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                SUPERVISOR_API_SHARED_SECRET=worker-secret
                SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(projected["SUPERVISOR_API_STAGING_REQUIRES_LOCAL_POSTGRES"], "false")
        self.assertEqual(projected["SUPERVISOR_API_STAGING_REQUIRES_LOCAL_MINIO"], "false")
        self.assertEqual(projected["SUPERVISOR_API_STAGING_REQUIRES_LOCAL_QDRANT"], "false")


if __name__ == "__main__":
    unittest.main()
