from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from campus_ragas_runner.agent_score_batch import RagasAgentRunnerSettings
from campus_ragas_runner.score_batch import RagasRunnerSettings


class RuntimeConfigTest(unittest.TestCase):
    def test_rag_settings_require_runtime_config_even_when_legacy_env_exists(self) -> None:
        with (
            patch.dict(
                os.environ,
                {
                    "RAGAS_LLM_API_KEY": "legacy-key",
                    "RAGAS_LLM_MODEL": "legacy-model",
                    "RAGAS_EMBEDDING_API_KEY": "legacy-embedding-key",
                    "RAGAS_EMBEDDING_MODEL": "legacy-embedding-model",
                },
            ),
            self.assertRaisesRegex(ValueError, "--runtime-config is required"),
        ):
            RagasRunnerSettings.from_sources()

    def test_loads_rag_and_agent_settings_only_from_typed_runtime_config(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "runtime.json"
            path.write_text(
                json.dumps(
                    {
                        "schema_version": "ragas_runner_config.v1",
                        "llm_api_key": "runtime-key",
                        "llm_model": "runtime-model",
                        "llm_base_url": "https://provider.example/v1",
                        "embedding_api_key": "embedding-key",
                        "embedding_model": "embedding-model",
                        "embedding_base_url": "https://embedding.example/v1",
                        "timeout_seconds": 42,
                    }
                ),
                encoding="utf-8",
            )

            rag = RagasRunnerSettings.from_sources(runtime_config_path=path)
            agent = RagasAgentRunnerSettings.from_sources(runtime_config_path=path)

            self.assertEqual(rag.llm_api_key, "runtime-key")
            self.assertEqual(rag.embedding_api_key, "embedding-key")
            self.assertEqual(rag.timeout_seconds, 42)
            self.assertEqual(agent.llm_api_key, "runtime-key")
            self.assertEqual(agent.timeout_seconds, 42)

    def test_rejects_unknown_runtime_config_fields(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "runtime.json"
            path.write_text(
                json.dumps(
                    {
                        "schema_version": "ragas_runner_config.v1",
                        "llm_api_key": "runtime-key",
                        "legacy_provider_env": "forbidden",
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(ValueError, "unsupported fields: legacy_provider_env"):
                RagasAgentRunnerSettings.from_sources(runtime_config_path=path)


if __name__ == "__main__":
    unittest.main()
