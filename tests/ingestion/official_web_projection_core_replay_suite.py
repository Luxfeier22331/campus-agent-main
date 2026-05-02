from __future__ import annotations

import unittest
from dataclasses import asdict

from .official_web_projection_test_support import *


class OfficialWebProjectionCoreReplayTest(unittest.TestCase):
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

    def test_replay_official_web_source_truth_local_uses_consumer_matches_before_title_routing(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            stable_match = {
                "consumerFamily": "stable_reference_candidate",
                "ownerSurface": "official_web/stable_reference",
                "ownerAgentOrRuntime": "rag-agent",
                "materializationPolicy": "release_gate_required",
                "selectedWriteTarget": "official_web/stable_reference",
                "reviewPolicy": "release_gate_required",
                "matchedEvidence": ["stable_reference"],
                "matchedKeywords": ["学校简介"],
                "matchedPatterns": [],
            }
            contact_match = {
                "consumerFamily": "contact_directory_candidate",
                "ownerSurface": "contact_directory_lookup",
                "ownerAgentOrRuntime": "campus-services-agent",
                "materializationPolicy": "candidate_only",
                "selectedWriteTarget": "campus_services/contact_directory",
                "reviewPolicy": "selected_write_requires_review",
                "matchedEvidence": ["phone", "location"],
                "matchedKeywords": ["联系我们"],
                "matchedPatterns": [],
            }
            news_match = {
                "consumerFamily": "notice_news_candidate",
                "ownerSurface": "future_notice_runtime",
                "ownerAgentOrRuntime": "notice-agent",
                "materializationPolicy": "inventory_only",
                "selectedWriteTarget": "",
                "reviewPolicy": "inventory_only",
                "matchedEvidence": ["notice_news"],
                "matchedKeywords": ["通知"],
                "matchedPatterns": [],
            }
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_consumer",
                    "generatedAt": "2026-05-01T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_consumer_stable",
                            raw_version_id="owver_consumer_stable",
                            normalized_canonical_url="https://www.example.edu/intro",
                            page_family="article_detail",
                            consumer_matches=[stable_match],
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_consumer_contact",
                            raw_version_id="owver_consumer_contact",
                            normalized_canonical_url="https://www.example.edu/contact",
                            page_family="article_detail",
                            consumer_matches=[contact_match],
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_consumer_news",
                            raw_version_id="owver_consumer_news",
                            normalized_canonical_url="https://www.example.edu/news/notice",
                            page_family="article_detail",
                            consumer_matches=[news_match],
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_consumer_stable",
                raw_version_id="owver_consumer_stable",
                normalized_canonical_url="https://www.example.edu/intro",
                page_title="学校简介",
                page_family="article_detail",
                consumer_matches=[stable_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_consumer_stable",
                        raw_version_id="owver_consumer_stable",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="学校简介",
                    ),
                    _block(
                        raw_asset_id="owasset_consumer_stable",
                        raw_version_id="owver_consumer_stable",
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
                raw_asset_id="owasset_consumer_contact",
                raw_version_id="owver_consumer_contact",
                normalized_canonical_url="https://www.example.edu/contact",
                page_title="联系我们",
                page_family="article_detail",
                consumer_matches=[contact_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_consumer_contact",
                        raw_version_id="owver_consumer_contact",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="联系我们",
                    ),
                    _block(
                        raw_asset_id="owasset_consumer_contact",
                        raw_version_id="owver_consumer_contact",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="办公地点：中慧楼二层，联系电话：010-68933381。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_consumer_news",
                raw_version_id="owver_consumer_news",
                normalized_canonical_url="https://www.example.edu/news/notice",
                page_title="关于近期活动安排的通知",
                page_family="article_detail",
                consumer_matches=[news_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_consumer_news",
                        raw_version_id="owver_consumer_news",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="关于近期活动安排的通知",
                    ),
                    _block(
                        raw_asset_id="owasset_consumer_news",
                        raw_version_id="owver_consumer_news",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="活动安排以现场通知为准。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(report.counts["emitted_documents"], 1)
            self.assertEqual(report.counts["consumer_candidate_pages"], 2)
            self.assertEqual(report.documents[0]["target_collection"], "stable_reference")
            self.assertEqual(
                report.documents[0]["routing_route_id"],
                "consumer-denominator:stable_reference_candidate",
            )
            candidate_families = {
                page["consumer_family"] for page in report.consumer_candidate_pages
            }
            self.assertEqual(
                candidate_families,
                {"contact_directory_candidate", "notice_news_candidate"},
            )
            contact_candidate = next(
                page
                for page in report.consumer_candidate_pages
                if page["consumer_family"] == "contact_directory_candidate"
            )
            self.assertTrue(str(contact_candidate["candidate_key"]).startswith("owcand_"))
            self.assertEqual(
                contact_candidate["typed_candidate_schema_version"],
                "official_web_contact_directory_candidate.v1",
            )
            self.assertEqual(
                contact_candidate["typed_candidate"]["phones"],
                ["010-68933381"],
            )
            self.assertEqual(
                contact_candidate["typed_candidate"]["locations"],
                ["中慧楼二层"],
            )
            self.assertEqual(contact_candidate["quality_gate"]["decision"], "pass")
            self.assertEqual(
                contact_candidate["quality_gate"]["reason_codes"],
                [],
            )
            self.assertGreaterEqual(len(contact_candidate["evidence_spans"]), 2)

    def test_replay_target_workset_uses_target_lineage_for_family_grouping_and_projection(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            stable_match = _target_match(
                consumer_family="stable_reference_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="official_web/stable_reference",
                target_id="official-web-stable-reference",
                review_policy="release_gate_required",
            )
            contact_match = _target_match(
                consumer_family="contact_directory_candidate",
                materialization_policy="candidate_only",
                selected_write_target="campus_services/contact_directory",
                target_id="campus-services-contact-directory",
            )
            notice_match = _target_match(
                consumer_family="notice_news_candidate",
                materialization_policy="inventory_only",
                selected_write_target="",
                target_id="official-web-notice-news-inventory",
                retention_policy="inventory_only",
                review_policy="inventory_only",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_target_workset",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-01T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_target_stable",
                            raw_version_id="owver_target_stable",
                            normalized_canonical_url="https://www.example.edu/intro",
                            page_family="article_detail",
                            target_matches=[stable_match],
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_target_contact",
                            raw_version_id="owver_target_contact",
                            normalized_canonical_url="https://www.example.edu/contact",
                            page_family="article_detail",
                            target_matches=[contact_match],
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_target_notice",
                            raw_version_id="owver_target_notice",
                            normalized_canonical_url="https://www.example.edu/news/notice",
                            page_family="article_detail",
                            target_matches=[notice_match],
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_target_stable",
                raw_version_id="owver_target_stable",
                normalized_canonical_url="https://www.example.edu/intro",
                page_title="学校简介",
                page_family="article_detail",
                target_matches=[stable_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_target_stable",
                        raw_version_id="owver_target_stable",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="学校简介",
                    ),
                    _block(
                        raw_asset_id="owasset_target_stable",
                        raw_version_id="owver_target_stable",
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
                raw_asset_id="owasset_target_contact",
                raw_version_id="owver_target_contact",
                normalized_canonical_url="https://www.example.edu/contact",
                page_title="联系我们",
                page_family="article_detail",
                target_matches=[contact_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_target_contact",
                        raw_version_id="owver_target_contact",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="联系我们",
                    ),
                    _block(
                        raw_asset_id="owasset_target_contact",
                        raw_version_id="owver_target_contact",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="办公地点：中慧楼二层，联系电话：010-68933381。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_target_notice",
                raw_version_id="owver_target_notice",
                normalized_canonical_url="https://www.example.edu/news/notice",
                page_title="关于近期活动安排的通知",
                page_family="article_detail",
                target_matches=[notice_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_target_notice",
                        raw_version_id="owver_target_notice",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="关于近期活动安排的通知",
                    ),
                    _block(
                        raw_asset_id="owasset_target_notice",
                        raw_version_id="owver_target_notice",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="活动安排以现场通知为准。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(report.counts["emitted_documents"], 1)
            self.assertEqual(report.counts["consumer_candidate_pages"], 2)
            self.assertEqual(
                report.target_family_counts,
                {
                    "stable_reference_candidate": 1,
                    "contact_directory_candidate": 1,
                    "notice_news_candidate": 1,
                },
            )
            self.assertEqual(
                report.target_materialization_policy_counts,
                {
                    "release_gate_required": 1,
                    "candidate_only": 1,
                    "inventory_only": 1,
                },
            )
            self.assertEqual(report.target_lineage_issues, [])
            self.assertEqual(
                report.documents[0]["target_consumer_family"],
                "stable_reference_candidate",
            )
            self.assertEqual(report.documents[0]["target_job_id"], "owtargetjob_test")
            self.assertEqual(report.documents[0]["target_id"], "official-web-stable-reference")
            self.assertEqual(report.documents[0]["materialization_policy"], "release_gate_required")
            candidates_by_family = {
                candidate["consumer_family"]: candidate
                for candidate in report.consumer_candidate_pages
            }
            self.assertEqual(
                candidates_by_family["contact_directory_candidate"]["target_id"],
                "campus-services-contact-directory",
            )
            self.assertEqual(
                candidates_by_family["notice_news_candidate"]["source_family"],
                "official_web_public_notice",
            )
            self.assertNotIn("public_notice_inventory", json.dumps(asdict(report)))

    def test_target_workset_contact_candidate_uses_footer_contact_facts(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            contact_match = _target_match(
                consumer_family="contact_directory_candidate",
                materialization_policy="candidate_only",
                selected_write_target="campus_services/contact_directory",
                target_id="campus-services-contact-directory",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_footer_contact",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-01T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_footer_contact",
                            raw_version_id="owver_footer_contact",
                            normalized_canonical_url="https://www.example.edu/",
                            page_family="generic_content_page",
                            target_matches=[contact_match],
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_footer_contact",
                raw_version_id="owver_footer_contact",
                normalized_canonical_url="https://www.example.edu/",
                page_title="中央民族大学",
                page_family="generic_content_page",
                target_matches=[contact_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_footer_contact",
                        raw_version_id="owver_footer_contact",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学",
                    ),
                    _block(
                        raw_asset_id="owasset_footer_contact",
                        raw_version_id="owver_footer_contact",
                        row_id="nav-1",
                        row_index=1,
                        block_order=1,
                        block_role="link",
                        text="通知公告",
                        is_main_content=False,
                        is_navigation=True,
                        is_boilerplate=True,
                    ),
                    _block(
                        raw_asset_id="owasset_footer_contact",
                        raw_version_id="owver_footer_contact",
                        row_id="footer-address",
                        row_index=2,
                        block_order=2,
                        block_role="list_item",
                        text="海淀校区：北京市海淀区中关村南大街27号 丰台校区：北京市丰台区魏各庄路27号",
                        is_main_content=False,
                        is_boilerplate=True,
                    ),
                    _block(
                        raw_asset_id="owasset_footer_contact",
                        raw_version_id="owver_footer_contact",
                        row_id="footer-phone",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="电话：010-68932442",
                        is_main_content=False,
                        is_boilerplate=True,
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(report.counts["consumer_candidate_pages"], 1)
            candidate = report.consumer_candidate_pages[0]
            self.assertEqual(candidate["typed_candidate"]["phones"], ["010-68932442"])
            self.assertIn(
                "海淀校区：北京市海淀区中关村南大街27号",
                candidate["typed_candidate"]["locations"],
            )
            self.assertIn(
                "丰台校区：北京市丰台区魏各庄路27号",
                candidate["typed_candidate"]["locations"],
            )
            self.assertEqual(candidate["quality_gate"], {"decision": "pass", "reason_codes": []})

    def test_service_guide_candidate_extracts_responsible_offices(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            service_match = _target_match(
                consumer_family="service_guide_candidate",
                materialization_policy="candidate_only",
                selected_write_target="campus_services/service_guide",
                target_id="campus-services-service-guide",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_service_office",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-01T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_service_office",
                            raw_version_id="owver_service_office",
                            normalized_canonical_url="https://www.example.edu/info/1007/1113.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_service_office",
                raw_version_id="owver_service_office",
                normalized_canonical_url="https://www.example.edu/info/1007/1113.htm",
                page_title="中央民族大学信息公开依申请公开工作流程",
                page_family="article_detail",
                target_matches=[service_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_service_office",
                        raw_version_id="owver_service_office",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学信息公开依申请公开工作流程",
                    ),
                    _block(
                        raw_asset_id="owasset_service_office",
                        raw_version_id="owver_service_office",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="学校信息公开办公室负责初步审核，并由具体承办部门负责审核申请人提出的学校信息公开申请。",
                    ),
                    _block(
                        raw_asset_id="owasset_service_office",
                        raw_version_id="owver_service_office",
                        row_id="p-2",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="申请人应提交申请材料，学校在15个工作日内作出答复。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            candidate = report.consumer_candidate_pages[0]
            self.assertEqual(
                candidate["typed_candidate"]["responsible_office"],
                ["学校信息公开办公室", "具体承办部门"],
            )
            self.assertEqual(candidate["quality_gate"], {"decision": "pass", "reason_codes": []})

    def test_target_workset_missing_lineage_fails_projection_admission(
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
                    "crawlRunId": "owrun_missing_lineage",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-01T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_missing_lineage",
                            raw_version_id="owver_missing_lineage",
                            normalized_canonical_url="https://www.example.edu/contact",
                            page_family="article_detail",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_missing_lineage",
                raw_version_id="owver_missing_lineage",
                normalized_canonical_url="https://www.example.edu/contact",
                page_title="联系我们",
                page_family="article_detail",
                blocks=[
                    _block(
                        raw_asset_id="owasset_missing_lineage",
                        raw_version_id="owver_missing_lineage",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="联系我们",
                    ),
                    _block(
                        raw_asset_id="owasset_missing_lineage",
                        raw_version_id="owver_missing_lineage",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="办公地点：中慧楼二层，联系电话：010-68933381。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )
            validation = validate_official_web_projection_output(projection_dir)

            self.assertEqual(report.counts["target_lineage_issue_pages"], 1)
            self.assertEqual(report.target_lineage_issues[0]["code"], "missing_target_lineage")
            self.assertFalse(validation.valid)
            self.assertIn(
                "target_workset_missing_lineage",
                {issue["code"] for issue in validation.issues},
            )

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
