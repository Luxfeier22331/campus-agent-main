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


class OfficialWebProjectionArticleUnitsTestPart02(unittest.TestCase):
    def test_article_projection_skips_trailing_qr_signup_tail_for_lecture_notice(self) -> None:
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
                    "crawlRunId": "owrun_projection_lecture_001",
                    "generatedAt": "2026-04-03T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_article_lecture_001",
                            raw_version_id="owver_article_lecture_001",
                            normalized_canonical_url="https://lib.example.edu/lecture.htm",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="lib.example.edu",
                raw_asset_id="owasset_article_lecture_001",
                raw_version_id="owver_article_lecture_001",
                normalized_canonical_url="https://lib.example.edu/lecture.htm",
                page_title="“民图一小时”信息素养讲座预告",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_lecture_001",
                        raw_version_id="owver_article_lecture_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="“民图一小时”信息素养讲座预告",
                    ),
                    _block(
                        raw_asset_id="owasset_article_lecture_001",
                        raw_version_id="owver_article_lecture_001",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="“民图一小时”信息素养讲座预告",
                    ),
                    _block(
                        raw_asset_id="owasset_article_lecture_001",
                        raw_version_id="owver_article_lecture_001",
                        row_id="p-1",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="讲座主题：聚焦人文社科前沿研究——人大复印报刊资料数据库助力科研创新",
                        parent_heading_path=["“民图一小时”信息素养讲座预告"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_lecture_001",
                        raw_version_id="owver_article_lecture_001",
                        row_id="p-2",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="讲座时间：2026年3月26日下午14:00—15:00",
                        parent_heading_path=["“民图一小时”信息素养讲座预告"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_lecture_001",
                        raw_version_id="owver_article_lecture_001",
                        row_id="p-3",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="讲座地点：丰台校区图书馆视听空间125室",
                        parent_heading_path=["“民图一小时”信息素养讲座预告"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_lecture_001",
                        raw_version_id="owver_article_lecture_001",
                        row_id="p-4",
                        row_index=5,
                        block_order=5,
                        block_role="paragraph",
                        text="讲座内容：介绍人大复印报刊资料数据库在选题追踪与文献综述中的使用方法。",
                        parent_heading_path=["“民图一小时”信息素养讲座预告"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_lecture_001",
                        raw_version_id="owver_article_lecture_001",
                        row_id="p-5",
                        row_index=6,
                        block_order=6,
                        block_role="paragraph",
                        text="欢迎全校师生报名参加。",
                        parent_heading_path=["“民图一小时”信息素养讲座预告"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_lecture_001",
                        raw_version_id="owver_article_lecture_001",
                        row_id="tail-1",
                        row_index=7,
                        block_order=7,
                        block_role="paragraph",
                        text="请感兴趣的同学扫描下方二维码预约讲座信息",
                        parent_heading_path=["“民图一小时”信息素养讲座预告"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_lecture_001",
                        raw_version_id="owver_article_lecture_001",
                        row_id="tail-2",
                        row_index=8,
                        block_order=8,
                        block_role="paragraph",
                        text="（活动结束后将累计参与者的图书馆积分）",
                        parent_heading_path=["“民图一小时”信息素养讲座预告"],
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            units_path = Path(report.documents[0]["document_units_path"])
            units = [
                json.loads(line)
                for line in units_path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]

            self.assertEqual(len(units), 2)
            self.assertIn(
                "讲座主题：聚焦人文社科前沿研究——人大复印报刊资料数据库助力科研创新",
                units[0]["clean_text"],
            )
            self.assertIn("讲座时间：2026年3月26日下午14:00—15:00", units[0]["clean_text"])
            self.assertIn("讲座地点：丰台校区图书馆视听空间125室", units[0]["clean_text"])
            self.assertNotIn(
                "讲座内容：介绍人大复印报刊资料数据库在选题追踪与文献综述中的使用方法。",
                units[0]["clean_text"],
            )
            self.assertEqual(units[0]["anchor"]["row_ids"], ["p-1", "p-2", "p-3"])
            self.assertIn(
                "讲座内容：介绍人大复印报刊资料数据库在选题追踪与文献综述中的使用方法。",
                units[1]["clean_text"],
            )
            self.assertIn("欢迎全校师生报名参加。", units[1]["clean_text"])
            self.assertNotIn("二维码预约讲座信息", units[1]["clean_text"])
            self.assertNotIn("图书馆积分", units[1]["clean_text"])

    def test_article_projection_keeps_notice_fact_rows_grouped_and_marks_notice_fact_role(
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
                    "crawlRunId": "owrun_projection_notice_fact_001",
                    "generatedAt": "2026-04-04T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_article_notice_fact_001",
                            raw_version_id="owver_article_notice_fact_001",
                            normalized_canonical_url="https://lib.example.edu/lecture-facts.htm",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="lib.example.edu",
                raw_asset_id="owasset_article_notice_fact_001",
                raw_version_id="owver_article_notice_fact_001",
                normalized_canonical_url="https://lib.example.edu/lecture-facts.htm",
                page_title="“民图一小时”信息素养讲座预告",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_notice_fact_001",
                        raw_version_id="owver_article_notice_fact_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="“民图一小时”信息素养讲座预告",
                    ),
                    _block(
                        raw_asset_id="owasset_article_notice_fact_001",
                        raw_version_id="owver_article_notice_fact_001",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="“民图一小时”信息素养讲座预告",
                    ),
                    _block(
                        raw_asset_id="owasset_article_notice_fact_001",
                        raw_version_id="owver_article_notice_fact_001",
                        row_id="p-1",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="讲座主题：聚焦人文社科前沿研究——人大复印报刊资料数据库助力科研创新",
                        parent_heading_path=["“民图一小时”信息素养讲座预告"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_notice_fact_001",
                        raw_version_id="owver_article_notice_fact_001",
                        row_id="p-2",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="主 讲 人：张小艺",
                        parent_heading_path=["“民图一小时”信息素养讲座预告"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_notice_fact_001",
                        raw_version_id="owver_article_notice_fact_001",
                        row_id="p-3",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="讲座时间：2026年3月26日下午14:00—15:00",
                        parent_heading_path=["“民图一小时”信息素养讲座预告"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_notice_fact_001",
                        raw_version_id="owver_article_notice_fact_001",
                        row_id="p-4",
                        row_index=5,
                        block_order=5,
                        block_role="paragraph",
                        text="讲座地点：丰台校区图书馆视听空间125室",
                        parent_heading_path=["“民图一小时”信息素养讲座预告"],
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
        self.assertEqual(units[0]["metadata"]["content_role"], "notice_fact")
        self.assertEqual(
            units[0]["anchor"]["row_ids"],
            ["p-1", "p-2", "p-3", "p-4"],
        )
        self.assertIn(
            "讲座主题：聚焦人文社科前沿研究——人大复印报刊资料数据库助力科研创新",
            units[0]["clean_text"],
        )
        self.assertIn("讲座时间：2026年3月26日下午14:00—15:00", units[0]["clean_text"])
        self.assertIn("讲座地点：丰台校区图书馆视听空间125室", units[0]["clean_text"])

    def test_article_projection_classifies_support_only_lines_and_excludes_them_from_canonical_markdown(
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
                    "crawlRunId": "owrun_projection_support_only_001",
                    "generatedAt": "2026-04-04T09:30:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_article_support_only_001",
                            raw_version_id="owver_article_support_only_001",
                            normalized_canonical_url="https://www.example.edu/undergraduate.htm",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_article_support_only_001",
                raw_version_id="owver_article_support_only_001",
                normalized_canonical_url="https://www.example.edu/undergraduate.htm",
                page_title="本科培养",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_support_only_001",
                        raw_version_id="owver_article_support_only_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="本科培养",
                    ),
                    _block(
                        raw_asset_id="owasset_article_support_only_001",
                        raw_version_id="owver_article_support_only_001",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="人才培养",
                    ),
                    _block(
                        raw_asset_id="owasset_article_support_only_001",
                        raw_version_id="owver_article_support_only_001",
                        row_id="p-1",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="学校现有本科专业71个，在招专业61个，涵盖11个学科门类。",
                        parent_heading_path=["人才培养"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_support_only_001",
                        raw_version_id="owver_article_support_only_001",
                        row_id="p-2",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="（来源：教务处）",
                        parent_heading_path=["人才培养"],
                    ),
                    _block(
                        raw_asset_id="owasset_article_support_only_001",
                        raw_version_id="owver_article_support_only_001",
                        row_id="p-3",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="新闻网版权与免责声明：",
                        parent_heading_path=["人才培养"],
                        is_boilerplate=True,
                    ),
                    _block(
                        raw_asset_id="owasset_article_support_only_001",
                        raw_version_id="owver_article_support_only_001",
                        row_id="p-4",
                        row_index=5,
                        block_order=5,
                        block_role="paragraph",
                        text="投稿方式：mucxcb@example.edu",
                        parent_heading_path=["人才培养"],
                        is_boilerplate=True,
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
            ["reference_fact", "source_attribution", "boilerplate"],
        )
        self.assertIn(
            "学校现有本科专业71个，在招专业61个，涵盖11个学科门类。", units[0]["clean_text"]
        )
        self.assertEqual(units[1]["clean_text"], "（来源：教务处）")
        self.assertIn("新闻网版权与免责声明：", units[2]["clean_text"])
        self.assertNotIn("（来源：教务处）", canonical)
        self.assertNotIn("新闻网版权与免责声明：", canonical)
        self.assertNotIn("投稿方式：mucxcb@example.edu", canonical)
