from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory

from scripts.restore_local_postgres_dev import (
    APP_API_DEV_VARS_BACKUP_PATH,
    APP_API_ENV_BACKUP_PATH,
    ROOT_ENV_BACKUP_PATH,
)
from scripts.restore_shared_postgres_dev import (
    execute_shared_postgres_restore,
    main,
    prepare_shared_postgres_restore,
)


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


class RestoreSharedPostgresDevTest(unittest.TestCase):
    def test_prepare_shared_restore_rejects_legacy_bare_local_dsn_source(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            shared_source = repo_root / "shared.env"
            _write(
                shared_source,
                "\n".join(
                    [
                        "CAMPUS_SHARED_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent",
                        "CAMPUS_SHARED_POSTGRES_OPERATOR_URL=postgres://operator.example/campus_agent",
                    ]
                )
                + "\n",
            )

            with self.assertRaisesRegex(
                ValueError,
                "shared root env source still points at the local Postgres DSN",
            ):
                prepare_shared_postgres_restore(
                    repo_root=repo_root,
                    source_env_path=shared_source,
                )

    def test_execute_shared_restore_uses_default_backup_files(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "CAMPUS_SHARED_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent\n",
            )
            _write(
                repo_root / "apps" / "app-api" / ".env",
                "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent\n",
            )
            _write(
                repo_root / "apps" / "app-api" / ".dev.vars",
                "APP_API_DATABASE_SSLMODE=disable\n",
            )

            shared_root_env = (
                "\n".join(
                    [
                        "CAMPUS_SHARED_POSTGRES_URL=postgres://pooler.example/campus_agent",
                        "CAMPUS_SHARED_POSTGRES_OPERATOR_URL=postgres://operator.example/campus_agent",
                    ]
                )
                + "\n"
            )
            shared_app_env = (
                "\n".join(
                    [
                        "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB=postgres://pooler.example/campus_agent",
                        "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH=postgres://pooler.example/campus_agent",
                        "APP_API_OPERATOR_DATABASE_URL=postgres://operator.example/campus_agent",
                    ]
                )
                + "\n"
            )
            shared_dev_vars = "APP_API_DATABASE_SSLMODE=prefer\n"
            _write(repo_root / ROOT_ENV_BACKUP_PATH, shared_root_env)
            _write(repo_root / APP_API_ENV_BACKUP_PATH, shared_app_env)
            _write(repo_root / APP_API_DEV_VARS_BACKUP_PATH, shared_dev_vars)

            plan = prepare_shared_postgres_restore(repo_root=repo_root)
            report = execute_shared_postgres_restore(plan)

            self.assertTrue(report["ok"])
            root_env = (repo_root / ".env").read_text(encoding="utf-8")
            self.assertIn(
                "CAMPUS_SHARED_POSTGRES_URL=postgres://pooler.example/campus_agent\n",
                root_env,
            )
            self.assertIn(
                "CAMPUS_SHARED_POSTGRES_OPERATOR_URL=postgres://operator.example/campus_agent\n",
                root_env,
            )
            self.assertIn(
                "DOCUMENT_REGISTRY_DATABASE_URL=postgres://pooler.example/campus_agent\n",
                root_env,
            )
            self.assertIn(
                "DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL=postgres://operator.example/campus_agent\n",
                root_env,
            )
            app_env = (repo_root / "apps" / "app-api" / ".env").read_text(encoding="utf-8")
            self.assertIn(
                "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB="
                "postgres://pooler.example/campus_agent\n",
                app_env,
            )
            self.assertIn(
                "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH="
                "postgres://pooler.example/campus_agent\n",
                app_env,
            )
            self.assertIn(
                "APP_API_OPERATOR_DATABASE_URL=postgres://operator.example/campus_agent\n",
                app_env,
            )
            self.assertNotIn("APP_API_MANAGEMENT_DATABASE_URL=", app_env)
            dev_vars = (repo_root / "apps" / "app-api" / ".dev.vars").read_text(encoding="utf-8")
            self.assertIn("APP_API_DATABASE_SSLMODE=prefer\n", dev_vars)

    def test_execute_shared_restore_can_derive_app_api_env_from_root_source(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "CAMPUS_SHARED_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent\n",
            )
            _write(
                repo_root / "apps" / "app-api" / ".env.example",
                "\n".join(
                    [
                        "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB=",
                        "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH=",
                        "APP_API_OPERATOR_DATABASE_URL=",
                        "KEEP_ME=1",
                    ]
                )
                + "\n",
            )
            _write(
                repo_root / "apps" / "app-api" / ".dev.vars",
                "\n".join(
                    [
                        "APP_API_DATABASE_SSLMODE=disable",
                        "APP_API_INTERNAL_SHARED_SECRET=test-secret",
                    ]
                )
                + "\n",
            )
            shared_source = repo_root / "shared.env"
            _write(
                shared_source,
                "\n".join(
                    [
                        "CAMPUS_SHARED_POSTGRES_URL=postgres://pooler.example/campus_agent",
                        "CAMPUS_SHARED_POSTGRES_OPERATOR_URL=postgres://operator.example/campus_agent",
                    ]
                )
                + "\n",
            )

            plan = prepare_shared_postgres_restore(
                repo_root=repo_root,
                source_env_path=shared_source,
            )
            report = execute_shared_postgres_restore(plan)

            self.assertTrue(report["ok"])
            root_env = (repo_root / ".env").read_text(encoding="utf-8")
            self.assertIn(
                "CAMPUS_SHARED_POSTGRES_URL=postgres://pooler.example/campus_agent\n",
                root_env,
            )
            self.assertIn(
                "CAMPUS_SHARED_POSTGRES_OPERATOR_URL=postgres://operator.example/campus_agent\n",
                root_env,
            )
            app_env = (repo_root / "apps" / "app-api" / ".env").read_text(encoding="utf-8")
            self.assertIn(
                "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB="
                "postgres://pooler.example/campus_agent\n",
                app_env,
            )
            self.assertIn(
                "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH="
                "postgres://pooler.example/campus_agent\n",
                app_env,
            )
            self.assertIn(
                "APP_API_OPERATOR_DATABASE_URL=postgres://operator.example/campus_agent\n",
                app_env,
            )
            self.assertNotIn("APP_API_MANAGEMENT_DATABASE_URL=", app_env)
            dev_vars = (repo_root / "apps" / "app-api" / ".dev.vars").read_text(encoding="utf-8")
            self.assertIn("APP_API_DATABASE_SSLMODE=prefer\n", dev_vars)
            self.assertIn("APP_API_INTERNAL_SHARED_SECRET=test-secret\n", dev_vars)

    def test_main_supports_json_output(self) -> None:
        with TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir) / "campus-agent"
            _write(
                repo_root / ".env",
                "CAMPUS_SHARED_POSTGRES_URL=postgresql://postgres:postgres@127.0.0.1:5432/campus_agent\n",
            )
            _write(
                repo_root / "apps" / "app-api" / ".env.example",
                "\n".join(
                    [
                        "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB=",
                        "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_APP_API_DB_FRESH=",
                        "APP_API_OPERATOR_DATABASE_URL=",
                    ]
                )
                + "\n",
            )
            _write(
                repo_root / "apps" / "app-api" / ".dev.vars.example",
                "APP_API_DATABASE_SSLMODE=disable\n",
            )
            shared_source = repo_root / "shared.env"
            _write(
                shared_source,
                "\n".join(
                    [
                        "CAMPUS_SHARED_POSTGRES_URL=postgres://pooler.example/campus_agent",
                        "CAMPUS_SHARED_POSTGRES_OPERATOR_URL=postgres://operator.example/campus_agent",
                    ]
                )
                + "\n",
            )

            buffer = io.StringIO()
            with redirect_stdout(buffer):
                exit_code = main(
                    [
                        "--repo-root",
                        str(repo_root),
                        "--shared-root-env",
                        str(shared_source),
                        "--json",
                    ]
                )

            payload = json.loads(buffer.getvalue())
            self.assertEqual(exit_code, 0)
            self.assertTrue(payload["ok"])
            self.assertEqual(payload["source_paths"]["root_env"], str(shared_source))


if __name__ == "__main__":
    unittest.main()
