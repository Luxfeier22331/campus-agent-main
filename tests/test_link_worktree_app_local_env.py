from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.link_worktree_app_local_env import (
    APP_LOCAL_ENV_PATHS,
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

            source_root_env = root_worktree / ".env"
            source_app_api_dev_vars = root_worktree / "apps" / "app-api" / ".dev.vars"
            source_app_api_env = root_worktree / "apps" / "app-api" / ".env"
            source_campus_web_env = root_worktree / "apps" / "campus-web" / ".env"
            source_campus_web_dev_vars = root_worktree / "apps" / "campus-web" / ".dev.vars"
            source_operator_console_dev_vars = (
                root_worktree / "apps" / "operator-console-web" / ".dev.vars"
            )
            source_collector_env = root_worktree / "apps" / "official-web-collector" / ".env"
            source_docs_reader_env = (
                root_worktree / "env" / "commands" / "campus-docs-reader-build.env"
            )
            source_generated_runtime_env = (
                root_worktree / "infra" / "local" / ".generated" / "runtime.env"
            )
            source_app_api_dev_vars.parent.mkdir(parents=True, exist_ok=True)
            source_campus_web_env.parent.mkdir(parents=True, exist_ok=True)
            source_operator_console_dev_vars.parent.mkdir(parents=True, exist_ok=True)
            source_collector_env.parent.mkdir(parents=True, exist_ok=True)
            source_docs_reader_env.parent.mkdir(parents=True, exist_ok=True)
            source_generated_runtime_env.parent.mkdir(parents=True, exist_ok=True)
            source_root_env.write_text(
                "OBJECT_STORE_ENDPOINT=http://localhost:9000\n",
                encoding="utf-8",
            )
            source_app_api_dev_vars.write_text(
                "APP_API_OFFICIAL_WEB_COLLECTOR_TOKEN=collector-token\n",
                encoding="utf-8",
            )
            source_app_api_env.write_text(
                "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB=postgres://postgres:secret@127.0.0.1:5432/campus_agent\n",
                encoding="utf-8",
            )
            source_campus_web_env.write_text(
                "OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived\n",
                encoding="utf-8",
            )
            source_campus_web_dev_vars.write_text(
                "APP_API_BASE_URL=http://127.0.0.1:8787\n",
                encoding="utf-8",
            )
            source_operator_console_dev_vars.write_text(
                "OPERATOR_CONSOLE_APP_API_BASE_URL=http://127.0.0.1:8787\n",
                encoding="utf-8",
            )
            source_collector_env.write_text(
                "OFFICIAL_WEB_SERVICE_TOKEN=collector-token\n",
                encoding="utf-8",
            )
            source_docs_reader_env.write_text(
                "OBJECT_STORE_BUCKET_DERIVED=campus-rag-derived\n",
                encoding="utf-8",
            )
            source_generated_runtime_env.write_text(
                "QDRANT_URL=http://127.0.0.1:6333\n",
                encoding="utf-8",
            )

            linked = link_worktree_app_local_env(repo_root=feature_worktree)

            target_root_env = feature_worktree / ".env"
            target_app_api_dev_vars = feature_worktree / "apps" / "app-api" / ".dev.vars"
            target_app_api_env = feature_worktree / "apps" / "app-api" / ".env"
            target_campus_web_env = feature_worktree / "apps" / "campus-web" / ".env"
            target_campus_web_dev_vars = feature_worktree / "apps" / "campus-web" / ".dev.vars"
            target_operator_console_dev_vars = (
                feature_worktree / "apps" / "operator-console-web" / ".dev.vars"
            )
            target_collector_env = feature_worktree / "apps" / "official-web-collector" / ".env"
            target_docs_reader_env = (
                feature_worktree / "env" / "commands" / "campus-docs-reader-build.env"
            )
            target_generated_runtime_env = (
                feature_worktree / "infra" / "local" / ".generated" / "runtime.env"
            )

            self.assertEqual(
                linked,
                [
                    target_root_env,
                    target_app_api_dev_vars,
                    target_app_api_env,
                    target_campus_web_env,
                    target_campus_web_dev_vars,
                    target_operator_console_dev_vars,
                    target_collector_env,
                    target_docs_reader_env,
                    target_generated_runtime_env,
                ],
            )
            self.assertTrue(target_root_env.is_symlink())
            self.assertTrue(target_app_api_dev_vars.is_symlink())
            self.assertTrue(target_app_api_env.is_symlink())
            self.assertTrue(target_campus_web_env.is_symlink())
            self.assertTrue(target_campus_web_dev_vars.is_symlink())
            self.assertTrue(target_operator_console_dev_vars.is_symlink())
            self.assertTrue(target_collector_env.is_symlink())
            self.assertTrue(target_docs_reader_env.is_symlink())
            self.assertTrue(target_generated_runtime_env.is_symlink())
            self.assertEqual(target_root_env.resolve(), source_root_env.resolve())
            self.assertEqual(target_app_api_dev_vars.resolve(), source_app_api_dev_vars.resolve())
            self.assertEqual(target_app_api_env.resolve(), source_app_api_env.resolve())
            self.assertEqual(target_campus_web_env.resolve(), source_campus_web_env.resolve())
            self.assertEqual(
                target_campus_web_dev_vars.resolve(),
                source_campus_web_dev_vars.resolve(),
            )
            self.assertEqual(
                target_operator_console_dev_vars.resolve(),
                source_operator_console_dev_vars.resolve(),
            )
            self.assertEqual(target_collector_env.resolve(), source_collector_env.resolve())
            self.assertEqual(target_docs_reader_env.resolve(), source_docs_reader_env.resolve())
            self.assertEqual(
                target_generated_runtime_env.resolve(),
                source_generated_runtime_env.resolve(),
            )

    def test_default_env_link_paths_do_not_include_retired_surfaces(self) -> None:
        self.assertNotIn("apps/public-entry-worker/.dev.vars", APP_LOCAL_ENV_PATHS)
        self.assertNotIn("apps/public-consumer-chat/.env", APP_LOCAL_ENV_PATHS)
        self.assertIn("env/commands/campus-docs-reader-build.env", APP_LOCAL_ENV_PATHS)
        self.assertIn("infra/local/.generated/runtime.env", APP_LOCAL_ENV_PATHS)

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
