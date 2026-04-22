from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.check_xml_tracked import tracked_xml_files, validate_xml_file


class CheckXmlTrackedTest(unittest.TestCase):
    def test_tracked_xml_files_match_repo_inventory(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        expected = subprocess.run(
            ["git", "-c", "core.quotePath=false", "ls-files", "-z", "*.xml"],
            check=True,
            capture_output=True,
            cwd=repo_root,
        )
        expected_paths = tuple(
            repo_root / decoded
            for item in expected.stdout.split(b"\0")
            if item and not (decoded := item.decode("utf-8")).startswith(".planning/")
        )

        self.assertEqual(tracked_xml_files(root=repo_root), expected_paths)

    def test_validate_xml_file_raises_for_malformed_xml(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            malformed = Path(tmp_dir) / "broken.xml"
            malformed.write_text("<project><broken></project>", encoding="utf-8")

            with self.assertRaises(Exception):
                validate_xml_file(malformed)
