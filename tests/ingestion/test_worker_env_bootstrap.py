from __future__ import annotations

import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from campus_ingestion_worker.env_bootstrap import load_worker_env


class WorkerEnvBootstrapTest(unittest.TestCase):
    def test_load_worker_env_prefers_current_worktree_dotenv(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / ".worktrees" / "feature-a"
            root.mkdir(parents=True)
            current_env = root / ".env"
            current_env.write_text("OCR_BASE_URL=https://current.example/api\n", encoding="utf-8")
            root_worktree = root.parent.parent
            root_worktree.mkdir(parents=True, exist_ok=True)
            (root_worktree / ".env").write_text("OCR_BASE_URL=https://root.example/api\n", encoding="utf-8")

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
            (root_worktree / ".env").write_text("OCR_BASE_URL=https://root.example/api\n", encoding="utf-8")

            with patch.dict(os.environ, {"OCR_BASE_URL": "https://runtime.example/api"}, clear=True):
                loaded = load_worker_env(repo_root=root)
                self.assertEqual(os.environ["OCR_BASE_URL"], "https://runtime.example/api")

            self.assertIsNone(loaded)


if __name__ == "__main__":
    unittest.main()
