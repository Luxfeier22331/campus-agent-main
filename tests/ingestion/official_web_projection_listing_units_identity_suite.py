from __future__ import annotations

import unittest

from .official_web_projection_test_support import *


class OfficialWebProjectionListingUnitsIdentityTest(unittest.TestCase):
    def test_listing_projection_skips_long_summary_paragraphs(self) -> None:
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
                            raw_asset_id="owasset_listing_008",
                            raw_version_id="owver_listing_008",
                            normalized_canonical_url="https://www.example.edu/history/research/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_008",
                raw_version_id="owver_listing_008",
                normalized_canonical_url="https://www.example.edu/history/research/",
                page_title="首页",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_008",
                        raw_version_id="owver_listing_008",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="首页",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_008",
                        raw_version_id="owver_listing_008",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="科学研究RESEARCH",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_008",
                        raw_version_id="owver_listing_008",
                        row_id="item-1",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="徐庭云教授生平",
                        parent_heading_path=["科学研究RESEARCH"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_008",
                        raw_version_id="owver_listing_008",
                        row_id="summary-1",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="徐庭云教授长期从事北方民族史与少数民族妇女史研究，是沙陀学研究的重要开拓者。学术贡献突出，发表论文有《晚唐五代时期的沙陀》《一位有贡献的沙陀政治家》等。",
                        parent_heading_path=["科学研究RESEARCH"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_008",
                        raw_version_id="owver_listing_008",
                        row_id="date-1",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="2026-01-17",
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

            self.assertIn("- 徐庭云教授生平", canonical)
            self.assertIn("- 2026-01-17", canonical)
            self.assertNotIn("徐庭云教授长期从事北方民族史与少数民族妇女史研究", canonical)

    def test_listing_projection_normalizes_section_heading_badges(self) -> None:
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
                            raw_asset_id="owasset_listing_009",
                            raw_version_id="owver_listing_009",
                            normalized_canonical_url="https://www.example.edu/history/headings/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_009",
                raw_version_id="owver_listing_009",
                normalized_canonical_url="https://www.example.edu/history/headings/",
                page_title="首页",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_009",
                        raw_version_id="owver_listing_009",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="首页",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_009",
                        raw_version_id="owver_listing_009",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="资讯公告NEWS&NOTICS",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_009",
                        raw_version_id="owver_listing_009",
                        row_id="item-1",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="2025-2026-1学期缓补考时间安排",
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

            self.assertIn("## 资讯公告", canonical)
            self.assertNotIn("## 资讯公告NEWS&NOTICS", canonical)

    def test_listing_projection_skips_short_label_rows_and_ellipsis_teasers(self) -> None:
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
                            raw_asset_id="owasset_listing_010",
                            raw_version_id="owver_listing_010",
                            normalized_canonical_url="https://www.example.edu/news/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_010",
                raw_version_id="owver_listing_010",
                normalized_canonical_url="https://www.example.edu/news/",
                page_title="示例大学新闻网",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_010",
                        raw_version_id="owver_listing_010",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="示例大学新闻网",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_010",
                        raw_version_id="owver_listing_010",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="校园经纬",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_010",
                        raw_version_id="owver_listing_010",
                        row_id="item-1",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="示例大学党委举办树立和践行正确政绩观学习教育读书班",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_010",
                        raw_version_id="owver_listing_010",
                        row_id="label-1",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="教学科研",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_010",
                        raw_version_id="owver_listing_010",
                        row_id="label-2",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="校园经纬",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_010",
                        raw_version_id="owver_listing_010",
                        row_id="label-3",
                        row_index=5,
                        block_order=5,
                        block_role="paragraph",
                        text="全球合作",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_010",
                        raw_version_id="owver_listing_010",
                        row_id="item-2",
                        row_index=6,
                        block_order=6,
                        block_role="link",
                        text="《学习时报》孔新峰：政德何以重要",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_010",
                        raw_version_id="owver_listing_010",
                        row_id="summary-1",
                        row_index=7,
                        block_order=7,
                        block_role="paragraph",
                        text="新闻网讯 3月23日，《学习时报》刊发示例大学马克思主义学院党委书记、院长孔新峰教授撰写的理论文章《政德何以重要》，文章指出：新时代新征程对干部治理能力提出更高要求，政德建设成为干部队伍建设的关键抓手。政德作为党员干部从政履职的根本道德准则，是中华传统政治文明一脉相承的精神内核，唯有筑牢政德底...",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_010",
                        raw_version_id="owver_listing_010",
                        row_id="teaser-1",
                        row_index=8,
                        block_order=8,
                        block_role="paragraph",
                        text="2026“春晓逐梦”启航跑：迎着春光，和奥运选手一...",
                        parent_heading_path=["校园经纬"],
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

            self.assertIn("- 示例大学党委举办树立和践行正确政绩观学习教育读书班", canonical)
            self.assertIn("- 《学习时报》孔新峰：政德何以重要", canonical)
            self.assertNotIn("教学科研", canonical)
            self.assertNotIn("全球合作", canonical)
            self.assertNotIn("唯有筑牢政德底", canonical)
            self.assertNotIn("迎着春光", canonical)

    def test_listing_projection_does_not_persist_item_heading_as_section_path(self) -> None:
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
                            raw_asset_id="owasset_listing_011",
                            raw_version_id="owver_listing_011",
                            normalized_canonical_url="https://www.example.edu/news/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            polluted_heading = "校长强世功接受“统战新语”专访 解读民族团结进步促进法"
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_011",
                raw_version_id="owver_listing_011",
                normalized_canonical_url="https://www.example.edu/news/",
                page_title="示例大学新闻网",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_011",
                        raw_version_id="owver_listing_011",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="示例大学新闻网",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_011",
                        raw_version_id="owver_listing_011",
                        row_id="heading-hero",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text=polluted_heading,
                    ),
                    _block(
                        raw_asset_id="owasset_listing_011",
                        raw_version_id="owver_listing_011",
                        row_id="heading-item-1",
                        row_index=2,
                        block_order=2,
                        block_role="heading",
                        text=polluted_heading,
                        parent_heading_path=[polluted_heading],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_011",
                        raw_version_id="owver_listing_011",
                        row_id="item-1",
                        row_index=3,
                        block_order=3,
                        block_role="link",
                        text=polluted_heading,
                        parent_heading_path=[polluted_heading],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_011",
                        raw_version_id="owver_listing_011",
                        row_id="heading-item-2",
                        row_index=4,
                        block_order=4,
                        block_role="heading",
                        text="示例大学党委举办树立和践行正确政绩观学习教育读书班",
                        parent_heading_path=[polluted_heading],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_011",
                        raw_version_id="owver_listing_011",
                        row_id="item-2",
                        row_index=5,
                        block_order=5,
                        block_role="link",
                        text="示例大学党委举办树立和践行正确政绩观学习教育读书班",
                        parent_heading_path=[polluted_heading],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_011",
                        raw_version_id="owver_listing_011",
                        row_id="heading-item-3",
                        row_index=6,
                        block_order=6,
                        block_role="heading",
                        text="【专题报道】深入贯彻中央八项规定精神学习教育",
                        parent_heading_path=[polluted_heading],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_011",
                        raw_version_id="owver_listing_011",
                        row_id="item-3",
                        row_index=7,
                        block_order=7,
                        block_role="link",
                        text="【专题报道】深入贯彻中央八项规定精神学习教育",
                        parent_heading_path=[polluted_heading],
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

            self.assertEqual(len(units), 3)
            self.assertEqual(units[1]["anchor"]["section_path"], [])
            self.assertEqual(units[2]["anchor"]["section_path"], [])
            self.assertNotEqual(units[1]["anchor"]["section_path"], [polluted_heading])
            self.assertNotEqual(units[2]["anchor"]["section_path"], [polluted_heading])

    def test_listing_projection_aligns_row_ids_with_retained_clean_lines(self) -> None:
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
                            raw_asset_id="owasset_listing_012",
                            raw_version_id="owver_listing_012",
                            normalized_canonical_url="https://www.example.edu/news/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_012",
                raw_version_id="owver_listing_012",
                normalized_canonical_url="https://www.example.edu/news/",
                page_title="示例大学新闻网",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_012",
                        raw_version_id="owver_listing_012",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="示例大学新闻网",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_012",
                        raw_version_id="owver_listing_012",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="校园经纬",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_012",
                        raw_version_id="owver_listing_012",
                        row_id="item-1",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="示例大学党委举办树立和践行正确政绩观学习教育读书班",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_012",
                        raw_version_id="owver_listing_012",
                        row_id="label-1",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="教学科研",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_012",
                        raw_version_id="owver_listing_012",
                        row_id="label-2",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="校园经纬",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_012",
                        raw_version_id="owver_listing_012",
                        row_id="label-3",
                        row_index=5,
                        block_order=5,
                        block_role="paragraph",
                        text="全球合作",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_012",
                        raw_version_id="owver_listing_012",
                        row_id="item-2",
                        row_index=6,
                        block_order=6,
                        block_role="link",
                        text="【专题报道】深入贯彻中央八项规定精神学习教育",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_012",
                        raw_version_id="owver_listing_012",
                        row_id="teaser-1",
                        row_index=7,
                        block_order=7,
                        block_role="list_item",
                        text="24张，集齐一整年的民大",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_012",
                        raw_version_id="owver_listing_012",
                        row_id="teaser-2",
                        row_index=8,
                        block_order=8,
                        block_role="list_item",
                        text="中国新闻网 | 这所大学如何让石榴花开别样红？",
                        parent_heading_path=["校园经纬"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_012",
                        raw_version_id="owver_listing_012",
                        row_id="teaser-3",
                        row_index=9,
                        block_order=9,
                        block_role="list_item",
                        text="民大学子在帕米尔高原与边防官兵同唱国歌、同升国旗",
                        parent_heading_path=["校园经纬"],
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

            self.assertEqual(len(units), 1)
            self.assertEqual(
                units[0]["clean_text"],
                "示例大学党委举办树立和践行正确政绩观学习教育读书班\n【专题报道】深入贯彻中央八项规定精神学习教育",
            )
            self.assertEqual(units[0]["anchor"]["row_ids"], ["item-1", "item-2"])
