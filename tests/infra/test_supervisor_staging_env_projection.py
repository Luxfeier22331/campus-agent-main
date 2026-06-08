from __future__ import annotations

import json
import textwrap
import unittest

from tests.execution_control_staging_preflight_support import run_common_script_with_env


class SupervisorStagingEnvProjectionTest(unittest.TestCase):
    def test_staging_local_env_overrides_repo_env_for_runtime_observability(self) -> None:
        result = run_common_script_with_env(
            repo_env=textwrap.dedent(
                """
                EXECUTION_CONTROL_OTEL_ENABLED=false
                EXECUTION_CONTROL_OTEL_METRICS_ENABLED=false
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
                EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                EXECUTION_CONTROL_SHARED_SECRET=worker-secret
                EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret
                EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://durable@staging-db.example.com:5432/campus_agent
                TEMPORAL_POSTGRES_PASSWORD=temporal-password
                EXECUTION_CONTROL_OTEL_ENABLED=true
                EXECUTION_CONTROL_OTEL_METRICS_ENABLED=true
                SUPERVISOR_AGENT_WORKER_OTEL_ENABLED=true
                EXECUTION_CONTROL_TEMPORAL_ADDRESS=temporal:7233
                EXECUTION_CONTROL_TEMPORAL_NAMESPACE=campus-agent-staging
                EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE=campus-agent.workflow
                EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY=staging:execution-control:001
                EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT=workflow-salt
                EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS=5000
                OTEL_COLLECTOR_AXIOM_EVENTS_DATASET=campus-agent-runtime
                """
            ).strip(),
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(projected["EXECUTION_CONTROL_OTEL_ENABLED"], "true")
        self.assertEqual(projected["EXECUTION_CONTROL_OTEL_METRICS_ENABLED"], "true")
        self.assertEqual(projected["SUPERVISOR_AGENT_WORKER_OTEL_ENABLED"], "true")
        self.assertEqual(
            projected["OTEL_COLLECTOR_AXIOM_EVENTS_DATASET"],
            "campus-agent-runtime",
        )
        self.assertEqual(
            projected["EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL"],
            "postgresql://durable@staging-db.example.com:5432/campus_agent",
        )
        self.assertEqual(projected["EXECUTION_CONTROL_TEMPORAL_ADDRESS"], "temporal:7233")
        self.assertEqual(
            projected["EXECUTION_CONTROL_TEMPORAL_NAMESPACE"],
            "campus-agent-staging",
        )
        self.assertEqual(
            projected["EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE"], "campus-agent.workflow"
        )
        self.assertEqual(
            projected["EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY"],
            "staging:execution-control:001",
        )
        self.assertEqual(projected["EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT"], "workflow-salt")
        self.assertEqual(projected["EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS"], "5000")
        self.assertEqual(
            projected["EXECUTION_CONTROL_STAGING_COMPOSE_PROJECT_NAME"],
            "campus-execution-control-staging",
        )
        self.assertTrue(
            projected["EXECUTION_CONTROL_STAGING_RUNTIME_DIR"].endswith(
                "/.tmp/execution-control-staging"
            )
        )
        self.assertNotIn("durable-staging", projected["EXECUTION_CONTROL_STAGING_RUNTIME_DIR"])
        self.assertEqual(projected["EXECUTION_CONTROL_STAGING_HOST"], "127.0.0.1")
        self.assertEqual(projected["EXECUTION_CONTROL_STAGING_PORT"], "27051")
        self.assertNotIn("EXECUTION_CONTROL_DURABLE_WORKER_LOOP_ENABLED", projected)
        self.assertNotIn("EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_ENABLED", projected)

    def test_canonical_staging_rejects_isolated_durable_proof_topology(self) -> None:
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
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                EXECUTION_CONTROL_STAGING_COMPOSE_PROJECT_NAME=campus-execution-control-durable-staging
                EXECUTION_CONTROL_STAGING_RUNTIME_DIR=.tmp/execution-control-durable-staging
                EXECUTION_CONTROL_STAGING_PORT=27061
                EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                EXECUTION_CONTROL_SHARED_SECRET=worker-secret
                EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret
                EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://durable@staging-db.example.com:5432/campus_agent
                TEMPORAL_POSTGRES_PASSWORD=temporal-password
                EXECUTION_CONTROL_TEMPORAL_ADDRESS=temporal:7233
                EXECUTION_CONTROL_TEMPORAL_NAMESPACE=campus-agent-staging
                EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE=campus-agent.workflow
                EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY=staging:execution-control:001
                EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT=workflow-salt
                EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS=5000
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "Canonical execution-control staging compose project must be campus-execution-control-staging",
            result.stderr,
        )

    def test_canonical_staging_rejects_non_loopback_execution_control_host(self) -> None:
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
                STAGING_INGESTION_SPARSE_MODEL=qdrant/bm25
                STAGING_INGESTION_SPARSE_TOKENIZER=multilingual
                STAGING_INGESTION_SPARSE_LANGUAGE=none
                EXECUTION_CONTROL_STAGING_HOST=0.0.0.0
                EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                EXECUTION_CONTROL_SHARED_SECRET=worker-secret
                EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret
                EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://durable@staging-db.example.com:5432/campus_agent
                TEMPORAL_POSTGRES_PASSWORD=temporal-password
                EXECUTION_CONTROL_TEMPORAL_ADDRESS=temporal:7233
                EXECUTION_CONTROL_TEMPORAL_NAMESPACE=campus-agent-staging
                EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE=campus-agent.workflow
                EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY=staging:execution-control:001
                EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT=workflow-salt
                EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS=5000
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "Canonical execution-control staging host must be 127.0.0.1",
            result.stderr,
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
                EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token
                EXECUTION_CONTROL_STAGING_UV_BIN=/opt/campus/bin/uv
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                EXECUTION_CONTROL_SHARED_SECRET=worker-secret
                EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret
                EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://durable@staging-db.example.com:5432/campus_agent
                TEMPORAL_POSTGRES_PASSWORD=temporal-password
                EXECUTION_CONTROL_TEMPORAL_ADDRESS=temporal:7233
                EXECUTION_CONTROL_TEMPORAL_NAMESPACE=campus-agent-staging
                EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE=campus-agent.workflow
                EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY=staging:execution-control:001
                EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT=workflow-salt
                EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS=5000
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
            projected["EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT"],
            "https://s3.staging.example.com",
        )
        self.assertEqual(
            projected["EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY"],
            "derived-access",
        )
        self.assertEqual(
            projected["EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_SECRET_KEY"],
            "derived-secret",
        )
        self.assertEqual(projected["EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_REGION"], "auto")
        self.assertEqual(
            projected["EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET"],
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
        self.assertEqual(projected["EXECUTION_CONTROL_STAGING_DATA_PLANE_ERRORS"], "")

    def test_staging_runtime_requires_explicit_run_projection_store_database_url(self) -> None:
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
                EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                EXECUTION_CONTROL_SHARED_SECRET=worker-secret
                EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL is required",
            result.stderr,
        )

    def test_staging_runtime_rejects_retired_durable_recovery_loop(
        self,
    ) -> None:
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
                EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                EXECUTION_CONTROL_SHARED_SECRET=worker-secret
                EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret
                EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://durable@staging-db.example.com:5432/campus_agent
                EXECUTION_CONTROL_TEMPORAL_ADDRESS=temporal:7233
                EXECUTION_CONTROL_TEMPORAL_NAMESPACE=campus-agent-staging
                EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE=campus-agent.workflow
                EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY=staging:execution-control:001
                EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT=workflow-salt
                EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS=5000
                EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_ENABLED=true
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn(
            "EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_ENABLED is retired",
            result.stderr,
        )

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
                EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                EXECUTION_CONTROL_SHARED_SECRET=worker-secret
                EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret
                EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://runtime:secret@127.0.0.1:5432/campus_agent
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("execution-control staging data-plane env is invalid", result.stderr)
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
                EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                EXECUTION_CONTROL_SHARED_SECRET=worker-secret
                EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret
                EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://durable@staging-db.example.com:5432/campus_agent
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("execution-control staging data-plane env is invalid", result.stderr)
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
                EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token
                SUPERVISOR_AGENT_WORKER_SHARED_SECRET=bridge-secret
                EXECUTION_CONTROL_SHARED_SECRET=worker-secret
                EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret
                EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://durable@staging-db.example.com:5432/campus_agent
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("execution-control staging data-plane env is invalid", result.stderr)
        self.assertIn("STAGING_INGESTION_EMBEDDING_PROVIDER is required", result.stderr)
        self.assertIn("STAGING_INGESTION_EMBEDDING_API_KEY is required", result.stderr)
        self.assertIn("STAGING_INGESTION_SPARSE_PROVIDER is required", result.stderr)
        self.assertIn("STAGING_INGESTION_SPARSE_MODEL is required", result.stderr)

if __name__ == "__main__":
    unittest.main()
