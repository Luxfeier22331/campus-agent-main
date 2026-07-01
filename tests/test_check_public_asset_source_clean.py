from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.check_public_asset_source_clean import (
    public_asset_files,
    scan_public_asset_source_tokens,
)


class CheckPublicAssetSourceCleanTest(unittest.TestCase):
    def test_rejects_tracked_campus_web_map_assets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            asset_path = root / "apps/campus-web/public/map-assets/haidian-campus.geojson"
            asset_path.parent.mkdir(parents=True)
            asset_path.write_text('{"type":"FeatureCollection","features":[]}', encoding="utf-8")

            with mock.patch(
                "scripts.check_public_asset_source_clean.worktree_paths",
                return_value=(asset_path,),
            ):
                failures = scan_public_asset_source_tokens(root=root)

        self.assertEqual(len(failures), 1)
        self.assertEqual(
            failures[0].path.as_posix(), "apps/campus-web/public/map-assets/haidian-campus.geojson"
        )
        self.assertEqual(failures[0].token, "repo_public_map_asset")

    def test_rejects_tracked_dining_review_media(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            asset_path = root / "apps/campus-web/public/assets/dining/reviews/photo.jpg"
            asset_path.parent.mkdir(parents=True)
            asset_path.write_bytes(b"jpeg")

            with mock.patch(
                "scripts.check_public_asset_source_clean.worktree_paths",
                return_value=(asset_path,),
            ):
                failures = scan_public_asset_source_tokens(root=root)

        self.assertEqual(len(failures), 1)
        self.assertEqual(
            failures[0].path.as_posix(),
            "apps/campus-web/public/assets/dining/reviews/photo.jpg",
        )
        self.assertEqual(failures[0].token, "repo_public_dining_review_media")

    def test_rejects_source_tokens_in_synthetic_map_fixtures(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            fixture_path = root / "apps/campus-web/test/fixtures/demo-map.geojson"
            fixture_path.parent.mkdir(parents=True)
            fixture_path.write_text(
                '{"license":"OpenStreetMap data is available under the Open Database License"}',
                encoding="utf-8",
            )

            with mock.patch(
                "scripts.check_public_asset_source_clean.worktree_paths",
                return_value=(fixture_path,),
            ):
                failures = scan_public_asset_source_tokens(root=root)

        self.assertEqual(len(failures), 2)
        self.assertEqual(
            {failure.token for failure in failures}, {"OpenStreetMap", "Open Database License"}
        )

    def test_repo_public_assets_are_source_clean(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        self.assertEqual(scan_public_asset_source_tokens(root=repo_root), ())

    def test_public_asset_files_include_campus_map_fixture_roots(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]

        relative_paths = {
            path.relative_to(repo_root).as_posix() for path in public_asset_files(root=repo_root)
        }

        self.assertIn("apps/campus-web/test/fixtures/map-manifest.ts", relative_paths)


if __name__ == "__main__":
    unittest.main()
