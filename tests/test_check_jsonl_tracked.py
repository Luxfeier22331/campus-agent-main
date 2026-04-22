from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.check_jsonl_tracked import tracked_jsonl_files, validate_jsonl_file


class CheckJsonlTrackedTest(unittest.TestCase):
    def test_tracked_jsonl_files_match_repo_inventory(self) -> None:
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
                "*.jsonl",
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
        self.assertEqual(tracked_jsonl_files(root=repo_root), expected_paths)

    def test_validate_jsonl_file_accepts_blank_lines_and_valid_json_records(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "valid.jsonl"
            path.write_text(
                json.dumps({"id": 1})
                + "\n\n"
                + json.dumps({"id": 2, "nested": {"ok": True}})
                + "\n",
                encoding="utf-8",
            )
            self.assertEqual(validate_jsonl_file(path), ())

    def test_validate_jsonl_file_reports_invalid_line_numbers(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "broken.jsonl"
            path.write_text('{"ok": true}\n{"broken":\n', encoding="utf-8")
            failures = validate_jsonl_file(path)
            self.assertEqual(len(failures), 1)
            self.assertIn("line 2", failures[0])
            self.assertIn("JSON", failures[0])

    def test_validate_jsonl_file_rejects_non_object_records(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "array.jsonl"
            path.write_text('{"ok": true}\n["not", "an", "object"]\n', encoding="utf-8")

            failures = validate_jsonl_file(path)

        self.assertEqual(len(failures), 1)
        self.assertIn("line 2", failures[0])
        self.assertIn("must decode to a JSON object", failures[0])

    def test_validate_jsonl_file_enforces_provider_result_minimum_shape(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "provider-result-sample.jsonl"
            path.write_text(json.dumps({"result": {}}) + "\n", encoding="utf-8")

            failures = validate_jsonl_file(path)

        self.assertEqual(len(failures), 1)
        self.assertIn("missing required key 'logId'", failures[0])

    def test_validate_jsonl_file_enforces_layout_elements_minimum_shape(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "layout-elements.pages-001-002.jsonl"
            path.write_text(
                json.dumps({"schema_version": "v1", "row_id": "row-1"}) + "\n", encoding="utf-8"
            )

            failures = validate_jsonl_file(path)

        self.assertEqual(len(failures), 1)
        self.assertIn("missing required key 'row_type'", failures[0])

    def test_validate_jsonl_file_enforces_structured_sample_minimum_shape(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            path = Path(tmp_dir) / "sample.structured.jsonl"
            path.write_text(
                json.dumps(
                    {
                        "doc_id": "doc-1",
                        "version_id": "v1",
                        "chunk_id": "chunk-1",
                        "clean_text": "hello",
                        "page_start": 1,
                        "page_end": 1,
                    }
                )
                + "\n",
                encoding="utf-8",
            )

            failures = validate_jsonl_file(path)

        self.assertEqual(len(failures), 1)
        self.assertIn("missing required key 'source'", failures[0])
