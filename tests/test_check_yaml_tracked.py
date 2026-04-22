from __future__ import annotations

import subprocess
import unittest
from pathlib import Path

from scripts.check_yaml_tracked import tracked_yaml_files


class CheckYamlTrackedTest(unittest.TestCase):
    def test_tracked_yaml_files_match_git_ls_files_without_planning(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        expected = subprocess.run(
            ["git", "-c", "core.quotePath=false", "ls-files", "-z", "*.yml", "*.yaml"],
            check=True,
            capture_output=True,
            cwd=repo_root,
        )
        expected_paths = tuple(
            repo_root / decoded
            for item in expected.stdout.split(b"\0")
            if item and not (decoded := item.decode("utf-8")).startswith(".planning/")
        )
        self.assertEqual(tracked_yaml_files(root=repo_root), expected_paths)
        self.assertTrue(
            all(".planning" not in str(path.relative_to(repo_root)) for path in expected_paths)
        )
