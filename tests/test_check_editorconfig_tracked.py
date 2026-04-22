from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.check_editorconfig_tracked import (
    _materialize_check_tree,
    editorconfig_checker_binary,
    main,
    tracked_editorconfig_files,
)


class CheckEditorconfigTrackedTest(unittest.TestCase):
    def test_tracked_editorconfig_files_match_repo_dotfile_inventory(self) -> None:
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
                ".editorconfig",
                ".gitattributes",
                ".gitignore",
                "**/.gitignore",
            ],
            check=True,
            capture_output=True,
            cwd=repo_root,
        )
        expected_paths = tuple(
            repo_root / decoded
            for item in expected.stdout.split(b"\0")
            if item
            for decoded in [item.decode("utf-8")]
            if not any(
                decoded.startswith(prefix)
                for prefix in (
                    ".planning/",
                    ".tmp/",
                    ".worktrees/",
                    "node_modules/",
                    "apps/public-chat-web/vendor/",
                )
            )
            and (repo_root / decoded).exists()
        )
        self.assertEqual(tracked_editorconfig_files(root=repo_root), expected_paths)

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
        with patch(
            "scripts.check_editorconfig_tracked.tracked_editorconfig_files",
            return_value=(
                repo_root / ".editorconfig",
                repo_root / ".gitignore",
                repo_root / "apps/public-docs/.gitignore",
            ),
        ):
            run_mock.return_value = subprocess.CompletedProcess(
                args=["editorconfig-checker"], returncode=0
            )

            exit_code = main()

        self.assertEqual(exit_code, 0)
        args = run_mock.call_args.args[0]
        cwd = run_mock.call_args.kwargs["cwd"]
        self.assertNotEqual(Path(cwd), repo_root)
        self.assertEqual(
            args,
            [str(repo_root / "node_modules/.bin/editorconfig-checker"), "-no-color"],
        )

    def test_materialize_check_tree_skips_missing_tracked_files(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        with tempfile.TemporaryDirectory() as temp_dir:
            target_dir = Path(temp_dir)
            _materialize_check_tree(
                target_dir,
                (
                    repo_root / ".gitignore",
                    repo_root / "apps/public-docs" / ".missing.gitignore",
                ),
                root=repo_root,
            )

            self.assertTrue((target_dir / ".editorconfig").exists())
            self.assertTrue((target_dir / ".gitignore").exists())
            self.assertFalse((target_dir / "apps/public-docs/.missing.gitignore").exists())
