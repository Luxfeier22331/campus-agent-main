from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.link_worktree_app_local_env import (
    link_worktree_app_local_env,
    resolve_source_repo_root,
)


class LinkWorktreeAppLocalEnvTest(unittest.TestCase):
    def test_resolve_source_repo_root_uses_root_worktree_for_feature_worktree(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root_worktree = Path(temp_dir) / "campus-agent"
            feature_worktree = root_worktree / ".worktrees" / "official-web-crawler"
            feature_worktree.mkdir(parents=True)

            resolved = resolve_source_repo_root(feature_worktree)

            self.assertEqual(resolved, root_worktree)

    def test_link_worktree_app_local_env_creates_symlinks_for_existing_app_local_env_files(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root_worktree = Path(temp_dir) / "campus-agent"
            feature_worktree = root_worktree / ".worktrees" / "official-web-crawler"
            root_worktree.mkdir(parents=True)
            feature_worktree.mkdir(parents=True)

            source_app_api_dev_vars = root_worktree / "apps" / "app-api" / ".dev.vars"
            source_app_api_env = root_worktree / "apps" / "app-api" / ".env"
            source_collector_env = root_worktree / "apps" / "official-web-collector" / ".env"
            source_app_api_dev_vars.parent.mkdir(parents=True, exist_ok=True)
            source_collector_env.parent.mkdir(parents=True, exist_ok=True)
            source_app_api_dev_vars.write_text(
                "APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN=collector-token\n",
                encoding="utf-8",
            )
            source_app_api_env.write_text(
                "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB=postgres://postgres:secret@127.0.0.1:5432/campus_agent\n",
                encoding="utf-8",
            )
            source_collector_env.write_text(
                "OFFICIAL_WEB_SERVICE_TOKEN=collector-token\n",
                encoding="utf-8",
            )

            linked = link_worktree_app_local_env(repo_root=feature_worktree)

            target_app_api_dev_vars = feature_worktree / "apps" / "app-api" / ".dev.vars"
            target_app_api_env = feature_worktree / "apps" / "app-api" / ".env"
            target_collector_env = feature_worktree / "apps" / "official-web-collector" / ".env"

            self.assertEqual(
                linked,
                [target_app_api_dev_vars, target_app_api_env, target_collector_env],
            )
            self.assertTrue(target_app_api_dev_vars.is_symlink())
            self.assertTrue(target_app_api_env.is_symlink())
            self.assertTrue(target_collector_env.is_symlink())
            self.assertEqual(target_app_api_dev_vars.resolve(), source_app_api_dev_vars.resolve())
            self.assertEqual(target_app_api_env.resolve(), source_app_api_env.resolve())
            self.assertEqual(target_collector_env.resolve(), source_collector_env.resolve())

    def test_link_worktree_app_local_env_rejects_existing_non_symlink_targets(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root_worktree = Path(temp_dir) / "campus-agent"
            feature_worktree = root_worktree / ".worktrees" / "official-web-crawler"
            root_worktree.mkdir(parents=True)
            feature_worktree.mkdir(parents=True)

            source_app_api_dev_vars = root_worktree / "apps" / "app-api" / ".dev.vars"
            source_app_api_dev_vars.parent.mkdir(parents=True, exist_ok=True)
            source_app_api_dev_vars.write_text(
                "APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN=collector-token\n",
                encoding="utf-8",
            )

            target_app_api_dev_vars = feature_worktree / "apps" / "app-api" / ".dev.vars"
            target_app_api_dev_vars.parent.mkdir(parents=True, exist_ok=True)
            target_app_api_dev_vars.write_text(
                "APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN=other-token\n",
                encoding="utf-8",
            )

            with self.assertRaises(FileExistsError):
                link_worktree_app_local_env(repo_root=feature_worktree)


if __name__ == "__main__":
    unittest.main()
