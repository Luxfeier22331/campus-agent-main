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
            ["git", "-c", "core.quotePath=false", "ls-files", "-z", "*.sql"],
            check=True,
            capture_output=True,
            cwd=repo_root,
        )
        expected_paths = tuple(
            repo_root / decoded
            for item in expected.stdout.split(b"\0")
            if item and not (decoded := item.decode("utf-8")).startswith(".planning/")
        )

        self.assertEqual(tracked_sql_files(root=repo_root), expected_paths)

    @patch("scripts.check_sql_tracked.subprocess.run")
    def test_main_invokes_sqlfluff_parse_for_each_tracked_file(
        self, run_mock: subprocess.CompletedProcess[str]
    ) -> None:
        run_mock.side_effect = [
            subprocess.CompletedProcess(
                args=["git"],
                returncode=0,
                stdout=(
                    "apps/app-api/db/shared-product-migrations/0001_chat_schema.sql\n"
                    "apps/app-api/drizzle/0015_broken_supernaut.sql\n"
                ),
            ),
            subprocess.CompletedProcess(args=["sqlfluff"], returncode=0),
            subprocess.CompletedProcess(args=["sqlfluff"], returncode=0),
        ]

        exit_code = main()

        self.assertEqual(exit_code, 0)
        command_calls = [call.args[0] for call in run_mock.call_args_list[1:]]
        self.assertEqual(
            command_calls,
            [
                [
                    "sqlfluff",
                    "parse",
                    "--dialect",
                    "postgres",
                    "apps/app-api/db/shared-product-migrations/0001_chat_schema.sql",
                ],
                [
                    "sqlfluff",
                    "parse",
                    "--dialect",
                    "postgres",
                    "apps/app-api/drizzle/0015_broken_supernaut.sql",
                ],
            ],
        )
