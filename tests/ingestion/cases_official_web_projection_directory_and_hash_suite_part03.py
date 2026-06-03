from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from tests.ingestion.official_web_projection_test_support import (
    _block,
    _declarations_payload,
    _page_bundle_entry,
    _write_json,
    _write_output_page,
    replay_official_web_source_truth_local,
)


class OfficialWebProjectionDirectoryAndHashTestPart03(unittest.TestCase):
    def test_replay_official_web_source_truth_local_keeps_portal_like_directory_pages_in_manual_review(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            payload = _declarations_payload()
            payload["declarations"].insert(
                3,
                {
                    "declaration_id": "directory-page-primary",
                    "page_family": "directory_page",
                    "target_corpus": "official_web",
                    "target_collection": "muc_public_pages",
                    "projection_family": "directory_document",
                    "document_kind": "directory",
                    "action": "emit_document",
                },
            )
            _write_json(declarations_path, payload)
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_directory_portal_001",
                            raw_version_id="owver_directory_portal_001",
                            normalized_canonical_url="https://www.example.edu/",
                            page_family="directory_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_directory_portal_001",
                raw_version_id="owver_directory_portal_001",
                normalized_canonical_url="https://www.example.edu/",
                page_title="中央民族大学",
                page_family="directory_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_directory_portal_001",
                        raw_version_id="owver_directory_portal_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学",
                    ),
                    _block(
                        raw_asset_id="owasset_directory_portal_001",
                        raw_version_id="owver_directory_portal_001",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                    ),
                    _block(
                        raw_asset_id="owasset_directory_portal_001",
                        raw_version_id="owver_directory_portal_001",
                        row_id="p-1",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="2026.03.27",
                        parent_heading_path=["中央民族大学与北京丰台人才集团共建就业实习实践基地"],
                    ),
                    _block(
                        raw_asset_id="owasset_directory_portal_001",
                        raw_version_id="owver_directory_portal_001",
                        row_id="heading-2",
                        row_index=3,
                        block_order=3,
                        block_role="heading",
                        text="通知公告",
                    ),
                    _block(
                        raw_asset_id="owasset_directory_portal_001",
                        raw_version_id="owver_directory_portal_001",
                        row_id="link-1",
                        row_index=4,
                        block_order=4,
                        block_role="link",
                        text="图书馆",
                        parent_heading_path=["通知公告"],
                    ),
                    _block(
                        raw_asset_id="owasset_directory_portal_001",
                        raw_version_id="owver_directory_portal_001",
                        row_id="link-2",
                        row_index=5,
                        block_order=5,
                        block_role="link",
                        text="信息门户",
                        parent_heading_path=["通知公告"],
                    ),
                    _block(
                        raw_asset_id="owasset_directory_portal_001",
                        raw_version_id="owver_directory_portal_001",
                        row_id="heading-3",
                        row_index=6,
                        block_order=6,
                        block_role="heading",
                        text="中央民族大学党委举办树立和践行正确政绩观学习教育读书班",
                    ),
                    _block(
                        raw_asset_id="owasset_directory_portal_001",
                        raw_version_id="owver_directory_portal_001",
                        row_id="p-2",
                        row_index=7,
                        block_order=7,
                        block_role="paragraph",
                        text="2026.03.26",
                        parent_heading_path=[
                            "中央民族大学党委举办树立和践行正确政绩观学习教育读书班"
                        ],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(report.counts["emitted_documents"], 0)
            self.assertEqual(report.counts["manual_review_pages"], 1)
            self.assertEqual(report.manual_review_pages[0]["page_family"], "directory_page")
            self.assertIn("staged_only", report.manual_review_pages[0]["reason"])
