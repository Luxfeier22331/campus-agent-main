from __future__ import annotations

import io
import json
import os
import stat
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from scripts.doctor_env import collect_env_doctor_status, main


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _write_provider_config_projection(path: Path) -> None:
    _write(
        path,
        json.dumps(
            {
                "schema_version": "provider_config_projection.v1",
                "generated_at": "2026-06-22T00:00:00Z",
                "profiles": {
                    "eval_ragas_llm": {
                        "api_key": "ragas-llm-secret",
                        "base_url": "https://ragas-llm.example/v1",
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
                        "api_key": "ragas-embedding-secret",
                        "base_url": "https://ragas-embedding.example/v1",
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
                        "api_key": "judge-llm-secret",
                        "base_url": "https://judge-llm.example/v1",
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
            }
        )
        + "\n",
    )
    path.chmod(stat.S_IRUSR | stat.S_IWUSR)


class DoctorEnvEvalProjectionTest(unittest.TestCase):
    def test_collect_env_doctor_status_reports_eval_projection_profiles(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            projection_path = repo_root / ".runtime/provider-config-projection.json"
            _write_provider_config_projection(projection_path)
            _write(
                repo_root / ".env",
                f"CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH={projection_path}\n",
            )

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(repo_root=repo_root, surface="evals")

            self.assertTrue(status["overall_ready"])
            self.assertEqual(status["surface"], "evals")
            self.assertTrue(status["bootstrap"]["file_found"])
            self.assertEqual(status["bootstrap"]["loaded_path"], str(repo_root / ".env"))
            self.assertEqual(status["providers"], {})
            projection = status["provider_projection"]
            self.assertTrue(projection["ready"])
            self.assertEqual(
                sorted(projection["profiles"]),
                ["eval_judge_llm", "eval_ragas_embedding", "eval_ragas_llm"],
            )
            self.assertEqual(
                projection["profiles"]["eval_ragas_embedding"]["dimensions"],
                2560,
            )
            self.assertTrue(projection["profiles"]["eval_ragas_llm"]["secret_configured"])

    def test_collect_env_doctor_status_reports_missing_eval_projection(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            repo_root.mkdir(parents=True)

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(repo_root=repo_root, surface="evals")
            rendered = json.dumps(status, ensure_ascii=False)

            self.assertFalse(status["overall_ready"])
            self.assertFalse(status["bootstrap"]["file_found"])
            self.assertIsNone(status["bootstrap"]["loaded_path"])
            self.assertEqual(status["providers"], {})
            self.assertFalse(status["provider_projection"]["ready"])
            self.assertIn("provider projection path", status["provider_projection"]["error"])
            self.assertNotIn("shared-llm-secret", rendered)
            self.assertNotIn("shared-embed-secret", rendered)
            self.assertNotIn("ragas-llm-secret", rendered)

    def test_main_supports_json_output_for_evals_surface(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            projection_path = repo_root / ".runtime/provider-config-projection.json"
            _write_provider_config_projection(projection_path)
            _write(
                repo_root / ".env",
                f"CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH={projection_path}\n",
            )

            buffer = io.StringIO()
            with (
                patch.dict(os.environ, {}, clear=True),
                redirect_stdout(buffer),
            ):
                exit_code = main(["evals", "--repo-root", str(repo_root), "--json"])

            payload = json.loads(buffer.getvalue())
            self.assertEqual(exit_code, 0)
            self.assertEqual(payload["surface"], "evals")
            self.assertTrue(payload["overall_ready"])
            self.assertTrue(payload["provider_projection"]["ready"])


if __name__ == "__main__":
    unittest.main()
