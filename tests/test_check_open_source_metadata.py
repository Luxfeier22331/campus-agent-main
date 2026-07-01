from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.check_open_source_metadata import audit_open_source_metadata


class CheckOpenSourceMetadataTest(unittest.TestCase):
    def test_repo_open_source_metadata_is_aligned(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        self.assertEqual(audit_open_source_metadata(root=repo_root), ())

    def test_reports_missing_root_repository_metadata_and_wrong_license(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            package_path = root / "package.json"
            package_path.write_text(
                json.dumps({"name": "demo", "private": True, "license": "MIT"}),
                encoding="utf-8",
            )

            with mock.patch(
                "scripts.check_open_source_metadata.worktree_paths",
                return_value=(package_path,),
            ):
                failures = audit_open_source_metadata(root=root)

        rendered = {failure.render() for failure in failures}
        self.assertIn("package.json: license must be Apache-2.0", rendered)
        self.assertIn("package.json: root package.json must define repository", rendered)
        self.assertIn("package.json: root package.json must define homepage", rendered)
        self.assertIn("package.json: root package.json must define bugs", rendered)

    def test_reports_workspace_package_that_is_not_private(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            package_path = root / "apps/app-api/package.json"
            package_path.parent.mkdir(parents=True)
            package_path.write_text(
                json.dumps({"name": "app-api", "license": "Apache-2.0"}),
                encoding="utf-8",
            )

            with mock.patch(
                "scripts.check_open_source_metadata.worktree_paths",
                return_value=(package_path,),
            ):
                failures = audit_open_source_metadata(root=root)

        self.assertEqual(len(failures), 1)
        self.assertEqual(
            failures[0].render(),
            (
                "apps/app-api/package.json: workspace package.json must remain private "
                "unless publication is explicitly designed"
            ),
        )

    def test_reports_pyproject_license_drift(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            pyproject_path = root / "packages/example/pyproject.toml"
            pyproject_path.parent.mkdir(parents=True)
            pyproject_path.write_text('[project]\nname = "example"\nlicense = "MIT"\n')

            with mock.patch(
                "scripts.check_open_source_metadata.worktree_paths",
                return_value=(pyproject_path,),
            ):
                failures = audit_open_source_metadata(root=root)

        self.assertEqual(
            failures[0].render(),
            "packages/example/pyproject.toml: license must be Apache-2.0",
        )


if __name__ == "__main__":
    unittest.main()
