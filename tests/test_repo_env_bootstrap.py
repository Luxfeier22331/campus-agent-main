from __future__ import annotations

import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from campus_shared.env_bootstrap import load_repo_env


class RepoEnvBootstrapTest(unittest.TestCase):
    def test_load_repo_env_prefers_current_worktree_dotenv(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / ".worktrees" / "feature-a"
            root.mkdir(parents=True)
            current_env = root / ".env"
            current_env.write_text("LLM_API_KEY=current-key\n", encoding="utf-8")
            root_worktree = root.parent.parent
            root_worktree.mkdir(parents=True, exist_ok=True)
            (root_worktree / ".env").write_text("LLM_API_KEY=root-key\n", encoding="utf-8")

            with patch.dict(os.environ, {}, clear=True):
                loaded = load_repo_env(repo_root=root)
                self.assertEqual(os.environ["LLM_API_KEY"], "current-key")

            self.assertEqual(loaded, current_env)

    def test_load_repo_env_falls_back_to_root_worktree_dotenv(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / ".worktrees" / "feature-a"
            root.mkdir(parents=True)
            root_worktree = root.parent.parent
            root_worktree.mkdir(parents=True, exist_ok=True)
            root_env = root_worktree / ".env"
            root_env.write_text("LLM_API_KEY=root-key\n", encoding="utf-8")

            with patch.dict(os.environ, {}, clear=True):
                loaded = load_repo_env(repo_root=root)
                self.assertEqual(os.environ["LLM_API_KEY"], "root-key")

            self.assertEqual(loaded, root_env)

    def test_load_repo_env_does_not_override_existing_environment(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / ".worktrees" / "feature-a"
            root.mkdir(parents=True)
            root_worktree = root.parent.parent
            root_worktree.mkdir(parents=True, exist_ok=True)
            (root_worktree / ".env").write_text("LLM_API_KEY=root-key\n", encoding="utf-8")

            with patch.dict(os.environ, {"LLM_API_KEY": "runtime-key"}, clear=True):
                loaded = load_repo_env(repo_root=root)
                self.assertEqual(os.environ["LLM_API_KEY"], "runtime-key")

            self.assertEqual(loaded, root_worktree / ".env")


if __name__ == "__main__":
    unittest.main()
