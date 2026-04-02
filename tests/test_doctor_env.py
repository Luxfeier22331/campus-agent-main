from __future__ import annotations

import io
import json
import os
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from scripts.doctor_env import collect_env_doctor_status, main


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


class DoctorEnvTest(unittest.TestCase):
    def test_collect_env_doctor_status_reports_eval_surface_bootstrap_and_checked_keys(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "LLM_API_KEY=shared-llm-secret",
                        "EMBEDDING_API_KEY=shared-embed-secret",
                        "EVAL_RAGAS_MODEL=gpt-5.4",
                    ]
                )
                + "\n",
            )

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(repo_root=repo_root, surface="evals")

            self.assertTrue(status["overall_ready"])
            self.assertEqual(status["surface"], "evals")
            self.assertTrue(status["bootstrap"]["file_found"])
            self.assertEqual(status["bootstrap"]["loaded_path"], str(repo_root / ".env"))
            self.assertEqual(
                status["providers"]["llm"]["checked_keys"],
                ["EVAL_LLM_API_KEY", "LLM_API_KEY"],
            )
            self.assertEqual(
                status["providers"]["embedding"]["checked_keys"],
                ["EVAL_EMBEDDING_API_KEY", "EMBEDDING_API_KEY"],
            )
            self.assertEqual(status["providers"]["llm"]["resolved_key"], "LLM_API_KEY")
            self.assertEqual(status["providers"]["embedding"]["resolved_key"], "EMBEDDING_API_KEY")

    def test_collect_env_doctor_status_reports_missing_bootstrap_and_never_leaks_secret_values(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            repo_root.mkdir(parents=True)

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(repo_root=repo_root, surface="evals")
            rendered = json.dumps(status, ensure_ascii=False)

            self.assertFalse(status["overall_ready"])
            self.assertFalse(status["bootstrap"]["file_found"])
            self.assertIsNone(status["bootstrap"]["loaded_path"])
            self.assertFalse(status["providers"]["llm"]["present"])
            self.assertFalse(status["providers"]["embedding"]["present"])
            self.assertIn("EVAL_LLM_API_KEY", status["providers"]["llm"]["error"])
            self.assertIn("EMBEDDING_API_KEY", status["providers"]["embedding"]["error"])
            self.assertNotIn("shared-llm-secret", rendered)
            self.assertNotIn("shared-embed-secret", rendered)

    def test_main_supports_json_output_for_evals_surface(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "\n".join(
                    [
                        "LLM_API_KEY=shared-llm-secret",
                        "EMBEDDING_API_KEY=shared-embed-secret",
                        "EVAL_RAGAS_MODEL=gpt-5.4",
                    ]
                )
                + "\n",
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


if __name__ == "__main__":
    unittest.main()
