from __future__ import annotations

import json
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


class OfficialWebProjectionArticleUnitsTestPart01(unittest.TestCase):
    def test_article_projection_marks_terminal_attachment_and_signature_lines_support_only(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_attachment_tail_001",
                    "generatedAt": "2026-04-27T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_article_attachment_tail_001",
                            raw_version_id="owver_article_attachment_tail_001",
                            normalized_canonical_url="https://xxgk.example.edu/info/1358/29241.htm",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.example.edu",
                raw_asset_id="owasset_article_attachment_tail_001",
                raw_version_id="owver_article_attachment_tail_001",
                normalized_canonical_url="https://xxgk.example.edu/info/1358/29241.htm",
                page_title="中央民族大学公开招聘经济学院院长启事",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_attachment_tail_001",
                        raw_version_id="owver_article_attachment_tail_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学公开招聘经济学院院长启事",
                    ),
                    _block(
                        raw_asset_id="owasset_article_attachment_tail_001",
                        raw_version_id="owver_article_attachment_tail_001",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="请于2026年6月30日前将以上材料电子版及扫描件发送至指定邮箱。",
                        parent_heading_path=["中央民族大学公开招聘经济学院院长启事"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_attachment_tail_001",
                        raw_version_id="owver_article_attachment_tail_001",
                        row_id="attachment-label",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="附件：中央民族大学公开招聘经济学院院长自荐表",
                        parent_heading_path=["中央民族大学公开招聘经济学院院长启事"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_attachment_tail_001",
                        raw_version_id="owver_article_attachment_tail_001",
                        row_id="signature-org",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="中央民族大学",
                        parent_heading_path=["中央民族大学公开招聘经济学院院长启事"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_attachment_tail_001",
                        raw_version_id="owver_article_attachment_tail_001",
                        row_id="signature-date",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="2026年4月24日",
                        parent_heading_path=["中央民族大学公开招聘经济学院院长启事"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_attachment_tail_001",
                        raw_version_id="owver_article_attachment_tail_001",
                        row_id="attachment-download",
                        row_index=5,
                        block_order=5,
                        block_role="list_item",
                        text="附件【中央民族大学公开招聘经济学院院长自荐表.docx】已下载次",
                        parent_heading_path=["中央民族大学公开招聘经济学院院长启事"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_attachment_tail_001",
                        raw_version_id="owver_article_attachment_tail_001",
                        row_id="attachment-file",
                        row_index=6,
                        block_order=6,
                        block_role="link",
                        text="中央民族大学公开招聘经济学院院长自荐表.docx",
                        parent_heading_path=["中央民族大学公开招聘经济学院院长启事"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            units = [
                json.loads(line)
                for line in Path(report.documents[0]["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]
            canonical = Path(report.documents[0]["canonical_markdown_path"]).read_text(
                encoding="utf-8"
            )

        self.assertEqual(
            [unit["metadata"]["content_role"] for unit in units],
            [
                "primary_content",
                "attachment_reference",
                "terminal_signature",
                "attachment_reference",
            ],
        )
        self.assertEqual(
            [unit["metadata"]["is_answer_bearing"] for unit in units],
            [True, False, False, False],
        )
        self.assertIn("请于2026年6月30日前", canonical)
        self.assertNotIn("附件：中央民族大学公开招聘经济学院院长自荐表", canonical)
        self.assertNotIn("中央民族大学公开招聘经济学院院长自荐表.docx", canonical)

    def test_article_projection_skips_leading_listing_noise_before_first_paragraph(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
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
                            raw_asset_id="owasset_article_001",
                            raw_version_id="owver_article_001",
                            normalized_canonical_url="https://www.example.edu/about",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_article_001",
                raw_version_id="owver_article_001",
                normalized_canonical_url="https://www.example.edu/about",
                page_title="学校概况",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_001",
                        raw_version_id="owver_article_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="学校概况",
                    ),
                    _block(
                        raw_asset_id="owasset_article_001",
                        raw_version_id="owver_article_001",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="学校概况",
                    ),
                    _block(
                        raw_asset_id="owasset_article_001",
                        raw_version_id="owver_article_001",
                        row_id="list-1",
                        row_index=2,
                        block_order=2,
                        block_role="list_item",
                        text="学校简介",
                        parent_heading_path=["学校概况"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_001",
                        raw_version_id="owver_article_001",
                        row_id="link-1",
                        row_index=3,
                        block_order=3,
                        block_role="link",
                        text="学校简介",
                        parent_heading_path=["学校概况"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_001",
                        raw_version_id="owver_article_001",
                        row_id="heading-2",
                        row_index=4,
                        block_order=4,
                        block_role="heading",
                        text="学校简介",
                        parent_heading_path=["学校概况"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_001",
                        raw_version_id="owver_article_001",
                        row_id="p-1",
                        row_index=5,
                        block_order=5,
                        block_role="paragraph",
                        text="中央民族大学是一所特色鲜明的高等院校。",
                        parent_heading_path=["学校概况", "学校简介"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            canonical = Path(report.documents[0]["canonical_markdown_path"]).read_text(
                encoding="utf-8"
            )

            self.assertIn("## 学校简介", canonical)
            self.assertIn("中央民族大学是一所特色鲜明的高等院校。", canonical)
            self.assertNotIn("- 学校简介", canonical)
            self.assertEqual(canonical.count("学校简介"), 1)

    def test_article_projection_splits_multi_paragraph_sections_before_becoming_one_giant_unit(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_article_split_001",
                    "generatedAt": "2026-04-03T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_article_split_001",
                            raw_version_id="owver_article_split_001",
                            normalized_canonical_url="https://www.example.edu/about/overview.htm",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_article_split_001",
                raw_version_id="owver_article_split_001",
                normalized_canonical_url="https://www.example.edu/about/overview.htm",
                page_title="学校概况",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_split_001",
                        raw_version_id="owver_article_split_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="学校概况",
                    ),
                    _block(
                        raw_asset_id="owasset_article_split_001",
                        raw_version_id="owver_article_split_001",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="学校简介",
                        parent_heading_path=["学校概况"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_split_001",
                        raw_version_id="owver_article_split_001",
                        row_id="p-1",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="中央民族大学是一所特色鲜明的高等院校。",
                        parent_heading_path=["学校概况", "学校简介"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_split_001",
                        raw_version_id="owver_article_split_001",
                        row_id="p-2",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="学校坚持铸牢中华民族共同体意识主线。",
                        parent_heading_path=["学校概况", "学校简介"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_split_001",
                        raw_version_id="owver_article_split_001",
                        row_id="p-3",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="现有海淀校区、丰台校区和海南校区。",
                        parent_heading_path=["学校概况", "学校简介"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_split_001",
                        raw_version_id="owver_article_split_001",
                        row_id="p-4",
                        row_index=5,
                        block_order=5,
                        block_role="paragraph",
                        text="学校形成了多学科协调发展的办学格局。",
                        parent_heading_path=["学校概况", "学校简介"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            units = [
                json.loads(line)
                for line in Path(report.documents[0]["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

            self.assertEqual(len(units), 2)
            self.assertTrue(all(unit["unit_type"] == "section_text" for unit in units))
            self.assertTrue(
                all(unit["anchor"]["section_path"] == ["学校概况", "学校简介"] for unit in units)
            )
            self.assertLessEqual(max(len(unit["anchor"]["row_ids"]) for unit in units), 3)
            combined_text = "\n".join(unit["clean_text"] for unit in units)
            self.assertIn("中央民族大学是一所特色鲜明的高等院校。", combined_text)
            self.assertIn("学校坚持铸牢中华民族共同体意识主线。", combined_text)
            self.assertIn("现有海淀校区、丰台校区和海南校区。", combined_text)
            self.assertIn("学校形成了多学科协调发展的办学格局。", combined_text)
            self.assertFalse(
                any(
                    "中央民族大学是一所特色鲜明的高等院校。" in unit["clean_text"]
                    and "学校形成了多学科协调发展的办学格局。" in unit["clean_text"]
                    for unit in units
                )
            )
