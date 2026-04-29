from __future__ import annotations

import unittest

from .official_web_projection_test_support import *


class OfficialWebProjectionListingUnitsFilteringSecondaryTest(unittest.TestCase):
    def test_listing_projection_skips_trailing_main_content_short_label_rows_before_next_heading(
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
                    "crawlRunId": "owrun_projection_001",
                    "generatedAt": "2026-03-31T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_listing_004d",
                            raw_version_id="owver_listing_004d",
                            normalized_canonical_url="https://www.example.edu/news/trailing-tabs/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_004d",
                raw_version_id="owver_listing_004d",
                normalized_canonical_url="https://www.example.edu/news/trailing-tabs/",
                page_title="中央民族大学新闻网",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_004d",
                        raw_version_id="owver_listing_004d",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学新闻网",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004d",
                        raw_version_id="owver_listing_004d",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="校长强世功接受“统战新语”专访 解读民族团结进步促进法",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004d",
                        raw_version_id="owver_listing_004d",
                        row_id="item-1",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="中央民族大学党委举办树立和践行正确政绩观学习教育读书班",
                        parent_heading_path=["校长强世功接受“统战新语”专访 解读民族团结进步促进法"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004d",
                        raw_version_id="owver_listing_004d",
                        row_id="label-1",
                        row_index=3,
                        block_order=3,
                        block_role="list_item",
                        text="教学科研",
                        parent_heading_path=["校长强世功接受“统战新语”专访 解读民族团结进步促进法"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004d",
                        raw_version_id="owver_listing_004d",
                        row_id="label-2",
                        row_index=4,
                        block_order=4,
                        block_role="list_item",
                        text="校园经纬",
                        parent_heading_path=["校长强世功接受“统战新语”专访 解读民族团结进步促进法"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004d",
                        raw_version_id="owver_listing_004d",
                        row_id="label-3",
                        row_index=5,
                        block_order=5,
                        block_role="list_item",
                        text="全球合作",
                        parent_heading_path=["校长强世功接受“统战新语”专访 解读民族团结进步促进法"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004d",
                        raw_version_id="owver_listing_004d",
                        row_id="heading-2",
                        row_index=6,
                        block_order=6,
                        block_role="heading",
                        text="中央民族大学举办中国历史研究院2025年度重大招标项目开题论证会",
                        parent_heading_path=["校长强世功接受“统战新语”专访 解读民族团结进步促进法"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004d",
                        raw_version_id="owver_listing_004d",
                        row_id="item-2",
                        row_index=7,
                        block_order=7,
                        block_role="link",
                        text="中央民族大学举办中国历史研究院2025年度重大招标项目开题论证会",
                        parent_heading_path=[
                            "校长强世功接受“统战新语”专访 解读民族团结进步促进法",
                            "中央民族大学举办中国历史研究院2025年度重大招标项目开题论证会",
                        ],
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

            self.assertIn("- 中央民族大学党委举办树立和践行正确政绩观学习教育读书班", canonical)
            self.assertIn(
                "- 中央民族大学举办中国历史研究院2025年度重大招标项目开题论证会", canonical
            )
            self.assertNotIn("教学科研", canonical)
            self.assertNotIn("校园经纬", canonical)
            self.assertNotIn("全球合作", canonical)

    def test_listing_projection_skips_trailing_teaser_cluster_rows(self) -> None:
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
                            raw_asset_id="owasset_listing_004e",
                            raw_version_id="owver_listing_004e",
                            normalized_canonical_url="https://www.example.edu/news/special-topics/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_004e",
                raw_version_id="owver_listing_004e",
                normalized_canonical_url="https://www.example.edu/news/special-topics/",
                page_title="中央民族大学新闻网",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_004e",
                        raw_version_id="owver_listing_004e",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学新闻网",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004e",
                        raw_version_id="owver_listing_004e",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="专题报道",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004e",
                        raw_version_id="owver_listing_004e",
                        row_id="item-1",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="【专题报道】深入贯彻中央八项规定精神学习教育",
                        parent_heading_path=["专题报道"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004e",
                        raw_version_id="owver_listing_004e",
                        row_id="teaser-1",
                        row_index=3,
                        block_order=3,
                        block_role="list_item",
                        text="24张，集齐一整年的民大",
                        parent_heading_path=["专题报道"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004e",
                        raw_version_id="owver_listing_004e",
                        row_id="teaser-2",
                        row_index=4,
                        block_order=4,
                        block_role="list_item",
                        text="中国新闻网 | 这所大学如何让石榴花开别样红？",
                        parent_heading_path=["专题报道"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004e",
                        raw_version_id="owver_listing_004e",
                        row_id="teaser-3",
                        row_index=5,
                        block_order=5,
                        block_role="list_item",
                        text="民大学子在帕米尔高原与边防官兵同唱国歌、同升国旗",
                        parent_heading_path=["专题报道"],
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
            units_lines = Path(report.documents[0]["document_units_path"]).read_text(
                encoding="utf-8"
            )

            self.assertIn("【专题报道】深入贯彻中央八项规定精神学习教育", canonical)
            self.assertNotIn("24张，集齐一整年的民大", canonical)
            self.assertNotIn("中国新闻网 | 这所大学如何让石榴花开别样红？", canonical)
            self.assertNotIn("民大学子在帕米尔高原与边防官兵同唱国歌、同升国旗", canonical)
            self.assertNotIn("24张，集齐一整年的民大", units_lines)
            self.assertNotIn("中国新闻网 | 这所大学如何让石榴花开别样红？", units_lines)
            self.assertNotIn("民大学子在帕米尔高原与边防官兵同唱国歌、同升国旗", units_lines)

    def test_listing_projection_skips_late_title_date_duplicate_after_summary_card(self) -> None:
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
                            raw_asset_id="owasset_listing_005",
                            raw_version_id="owver_listing_005",
                            normalized_canonical_url="https://www.example.edu/history/news/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_005",
                raw_version_id="owver_listing_005",
                normalized_canonical_url="https://www.example.edu/history/news/",
                page_title="首页",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_005",
                        raw_version_id="owver_listing_005",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="首页",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_005",
                        raw_version_id="owver_listing_005",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="资讯公告NEWS&NOTICS",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_005",
                        raw_version_id="owver_listing_005",
                        row_id="link-1",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="徐庭云教授生平",
                        parent_heading_path=["资讯公告NEWS&NOTICS"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_005",
                        raw_version_id="owver_listing_005",
                        row_id="summary-1",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="徐庭云教授长期从事北方民族史与少数民族妇女史研究。",
                        parent_heading_path=["资讯公告NEWS&NOTICS"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_005",
                        raw_version_id="owver_listing_005",
                        row_id="date-1",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="2026-01-17",
                        parent_heading_path=["资讯公告NEWS&NOTICS"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_005",
                        raw_version_id="owver_listing_005",
                        row_id="link-2",
                        row_index=5,
                        block_order=5,
                        block_role="link",
                        text="徐庭云教授生平",
                        parent_heading_path=["资讯公告NEWS&NOTICS"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_005",
                        raw_version_id="owver_listing_005",
                        row_id="date-2",
                        row_index=6,
                        block_order=6,
                        block_role="paragraph",
                        text="2026-01-17",
                        parent_heading_path=["资讯公告NEWS&NOTICS"],
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

            self.assertIn("- 徐庭云教授生平", canonical)
            self.assertIn("- 徐庭云教授长期从事北方民族史与少数民族妇女史研究。", canonical)
            self.assertIn("- 2026-01-17", canonical)
            self.assertNotIn("- 徐庭云教授生平 2026-01-17", canonical)

    def test_listing_projection_skips_pagination_controls(self) -> None:
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
                            raw_asset_id="owasset_listing_006",
                            raw_version_id="owver_listing_006",
                            normalized_canonical_url="https://www.example.edu/history/page/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_006",
                raw_version_id="owver_listing_006",
                normalized_canonical_url="https://www.example.edu/history/page/",
                page_title="本科教学",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_006",
                        raw_version_id="owver_listing_006",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="本科教学",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_006",
                        raw_version_id="owver_listing_006",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="人才培养",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_006",
                        raw_version_id="owver_listing_006",
                        row_id="item-1",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="2025-12-12 2025-2026-1学期期末考试安排",
                        parent_heading_path=["人才培养"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_006",
                        raw_version_id="owver_listing_006",
                        row_id="item-2",
                        row_index=3,
                        block_order=3,
                        block_role="link",
                        text="2025-10-23 近代中外关系史暨中国与周边国家关系史实验班建设研讨会顺利召开",
                        parent_heading_path=["人才培养"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_006",
                        raw_version_id="owver_listing_006",
                        row_id="page-2",
                        row_index=4,
                        block_order=4,
                        block_role="link",
                        text="2",
                        parent_heading_path=["人才培养"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_006",
                        raw_version_id="owver_listing_006",
                        row_id="page-3",
                        row_index=5,
                        block_order=5,
                        block_role="link",
                        text="3",
                        parent_heading_path=["人才培养"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_006",
                        raw_version_id="owver_listing_006",
                        row_id="next-1",
                        row_index=6,
                        block_order=6,
                        block_role="link",
                        text="下页",
                        parent_heading_path=["人才培养"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_006",
                        raw_version_id="owver_listing_006",
                        row_id="last-1",
                        row_index=7,
                        block_order=7,
                        block_role="link",
                        text="尾页",
                        parent_heading_path=["人才培养"],
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
            canonical_lines = canonical.splitlines()

            self.assertIn("2025-12-12 2025-2026-1学期期末考试安排", canonical)
            self.assertNotIn("- 2", canonical_lines)
            self.assertNotIn("- 3", canonical_lines)
            self.assertNotIn("- 下页", canonical_lines)
            self.assertNotIn("- 尾页", canonical_lines)

    def test_listing_projection_skips_utility_quick_links(self) -> None:
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
                            raw_asset_id="owasset_listing_007",
                            raw_version_id="owver_listing_007",
                            normalized_canonical_url="https://www.example.edu/history/tools/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_007",
                raw_version_id="owver_listing_007",
                normalized_canonical_url="https://www.example.edu/history/tools/",
                page_title="首页",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_007",
                        raw_version_id="owver_listing_007",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="首页",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_007",
                        raw_version_id="owver_listing_007",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="科学研究RESEARCH",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_007",
                        raw_version_id="owver_listing_007",
                        row_id="item-1",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="我院教师裴艾琳学术专著《遐迩同风：宋代南方族群治理转型研究》出版发行",
                        parent_heading_path=["科学研究RESEARCH"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_007",
                        raw_version_id="owver_listing_007",
                        row_id="tool-1",
                        row_index=3,
                        block_order=3,
                        block_role="link",
                        text="信息门户",
                        parent_heading_path=["科学研究RESEARCH"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_007",
                        raw_version_id="owver_listing_007",
                        row_id="tool-2",
                        row_index=4,
                        block_order=4,
                        block_role="link",
                        text="图书馆",
                        parent_heading_path=["科学研究RESEARCH"],
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

            self.assertIn(
                "我院教师裴艾琳学术专著《遐迩同风：宋代南方族群治理转型研究》出版发行", canonical
            )
            self.assertNotIn("- 信息门户", canonical)
            self.assertNotIn("- 图书馆", canonical)
