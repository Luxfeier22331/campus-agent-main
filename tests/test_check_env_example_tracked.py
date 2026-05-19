from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.check_env_example_tracked import (
    tracked_env_example_files,
    validate_env_example_file,
    validate_env_example_ownership,
)


class CheckEnvExampleTrackedTest(unittest.TestCase):
    def test_tracked_env_example_files_match_repo_examples(self) -> None:
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
                "*.env.example",
                "*.local.example",
                "*.dev.vars.example",
            ],
            check=True,
            capture_output=True,
            cwd=repo_root,
        )
        expected_paths = tuple(
            repo_root / decoded
            for item in expected.stdout.split(b"\0")
            if item
            and not (decoded := item.decode("utf-8")).startswith(".planning/")
            and "/vendor/" not in decoded
            and (repo_root / decoded).exists()
        )
        self.assertEqual(tracked_env_example_files(root=repo_root), expected_paths)

    def test_validate_env_example_file_accepts_comments_blank_lines_and_empty_values(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "valid.env.example"
            path.write_text(
                "# comment\n\nVALID_KEY=value\nEMPTY_VALUE=\nANOTHER_KEY=./var/path\n",
                encoding="utf-8",
            )
            self.assertEqual(validate_env_example_file(path), ())

    def test_validate_env_example_file_rejects_duplicate_keys(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "duplicate.env.example"
            path.write_text("VALID_KEY=one\nVALID_KEY=two\n", encoding="utf-8")
            failures = validate_env_example_file(path)
            self.assertEqual(len(failures), 1)
            self.assertIn("duplicate env key 'VALID_KEY'", failures[0])

    def test_validate_env_example_file_rejects_invalid_key_names(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "invalid-key.env.example"
            path.write_text("invalid-key=value\n", encoding="utf-8")
            failures = validate_env_example_file(path)
            self.assertEqual(len(failures), 1)
            self.assertIn("invalid env key 'invalid-key'", failures[0])

    def test_validate_env_example_file_rejects_missing_equals(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "missing-equals.env.example"
            path.write_text("MISSING_EQUALS\n", encoding="utf-8")
            failures = validate_env_example_file(path)
            self.assertEqual(len(failures), 1)
            self.assertIn("expected KEY=VALUE entry", failures[0])

    def test_validate_env_example_file_rejects_whitespace_around_key(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "spaced-key.env.example"
            path.write_text("KEY =value\n", encoding="utf-8")
            failures = validate_env_example_file(path)
            self.assertEqual(len(failures), 1)
            self.assertIn("surrounding whitespace", failures[0])

    def test_validate_env_example_file_rejects_leading_or_trailing_value_whitespace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "spaced-value.env.example"
            path.write_text("LEADING= value\nTRAILING=value \n", encoding="utf-8")

            failures = validate_env_example_file(path)

        self.assertEqual(len(failures), 2)
        self.assertTrue(
            all("must not contain leading or trailing whitespace" in item for item in failures)
        )

    def test_validate_env_example_file_rejects_trailing_whitespace_on_comment_lines(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "comment-trailing-space.env.example"
            path.write_text("# comment  \nVALID_KEY=value\n", encoding="utf-8")

            failures = validate_env_example_file(path)

        self.assertEqual(len(failures), 1)
        self.assertIn("trailing whitespace is not allowed", failures[0])

    def test_root_env_example_does_not_own_app_or_command_scoped_keys(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        failures = validate_env_example_ownership(repo_root / ".env.example")

        self.assertEqual(failures, ())
