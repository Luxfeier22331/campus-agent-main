from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_ragas_runner.provider_config import load_provider_profiles


def provider_config_payload() -> dict[str, object]:
    return {
        "profiles": {
            "eval_judge_llm": {
                "api_key": "judge-key",
                "base_url": "https://provider.example/v1",
                "model": "judge-model",
                "timeout_ms": 120_001,
            },
            "eval_ragas_embedding": {
                "api_key": "embedding-key",
                "base_url": "https://embedding.example/v1",
                "model": "embedding-model",
                "timeout_ms": 180_000,
            },
            "eval_ragas_llm": {
                "api_key": "ragas-key",
                "base_url": "https://provider.example/v1",
                "model": "ragas-model",
                "timeout_ms": 150_000,
            },
        },
    }


class ProviderConfigTest(unittest.TestCase):
    def test_loads_provider_profiles_for_required_roles(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            path = Path(raw_dir) / "provider-config.json"
            path.write_text(json.dumps(provider_config_payload()), encoding="utf-8")

            profiles = load_provider_profiles(
                path,
                required_roles=("eval_ragas_llm", "eval_ragas_embedding"),
            )

            self.assertEqual(profiles["eval_ragas_llm"].model, "ragas-model")
            self.assertEqual(profiles["eval_ragas_embedding"].api_key, "embedding-key")
            self.assertEqual(profiles["eval_judge_llm"].timeout_seconds, 121)

    def test_rejects_top_level_fields(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            path = Path(raw_dir) / "provider-config.json"
            path.write_text(
                json.dumps({"profiles": {}, "schema_version": "retired"}),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "unsupported fields: schema_version"):
                load_provider_profiles(path)

    def test_rejects_unknown_profiles_and_fields(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            path = Path(raw_dir) / "provider-config.json"
            payload = provider_config_payload()
            profiles = payload["profiles"]
            assert isinstance(profiles, dict)
            profiles["legacy_runner"] = {}
            path.write_text(json.dumps(payload), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "unsupported profiles: legacy_runner"):
                load_provider_profiles(path)

            del profiles["legacy_runner"]
            ragas = profiles["eval_ragas_llm"]
            assert isinstance(ragas, dict)
            ragas["legacy_field"] = "forbidden"
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unsupported fields: legacy_field"):
                load_provider_profiles(path)

    def test_requires_roles_requested_by_the_command(self) -> None:
        with tempfile.TemporaryDirectory() as raw_dir:
            path = Path(raw_dir) / "provider-config.json"
            payload = provider_config_payload()
            profiles = payload["profiles"]
            assert isinstance(profiles, dict)
            del profiles["eval_ragas_embedding"]
            path.write_text(json.dumps(payload), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "eval_ragas_embedding is required"):
                load_provider_profiles(path, required_roles=("eval_ragas_embedding",))


if __name__ == "__main__":
    unittest.main()
