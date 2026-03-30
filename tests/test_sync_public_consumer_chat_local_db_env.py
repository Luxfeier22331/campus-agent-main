from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from scripts.env_sync import SHARED_POSTGRES_ENV_KEY
from scripts.sync_public_consumer_chat_local_db_env import (
    sync_public_consumer_chat_local_db_env,
)


class SyncPublicConsumerChatLocalDbEnvTest(unittest.TestCase):
    def test_sync_public_consumer_chat_local_db_env_creates_app_env_from_root_env(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            repo_root.mkdir(parents=True)
            (repo_root / ".env").write_text(
                f"{SHARED_POSTGRES_ENV_KEY}=postgres://db.example/campus_agent\n",
                encoding="utf-8",
            )

            app_dir = repo_root / "apps" / "public-consumer-chat"
            app_dir.mkdir(parents=True)
            (app_dir / ".env.example").write_text(
                "\n".join(
                    [
                        "PUBLIC_CONSUMER_CHAT_DATABASE_URL=",
                        "PUBLIC_CHAT_TEST_DATABASE_URL=",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            target_path = sync_public_consumer_chat_local_db_env(repo_root=repo_root)

            self.assertEqual(target_path, app_dir / ".env")
            env_text = target_path.read_text(encoding="utf-8")
            self.assertIn(
                "PUBLIC_CONSUMER_CHAT_DATABASE_URL=postgres://db.example/campus_agent\n",
                env_text,
            )
            self.assertIn(
                "PUBLIC_CHAT_TEST_DATABASE_URL=postgres://db.example/campus_agent\n",
                env_text,
            )

    def test_sync_public_consumer_chat_local_db_env_updates_existing_env_without_clobbering_other_keys(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            app_dir = repo_root / "apps" / "public-consumer-chat"
            app_dir.mkdir(parents=True)

            (repo_root / ".env").write_text(
                f"{SHARED_POSTGRES_ENV_KEY}=postgres://db.new.example/campus_agent\n",
                encoding="utf-8",
            )
            (app_dir / ".env").write_text(
                "\n".join(
                    [
                        "PUBLIC_CONSUMER_CHAT_DATABASE_URL=postgres://db.old.example/campus_agent",
                        "PUBLIC_CHAT_TEST_DATABASE_URL=postgres://db.old.example/campus_agent",
                        "BETTER_AUTH_SECRET=keep-me",
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            sync_public_consumer_chat_local_db_env(repo_root=repo_root)

            env_text = (app_dir / ".env").read_text(encoding="utf-8")
            self.assertIn(
                "PUBLIC_CONSUMER_CHAT_DATABASE_URL=postgres://db.new.example/campus_agent\n",
                env_text,
            )
            self.assertIn(
                "PUBLIC_CHAT_TEST_DATABASE_URL=postgres://db.new.example/campus_agent\n",
                env_text,
            )
            self.assertIn("BETTER_AUTH_SECRET=keep-me\n", env_text)

    def test_sync_public_consumer_chat_local_db_env_requires_source_database_url(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            repo_root.mkdir(parents=True)
            (repo_root / ".env").write_text("OTHER_KEY=value\n", encoding="utf-8")

            with self.assertRaisesRegex(
                ValueError,
                f"Missing required env value in source env: {SHARED_POSTGRES_ENV_KEY}",
            ):
                sync_public_consumer_chat_local_db_env(repo_root=repo_root)


if __name__ == "__main__":
    unittest.main()
