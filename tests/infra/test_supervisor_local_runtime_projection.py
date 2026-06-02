from __future__ import annotations

import json
import textwrap
import unittest

from tests.supervisor_api_staging_preflight_support import run_local_runtime_script_with_env


class SupervisorLocalRuntimeProjectionTest(unittest.TestCase):
    def test_local_supervisor_runtime_projects_loopback_data_plane_to_service_dns(self) -> None:
        result = run_local_runtime_script_with_env(
            repo_env=textwrap.dedent(
                """
                CAMPUS_SHARED_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent
                DOCUMENT_REGISTRY_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/campus_agent
                OBJECT_STORE_ENDPOINT=http://localhost:9000
                QDRANT_URL=http://127.0.0.1:6333
                EMBEDDING_PROVIDER=mock
                EMBEDDING_MODEL=Qwen3-Embedding-4B
                SPARSE_PROVIDER=mock
                """
            ).strip()
        )

        self.assertEqual(result.returncode, 0, result.stderr)
        projected = json.loads(result.stdout)
        self.assertEqual(
            projected["CAMPUS_SHARED_POSTGRES_URL"],
            "postgresql://postgres:postgres@postgres:5432/campus_agent",
        )
        self.assertEqual(
            projected["DOCUMENT_REGISTRY_DATABASE_URL"],
            "postgresql://postgres:postgres@postgres:5432/campus_agent",
        )
        self.assertEqual(projected["OBJECT_STORE_ENDPOINT"], "http://minio:9000")
        self.assertEqual(projected["QDRANT_URL"], "http://qdrant:6333")


if __name__ == "__main__":
    unittest.main()


if __name__ == "__main__":
    unittest.main()
