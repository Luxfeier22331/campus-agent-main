from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.env_sync import (
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
    resolve_source_env_path,
)
from scripts.sync_app_api_local_db_env import sync_app_api_local_db_env


class SyncAppApiLocalDbEnvTest(unittest.TestCase):
    def test_resolve_source_env_path_uses_root_worktree_dotenv_for_feature_worktree(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root_worktree = Path(temp_dir) / "campus-agent"
            feature_worktree = root_worktree / ".worktrees" / "official-web-crawler"
            feature_worktree.mkdir(parents=True)
            source_env = root_worktree / ".env"
            source_env.write_text(
                f"{SHARED_POSTGRES_ENV_KEY}=postgres://db.example\n",
                encoding="utf-8",
            )

            resolved = resolve_source_env_path(feature_worktree)

            self.assertEqual(resolved, source_env)

    def test_sync_app_api_local_db_env_creates_app_env_from_root_env(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root_worktree = Path(temp_dir) / "campus-agent"
            feature_worktree = root_worktree / ".worktrees" / "official-web-crawler"
            feature_worktree.mkdir(parents=True)

            (root_worktree / ".env").write_text(
                "\n".join(
                    [
                        f"{SHARED_POSTGRES_ENV_KEY}=postgres://pooler.example/campus_agent",
                        (
                            f"{SHARED_POSTGRES_MANAGEMENT_ENV_KEY}="
                            "postgres://direct.example/campus_agent"
                        ),
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            app_api_dir = feature_worktree / "apps" / "app-api"
            app_api_dir.mkdir(parents=True)
            (app_api_dir / ".env.example").write_text(
                "\n".join(
                    [
                        "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB=",
                        "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH=",
                        "APP_API_MANAGEMENT_DATABASE_URL=",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            target_path = sync_app_api_local_db_env(repo_root=feature_worktree)

            self.assertEqual(target_path, app_api_dir / ".env")
            env_text = target_path.read_text(encoding="utf-8")
            self.assertIn(
                "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB="
                "postgres://pooler.example/campus_agent\n",
                env_text,
            )
            self.assertIn(
                "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH="
                "postgres://pooler.example/campus_agent\n",
                env_text,
            )
            self.assertIn(
                "APP_API_MANAGEMENT_DATABASE_URL=postgres://direct.example/campus_agent\n",
                env_text,
            )

    def test_sync_app_api_local_db_env_updates_existing_env_without_clobbering_other_keys(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            app_api_dir = repo_root / "apps" / "app-api"
            app_api_dir.mkdir(parents=True)

            (repo_root / ".env").write_text(
                "\n".join(
                    [
                        f"{SHARED_POSTGRES_ENV_KEY}=postgres://pooler.new.example/campus_agent",
                        (
                            f"{SHARED_POSTGRES_MANAGEMENT_ENV_KEY}="
                            "postgres://direct.new.example/campus_agent"
                        ),
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            (app_api_dir / ".env").write_text(
                "\n".join(
                    [
                        "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB=postgres://pooler.old.example/campus_agent",
                        "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH=postgres://pooler.old.example/campus_agent",
                        "APP_API_MANAGEMENT_DATABASE_URL=postgres://direct.old.example/campus_agent",
                        "KEEP_ME=1",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            sync_app_api_local_db_env(repo_root=repo_root)

            env_text = (app_api_dir / ".env").read_text(encoding="utf-8")
            self.assertIn(
                "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB="
                "postgres://pooler.new.example/campus_agent\n",
                env_text,
            )
            self.assertIn(
                "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH="
                "postgres://pooler.new.example/campus_agent\n",
                env_text,
            )
            self.assertIn(
                "APP_API_MANAGEMENT_DATABASE_URL=postgres://direct.new.example/campus_agent\n",
                env_text,
            )
            self.assertIn("KEEP_ME=1\n", env_text)

    def test_sync_app_api_local_db_env_requires_source_runtime_and_management_database_urls(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            repo_root.mkdir(parents=True)
            (repo_root / ".env").write_text(
                f"{SHARED_POSTGRES_ENV_KEY}=postgres://pooler.example/campus_agent\n",
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                ValueError,
                (
                    "Missing required env value in source env: "
                    f"{SHARED_POSTGRES_MANAGEMENT_ENV_KEY}"
                ),
            ):
                sync_app_api_local_db_env(repo_root=repo_root)


if __name__ == "__main__":
    unittest.main()
