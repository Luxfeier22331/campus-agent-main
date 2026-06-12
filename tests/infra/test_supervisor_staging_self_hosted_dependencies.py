from __future__ import annotations

import json
import textwrap
import unittest

from tests.execution_control_staging_preflight_support import run_common_script_with_env


class SupervisorStagingSelfHostedDependenciesTest(unittest.TestCase):
    def test_staging_runtime_projects_same_host_self_hosted_data_plane_to_service_dns(
        self,
    ) -> None:
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

                STAGING_INGESTION_QDRANT_URL=https://127.0.0.1:6333
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY=qdrant-readonly-key
                STAGING_INGESTION_QDRANT_TLS_CA_CERT_PATH=/srv/docker/campus-agent/staging/qdrant/tls/ca.pem
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
                EXECUTION_CONTROL_SHARED_SECRET=worker-secret
                EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret
                EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://runtime:secret@127.0.0.1:5432/campus_agent
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
            "postgresql://runtime:secret@campus-agent-postgres:5432/campus_agent",
        )
        self.assertEqual(
            projected["DOCUMENT_REGISTRY_DOCKER_DATABASE_URL"],
            "postgresql://runtime:secret@campus-agent-postgres:5432/campus_agent",
        )
        self.assertEqual(
            projected["RAW_ASSET_REGISTRY_DOCKER_DATABASE_URL"],
            "postgresql://runtime:secret@campus-agent-postgres:5432/campus_agent",
        )
        self.assertEqual(projected["OBJECT_STORE_ENDPOINT"], "http://localhost:9000")
        self.assertEqual(projected["OBJECT_STORE_DOCKER_ENDPOINT"], "http://minio:9000")
        self.assertEqual(
            projected["EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT"],
            "http://minio:9000",
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
        self.assertEqual(projected["QDRANT_URL"], "https://127.0.0.1:6333")
        self.assertEqual(projected["QDRANT_DOCKER_URL"], "https://qdrant:6333")
        self.assertEqual(projected["QDRANT_QUERY_API_KEY"], "qdrant-readonly-key")
        self.assertEqual(
            projected["QDRANT_TLS_CA_CERT_PATH"],
            "/srv/docker/campus-agent/staging/qdrant/tls/ca.pem",
        )
        self.assertEqual(projected["EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_DB"], "campus_agent")
        self.assertEqual(projected["EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_USER"], "runtime")
        self.assertEqual(projected["EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_PORT"], "5432")
        self.assertEqual(
            projected["EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL"],
            "postgresql://runtime:secret@127.0.0.1:5432/campus_agent",
        )
        self.assertEqual(
            projected["EXECUTION_CONTROL_RUN_PROJECTION_DOCKER_DATABASE_URL"],
            "postgresql://runtime:secret@campus-agent-postgres:5432/campus_agent",
        )
        self.assertEqual(
            projected["EXECUTION_CONTROL_STAGING_LOCAL_MINIO_ACCESS_KEY"],
            "derived-access",
        )
        self.assertEqual(projected["EXECUTION_CONTROL_STAGING_DATA_PLANE_ERRORS"], "")

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

                STAGING_INGESTION_QDRANT_URL=https://127.0.0.1:6333
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY=qdrant-readonly-key
                STAGING_INGESTION_QDRANT_TLS_CA_CERT_PATH=/srv/docker/campus-agent/staging/qdrant/tls/ca.pem
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
                EXECUTION_CONTROL_SHARED_SECRET=worker-secret
                EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret
                EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://durable@staging-db.example.com:5432/campus_agent
                """
            ).strip(),
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(projected["EXECUTION_CONTROL_STAGING_REQUIRES_LOCAL_POSTGRES"], "true")
        self.assertEqual(projected["EXECUTION_CONTROL_STAGING_REQUIRES_LOCAL_MINIO"], "true")
        self.assertEqual(projected["EXECUTION_CONTROL_STAGING_REQUIRES_LOCAL_QDRANT"], "true")

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

                STAGING_INGESTION_QDRANT_URL=https://127.0.0.1:6333
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY=qdrant-readonly-key
                STAGING_INGESTION_QDRANT_TLS_CA_CERT_PATH=/srv/docker/campus-agent/staging/qdrant/tls/ca.pem
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
                EXECUTION_CONTROL_SHARED_SECRET=worker-secret
                EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret
                EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://durable@staging-db.example.com:5432/campus_agent
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

                STAGING_INGESTION_QDRANT_URL=https://127.0.0.1:6333
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY=qdrant-readonly-key
                STAGING_INGESTION_QDRANT_TLS_CA_CERT_PATH=/srv/docker/campus-agent/staging/qdrant/tls/ca.pem
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
                EXECUTION_CONTROL_SHARED_SECRET=worker-secret
                EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret
                EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://durable@staging-db.example.com:5432/campus_agent
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

                STAGING_INGESTION_QDRANT_URL=https://127.0.0.1:6333
                STAGING_INGESTION_QDRANT_API_KEY=qdrant-key
                STAGING_INGESTION_QDRANT_TLS_CA_CERT_PATH=/srv/docker/campus-agent/staging/qdrant/tls/ca.pem
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
                EXECUTION_CONTROL_SHARED_SECRET=worker-secret
                EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret
                EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://durable@staging-db.example.com:5432/campus_agent
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY is required", result.stderr)

    def test_staging_local_qdrant_dependency_rejects_http_with_api_key(self) -> None:
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
                STAGING_INGESTION_QDRANT_TLS_CA_CERT_PATH=/srv/docker/campus-agent/staging/qdrant/tls/ca.pem
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
                EXECUTION_CONTROL_SHARED_SECRET=worker-secret
                EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret
                EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://durable@staging-db.example.com:5432/campus_agent
                """
            ).strip(),
        )

        self.assertNotEqual(result.returncode, 0)
        self.assertIn("STAGING_INGESTION_QDRANT_URL must use https", result.stderr)

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
                STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY=qdrant-readonly-key
                STAGING_INGESTION_QDRANT_TLS_CA_CERT_PATH=/srv/docker/campus-agent/staging/qdrant/tls/ca.pem
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
                EXECUTION_CONTROL_SHARED_SECRET=worker-secret
                EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret
                EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://durable@staging-db.example.com:5432/campus_agent
                """
            ).strip(),
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(projected["EXECUTION_CONTROL_STAGING_REQUIRES_LOCAL_POSTGRES"], "false")
        self.assertEqual(projected["EXECUTION_CONTROL_STAGING_REQUIRES_LOCAL_MINIO"], "false")
        self.assertEqual(projected["EXECUTION_CONTROL_STAGING_REQUIRES_LOCAL_QDRANT"], "false")


if __name__ == "__main__":
    unittest.main()
