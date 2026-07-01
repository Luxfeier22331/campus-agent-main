from __future__ import annotations

import unittest

from .official_web_projection_test_support import *


class OfficialWebProjectionListingUnitsFilteringPrimaryTest(unittest.TestCase):
    def test_listing_projection_drops_title_only_duplicate_after_compacted_title_date_pair(
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
                    "crawlRunId": "owrun_projection_listing_compacted_pair_001",
                    "generatedAt": "2026-04-27T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_listing_compacted_pair_001",
                            raw_version_id="owver_listing_compacted_pair_001",
                            normalized_canonical_url="https://law.example.edu/xzzq/dtsw.htm",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="law.example.edu",
                raw_asset_id="owasset_listing_compacted_pair_001",
                raw_version_id="owver_listing_compacted_pair_001",
                normalized_canonical_url="https://law.example.edu/xzzq/dtsw.htm",
                page_title="党团事务",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_compacted_pair_001",
                        raw_version_id="owver_listing_compacted_pair_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="党团事务",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_compacted_pair_001",
                        raw_version_id="owver_listing_compacted_pair_001",
                        row_id="item-1",
                        row_index=1,
                        block_order=1,
                        block_role="list_item",
                        text="党员介绍信存根2022-04-24",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_compacted_pair_001",
                        raw_version_id="owver_listing_compacted_pair_001",
                        row_id="link-1",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="党员介绍信存根",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_compacted_pair_001",
                        raw_version_id="owver_listing_compacted_pair_001",
                        row_id="item-2",
                        row_index=3,
                        block_order=3,
                        block_role="list_item",
                        text="组织关系介绍信修订样式2022-04-24",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_compacted_pair_001",
                        raw_version_id="owver_listing_compacted_pair_001",
                        row_id="link-2",
                        row_index=4,
                        block_order=4,
                        block_role="link",
                        text="组织关系介绍信修订样式",
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
                units[0]["clean_text"],
                "党员介绍信存根2022-04-24\n组织关系介绍信修订样式2022-04-24",
            )
            self.assertEqual(units[0]["anchor"]["row_ids"], ["item-1", "item-2"])
            self.assertEqual(canonical.count("党员介绍信存根"), 1)
            self.assertEqual(canonical.count("组织关系介绍信修订样式"), 1)

    def test_listing_projection_drops_sidebar_label_stack_around_current_page_title(
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
                    "crawlRunId": "owrun_projection_listing_sidebar_001",
                    "generatedAt": "2026-04-27T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_listing_sidebar_001",
                            raw_version_id="owver_listing_sidebar_001",
                            normalized_canonical_url="https://www.example.edu/xxgk/lrld.htm",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_sidebar_001",
                raw_version_id="owver_listing_sidebar_001",
                normalized_canonical_url="https://www.example.edu/xxgk/lrld.htm",
                page_title="历任领导",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_sidebar_001",
                        raw_version_id="owver_listing_sidebar_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="历任领导",
                    ),
                    *[
                        _block(
                            raw_asset_id="owasset_listing_sidebar_001",
                            raw_version_id="owver_listing_sidebar_001",
                            row_id=f"nav-{index}",
                            row_index=index,
                            block_order=index,
                            block_role="link",
                            text=text,
                            parent_heading_path=["学校概况"],
                        )
                        for index, text in enumerate(
                            [
                                "学校简介",
                                "现任领导",
                                "历任领导",
                                "学术名流",
                                "校园地图",
                                "标识系统 标志 中英文校名 校训 校旗 标准色 标志二级单位组合 标志规范手册",
                                "标志二级单位组合",
                                "标志规范手册",
                            ],
                            start=1,
                        )
                    ],
                    _block(
                        raw_asset_id="owasset_listing_sidebar_001",
                        raw_version_id="owver_listing_sidebar_001",
                        row_id="leader-1",
                        row_index=20,
                        block_order=20,
                        block_role="link",
                        text="历任校长名单",
                        parent_heading_path=["历任领导"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_sidebar_001",
                        raw_version_id="owver_listing_sidebar_001",
                        row_id="date-1",
                        row_index=21,
                        block_order=21,
                        block_role="paragraph",
                        text="2026-04-01",
                        parent_heading_path=["历任领导"],
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

            self.assertIn("- 历任校长名单 2026-04-01", canonical)
            self.assertNotIn("标识系统 标志 中英文校名", canonical)
            self.assertNotIn("- 学校简介", canonical)

    def test_listing_projection_skips_section_badges_and_repeated_entries(self) -> None:
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
                            raw_asset_id="owasset_listing_002",
                            raw_version_id="owver_listing_002",
                            normalized_canonical_url="https://www.example.edu/history/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_002",
                raw_version_id="owver_listing_002",
                normalized_canonical_url="https://www.example.edu/history/",
                page_title="示例历史学院首页",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_002",
                        raw_version_id="owver_listing_002",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="示例历史学院首页",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_002",
                        raw_version_id="owver_listing_002",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="资讯公告NEWS&NOTICS",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_002",
                        raw_version_id="owver_listing_002",
                        row_id="badge-1",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="NEWS&NOTICS",
                        parent_heading_path=["资讯公告NEWS&NOTICS"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_002",
                        raw_version_id="owver_listing_002",
                        row_id="link-1",
                        row_index=3,
                        block_order=3,
                        block_role="link",
                        text="2025-2026-1学期缓补考时间安排",
                        parent_heading_path=["资讯公告NEWS&NOTICS"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_002",
                        raw_version_id="owver_listing_002",
                        row_id="date-1",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="2026-03-12",
                        parent_heading_path=["资讯公告NEWS&NOTICS"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_002",
                        raw_version_id="owver_listing_002",
                        row_id="link-2",
                        row_index=5,
                        block_order=5,
                        block_role="link",
                        text="2025-2026-1学期缓补考时间安排",
                        parent_heading_path=["资讯公告NEWS&NOTICS"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_002",
                        raw_version_id="owver_listing_002",
                        row_id="date-2",
                        row_index=6,
                        block_order=6,
                        block_role="paragraph",
                        text="2026-03-12",
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

            self.assertNotIn("- NEWS&NOTICS", canonical)
            self.assertEqual(canonical.count("2025-2026-1学期缓补考时间安排"), 1)
            self.assertEqual(canonical.count("2026-03-12"), 1)

    def test_listing_projection_normalizes_compacted_date_prefixes(self) -> None:
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
                            raw_asset_id="owasset_listing_003",
                            raw_version_id="owver_listing_003",
                            normalized_canonical_url="https://www.example.edu/history/bks/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_003",
                raw_version_id="owver_listing_003",
                normalized_canonical_url="https://www.example.edu/history/bks/",
                page_title="本科教学",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_003",
                        raw_version_id="owver_listing_003",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="本科教学",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_003",
                        raw_version_id="owver_listing_003",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="本科教学",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_003",
                        raw_version_id="owver_listing_003",
                        row_id="item-1",
                        row_index=2,
                        block_order=2,
                        block_role="list_item",
                        text="2026-03-122025-2026-1学期缓补考时间安排",
                        parent_heading_path=["本科教学"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_003",
                        raw_version_id="owver_listing_003",
                        row_id="item-2",
                        row_index=3,
                        block_order=3,
                        block_role="list_item",
                        text="122026.03历史学动态调整结果公示",
                        parent_heading_path=["本科教学"],
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

            self.assertIn("- 2026-03-12 2025-2026-1学期缓补考时间安排", canonical)
            self.assertIn("- 2026.03.12 历史学动态调整结果公示", canonical)
            self.assertNotIn("2026-03-122025-2026-1学期缓补考时间安排", canonical)
            self.assertNotIn("122026.03历史学动态调整结果公示", canonical)

    def test_listing_projection_skips_aggregate_quick_link_rows(self) -> None:
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
                            raw_asset_id="owasset_listing_004",
                            raw_version_id="owver_listing_004",
                            normalized_canonical_url="https://www.example.edu/history/links/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_004",
                raw_version_id="owver_listing_004",
                normalized_canonical_url="https://www.example.edu/history/links/",
                page_title="快速链接",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_004",
                        raw_version_id="owver_listing_004",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="快速链接",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004",
                        raw_version_id="owver_listing_004",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="快速链接",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004",
                        raw_version_id="owver_listing_004",
                        row_id="list-1",
                        row_index=2,
                        block_order=2,
                        block_role="list_item",
                        text="中山大学历史系 南开大学历史学院 东北师范大学示例历史学院",
                        parent_heading_path=["快速链接"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004",
                        raw_version_id="owver_listing_004",
                        row_id="link-1",
                        row_index=3,
                        block_order=3,
                        block_role="link",
                        text="中山大学历史系",
                        parent_heading_path=["快速链接"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004",
                        raw_version_id="owver_listing_004",
                        row_id="link-2",
                        row_index=4,
                        block_order=4,
                        block_role="link",
                        text="南开大学历史学院",
                        parent_heading_path=["快速链接"],
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004",
                        raw_version_id="owver_listing_004",
                        row_id="link-3",
                        row_index=5,
                        block_order=5,
                        block_role="link",
                        text="东北师范大学示例历史学院",
                        parent_heading_path=["快速链接"],
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

            self.assertNotIn(
                "- 中山大学历史系 南开大学历史学院 东北师范大学示例历史学院", canonical
            )
            self.assertIn("- 中山大学历史系", canonical)
            self.assertIn("- 南开大学历史学院", canonical)
            self.assertIn("- 东北师范大学示例历史学院", canonical)

    def test_listing_projection_skips_navigation_short_label_rows(self) -> None:
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
                            raw_asset_id="owasset_listing_004b",
                            raw_version_id="owver_listing_004b",
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
                raw_asset_id="owasset_listing_004b",
                raw_version_id="owver_listing_004b",
                normalized_canonical_url="https://www.example.edu/news/",
                page_title="示例大学新闻网",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_004b",
                        raw_version_id="owver_listing_004b",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="示例大学新闻网",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004b",
                        raw_version_id="owver_listing_004b",
                        row_id="item-1",
                        row_index=1,
                        block_order=1,
                        block_role="link",
                        text="示例大学党委举办树立和践行正确政绩观学习教育读书班",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004b",
                        raw_version_id="owver_listing_004b",
                        row_id="label-1",
                        row_index=2,
                        block_order=2,
                        block_role="list_item",
                        text="教学科研",
                        is_main_content=False,
                        is_navigation=True,
                        is_boilerplate=True,
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004b",
                        raw_version_id="owver_listing_004b",
                        row_id="label-2",
                        row_index=3,
                        block_order=3,
                        block_role="link",
                        text="校园经纬",
                        is_main_content=False,
                        is_navigation=True,
                        is_boilerplate=True,
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004b",
                        raw_version_id="owver_listing_004b",
                        row_id="label-3",
                        row_index=4,
                        block_order=4,
                        block_role="list_item",
                        text="全球合作",
                        is_main_content=False,
                        is_navigation=True,
                        is_boilerplate=True,
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004b",
                        raw_version_id="owver_listing_004b",
                        row_id="item-2",
                        row_index=5,
                        block_order=5,
                        block_role="link",
                        text="《学习时报》孔新峰：政德何以重要",
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
            self.assertNotIn("校园经纬", canonical)
            self.assertNotIn("全球合作", canonical)

    def test_listing_projection_skips_interstitial_main_content_short_label_rows(self) -> None:
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
                            raw_asset_id="owasset_listing_004c",
                            raw_version_id="owver_listing_004c",
                            normalized_canonical_url="https://www.example.edu/news/interstitial/",
                            page_family="listing_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_004c",
                raw_version_id="owver_listing_004c",
                normalized_canonical_url="https://www.example.edu/news/interstitial/",
                page_title="示例大学新闻网",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_004c",
                        raw_version_id="owver_listing_004c",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="示例大学新闻网",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004c",
                        raw_version_id="owver_listing_004c",
                        row_id="item-1",
                        row_index=1,
                        block_order=1,
                        block_role="link",
                        text="示例大学党委举办树立和践行正确政绩观学习教育读书班",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004c",
                        raw_version_id="owver_listing_004c",
                        row_id="label-1",
                        row_index=2,
                        block_order=2,
                        block_role="list_item",
                        text="教学科研",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004c",
                        raw_version_id="owver_listing_004c",
                        row_id="label-2",
                        row_index=3,
                        block_order=3,
                        block_role="list_item",
                        text="校园经纬",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004c",
                        raw_version_id="owver_listing_004c",
                        row_id="label-3",
                        row_index=4,
                        block_order=4,
                        block_role="list_item",
                        text="全球合作",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_004c",
                        raw_version_id="owver_listing_004c",
                        row_id="item-2",
                        row_index=5,
                        block_order=5,
                        block_role="link",
                        text="示例大学举办中国历史研究院2025年度重大招标项目开题论证会",
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
            self.assertIn("- 示例大学举办中国历史研究院2025年度重大招标项目开题论证会", canonical)
            self.assertNotIn("教学科研", canonical)
            self.assertNotIn("校园经纬", canonical)
            self.assertNotIn("全球合作", canonical)
