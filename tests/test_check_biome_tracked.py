from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

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
            repo_root / line for line in expected.stdout.splitlines() if line.strip()
        )
        self.assertEqual(tracked_biome_files(root=repo_root), expected_paths)
