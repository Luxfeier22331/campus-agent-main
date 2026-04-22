from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.check_shell_syntax import tracked_shell_files, validate_shell_file


class CheckShellSyntaxTest(unittest.TestCase):
    def test_tracked_shell_files_match_git_ls_files(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        expected = subprocess.run(
            ["git", "ls-files", "*.sh"],
            check=True,
            capture_output=True,
            text=True,
            cwd=repo_root,
        )
        expected_paths = tuple(
            repo_root / line for line in expected.stdout.splitlines() if line.strip()
        )
        self.assertEqual(tracked_shell_files(root=repo_root), expected_paths)

    def test_validate_shell_file_raises_for_invalid_script(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "broken.sh"
            path.write_text("#!/usr/bin/env bash\nif [\n", encoding="utf-8")
            with self.assertRaises(subprocess.CalledProcessError):
                validate_shell_file(path)
