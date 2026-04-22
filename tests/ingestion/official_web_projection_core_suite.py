from __future__ import annotations

import unittest

from .official_web_projection_test_support import *  # noqa: F401,F403


class OfficialWebProjectionCoreTest(unittest.TestCase):
    def test_load_official_web_projection_declarations_rejects_shell_emit_action(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "projection-declarations.json"
            payload = _declarations_payload()
            payload["declarations"][3]["action"] = "emit_document"
            _write_json(path, payload)

            with self.assertRaisesRegex(ValueError, "manual_review"):
                load_official_web_projection_declarations(path)

    def test_replay_official_web_source_truth_local_emits_listing_documents_and_keeps_shell_review(
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
                            raw_asset_id="owasset_article_001",
                            raw_version_id="owver_article_001",
                            normalized_canonical_url="https://www.example.edu/news/1",
                            page_family="article_detail",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_listing_001",
                            raw_version_id="owver_listing_001",
                            normalized_canonical_url="https://www.example.edu/news/",
                            page_family="listing_page",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_shell_001",
                            raw_version_id="owver_shell_001",
                            normalized_canonical_url="https://www.example.edu/app/",
                            page_family="dynamic_shell_page",
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
                normalized_canonical_url="https://www.example.edu/news/1",
                page_title="新闻详情",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_001",
                        raw_version_id="owver_article_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="新闻详情",
                    ),
                    _block(
                        raw_asset_id="owasset_article_001",
                        raw_version_id="owver_article_001",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="中央民族大学召开专题工作会议，部署本学期重点任务。",
                    ),
                    _block(
                        raw_asset_id="owasset_article_001",
                        raw_version_id="owver_article_001",
                        row_id="p-2",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="会议强调要持续提升教学质量和校园服务保障能力。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_001",
                raw_version_id="owver_listing_001",
                normalized_canonical_url="https://www.example.edu/news/",
                page_title="新闻网",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_001",
                        raw_version_id="owver_listing_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="新闻网",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_001",
                        raw_version_id="owver_listing_001",
                        row_id="li-1",
                        row_index=1,
                        block_order=1,
                        block_role="list_item",
                        text="学校召开就业工作推进会",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_001",
                        raw_version_id="owver_listing_001",
                        row_id="li-2",
                        row_index=2,
                        block_order=2,
                        block_role="list_item",
                        text="2026年招生宣传工作启动",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_shell_001",
                raw_version_id="owver_shell_001",
                normalized_canonical_url="https://www.example.edu/app/",
                page_title="网上办事大厅",
                page_family="dynamic_shell_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_shell_001",
                        raw_version_id="owver_shell_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="网上办事大厅",
                        is_main_content=False,
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(report.counts["pages_seen"], 3)
            self.assertEqual(report.counts["emitted_documents"], 2)
            self.assertEqual(report.counts["manual_review_pages"], 1)
            self.assertEqual(len(report.documents), 2)
            self.assertEqual(len(report.manual_review_pages), 1)
            self.assertTrue(
                any(
                    page["normalized_canonical_url"] == "https://www.example.edu/app/"
                    for page in report.manual_review_pages
                )
            )

            for document in report.documents:
                canonical_path = Path(document["canonical_markdown_path"])
                units_path = Path(document["document_units_path"])
                self.assertTrue(canonical_path.exists())
                self.assertTrue(units_path.exists())
                self.assertIn("# ", canonical_path.read_text(encoding="utf-8"))
                rows = [
                    json.loads(line)
                    for line in units_path.read_text(encoding="utf-8").splitlines()
                    if line.strip()
                ]
                self.assertGreater(len(rows), 0)
                self.assertTrue(all(row["doc_id"] == document["document_id"] for row in rows))

    def test_replay_official_web_source_truth_local_routes_stable_reference_titles_to_stable_reference_scope(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            routing_path = root / "projection-routing.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(routing_path, _routing_payload(titles=["学校简介"]))
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
                            raw_asset_id="owasset_intro_001",
                            raw_version_id="owver_intro_001",
                            normalized_canonical_url="https://www.example.edu/intro",
                            page_family="article_detail",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_news_001",
                            raw_version_id="owver_news_001",
                            normalized_canonical_url="https://www.example.edu/news/1",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_intro_001",
                raw_version_id="owver_intro_001",
                normalized_canonical_url="https://www.example.edu/intro",
                page_title="学校简介",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_intro_001",
                        raw_version_id="owver_intro_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="学校简介",
                    ),
                    _block(
                        raw_asset_id="owasset_intro_001",
                        raw_version_id="owver_intro_001",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="中央民族大学是一所特色鲜明的高水平大学。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_news_001",
                raw_version_id="owver_news_001",
                normalized_canonical_url="https://www.example.edu/news/1",
                page_title="校园新闻",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_news_001",
                        raw_version_id="owver_news_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="校园新闻",
                    ),
                    _block(
                        raw_asset_id="owasset_news_001",
                        raw_version_id="owver_news_001",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="学校召开专题工作会议，部署近期重点任务。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
                routing_path=routing_path,
            )

            self.assertEqual(report.counts["emitted_documents"], 2)
            documents_by_title = {document["title"]: document for document in report.documents}
            self.assertEqual(
                documents_by_title["学校简介"]["target_collection"], "stable_reference"
            )
            self.assertEqual(documents_by_title["学校简介"]["target_corpus"], "official_web")
            self.assertEqual(
                documents_by_title["学校简介"]["routing_route_id"], "stable-reference-bootstrap"
            )
            self.assertEqual(
                documents_by_title["校园新闻"]["target_collection"], "muc_public_pages"
            )
            self.assertIsNone(documents_by_title["校园新闻"]["routing_route_id"])

    def test_replay_official_web_source_truth_local_routes_fresh_news_seed_titles_to_fresh_news_scope(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            routing_path = root / "projection-routing.json"
            _write_json(declarations_path, _declarations_payload())
            _write_json(
                routing_path,
                _routing_payload(
                    titles=["学校简介"],
                    extra_routes=[
                        {
                            "route_id": "fresh-news-seed-handoff",
                            "target_corpus": "official_web",
                            "target_collection": "fresh_news",
                            "page_families": ["article_detail"],
                            "title_allowlist": [
                                "中央民族大学唐鑫团队在红外高光谱成像系统研究获重大突破"
                            ],
                        }
                    ],
                ),
            )
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
                            raw_asset_id="owasset_intro_001",
                            raw_version_id="owver_intro_001",
                            normalized_canonical_url="https://www.example.edu/intro",
                            page_family="article_detail",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_news_001",
                            raw_version_id="owver_news_001",
                            normalized_canonical_url="https://www.example.edu/news/1",
                            page_family="article_detail",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_misc_001",
                            raw_version_id="owver_misc_001",
                            normalized_canonical_url="https://www.example.edu/news/2",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_intro_001",
                raw_version_id="owver_intro_001",
                normalized_canonical_url="https://www.example.edu/intro",
                page_title="学校简介",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_intro_001",
                        raw_version_id="owver_intro_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="学校简介",
                    ),
                    _block(
                        raw_asset_id="owasset_intro_001",
                        raw_version_id="owver_intro_001",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="中央民族大学是一所特色鲜明的高水平大学。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="news.example.edu",
                raw_asset_id="owasset_news_001",
                raw_version_id="owver_news_001",
                normalized_canonical_url="https://www.example.edu/news/1",
                page_title="中央民族大学唐鑫团队在红外高光谱成像系统研究获重大突破",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_news_001",
                        raw_version_id="owver_news_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学唐鑫团队在红外高光谱成像系统研究获重大突破",
                    ),
                    _block(
                        raw_asset_id="owasset_news_001",
                        raw_version_id="owver_news_001",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="学校科研团队在红外高光谱成像系统研究中取得重要进展。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="news.example.edu",
                raw_asset_id="owasset_misc_001",
                raw_version_id="owver_misc_001",
                normalized_canonical_url="https://www.example.edu/news/2",
                page_title="校园新闻",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_misc_001",
                        raw_version_id="owver_misc_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="校园新闻",
                    ),
                    _block(
                        raw_asset_id="owasset_misc_001",
                        raw_version_id="owver_misc_001",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="学校召开专题工作会议，部署近期重点任务。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
                routing_path=routing_path,
            )

            documents_by_title = {document["title"]: document for document in report.documents}
            self.assertEqual(
                documents_by_title["学校简介"]["target_collection"], "stable_reference"
            )
            self.assertEqual(
                documents_by_title["中央民族大学唐鑫团队在红外高光谱成像系统研究获重大突破"][
                    "target_collection"
                ],
                "fresh_news",
            )
            self.assertEqual(
                documents_by_title["中央民族大学唐鑫团队在红外高光谱成像系统研究获重大突破"][
                    "routing_route_id"
                ],
                "fresh-news-seed-handoff",
            )
            self.assertEqual(
                documents_by_title["校园新闻"]["target_collection"], "muc_public_pages"
            )
            self.assertIsNone(documents_by_title["校园新闻"]["routing_route_id"])

    def test_replay_official_web_source_truth_local_keeps_generic_fallback_pages_in_manual_review_for_muc_public_pages(
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
                            raw_asset_id="owasset_generic_001",
                            raw_version_id="owver_generic_001",
                            normalized_canonical_url="https://www.example.edu/",
                            page_family="generic_content_page",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_generic_001",
                raw_version_id="owver_generic_001",
                normalized_canonical_url="https://www.example.edu/",
                page_title="门户首页",
                page_family="generic_content_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_generic_001",
                        raw_version_id="owver_generic_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="门户首页",
                    ),
                    _block(
                        raw_asset_id="owasset_generic_001",
                        raw_version_id="owver_generic_001",
                        row_id="link-1",
                        row_index=1,
                        block_order=1,
                        block_role="link",
                        text="学校召开就业工作推进会",
                    ),
                    _block(
                        raw_asset_id="owasset_generic_001",
                        raw_version_id="owver_generic_001",
                        row_id="link-2",
                        row_index=2,
                        block_order=2,
                        block_role="link",
                        text="2026年招生宣传工作启动",
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
            self.assertEqual(report.manual_review_pages[0]["page_family"], "generic_content_page")
            self.assertIn("staged_only", report.manual_review_pages[0]["reason"])

    def test_projection_emits_serving_intent_metadata_for_promotable_and_audit_only_documents(
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
                            raw_asset_id="owasset_article_010",
                            raw_version_id="owver_article_010",
                            normalized_canonical_url="https://www.example.edu/news/10",
                            page_family="article_detail",
                        ),
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
                raw_asset_id="owasset_article_010",
                raw_version_id="owver_article_010",
                normalized_canonical_url="https://www.example.edu/news/10",
                page_title="新闻详情",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_010",
                        raw_version_id="owver_article_010",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="新闻详情",
                    ),
                    _block(
                        raw_asset_id="owasset_article_010",
                        raw_version_id="owver_article_010",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="中央民族大学召开专题工作会议，部署本学期重点任务。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_listing_010",
                raw_version_id="owver_listing_010",
                normalized_canonical_url="https://www.example.edu/news/",
                page_title="新闻网",
                page_family="listing_page",
                blocks=[
                    _block(
                        raw_asset_id="owasset_listing_010",
                        raw_version_id="owver_listing_010",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="新闻网",
                    ),
                    _block(
                        raw_asset_id="owasset_listing_010",
                        raw_version_id="owver_listing_010",
                        row_id="item-1",
                        row_index=1,
                        block_order=1,
                        block_role="list_item",
                        text="学校召开就业工作推进会",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            article_document = next(
                document
                for document in report.documents
                if document["page_family"] == "article_detail"
            )
            listing_document = next(
                document
                for document in report.documents
                if document["page_family"] == "listing_page"
            )
            article_units = [
                json.loads(line)
                for line in Path(article_document["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]
            listing_units = [
                json.loads(line)
                for line in Path(listing_document["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

            self.assertEqual(article_document["serving_intent"], "promotable")
            self.assertIsNone(article_document["promotion_block_reason"])
            self.assertEqual(article_units[0]["metadata"]["serving_intent"], "promotable")
            self.assertEqual(article_units[0]["metadata"]["content_role"], "primary_content")
            self.assertNotIn("promotion_block_reason", article_units[0]["metadata"])
            self.assertNotIn("acl", article_units[0])

            self.assertEqual(listing_document["serving_intent"], "audit_only")
            self.assertEqual(listing_document["promotion_block_reason"], "listing_page_audit_only")
            self.assertEqual(listing_units[0]["metadata"]["serving_intent"], "audit_only")
            self.assertEqual(
                listing_units[0]["metadata"]["promotion_block_reason"], "listing_page_audit_only"
            )
            self.assertEqual(listing_units[0]["metadata"]["content_role"], "navigation_audit")
            self.assertNotIn("acl", listing_units[0])

    def test_projection_propagates_publication_and_fetch_metadata(self) -> None:
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
                            raw_asset_id="owasset_article_011",
                            raw_version_id="owver_article_011",
                            normalized_canonical_url="https://www.example.edu/news/11",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_article_011",
                raw_version_id="owver_article_011",
                normalized_canonical_url="https://www.example.edu/news/11",
                page_title="新闻详情",
                page_family="article_detail",
                published_at="2026-03-25T00:00:00+08:00",
                last_modified="Tue, 25 Mar 2026 08:00:00 GMT",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_011",
                        raw_version_id="owver_article_011",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="新闻详情",
                    ),
                    _block(
                        raw_asset_id="owasset_article_011",
                        raw_version_id="owver_article_011",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="中央民族大学召开专题工作会议，部署本学期重点任务。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            document = report.documents[0]
            units = [
                json.loads(line)
                for line in Path(document["document_units_path"])
                .read_text(encoding="utf-8")
                .splitlines()
                if line.strip()
            ]

            self.assertEqual(document["published_at"], "2026-03-25T00:00:00+08:00")
            self.assertEqual(document["fetched_at"], "2026-03-31T09:00:00.000Z")
            self.assertEqual(document["last_modified"], "Tue, 25 Mar 2026 08:00:00 GMT")
            self.assertEqual(units[0]["metadata"]["published_at"], "2026-03-25T00:00:00+08:00")
            self.assertEqual(units[0]["metadata"]["fetched_at"], "2026-03-31T09:00:00.000Z")
            self.assertEqual(units[0]["metadata"]["last_modified"], "Tue, 25 Mar 2026 08:00:00 GMT")

    def test_projection_marks_low_value_public_notice_articles_as_audit_only(self) -> None:
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
                            raw_asset_id="owasset_notice_001",
                            raw_version_id="owver_notice_001",
                            normalized_canonical_url="https://xxgk.example.edu/info/1297/5711.htm",
                            page_family="article_detail",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_notice_002",
                            raw_version_id="owver_notice_002",
                            normalized_canonical_url="https://xxgk.example.edu/info/1358/28711.htm",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.example.edu",
                raw_asset_id="owasset_notice_001",
                raw_version_id="owver_notice_001",
                normalized_canonical_url="https://xxgk.example.edu/info/1297/5711.htm",
                page_title="中央民族大学公开招聘及公示信息",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_notice_001",
                        raw_version_id="owver_notice_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学公开招聘及公示信息",
                    ),
                    _block(
                        raw_asset_id="owasset_notice_001",
                        raw_version_id="owver_notice_001",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="现发布中央民族大学公开招聘及公示信息，请查阅附件和后续说明。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.example.edu",
                raw_asset_id="owasset_notice_002",
                raw_version_id="owver_notice_002",
                normalized_canonical_url="https://xxgk.example.edu/info/1358/28711.htm",
                page_title="中央民族大学海淀校区为新购置家具加装嵌入式插座项目采购谈判结果公示",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_notice_002",
                        raw_version_id="owver_notice_002",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学海淀校区为新购置家具加装嵌入式插座项目采购谈判结果公示",
                    ),
                    _block(
                        raw_asset_id="owasset_notice_002",
                        raw_version_id="owver_notice_002",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="现将采购谈判结果予以公示，项目联系人与结果说明如下。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            documents_by_title = {document["title"]: document for document in report.documents}
            for title in (
                "中央民族大学公开招聘及公示信息",
                "中央民族大学海淀校区为新购置家具加装嵌入式插座项目采购谈判结果公示",
            ):
                document = documents_by_title[title]
                units = [
                    json.loads(line)
                    for line in Path(document["document_units_path"])
                    .read_text(encoding="utf-8")
                    .splitlines()
                    if line.strip()
                ]
                self.assertEqual(document["serving_intent"], "audit_only")
                self.assertEqual(
                    document["promotion_block_reason"], "low_value_public_notice_audit_only"
                )
                self.assertEqual(units[0]["metadata"]["serving_intent"], "audit_only")
                self.assertEqual(
                    units[0]["metadata"]["promotion_block_reason"],
                    "low_value_public_notice_audit_only",
                )

    def test_validate_official_web_projection_output_reports_missing_document_units(self) -> None:
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
                            normalized_canonical_url="https://www.example.edu/news/1",
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
                normalized_canonical_url="https://www.example.edu/news/1",
                page_title="新闻详情",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_article_001",
                        raw_version_id="owver_article_001",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="新闻详情",
                    ),
                    _block(
                        raw_asset_id="owasset_article_001",
                        raw_version_id="owver_article_001",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="中央民族大学召开专题工作会议。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            document_units_path = Path(report.documents[0]["document_units_path"])
            document_units_path.unlink()

            validation = validate_official_web_projection_output(projection_dir)

            self.assertFalse(validation.valid)
            self.assertTrue(
                any(issue["code"] == "missing_document_units" for issue in validation.issues)
            )
