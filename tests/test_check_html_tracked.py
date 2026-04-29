from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.check_html_tracked import (
    tracked_html_files,
    validate_html_file,
)


class CheckHtmlTrackedTest(unittest.TestCase):
    def test_tracked_html_files_match_repo_inventory(self) -> None:
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
                "*.html",
                "apps/**/*.html",
            ],
            check=True,
            capture_output=True,
            cwd=repo_root,
        )
        expected_paths = tuple(
            repo_root / decoded
            for item in expected.stdout.split(b"\0")
            if item
            and (decoded := item.decode("utf-8")).endswith(".html")
            and not decoded.startswith((".planning/", ".tmp/", ".worktrees/"))
            and "/vendor/" not in decoded
            and "/node_modules/" not in decoded
            and (repo_root / decoded).exists()
        )

        self.assertEqual(tracked_html_files(root=repo_root), expected_paths)

    def test_validate_html_file_reports_malformed_html(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            malformed = Path(tmp_dir) / "broken.html"
            malformed.write_text(
                "<!doctype html><html><body><div></span></body></html>",
                encoding="utf-8",
            )

            errors = validate_html_file(malformed)

        self.assertTrue(errors)

    def test_validate_html_file_requires_doctype(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            missing_doctype = Path(tmp_dir) / "missing-doctype.html"
            missing_doctype.write_text(
                "<html><head><title>Example</title></head><body><main>ok</main></body></html>",
                encoding="utf-8",
            )

            errors = validate_html_file(missing_doctype)

        self.assertIn("missing <!doctype html> declaration", errors)

    def test_validate_html_file_requires_head_and_nonempty_title(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            missing_title = Path(tmp_dir) / "missing-title.html"
            missing_title.write_text(
                "<!doctype html><html><body><main>ok</main></body></html>",
                encoding="utf-8",
            )

            errors = validate_html_file(missing_title)

        self.assertIn("missing <head> element", errors)
        self.assertIn("missing non-empty <title> element", errors)

    def test_validate_html_file_accepts_complete_document_structure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            valid = Path(tmp_dir) / "valid.html"
            valid.write_text(
                "\n".join(
                    [
                        "<!doctype html>",
                        '<html lang="en">',
                        "<head>",
                        '<meta charset="UTF-8" />',
                        "<title>Example</title>",
                        "</head>",
                        "<body>",
                        '<div id="root"></div>',
                        "</body>",
                        "</html>",
                    ]
                ),
                encoding="utf-8",
            )

            self.assertEqual(validate_html_file(valid), ())
