from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.check_toml_syntax import tracked_toml_files, validate_toml_file


class CheckTomlSyntaxTest(unittest.TestCase):
    def test_tracked_toml_files_match_git_ls_files(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        expected = subprocess.run(
            ["git", "ls-files", "*.toml"],
            check=True,
            capture_output=True,
            text=True,
            cwd=repo_root,
        )
        expected_paths = tuple(
            repo_root / line for line in expected.stdout.splitlines() if line.strip()
        )
        self.assertEqual(tracked_toml_files(root=repo_root), expected_paths)

    def test_validate_toml_file_raises_for_invalid_document(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "broken.toml"
            path.write_text("key = [\n", encoding="utf-8")
            with self.assertRaises(Exception):
                validate_toml_file(path)
