from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.worktree_file_discovery import changed_worktree_paths, worktree_paths


class WorktreeFileDiscoveryTest(unittest.TestCase):
    @patch("scripts.worktree_file_discovery.subprocess.run")
    def test_worktree_paths_include_cached_and_untracked_entries_once_in_order(
        self, run_mock: subprocess.CompletedProcess[bytes]
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            tracked = root / "tracked.ts"
            untracked = root / "untracked.ts"
            tracked.write_text("export {};\n", encoding="utf-8")
            untracked.write_text("export {};\n", encoding="utf-8")
            run_mock.return_value = subprocess.CompletedProcess(
                args=["git"],
                returncode=0,
                stdout=b"tracked.ts\0untracked.ts\0tracked.ts\0",
            )

            files = worktree_paths("*.ts", root=root)

        self.assertEqual(files, (tracked, untracked))
        self.assertEqual(
            run_mock.call_args.args[0],
            [
                "git",
                "-c",
                "core.quotePath=false",
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
                "*.ts",
            ],
        )

    @patch("scripts.worktree_file_discovery.subprocess.run")
    def test_worktree_paths_skip_missing_entries(
        self, run_mock: subprocess.CompletedProcess[bytes]
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            existing = root / "README.md"
            existing.write_text("# hello\n", encoding="utf-8")
            run_mock.return_value = subprocess.CompletedProcess(
                args=["git"],
                returncode=0,
                stdout=b"README.md\0docs/missing.md\0",
            )

            files = worktree_paths("README.md", "docs", root=root)

        self.assertEqual(files, (existing,))

    @patch("scripts.worktree_file_discovery.subprocess.run")
    def test_worktree_paths_decode_non_ascii_paths(
        self, run_mock: subprocess.CompletedProcess[bytes]
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            target = root / "docs" / "你好.md"
            target.parent.mkdir(parents=True)
            target.write_text("hello\n", encoding="utf-8")
            run_mock.return_value = subprocess.CompletedProcess(
                args=["git"],
                returncode=0,
                stdout="docs/你好.md\0".encode(),
            )

            files = worktree_paths("docs", root=root)

        self.assertEqual(files, (target,))

    @patch("scripts.worktree_file_discovery.subprocess.run")
    def test_changed_worktree_paths_include_branch_worktree_and_untracked_files(
        self, run_mock: subprocess.CompletedProcess[bytes]
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            changed = root / "apps/campus-web/src/app.ts"
            staged = root / "scripts/check_repo_static.py"
            untracked = root / "tests/test_new.py"
            changed.parent.mkdir(parents=True)
            staged.parent.mkdir(parents=True)
            untracked.parent.mkdir(parents=True)
            changed.write_text("export {};\n", encoding="utf-8")
            staged.write_text("print('ok')\n", encoding="utf-8")
            untracked.write_text("import unittest\n", encoding="utf-8")
            run_mock.side_effect = [
                subprocess.CompletedProcess(args=["git"], returncode=0, stdout="abc123\n"),
                subprocess.CompletedProcess(
                    args=["git"],
                    returncode=0,
                    stdout="apps/campus-web/src/app.ts\0missing.py\0",
                ),
                subprocess.CompletedProcess(
                    args=["git"],
                    returncode=0,
                    stdout="scripts/check_repo_static.py\0",
                ),
                subprocess.CompletedProcess(
                    args=["git"],
                    returncode=0,
                    stdout="apps/campus-web/src/app.ts\0",
                ),
                subprocess.CompletedProcess(
                    args=["git"],
                    returncode=0,
                    stdout="tests/test_new.py\0",
                ),
            ]

            files = changed_worktree_paths(root=root, base_ref="origin/develop")

        self.assertEqual(files, (changed, staged, untracked))


if __name__ == "__main__":
    unittest.main()
