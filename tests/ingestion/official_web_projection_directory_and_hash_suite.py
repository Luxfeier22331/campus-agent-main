from __future__ import annotations

import unittest

from .official_web_projection_test_support import *  # noqa: F401,F403


class OfficialWebProjectionDirectoryAndHashTest(unittest.TestCase):
    def test_directory_projection_splits_dense_roster_into_multiple_directory_entries(self) -> None:
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
                            raw_asset_id="owasset_directory_001",
                            raw_version_id="owver_directory_001",
                            normalized_canonical_url="https://www.example.edu/faculty",
                            page_family="directory_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_directory_001",
                raw_version_id="owver_directory_001",
                normalized_canonical_url="https://www.example.edu/faculty",
                page_title="师资队伍",
                page_family="directory_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_directory_001",
                        raw_version_id="owver_directory_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="师资队伍",
                    ),
                    _block(
                        raw_asset_id="owasset_directory_001",
                        raw_version_id="owver_directory_001",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="专任教师",
                    ),
                    _block(
                        raw_asset_id="owasset_directory_001",
                        raw_version_id="owver_directory_001",
                        row_id="p-1",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="张三 教授 研究方向：民族法学 电子邮箱：zhangsan@example.edu",
                        parent_heading_path=["专任教师"],
                    ),
                    _block(
                        raw_asset_id="owasset_directory_001",
                        raw_version_id="owver_directory_001",
                        row_id="p-2",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="李四 副教授 办公电话：010-68930001 电子邮箱：lisi@example.edu",
                        parent_heading_path=["专任教师"],
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

            self.assertEqual(
                [unit["unit_type"] for unit in units], ["directory_entry", "directory_entry"]
            )
            self.assertEqual(
                units[0]["clean_text"],
                "张三 教授 研究方向：民族法学 电子邮箱：zhangsan@example.edu",
            )
            self.assertEqual(
                units[1]["clean_text"],
                "李四 副教授 办公电话：010-68930001 电子邮箱：lisi@example.edu",
            )
            self.assertEqual(units[0]["metadata"]["serving_intent"], "promotable")
            self.assertEqual(units[0]["metadata"]["content_role"], "directory_reference")

    def test_projection_emits_stable_semantic_content_hash_for_cross_host_duplicate_articles(
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
                            raw_asset_id="owasset_article_news",
                            raw_version_id="owver_article_news",
                            normalized_canonical_url="https://news.example.edu/info/1.htm",
                            page_family="article_detail",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_article_xxgk",
                            raw_version_id="owver_article_xxgk",
                            normalized_canonical_url="https://xxgk.example.edu/info/2.htm",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            shared_blocks = [
                {
                    "row_id": "title-1",
                    "row_index": 0,
                    "block_order": 0,
                    "block_role": "title",
                    "text": "中央民族大学与北京丰台人才集团共建就业实习实践基地",
                },
                {
                    "row_id": "p-1",
                    "row_index": 1,
                    "block_order": 1,
                    "block_role": "paragraph",
                    "text": "中央民族大学与北京丰台人才集团共建就业实习实践基地。",
                },
                {
                    "row_id": "p-2",
                    "row_index": 2,
                    "block_order": 2,
                    "block_role": "paragraph",
                    "text": "双方将围绕就业见习、实践育人、人才输送等方面开展合作。",
                },
            ]
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="news.example.edu",
                raw_asset_id="owasset_article_news",
                raw_version_id="owver_article_news",
                normalized_canonical_url="https://news.example.edu/info/1.htm",
                page_title="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_news",
                        raw_version_id="owver_article_news",
                        row_id=item["row_id"],
                        row_index=item["row_index"],
                        block_order=item["block_order"],
                        block_role=item["block_role"],
                        text=item["text"],
                    )
                    for item in shared_blocks
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.example.edu",
                raw_asset_id="owasset_article_xxgk",
                raw_version_id="owver_article_xxgk",
                normalized_canonical_url="https://xxgk.example.edu/info/2.htm",
                page_title="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_xxgk",
                        raw_version_id="owver_article_xxgk",
                        row_id=item["row_id"],
                        row_index=item["row_index"],
                        block_order=item["block_order"],
                        block_role=item["block_role"],
                        text=item["text"],
                    )
                    for item in shared_blocks
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            news_document = next(
                document
                for document in report.documents
                if document["raw_asset_id"] == "owasset_article_news"
            )
            xxgk_document = next(
                document
                for document in report.documents
                if document["raw_asset_id"] == "owasset_article_xxgk"
            )
            news_units = [
                json.loads(line)
                for line in Path(news_document["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]
            xxgk_units = [
                json.loads(line)
                for line in Path(xxgk_document["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

            self.assertEqual(
                news_units[0]["metadata"]["semantic_content_hash"],
                xxgk_units[0]["metadata"]["semantic_content_hash"],
            )
            self.assertTrue(news_units[0]["metadata"]["semantic_content_hash"])

    def test_projection_semantic_content_hash_ignores_terminal_host_specific_boilerplate(
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
                            raw_asset_id="owasset_article_news_boilerplate",
                            raw_version_id="owver_article_news_boilerplate",
                            normalized_canonical_url="https://news.example.edu/info/61874.htm",
                            page_family="article_detail",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_article_xxgk_boilerplate",
                            raw_version_id="owver_article_xxgk_boilerplate",
                            normalized_canonical_url="https://xxgk.example.edu/info/28641.htm",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            shared_blocks = [
                {
                    "row_id": "title-1",
                    "row_index": 0,
                    "block_order": 0,
                    "block_role": "title",
                    "text": "中央民族大学与北京丰台人才集团共建就业实习实践基地",
                },
                {
                    "row_id": "p-1",
                    "row_index": 1,
                    "block_order": 1,
                    "block_role": "paragraph",
                    "text": "新闻网讯 为进一步推动教育科技人才一体发展，深化校地校企合作交流，双方围绕人才共育、产教融合、成果转化、学生就业实习等领域深入沟通。",
                },
                {
                    "row_id": "p-2",
                    "row_index": 2,
                    "block_order": 2,
                    "block_role": "paragraph",
                    "text": "中央民族大学招生就业工作处与丰台人才集团将围绕就业见习、实践育人、人才输送等方面开展合作。",
                },
            ]
            news_blocks = [
                *shared_blocks,
                {
                    "row_id": "bp-1",
                    "row_index": 3,
                    "block_order": 3,
                    "block_role": "paragraph",
                    "text": "新闻网版权与免责声明：",
                },
                {
                    "row_id": "bp-2",
                    "row_index": 4,
                    "block_order": 4,
                    "block_role": "paragraph",
                    "text": "① 凡本网未注明其他出处的作品，版权均属于中央民族大学新闻中心，转载、摘编或以其它方式使用本网作品的应注明“来源：中央民族大学新闻网”。违反上述声明者，本网将追究其相关法律责任。",
                },
                {
                    "row_id": "bp-3",
                    "row_index": 5,
                    "block_order": 5,
                    "block_role": "paragraph",
                    "text": "② 凡本网注明其他来源的作品，均转载自其它媒体，转载目的在于传递更多信息，并不代表本网赞同其观点和对其真实性负责。",
                },
                {
                    "row_id": "bp-4",
                    "row_index": 6,
                    "block_order": 6,
                    "block_role": "paragraph",
                    "text": "③ 有关作品内容、版权和其它问题请与我们联系。",
                },
                {
                    "row_id": "bp-5",
                    "row_index": 7,
                    "block_order": 7,
                    "block_role": "paragraph",
                    "text": "投稿方式：mucxcb@example.edu.cn",
                },
            ]
            xxgk_blocks = [
                *shared_blocks,
                {
                    "row_id": "bp-6",
                    "row_index": 3,
                    "block_order": 3,
                    "block_role": "paragraph",
                    "text": "Copyright@ 2018 -- 党委办公室 校长办公室 All Rights Reserved",
                },
            ]
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="news.example.edu",
                raw_asset_id="owasset_article_news_boilerplate",
                raw_version_id="owver_article_news_boilerplate",
                normalized_canonical_url="https://news.example.edu/info/61874.htm",
                page_title="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_news_boilerplate",
                        raw_version_id="owver_article_news_boilerplate",
                        row_id=item["row_id"],
                        row_index=item["row_index"],
                        block_order=item["block_order"],
                        block_role=item["block_role"],
                        text=item["text"],
                    )
                    for item in news_blocks
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.example.edu",
                raw_asset_id="owasset_article_xxgk_boilerplate",
                raw_version_id="owver_article_xxgk_boilerplate",
                normalized_canonical_url="https://xxgk.example.edu/info/28641.htm",
                page_title="中央民族大学与北京丰台人才集团共建就业实习实践基地",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_xxgk_boilerplate",
                        raw_version_id="owver_article_xxgk_boilerplate",
                        row_id=item["row_id"],
                        row_index=item["row_index"],
                        block_order=item["block_order"],
                        block_role=item["block_role"],
                        text=item["text"],
                    )
                    for item in xxgk_blocks
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            news_document = next(
                document
                for document in report.documents
                if document["raw_asset_id"] == "owasset_article_news_boilerplate"
            )
            xxgk_document = next(
                document
                for document in report.documents
                if document["raw_asset_id"] == "owasset_article_xxgk_boilerplate"
            )
            news_units = [
                json.loads(line)
                for line in Path(news_document["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]
            xxgk_units = [
                json.loads(line)
                for line in Path(xxgk_document["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

            news_support_units = [
                unit for unit in news_units if unit["metadata"]["content_role"] == "boilerplate"
            ]
            xxgk_support_units = [
                unit for unit in xxgk_units if unit["metadata"]["content_role"] == "boilerplate"
            ]

            self.assertEqual(len(news_support_units), 1)
            self.assertEqual(len(xxgk_support_units), 1)
            self.assertIn("投稿方式：mucxcb@example.edu.cn", news_support_units[0]["clean_text"])
            self.assertIn("All Rights Reserved", xxgk_support_units[0]["clean_text"])
            self.assertEqual(
                news_units[0]["metadata"]["semantic_content_hash"],
                xxgk_units[0]["metadata"]["semantic_content_hash"],
            )

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
