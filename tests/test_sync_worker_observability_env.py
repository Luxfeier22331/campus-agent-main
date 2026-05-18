from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.sync_worker_observability_env import (
    resolve_source_env_path,
    sync_worker_observability_env,
)


class SyncWorkerObservabilityEnvTest(unittest.TestCase):
    def test_resolve_source_env_path_uses_root_worktree_dotenv_for_feature_worktree(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root_worktree = Path(temp_dir) / "campus-agent"
            feature_worktree = root_worktree / ".worktrees" / "protected-panel-web"
            feature_worktree.mkdir(parents=True)
            source_env = root_worktree / ".env"
            source_env.write_text("SENTRY_DSN=https://shared.example\n", encoding="utf-8")

            resolved = resolve_source_env_path(feature_worktree)

            self.assertEqual(resolved, source_env)

    def test_sync_worker_observability_env_creates_app_local_dev_vars_from_root_env(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root_worktree = Path(temp_dir) / "campus-agent"
            feature_worktree = root_worktree / ".worktrees" / "protected-panel-web"
            feature_worktree.mkdir(parents=True)

            (root_worktree / ".env").write_text(
                "\n".join(
                    [
                        "SENTRY_DSN=https://shared.example",
                        "AXIOM_ENDPOINT=https://us-east-1.aws.edge.axiom.co",
                        "AXIOM_DATASET=campus-agent-runtime-dev",
                        "AXIOM_TOKEN=axiom-token",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            app_api_dir = feature_worktree / "apps" / "app-api"
            public_chat_dir = feature_worktree / "apps" / "public-chat-web"
            protected_panel_dir = feature_worktree / "apps" / "protected-panel-web"
            hub_web_dir = feature_worktree / "apps" / "hub-web"
            app_api_dir.mkdir(parents=True)
            public_chat_dir.mkdir(parents=True)
            protected_panel_dir.mkdir(parents=True)
            hub_web_dir.mkdir(parents=True)

            (app_api_dir / ".dev.vars.example").write_text(
                "\n".join(
                    [
                        "APP_API_NAME=campus-agent-app-api",
                        "SENTRY_DSN=",
                        "SENTRY_ENVIRONMENT=development",
                        "AXIOM_ENDPOINT=https://us-east-1.aws.edge.axiom.co",
                        "AXIOM_DATASET=campus_agent_runtime",
                        "AXIOM_TOKEN=",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            (public_chat_dir / ".dev.vars.example").write_text(
                "\n".join(
                    [
                        "PUBLIC_CHAT_APP_NAME=campus-agent-public-chat-web",
                        "SENTRY_DSN=",
                        "SENTRY_ENVIRONMENT=development",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            (protected_panel_dir / ".dev.vars.example").write_text(
                "\n".join(
                    [
                        "PANEL_APP_NAME=campus-agent-v2-protected-panel",
                        "SENTRY_DSN=",
                        "SENTRY_ENVIRONMENT=development",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            (hub_web_dir / ".dev.vars.example").write_text(
                "\n".join(
                    [
                        "HUB_WEB_HOSTNAME=hub.muc.wiki",
                        "SENTRY_DSN=",
                        "SENTRY_ENVIRONMENT=development",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            sync_worker_observability_env(repo_root=feature_worktree)

            self.assertIn(
                "SENTRY_DSN=https://shared.example\n",
                (app_api_dir / ".dev.vars").read_text(encoding="utf-8"),
            )
            app_api_vars = (app_api_dir / ".dev.vars").read_text(encoding="utf-8")
            self.assertIn("AXIOM_ENDPOINT=https://us-east-1.aws.edge.axiom.co\n", app_api_vars)
            self.assertIn("AXIOM_DATASET=campus-agent-runtime-dev\n", app_api_vars)
            self.assertIn("AXIOM_TOKEN=axiom-token\n", app_api_vars)
            self.assertIn(
                "SENTRY_DSN=https://shared.example\n",
                (public_chat_dir / ".dev.vars").read_text(encoding="utf-8"),
            )
            self.assertIn(
                "SENTRY_DSN=https://shared.example\n",
                (protected_panel_dir / ".dev.vars").read_text(encoding="utf-8"),
            )
            self.assertIn(
                "SENTRY_DSN=https://shared.example\n",
                (hub_web_dir / ".dev.vars").read_text(encoding="utf-8"),
            )

    def test_sync_worker_observability_env_updates_existing_dev_vars_without_clobbering_other_keys(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root_worktree = Path(temp_dir) / "campus-agent"
            feature_worktree = root_worktree / ".worktrees" / "protected-panel-web"
            app_api_dir = feature_worktree / "apps" / "app-api"
            public_chat_dir = feature_worktree / "apps" / "public-chat-web"
            protected_panel_dir = feature_worktree / "apps" / "protected-panel-web"
            hub_web_dir = feature_worktree / "apps" / "hub-web"
            app_api_dir.mkdir(parents=True)
            public_chat_dir.mkdir(parents=True)
            protected_panel_dir.mkdir(parents=True)
            hub_web_dir.mkdir(parents=True)

            (root_worktree / ".env").write_text(
                "\n".join(
                    [
                        "SENTRY_DSN=https://shared.new.example",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            (app_api_dir / ".dev.vars").write_text(
                "\n".join(
                    [
                        "APP_API_NAME=campus-agent-app-api",
                        "SENTRY_DSN=https://api.old.example",
                        "SENTRY_ENVIRONMENT=staging",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            (public_chat_dir / ".dev.vars").write_text(
                "SENTRY_DSN=https://chat.old.example\nSENTRY_RELEASE=chat@old\n",
                encoding="utf-8",
            )
            (protected_panel_dir / ".dev.vars").write_text(
                "SENTRY_DSN=https://panel.old.example\nSENTRY_RELEASE=panel@old\n",
                encoding="utf-8",
            )
            (hub_web_dir / ".dev.vars").write_text(
                "SENTRY_DSN=https://hub.old.example\nSENTRY_RELEASE=hub@old\n",
                encoding="utf-8",
            )

            sync_worker_observability_env(repo_root=feature_worktree)

            self.assertIn(
                "SENTRY_DSN=https://shared.new.example\n",
                (app_api_dir / ".dev.vars").read_text(encoding="utf-8"),
            )
            self.assertIn(
                "SENTRY_ENVIRONMENT=staging\n",
                (app_api_dir / ".dev.vars").read_text(encoding="utf-8"),
            )
            self.assertIn(
                "SENTRY_RELEASE=chat@old\n",
                (public_chat_dir / ".dev.vars").read_text(encoding="utf-8"),
            )
            self.assertIn(
                "SENTRY_RELEASE=panel@old\n",
                (protected_panel_dir / ".dev.vars").read_text(encoding="utf-8"),
            )
            self.assertIn(
                "SENTRY_DSN=https://shared.new.example\n",
                (hub_web_dir / ".dev.vars").read_text(encoding="utf-8"),
            )
            self.assertIn(
                "SENTRY_RELEASE=hub@old\n",
                (hub_web_dir / ".dev.vars").read_text(encoding="utf-8"),
            )


if __name__ == "__main__":
    unittest.main()
