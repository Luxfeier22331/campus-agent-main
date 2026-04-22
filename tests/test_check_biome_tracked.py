from __future__ import annotations

import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.check_biome_tracked import tracked_biome_files


class CheckBiomeTrackedTest(unittest.TestCase):
    def test_tracked_biome_files_match_git_ls_files(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        expected = subprocess.run(
            [
                "git",
                "ls-files",
                ".markdownlint-cli2.jsonc",
                "biome.jsonc",
                "package.json",
                "turbo.json",
                "apps",
                "packages",
                "configs",
                "scripts",
                "tests",
            ],
            check=True,
            capture_output=True,
            text=True,
            cwd=repo_root,
        )
        expected_paths = tuple(
            path
            for line in expected.stdout.splitlines()
            if line.strip()
            for path in [repo_root / line]
            if path.exists()
        )
        self.assertEqual(tracked_biome_files(root=repo_root), expected_paths)

    @patch("scripts.check_biome_tracked.subprocess.run")
    def test_tracked_biome_files_skip_missing_worktree_paths(
        self, run_mock: subprocess.CompletedProcess[str]
    ) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        existing_file = repo_root / "package.json"
        missing_file = repo_root / "configs/ingestion/regulations/student_handbook/README.md"

        run_mock.return_value = subprocess.CompletedProcess(
            args=["git"],
            returncode=0,
            stdout="package.json\nconfigs/ingestion/regulations/student_handbook/README.md\n",
        )

        self.assertEqual(tracked_biome_files(root=repo_root), (existing_file,))
        self.assertFalse(missing_file.exists())
