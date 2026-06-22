from __future__ import annotations

import json
import os
import stat
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.provider_projection import (
    ProviderProjectionError,
    load_provider_projection,
    load_provider_projection_from_env,
    provider_projection_status,
)


def write_projection(path: Path) -> None:
    path.write_text(
        json.dumps(
            {
                "schema_version": "provider_config_projection.v1",
                "generated_at": "2026-06-22T00:00:00Z",
                "profiles": {
                    "eval_ragas_llm": {
                        "api_key": "ragas-llm-key",
                        "base_url": "https://llm.example/v1",
                        "kind": "prompt",
                        "model": "gpt-5.4",
                        "profile_id": "provider_profile_eval_ragas_llm",
                        "provider": "openai",
                        "revision": 3,
                        "role": "eval_ragas_llm",
                        "timeout_ms": 30000,
                        "transport": "responses",
                    },
                    "eval_ragas_embedding": {
                        "api_key": "embedding-key",
                        "base_url": "https://embedding.example/v1",
                        "dimensions": 2560,
                        "kind": "embedding",
                        "model": "Qwen3-Embedding-4B",
                        "profile_id": "provider_profile_eval_ragas_embedding",
                        "provider": "openai-compatible",
                        "revision": 4,
                        "role": "eval_ragas_embedding",
                        "timeout_ms": 30000,
                        "transport": "embeddings",
                    },
                    "eval_judge_llm": {
                        "api_key": "judge-key",
                        "base_url": "https://judge.example/v1",
                        "kind": "prompt",
                        "model": "gpt-5.4",
                        "profile_id": "provider_profile_eval_judge_llm",
                        "provider": "openai",
                        "revision": 5,
                        "role": "eval_judge_llm",
                        "timeout_ms": 30000,
                        "transport": "responses",
                    },
                },
            },
            ensure_ascii=True,
        ),
        encoding="utf-8",
    )
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)


class ProviderProjectionTest(unittest.TestCase):
    def test_loads_projection_profiles_without_leaking_secrets_in_errors(self) -> None:
        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "provider-projection.json"
            write_projection(path)

            projection = load_provider_projection(path)

            self.assertEqual(projection.profile("eval_ragas_llm").api_key, "ragas-llm-key")
            self.assertEqual(projection.profile("eval_ragas_embedding").dimensions, 2560)
            with self.assertRaises(ProviderProjectionError) as raised:
                projection.profile("missing_role")
            self.assertIn("missing_role", str(raised.exception))
            self.assertNotIn("ragas-llm-key", str(raised.exception))

    def test_status_fails_closed_for_insecure_file_permissions(self) -> None:
        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "provider-projection.json"
            write_projection(path)
            os.chmod(path, stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP)

            status = provider_projection_status(path, required_roles=("eval_ragas_llm",))

            self.assertFalse(status["ready"])
            self.assertEqual(status["error_code"], "projection_file_permissions")
            self.assertNotIn("ragas-llm-key", json.dumps(status))

    def test_env_path_accepts_canonical_and_execution_control_alias_only(self) -> None:
        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "provider-projection.json"
            write_projection(path)

            canonical = load_provider_projection_from_env(
                {"CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH": str(path)}
            )
            execution_alias = load_provider_projection_from_env(
                {"EXECUTION_CONTROL_PROVIDER_CONFIG_SNAPSHOT_PATH": str(path)}
            )

            self.assertEqual(canonical.profile("eval_ragas_llm").api_key, "ragas-llm-key")
            self.assertEqual(
                execution_alias.profile("eval_judge_llm").api_key,
                "judge-key",
            )
            with self.assertRaisesRegex(ProviderProjectionError, "CAMPUS_PROVIDER_CONFIG"):
                load_provider_projection_from_env({"EVAL_PROVIDER_CONFIG_SNAPSHOT_PATH": str(path)})


if __name__ == "__main__":
    unittest.main()
