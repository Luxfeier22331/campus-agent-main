from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.check_editorconfig_tracked import (
    editorconfig_checker_binary,
    main,
    tracked_editorconfig_files,
)


class CheckEditorconfigTrackedTest(unittest.TestCase):
    def test_tracked_editorconfig_files_match_repo_dotfile_inventory(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        self.assertEqual(
            tracked_editorconfig_files(root=repo_root),
            (
                repo_root / ".editorconfig",
                repo_root / ".gitignore",
                repo_root / "apps/public-docs-rspress/.gitignore",
                repo_root / "apps/public-docs-web/.gitignore",
            ),
        )

    def test_editorconfig_checker_binary_resolves_to_repo_node_modules(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        self.assertEqual(
            editorconfig_checker_binary(root=repo_root),
            repo_root / "node_modules/.bin/editorconfig-checker",
        )

    @patch("scripts.check_editorconfig_tracked.subprocess.run")
    @patch("scripts.check_editorconfig_tracked.editorconfig_checker_binary")
    def test_main_invokes_editorconfig_checker_with_temp_tree(
        self,
        binary_mock: Path,
        run_mock: subprocess.CompletedProcess[str],
    ) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        binary_mock.return_value = repo_root / "node_modules/.bin/editorconfig-checker"
        run_mock.side_effect = [
            subprocess.CompletedProcess(
                args=["git"],
                returncode=0,
                stdout=".editorconfig\n.gitignore\napps/public-docs-rspress/.gitignore\napps/public-docs-web/.gitignore\n",
            ),
            subprocess.CompletedProcess(args=["editorconfig-checker"], returncode=0),
        ]

        exit_code = main()

        self.assertEqual(exit_code, 0)
        args = run_mock.call_args.args[0]
        cwd = run_mock.call_args.kwargs["cwd"]
        self.assertNotEqual(Path(cwd), repo_root)
        self.assertEqual(
            args,
            [str(repo_root / "node_modules/.bin/editorconfig-checker"), "-no-color"],
        )
