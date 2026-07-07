from __future__ import annotations

import io
import json
import os
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from scripts.doctor_env import collect_env_doctor_status, main


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


class DoctorEnvEvalProjectionTest(unittest.TestCase):
    def test_collect_env_doctor_status_reports_retired_eval_surface_as_empty(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(repo_root / ".env", "UNRELATED_KEY=value\n")

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(repo_root=repo_root, surface="evals")

            self.assertTrue(status["overall_ready"])
            self.assertEqual(status["surface"], "evals")
            self.assertTrue(status["bootstrap"]["file_found"])
            self.assertEqual(status["bootstrap"]["loaded_path"], str(repo_root / ".env"))
            self.assertEqual(status["providers"], {})
            self.assertEqual(status["provider_projection"], {})
            self.assertEqual(status["settings"]["required"], {})
            self.assertEqual(status["files"], {})

    def test_collect_env_doctor_status_reports_missing_eval_env_as_ready(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            repo_root.mkdir(parents=True)

            with patch.dict(os.environ, {}, clear=True):
                status = collect_env_doctor_status(repo_root=repo_root, surface="evals")
            rendered = json.dumps(status, ensure_ascii=False)

            self.assertTrue(status["overall_ready"])
            self.assertFalse(status["bootstrap"]["file_found"])
            self.assertIsNone(status["bootstrap"]["loaded_path"])
            self.assertEqual(status["providers"], {})
            self.assertEqual(status["provider_projection"], {})
            self.assertNotIn("shared-llm-secret", rendered)
            self.assertNotIn("shared-embed-secret", rendered)
            self.assertNotIn("ragas-llm-secret", rendered)

    def test_main_supports_json_output_for_evals_surface(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            repo_root.mkdir(parents=True)

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
            self.assertEqual(payload["provider_projection"], {})


if __name__ == "__main__":
    unittest.main()
