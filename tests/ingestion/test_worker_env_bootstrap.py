from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_worker.env_bootstrap import load_worker_env


class WorkerEnvBootstrapTest(unittest.TestCase):
    def test_importing_worker_env_bootstrap_stays_lightweight(self) -> None:
        code = """
import json
import sys

import campus_ingestion_worker.env_bootstrap

print(json.dumps({
    "prompt_runtime_imported": "campus_shared.prompt_runtime" in sys.modules,
    "provider_config_imported": "campus_shared.provider_config" in sys.modules,
    "ingestion_core_imported": any(
        name == "campus_ingestion_core" or name.startswith("campus_ingestion_core.")
        for name in sys.modules
    ),
}))
"""
        completed = subprocess.run(
            [sys.executable, "-c", code],
            check=True,
            capture_output=True,
            text=True,
        )

        payload = json.loads(completed.stdout)
        self.assertFalse(payload["prompt_runtime_imported"])
        self.assertFalse(payload["provider_config_imported"])
        self.assertFalse(payload["ingestion_core_imported"])

    def test_load_worker_env_prefers_current_worktree_dotenv(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / ".worktrees" / "feature-a"
            root.mkdir(parents=True)
            current_env = root / ".env"
            current_env.write_text("OCR_BASE_URL=https://current.example/api\n", encoding="utf-8")
            root_worktree = root.parent.parent
            root_worktree.mkdir(parents=True, exist_ok=True)
            (root_worktree / ".env").write_text(
                "OCR_BASE_URL=https://root.example/api\n", encoding="utf-8"
            )

            with patch.dict(os.environ, {}, clear=True):
                loaded = load_worker_env(repo_root=root)
                self.assertEqual(os.environ["OCR_BASE_URL"], "https://current.example/api")

            self.assertEqual(loaded, current_env)

    def test_load_worker_env_does_not_fall_back_to_root_worktree_dotenv(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / ".worktrees" / "feature-a"
            root.mkdir(parents=True)
            root_worktree = root.parent.parent
            root_worktree.mkdir(parents=True, exist_ok=True)
            root_env = root_worktree / ".env"
            root_env.write_text("OCR_BASE_URL=https://root.example/api\n", encoding="utf-8")

            with patch.dict(os.environ, {}, clear=True):
                loaded = load_worker_env(repo_root=root)
                self.assertNotIn("OCR_BASE_URL", os.environ)

            self.assertIsNone(loaded)

    def test_load_worker_env_does_not_override_existing_environment(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / ".worktrees" / "feature-a"
            root.mkdir(parents=True)
            root_worktree = root.parent.parent
            root_worktree.mkdir(parents=True, exist_ok=True)
            (root_worktree / ".env").write_text(
                "OCR_BASE_URL=https://root.example/api\n", encoding="utf-8"
            )

            with patch.dict(
                os.environ, {"OCR_BASE_URL": "https://runtime.example/api"}, clear=True
            ):
                loaded = load_worker_env(repo_root=root)
                self.assertEqual(os.environ["OCR_BASE_URL"], "https://runtime.example/api")

            self.assertIsNone(loaded)

    def test_load_worker_env_does_not_derive_local_app_api_callback_env_for_release_tasks(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / ".worktrees" / "feature-a"
            root.mkdir(parents=True)
            current_env = root / ".env"
            current_env.write_text(
                "APP_API_INTERNAL_SHARED_SECRET=derived-secret\n",
                encoding="utf-8",
            )

            with patch.dict(os.environ, {}, clear=True):
                loaded = load_worker_env(repo_root=root)
                self.assertEqual(loaded, current_env)
                self.assertEqual(os.environ["APP_API_INTERNAL_SHARED_SECRET"], "derived-secret")
                self.assertNotIn("INGESTION_WORKER_APP_API_BASE_URL", os.environ)
                self.assertNotIn("INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET", os.environ)

    def test_load_worker_env_keeps_explicit_release_task_callback_env(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / ".worktrees" / "feature-a"
            root.mkdir(parents=True)
            current_env = root / ".env"
            current_env.write_text(
                "\n".join(
                    (
                        "APP_API_INTERNAL_SHARED_SECRET=derived-secret",
                        "INGESTION_WORKER_APP_API_BASE_URL=http://127.0.0.1:9999",
                        "INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET=explicit-secret",
                    )
                )
                + "\n",
                encoding="utf-8",
            )

            with patch.dict(os.environ, {}, clear=True):
                loaded = load_worker_env(repo_root=root)
                self.assertEqual(loaded, current_env)
                self.assertEqual(
                    os.environ["INGESTION_WORKER_APP_API_BASE_URL"],
                    "http://127.0.0.1:9999",
                )
                self.assertEqual(
                    os.environ["INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET"],
                    "explicit-secret",
                )


if __name__ == "__main__":
    unittest.main()
