from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from scripts.check_env_example_tracked import (
    tracked_env_example_files,
    validate_env_example_file,
)


class CheckEnvExampleTrackedTest(unittest.TestCase):
    def test_tracked_env_example_files_match_repo_examples(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        expected_paths = (
            repo_root / ".env.example",
            repo_root / "env/commands/compare-online-ocr.env.example",
            repo_root / "env/commands/historical/migrate-student-handbook.env.example",
            repo_root / "env/commands/historical/official-web-history-backfill.env.example",
            repo_root / "env/commands/legacy-office-conversion-service.env.example",
            repo_root / "env/commands/official-web-handoff-consumer.env.example",
            repo_root / "env/commands/official-web-handoff-receiver.env.example",
            repo_root / "env/commands/process-raw-ingestion-job.env.example",
            repo_root / "env/commands/rebuild-local-data.env.example",
            repo_root / "env/commands/release-registry-scope.env.example",
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
