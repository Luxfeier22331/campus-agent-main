from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.check_source_derived_config_clean import (
    scan_source_derived_config_tokens,
    source_config_text_files,
)


class CheckSourceDerivedConfigCleanTest(unittest.TestCase):
    def test_source_config_text_files_are_limited_to_config_roots(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        files = source_config_text_files(root=repo_root)
        relative_paths = {path.relative_to(repo_root).as_posix() for path in files}

        self.assertIn(
            "configs/ingestion/curriculum/curriculum_plan/split-manifest.v1.json",
            relative_paths,
        )
        self.assertIn(
            "configs/sources/official_web/muc_public/site.json",
            relative_paths,
        )
        self.assertTrue(
            all(
                path.startswith(("configs/ingestion/", "configs/sources/"))
                for path in relative_paths
            )
        )

    def test_scan_source_derived_config_tokens_reports_forbidden_tokens(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            config_path = root / "configs/ingestion/example/source.json"
            config_path.parent.mkdir(parents=True)
            config_path.write_text(
                json.dumps({"title": "中央民族大学示例"}, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            unrelated_path = root / "tests/fixtures/example/source.json"
            unrelated_path.parent.mkdir(parents=True)
            unrelated_path.write_text(
                json.dumps({"title": "中央民族大学不在扫描范围"}, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )

            with mock.patch(
                "scripts.check_source_derived_config_clean.worktree_paths",
                return_value=(config_path, unrelated_path),
            ):
                failures = scan_source_derived_config_tokens(root=root)

        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0].path.as_posix(), "configs/ingestion/example/source.json")
        self.assertEqual(failures[0].line_number, 1)
        self.assertEqual(failures[0].token, "中央民族大学")

    def test_repo_source_configs_are_source_clean(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        self.assertEqual(scan_source_derived_config_tokens(root=repo_root), ())

    def test_script_matches_git_discovery_for_source_config_files(self) -> None:
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
                "configs/ingestion/**",
                "configs/sources/**",
            ],
            check=True,
            capture_output=True,
            cwd=repo_root,
        )
        expected_paths = tuple(
            repo_root / decoded
            for item in expected.stdout.split(b"\0")
            if item
            and (decoded := item.decode("utf-8")).startswith(
                ("configs/ingestion/", "configs/sources/")
            )
            and Path(decoded).suffix.lower()
            in {".json", ".jsonl", ".md", ".sql", ".toml", ".txt", ".yaml", ".yml"}
            and (repo_root / decoded).exists()
        )

        self.assertEqual(source_config_text_files(root=repo_root), expected_paths)


if __name__ == "__main__":
    unittest.main()
