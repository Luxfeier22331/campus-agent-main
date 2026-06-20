from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.check_sql_tracked import main, tracked_sql_files


class CheckSqlTrackedTest(unittest.TestCase):
    def test_tracked_sql_files_match_repo_inventory(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        expected = subprocess.run(
            [
                "git",
                "-c",
                "core.quotePath=false",
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
                "*.sql",
            ],
            check=True,
            capture_output=True,
            cwd=repo_root,
        )
        expected_paths = tuple(
            repo_root / decoded
            for item in expected.stdout.split(b"\0")
            if item
            and not (decoded := item.decode("utf-8")).startswith(".planning/")
            and not decoded.startswith("apps/app-api/drizzle/")
            and (repo_root / decoded).exists()
        )

        self.assertEqual(tracked_sql_files(root=repo_root), expected_paths)

    @patch("scripts.check_sql_tracked.subprocess.run")
    def test_main_invokes_sqlfluff_lint_for_each_tracked_file(
        self,
        run_mock: subprocess.CompletedProcess[str],
    ) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        with patch(
            "scripts.check_sql_tracked.tracked_sql_files",
            return_value=(
                repo_root / "apps/app-api/db/shared-product-migrations/0001_chat_schema.sql",
                repo_root / "docs/reference/example.sql",
            ),
        ):
            run_mock.side_effect = [
                subprocess.CompletedProcess(args=["sqlfluff"], returncode=0),
                subprocess.CompletedProcess(args=["sqlfluff"], returncode=0),
            ]

            exit_code = main()

        self.assertEqual(exit_code, 0)
        command_calls = [call.args[0] for call in run_mock.call_args_list]
        self.assertEqual(
            command_calls,
            [
                [
                    "sqlfluff",
                    "lint",
                    "--config",
                    ".sqlfluff",
                    "apps/app-api/db/shared-product-migrations/0001_chat_schema.sql",
                ],
                [
                    "sqlfluff",
                    "lint",
                    "--config",
                    ".sqlfluff",
                    "docs/reference/example.sql",
                ],
            ],
        )

    def test_generated_drizzle_migrations_are_excluded(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        self.assertNotIn(
            repo_root / "apps/app-api/drizzle/0044_concerned_carmella_unuscione.sql",
            tracked_sql_files(root=repo_root),
        )
