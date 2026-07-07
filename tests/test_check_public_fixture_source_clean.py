from __future__ import annotations

import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.check_public_fixture_source_clean import (
    public_fixture_text_files,
    scan_public_fixture_source_tokens,
)


class CheckPublicFixtureSourceCleanTest(unittest.TestCase):
    def test_public_fixture_text_files_are_limited_to_public_fixture_roots(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        files = public_fixture_text_files(root=repo_root)
        relative_paths = {path.relative_to(repo_root).as_posix() for path in files}

        self.assertIn(
            "packages/eval-langfuse/assets/qrels/rag/student_rules/retrieval_qrels.json",
            relative_paths,
        )
        self.assertIn(
            "packages/contracts/fixtures/tool_execution_contract/tool_execution_delegate.valid.json",
            relative_paths,
        )
        self.assertIn(
            "apps/source-collector/adapters/official-web/test/assertions/pages/sample-news-home-page.html",
            relative_paths,
        )
        self.assertIn(
            "apps/source-collector/adapters/official-web/test/page-artifacts-test-support.ts",
            relative_paths,
        )
        self.assertIn(
            "apps/campus-web/test/fixtures/map-page-data.ts",
            relative_paths,
        )
        self.assertTrue(
            all(
                path.startswith(
                    (
                        "tests/fixtures/",
                        "packages/contracts/fixtures/",
                        "packages/eval-langfuse/assets/",
                        "packages/eval-langfuse/fixtures/",
                        "apps/source-collector/adapters/official-web/test/",
                        "apps/source-collector/adapters/official-web/test/assertions/pages/",
                        "apps/campus-web/test/fixtures/",
                    )
                )
                for path in relative_paths
            )
        )

    def test_scan_public_fixture_source_tokens_reports_forbidden_tokens(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            fixture_path = root / "tests/fixtures/example/source.jsonl"
            fixture_path.parent.mkdir(parents=True)
            fixture_path.write_text(
                json.dumps({"title": "中央民族大学示例"}, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )
            unrelated_path = root / "tests/not_fixture/source.json"
            unrelated_path.parent.mkdir(parents=True)
            unrelated_path.write_text(
                json.dumps({"title": "中央民族大学不在扫描范围"}, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )

            with mock.patch(
                "scripts.check_public_fixture_source_clean.worktree_paths",
                return_value=(fixture_path, unrelated_path),
            ):
                failures = scan_public_fixture_source_tokens(root=root)

        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0].path.as_posix(), "tests/fixtures/example/source.jsonl")
        self.assertEqual(failures[0].line_number, 1)
        self.assertEqual(failures[0].token, "中央民族大学")

    def test_repo_public_fixtures_are_source_clean(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        self.assertEqual(scan_public_fixture_source_tokens(root=repo_root), ())

    def test_script_matches_git_discovery_for_fixture_json_files(self) -> None:
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
                "tests/fixtures/**",
                "packages/contracts/fixtures/**",
                "packages/eval-langfuse/assets/**",
                "packages/eval-langfuse/fixtures/**",
                "apps/source-collector/adapters/official-web/test/**",
                "apps/source-collector/adapters/official-web/test/assertions/pages/**",
                "apps/campus-web/test/fixtures/**",
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
                (
                    "tests/fixtures/",
                    "packages/contracts/fixtures/",
                    "packages/eval-langfuse/assets/",
                    "packages/eval-langfuse/fixtures/",
                    "apps/source-collector/adapters/official-web/test/",
                    "apps/source-collector/adapters/official-web/test/assertions/pages/",
                    "apps/campus-web/test/fixtures/",
                )
            )
            and Path(decoded).suffix.lower()
            in {".html", ".json", ".jsonl", ".md", ".ts", ".txt", ".yaml", ".yml"}
            and (repo_root / decoded).exists()
        )

        self.assertEqual(public_fixture_text_files(root=repo_root), expected_paths)


if __name__ == "__main__":
    unittest.main()
