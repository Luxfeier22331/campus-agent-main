from __future__ import annotations

import unittest
from pathlib import Path

ROOT_ENV_EXAMPLE = Path(__file__).resolve().parents[1] / ".env.example"


class RootEnvOwnershipTest(unittest.TestCase):
    def test_root_env_example_owns_shared_postgres_and_local_provider_seed_inputs(self) -> None:
        entries = [
            line.split("=", 1)[0]
            for line in ROOT_ENV_EXAMPLE.read_text(encoding="utf-8").splitlines()
            if line and not line.startswith("#") and "=" in line
        ]

        self.assertEqual(
            entries,
            [
                "CAMPUS_SHARED_POSTGRES_URL",
                "CAMPUS_SHARED_POSTGRES_OPERATOR_URL",
                "LLM_BASE_URL",
                "LLM_API_KEY",
                "LLM_MODEL",
                "RAG_SYNTHESIS_MODEL",
                "EMBEDDING_BASE_URL",
                "EMBEDDING_API_KEY",
                "EMBEDDING_MODEL",
                "EMBEDDING_DIMENSIONS",
                "RERANK_BASE_URL",
                "RERANK_API_KEY",
                "RERANK_MODEL",
                "RERANK_PATH",
            ],
        )

    def test_root_env_example_does_not_own_domain_multimodal_env(self) -> None:
        rendered = ROOT_ENV_EXAMPLE.read_text(encoding="utf-8")

        self.assertNotIn("INTERNAL_NOTICE_MULTIMODAL_", rendered)
        self.assertNotIn("CURRICULUM_COURSE_MAP_MULTIMODAL_", rendered)
        self.assertNotIn("HANDBOOK_SERVICE_NAVIGATION_", rendered)

    def test_root_env_example_does_not_own_self_hosted_qdrant_env(self) -> None:
        rendered = ROOT_ENV_EXAMPLE.read_text(encoding="utf-8")

        self.assertNotIn("QDRANT_URL=", rendered)
        self.assertNotIn("QDRANT_API_KEY=", rendered)
        self.assertNotIn("QDRANT_READ_ONLY_API_KEY=", rendered)


if __name__ == "__main__":
    unittest.main()
