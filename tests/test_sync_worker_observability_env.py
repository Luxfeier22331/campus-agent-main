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
            feature_worktree = root_worktree / ".worktrees" / "operator-console-web"
            feature_worktree.mkdir(parents=True)
            source_env = root_worktree / ".env"
            source_env.write_text("SENTRY_DSN=https://shared.example\n", encoding="utf-8")

            resolved = resolve_source_env_path(feature_worktree)

            self.assertEqual(resolved, source_env)

    def test_sync_worker_observability_env_creates_app_local_dev_vars_from_root_env(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root_worktree = Path(temp_dir) / "campus-agent"
            feature_worktree = root_worktree / ".worktrees" / "operator-console-web"
            feature_worktree.mkdir(parents=True)

            (root_worktree / ".env").write_text(
                "\n".join(
                    [
                        "SENTRY_DSN=https://shared.example",
                        "AXIOM_ENDPOINT=https://us-east-1.aws.edge.axiom.co",
                        "AXIOM_DATASET=campus-agent-runtime",
                        "AXIOM_TOKEN=axiom-token",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            app_api_dir = feature_worktree / "apps" / "app-api"
            operator_console_dir = feature_worktree / "apps" / "operator-console-web"
            campus_web_dir = feature_worktree / "apps" / "campus-web"
            app_api_dir.mkdir(parents=True)
            operator_console_dir.mkdir(parents=True)
            campus_web_dir.mkdir(parents=True)

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
            (operator_console_dir / ".dev.vars.example").write_text(
                "\n".join(
                    [
                        "OPERATOR_CONSOLE_APP_NAME=campus-agent-v2-operator-console",
                        "SENTRY_DSN=",
                        "SENTRY_ENVIRONMENT=development",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            (campus_web_dir / ".dev.vars.example").write_text(
                "\n".join(
                    [
                        "CAMPUS_WEB_HOSTNAME=campus.muc.wiki",
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
            self.assertIn("AXIOM_DATASET=campus-agent-runtime\n", app_api_vars)
            self.assertIn("AXIOM_TOKEN=axiom-token\n", app_api_vars)
            self.assertIn(
                "SENTRY_DSN=https://shared.example\n",
                (operator_console_dir / ".dev.vars").read_text(encoding="utf-8"),
            )
            self.assertIn(
                "SENTRY_DSN=https://shared.example\n",
                (campus_web_dir / ".dev.vars").read_text(encoding="utf-8"),
            )

    def test_sync_worker_observability_env_updates_existing_dev_vars_without_clobbering_other_keys(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root_worktree = Path(temp_dir) / "campus-agent"
            feature_worktree = root_worktree / ".worktrees" / "operator-console-web"
            app_api_dir = feature_worktree / "apps" / "app-api"
            operator_console_dir = feature_worktree / "apps" / "operator-console-web"
            campus_web_dir = feature_worktree / "apps" / "campus-web"
            app_api_dir.mkdir(parents=True)
            operator_console_dir.mkdir(parents=True)
            campus_web_dir.mkdir(parents=True)

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
            (operator_console_dir / ".dev.vars").write_text(
                "SENTRY_DSN=https://operator-console.old.example\nSENTRY_RELEASE=operator-console@old\n",
                encoding="utf-8",
            )
            (campus_web_dir / ".dev.vars").write_text(
                "SENTRY_DSN=https://campus.old.example\nSENTRY_RELEASE=campus@old\n",
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
                "SENTRY_RELEASE=operator-console@old\n",
                (operator_console_dir / ".dev.vars").read_text(encoding="utf-8"),
            )
            self.assertIn(
                "SENTRY_DSN=https://shared.new.example\n",
                (campus_web_dir / ".dev.vars").read_text(encoding="utf-8"),
            )
            self.assertIn(
                "SENTRY_RELEASE=campus@old\n",
                (campus_web_dir / ".dev.vars").read_text(encoding="utf-8"),
            )


if __name__ == "__main__":
    unittest.main()
