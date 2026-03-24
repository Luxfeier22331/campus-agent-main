from __future__ import annotations

import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_ingestion_worker.env_bootstrap import load_worker_env


class WorkerEnvBootstrapTest(unittest.TestCase):
    def test_load_worker_env_prefers_current_worktree_dotenv(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / ".worktrees" / "feature-a"
            root.mkdir(parents=True)
            current_env = root / ".env"
            current_env.write_text("OCR_BASE_URL=https://current.example/api\n", encoding="utf-8")
            main_root = root.parent.parent
            main_root.mkdir(parents=True, exist_ok=True)
            (main_root / ".env").write_text("OCR_BASE_URL=https://main.example/api\n", encoding="utf-8")

            with unittest.mock.patch.dict(os.environ, {}, clear=True):
                loaded = load_worker_env(repo_root=root)
                self.assertEqual(os.environ["OCR_BASE_URL"], "https://current.example/api")

            self.assertEqual(loaded, current_env)

    def test_load_worker_env_falls_back_to_main_worktree_dotenv(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / ".worktrees" / "feature-a"
            root.mkdir(parents=True)
            main_root = root.parent.parent
            main_root.mkdir(parents=True, exist_ok=True)
            main_env = main_root / ".env"
            main_env.write_text("OCR_BASE_URL=https://main.example/api\n", encoding="utf-8")

            with unittest.mock.patch.dict(os.environ, {}, clear=True):
                loaded = load_worker_env(repo_root=root)
                self.assertEqual(os.environ["OCR_BASE_URL"], "https://main.example/api")

            self.assertEqual(loaded, main_env)

    def test_load_worker_env_does_not_override_existing_environment(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / ".worktrees" / "feature-a"
            root.mkdir(parents=True)
            main_root = root.parent.parent
            main_root.mkdir(parents=True, exist_ok=True)
            (main_root / ".env").write_text("OCR_BASE_URL=https://main.example/api\n", encoding="utf-8")

            with unittest.mock.patch.dict(os.environ, {"OCR_BASE_URL": "https://runtime.example/api"}, clear=True):
                loaded = load_worker_env(repo_root=root)
                self.assertEqual(os.environ["OCR_BASE_URL"], "https://runtime.example/api")

            self.assertEqual(loaded, main_root / ".env")


if __name__ == "__main__":
    unittest.main()
