from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.check_object_store_bucket_policy import scan_object_store_bucket_policy


class CheckObjectStoreBucketPolicyTest(unittest.TestCase):
    def test_rejects_retired_object_store_and_project_tokens(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            fixture = root / "apps/campus-web/wrangler.toml"
            fixture.parent.mkdir(parents=True)
            fixture.write_text(
                "\n".join(
                    (
                        'bucket_name = "campus-map-data-staging"',
                        'OBJECT_STORE_BUCKET_SOURCE = "campus-rag-source"',
                        'OBJECT_STORE_BUCKET_DERIVED = "campus-rag-derived"',
                        'source_uri = "campusrag://promotion/internal_notice/1"',
                        "from campus_ingestion_core.campusrag_ingestion_support import utc_now",
                    )
                ),
                encoding="utf-8",
            )

            with mock.patch(
                "scripts.check_object_store_bucket_policy.worktree_paths",
                return_value=(fixture,),
            ):
                failures = scan_object_store_bucket_policy(root=root)

        self.assertEqual(
            [failure.token for failure in failures],
            [
                "campus-map-data",
                "campus-rag-",
                "campus-rag-",
                "campusrag://",
                "campusrag_ingestion",
            ],
        )
        self.assertTrue(
            all(failure.path.as_posix() == "apps/campus-web/wrangler.toml" for failure in failures)
        )

    def test_repo_bucket_policy_is_clean(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        self.assertEqual(scan_object_store_bucket_policy(root=repo_root), ())


if __name__ == "__main__":
    unittest.main()
