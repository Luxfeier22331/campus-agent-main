from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.check_public_source_tokens import (
    public_source_token_candidate_paths,
    scan_public_source_tokens,
)


class CheckPublicSourceTokensTest(unittest.TestCase):
    def test_rejects_real_source_tokens_in_public_text(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            source = root / "apps/app-api/test/example.test.ts"
            source.parent.mkdir(parents=True)
            source.write_text('const url = "https://www.muc.edu.cn/news.htm";\n', encoding="utf-8")

            with mock.patch(
                "scripts.check_public_source_tokens.worktree_paths",
                return_value=(source,),
            ):
                failures = scan_public_source_tokens(root=root)

        self.assertEqual(len(failures), 2)
        self.assertEqual(failures[0].path.as_posix(), "apps/app-api/test/example.test.ts")
        self.assertEqual(failures[0].token, "www.muc.edu.cn")
        self.assertEqual(failures[1].token, "muc.edu.cn")

    def test_repo_public_source_tokens_are_clean(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        self.assertEqual(scan_public_source_tokens(root=repo_root), ())

    def test_candidate_paths_include_expected_roots(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        paths = {
            path.relative_to(repo_root).as_posix()
            for path in public_source_token_candidate_paths(root=repo_root)
        }

        self.assertIn("apps/app-api/wrangler.toml", paths)
        self.assertIn("docs/reference/open-source-data.md", paths)
        self.assertIn("tests/ingestion/test_object_store_config.py", paths)


if __name__ == "__main__":
    unittest.main()
