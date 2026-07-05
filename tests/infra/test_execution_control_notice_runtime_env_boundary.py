from __future__ import annotations

import json
import unittest

from tests.execution_control_staging_preflight_support import run_common_script_with_env

_BASE_STAGING_ENV_WITHOUT_NOTICE_OBJECT_STORE = "\n".join(
    (
        "STAGING_INGESTION_SHARED_POSTGRES_URL=postgresql://runtime@staging-db.example.com:5432/campus_agent",
        "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL=postgresql://registry@staging-registry.example.com:5432/campus_agent",
        "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL=postgresql://raw@staging-raw.example.com:5432/campus_agent",
        "STAGING_INGESTION_QDRANT_URL=https://qdrant.staging.example.com",
        "STAGING_INGESTION_QDRANT_API_KEY=qdrant-key",
        "STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY=qdrant-readonly-key",
        "STAGING_INGESTION_QDRANT_TLS_CA_CERT_PATH=/srv/docker/campus-agent/staging/qdrant/tls/ca.pem",
        "STAGING_INGESTION_EMBEDDING_BASE_URL=https://ai.gitee.com/v1",
        "STAGING_INGESTION_EMBEDDING_API_KEY=embedding-key",
        "EXECUTION_CONTROL_METRICS_BEARER_TOKEN=metrics-token",
        "EXECUTION_CONTROL_SHARED_SECRET=worker-secret",
        "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET=query-secret",
        "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL=postgresql://projection@staging-db.example.com:5432/campus_agent",
    )
)


class ExecutionControlNoticeRuntimeEnvBoundaryTest(unittest.TestCase):
    def test_closed_notice_tools_do_not_require_notice_object_store_projection(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env=_BASE_STAGING_ENV_WITHOUT_NOTICE_OBJECT_STORE,
            runtime_profile_open_tools=["public_web_search"],
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(projected["EXECUTION_CONTROL_STAGING_NOTICE_RUNTIME_REQUIRED"], "false")
        self.assertNotIn("OBJECT_STORE_ENDPOINT", projected)
        self.assertNotIn("OBJECT_STORE_DOCKER_ENDPOINT", projected)
        self.assertNotIn("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT", projected)
        self.assertNotIn("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY", projected)
        self.assertNotIn("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_SECRET_KEY", projected)
        self.assertNotIn("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET", projected)

    def test_closed_notice_tools_ignore_stale_notice_object_store_projection_inputs(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env="\n".join(
                (
                    _BASE_STAGING_ENV_WITHOUT_NOTICE_OBJECT_STORE,
                    "STAGING_INGESTION_OBJECT_STORE_ENDPOINT=http://127.0.0.1:9000",
                    "STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY=derived-access",
                    "STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY=derived-secret",
                    "STAGING_INGESTION_OBJECT_STORE_REGION=auto",
                    "STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED=campus-agent-derived-staging",
                )
            ),
            runtime_profile_open_tools=["public_web_search"],
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(projected["EXECUTION_CONTROL_STAGING_NOTICE_RUNTIME_REQUIRED"], "false")
        self.assertNotIn("OBJECT_STORE_ENDPOINT", projected)
        self.assertNotIn("OBJECT_STORE_DOCKER_ENDPOINT", projected)
        self.assertNotIn("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT", projected)
        self.assertNotIn("EXECUTION_CONTROL_STAGING_REQUIRES_LOCAL_MINIO", projected)

    def test_ingestion_registry_inputs_are_not_projected_into_serving_runtime(self) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env=_BASE_STAGING_ENV_WITHOUT_NOTICE_OBJECT_STORE,
            runtime_profile_open_tools=["public_web_search"],
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertNotIn("DOCUMENT_REGISTRY_DATABASE_URL", projected)
        self.assertNotIn("RAW_ASSET_REGISTRY_DATABASE_URL", projected)
        self.assertNotIn("DOCUMENT_REGISTRY_DOCKER_DATABASE_URL", projected)
        self.assertNotIn("RAW_ASSET_REGISTRY_DOCKER_DATABASE_URL", projected)

    def test_open_notice_tools_require_tool_read_model_without_notice_object_store_projection(
        self,
    ) -> None:
        result = run_common_script_with_env(
            repo_env="",
            staging_env=_BASE_STAGING_ENV_WITHOUT_NOTICE_OBJECT_STORE,
            runtime_profile_open_tools=["public_web_search", "campus_notice_discover"],
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(projected["EXECUTION_CONTROL_STAGING_NOTICE_RUNTIME_REQUIRED"], "false")
        self.assertEqual(
            projected["EXECUTION_CONTROL_STAGING_TOOL_READ_MODEL_RUNTIME_REQUIRED"], "true"
        )
        self.assertNotIn("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT", projected)
        self.assertNotIn("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET", projected)


if __name__ == "__main__":
    unittest.main()
