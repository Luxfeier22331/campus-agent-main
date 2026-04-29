from __future__ import annotations

import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_shared.env_bootstrap import (
    get_repo_env_bootstrap_state,
    load_repo_env,
    reset_repo_env_bootstrap_state,
)


class RepoEnvBootstrapTest(unittest.TestCase):
    def setUp(self) -> None:
        reset_repo_env_bootstrap_state()

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
            state = get_repo_env_bootstrap_state()
            self.assertIsNotNone(state)
            assert state is not None
            self.assertEqual(state.repo_root, root)
            self.assertEqual(state.candidate_path, current_env)
            self.assertEqual(state.loaded_path, current_env)
            self.assertTrue(state.file_found)
            self.assertEqual(state.loaded_keys, ("LLM_API_KEY",))
            self.assertEqual(state.skipped_existing_keys, ())

    def test_load_repo_env_does_not_fall_back_to_root_worktree_dotenv(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / ".worktrees" / "feature-a"
            root.mkdir(parents=True)
            root_worktree = root.parent.parent
            root_worktree.mkdir(parents=True, exist_ok=True)
            root_env = root_worktree / ".env"
            root_env.write_text("LLM_API_KEY=root-key\n", encoding="utf-8")

            with patch.dict(os.environ, {}, clear=True):
                loaded = load_repo_env(repo_root=root)
                self.assertNotIn("LLM_API_KEY", os.environ)

            self.assertIsNone(loaded)
            state = get_repo_env_bootstrap_state()
            self.assertIsNotNone(state)
            assert state is not None
            self.assertEqual(state.repo_root, root)
            self.assertEqual(state.candidate_path, root / ".env")
            self.assertIsNone(state.loaded_path)
            self.assertFalse(state.file_found)
            self.assertEqual(state.loaded_keys, ())
            self.assertEqual(state.skipped_existing_keys, ())

    def test_load_repo_env_does_not_override_existing_environment(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / ".worktrees" / "feature-a"
            root.mkdir(parents=True)
            root_worktree = root.parent.parent
            root_worktree.mkdir(parents=True, exist_ok=True)
            current_env = root / ".env"
            current_env.write_text("LLM_API_KEY=current-key\n", encoding="utf-8")

            with patch.dict(os.environ, {"LLM_API_KEY": "runtime-key"}, clear=True):
                loaded = load_repo_env(repo_root=root)
                self.assertEqual(os.environ["LLM_API_KEY"], "runtime-key")

            self.assertEqual(loaded, current_env)
            state = get_repo_env_bootstrap_state()
            self.assertIsNotNone(state)
            assert state is not None
            self.assertTrue(state.file_found)
            self.assertEqual(state.loaded_path, current_env)
            self.assertEqual(state.loaded_keys, ())
            self.assertEqual(state.skipped_existing_keys, ("LLM_API_KEY",))


if __name__ == "__main__":
    unittest.main()
