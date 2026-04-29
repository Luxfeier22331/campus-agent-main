from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.worktree_file_discovery import worktree_paths


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


if __name__ == "__main__":
    unittest.main()
