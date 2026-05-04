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
                target_label="中央民族大学信息化服务联系方式",
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

    def test_target_workset_regulation_candidate_stays_release_gated_and_targets_institutional_rules(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            regulation_match = _target_match(
                consumer_family="regulation_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="regulations/institutional_rules",
                target_id="official-web-institutional-rules",
                review_policy="release_gate_required",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_target_regulation",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-01T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_target_regulation",
                            raw_version_id="owver_target_regulation",
                            normalized_canonical_url="https://www.example.edu/rules/policy",
                            page_family="article_detail",
                            target_matches=[regulation_match],
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_target_regulation",
                raw_version_id="owver_target_regulation",
                normalized_canonical_url="https://www.example.edu/rules/policy",
                page_title="中央民族大学信息公开实施细则",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_target_regulation",
                        raw_version_id="owver_target_regulation",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学信息公开实施细则",
                    ),
                    _block(
                        raw_asset_id="owasset_target_regulation",
                        raw_version_id="owver_target_regulation",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 为了推进学校信息公开工作，制定本实施细则。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(report.counts["emitted_documents"], 0)
            self.assertEqual(report.counts["consumer_candidate_pages"], 1)
            self.assertEqual(
                report.target_family_counts,
                {
                    "regulation_candidate": 1,
                },
            )
            candidate = report.consumer_candidate_pages[0]
            self.assertEqual(candidate["consumer_family"], "regulation_candidate")
            self.assertEqual(candidate["materialization_policy"], "release_gate_required")
            self.assertEqual(candidate["selected_write_target"], "regulations/institutional_rules")
            self.assertEqual(candidate["target_corpus"], "regulations")
            self.assertEqual(candidate["target_collection"], "institutional_rules")
            self.assertEqual(
                candidate["typed_candidate_schema_version"],
                "official_web_regulation_candidate.v1",
            )
            self.assertEqual(candidate["quality_gate"]["decision"], "pass")
            self.assertEqual(
                candidate["typed_candidate"]["regulation_text"],
                "第一条 为了推进学校信息公开工作，制定本实施细则。",
            )

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
                target_label="中央民族大学信息化服务联系方式",
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

    def test_service_guide_candidate_keeps_process_text_out_of_materials_and_entry_refs(
        self,
    ) -> None:
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
                target_id="muc-it-student-campus-card-service-guide",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_campus_card_service",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-01T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_campus_card",
                            raw_version_id="owver_campus_card",
                            normalized_canonical_url="https://met.example.edu/card-service",
                            page_family="article_detail",
                            target_matches=[service_match],
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_campus_card",
                raw_version_id="owver_campus_card",
                normalized_canonical_url="https://met.example.edu/card-service",
                page_title="学生校园卡服务",
                page_family="article_detail",
                target_matches=[service_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_campus_card",
                        raw_version_id="owver_campus_card",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="学生校园卡服务",
                    ),
                    _block(
                        raw_asset_id="owasset_campus_card",
                        raw_version_id="owver_campus_card",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="服务说明：校园卡丢失后，请立即通过圈存机或民大通APP挂失，也可携带身份证到校园卡管理中心前台现场办理。",
                    ),
                    _block(
                        raw_asset_id="owasset_campus_card",
                        raw_version_id="owver_campus_card",
                        row_id="p-2",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="服务说明：校园卡损坏或丢失后，可通过自助补卡机补办新卡。",
                    ),
                    _block(
                        raw_asset_id="owasset_campus_card",
                        raw_version_id="owver_campus_card",
                        row_id="p-3",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="系统会同步相关个人信息到校园卡系统。",
                    ),
                    _block(
                        raw_asset_id="owasset_campus_card",
                        raw_version_id="owver_campus_card",
                        row_id="p-4",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="咨询电话：010-68933381、010-83878225。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            candidate = report.consumer_candidate_pages[0]
            typed_candidate = candidate["typed_candidate"]
            self.assertEqual(typed_candidate["materials"], [])
            self.assertEqual(
                typed_candidate["entry_points"],
                ["圈存机", "民大通APP", "校园卡管理中心前台", "自助补卡机"],
            )
            self.assertTrue(
                any("服务说明：校园卡丢失后" in step for step in typed_candidate["process_steps"])
            )
            self.assertEqual(
                typed_candidate["contacts"]["phones"],
                ["010-68933381", "010-83878225"],
            )
            self.assertEqual(candidate["quality_gate"], {"decision": "pass", "reason_codes": []})

    def test_service_guide_download_page_does_not_satisfy_process_evidence(self) -> None:
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
                target_id="muc-information-disclosure-application-form-download",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_form_download",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-01T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_form_download",
                            raw_version_id="owver_form_download",
                            normalized_canonical_url="https://xxgk.example.edu/info/1007/1114.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.example.edu",
                raw_asset_id="owasset_form_download",
                raw_version_id="owver_form_download",
                normalized_canonical_url="https://xxgk.example.edu/info/1007/1114.htm",
                page_title="中央民族大学依申请公开信息申请表、审批表下载",
                page_family="article_detail",
                target_matches=[service_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_form_download",
                        raw_version_id="owver_form_download",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学依申请公开信息申请表、审批表下载",
                    ),
                    _block(
                        raw_asset_id="owasset_form_download",
                        raw_version_id="owver_form_download",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="中央民族大学依申请公开信息审批表",
                    ),
                    _block(
                        raw_asset_id="owasset_form_download",
                        raw_version_id="owver_form_download",
                        row_id="p-2",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="中央民族大学信息公开申请表",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            candidate = report.consumer_candidate_pages[0]
            self.assertEqual(candidate["typed_candidate"]["process_steps"], [])
            self.assertEqual(
                candidate["typed_candidate"]["materials"],
                ["中央民族大学依申请公开信息审批表", "中央民族大学信息公开申请表"],
            )
            self.assertEqual(
                candidate["quality_gate"],
                {"decision": "reject", "reason_codes": ["missing_required_evidence"]},
            )

    def test_information_disclosure_composition_merges_material_and_contact_into_service_candidate(
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
            service_match = _target_match(
                consumer_family="service_guide_candidate",
                materialization_policy="candidate_only",
                selected_write_target="campus_services/service_guide",
                target_id="campus-services-service-guide",
                target_job_id="owtarget_service_guide",
                target_candidate_id="owcand_info_disclosure_service",
            )
            contact_match = _target_match(
                consumer_family="contact_directory_candidate",
                materialization_policy="candidate_only",
                selected_write_target="campus_services/contact_directory",
                target_id="campus-services-contact-directory",
                target_job_id="owtarget_contact_directory",
                target_candidate_id="owcand_info_disclosure_contact",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_info_disclosure_bundle",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-03T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_info_policy",
                            raw_version_id="owver_info_policy",
                            normalized_canonical_url="https://xxgk.example.edu/info/1005/1107.htm",
                            page_family="article_detail",
                            target_matches=[stable_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-info-disclosure-policy-1107",
                            composition_group="information_disclosure",
                            composition_role="policy_source",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_info_procedure",
                            raw_version_id="owver_info_procedure",
                            normalized_canonical_url="https://xxgk.example.edu/info/1007/1113.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-info-disclosure-procedure-1113",
                            composition_group="information_disclosure",
                            composition_role="procedure_source",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_info_material",
                            raw_version_id="owver_info_material",
                            normalized_canonical_url="https://xxgk.example.edu/info/1007/1114.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-info-disclosure-material-1114",
                            composition_group="information_disclosure",
                            composition_role="material_source",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_info_contact",
                            raw_version_id="owver_info_contact",
                            normalized_canonical_url="https://xxgk.example.edu/xxgk/lxfs.htm",
                            page_family="article_detail",
                            target_matches=[contact_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-info-disclosure-contact-lxfs",
                            composition_group="information_disclosure",
                            composition_role="contact_source",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.example.edu",
                raw_asset_id="owasset_info_policy",
                raw_version_id="owver_info_policy",
                normalized_canonical_url="https://xxgk.example.edu/info/1005/1107.htm",
                page_title="中央民族大学信息公开实施细则",
                page_family="article_detail",
                target_matches=[stable_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-info-disclosure-policy-1107",
                composition_group="information_disclosure",
                composition_role="policy_source",
                blocks=[
                    _block(
                        raw_asset_id="owasset_info_policy",
                        raw_version_id="owver_info_policy",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学信息公开实施细则",
                    ),
                    _block(
                        raw_asset_id="owasset_info_policy",
                        raw_version_id="owver_info_policy",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="学校主动公开和依申请公开的信息范围按照细则执行。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.example.edu",
                raw_asset_id="owasset_info_procedure",
                raw_version_id="owver_info_procedure",
                normalized_canonical_url="https://xxgk.example.edu/info/1007/1113.htm",
                page_title="中央民族大学信息公开依申请公开工作流程",
                page_family="article_detail",
                target_matches=[service_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-info-disclosure-procedure-1113",
                composition_group="information_disclosure",
                composition_role="procedure_source",
                blocks=[
                    _block(
                        raw_asset_id="owasset_info_procedure",
                        raw_version_id="owver_info_procedure",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学信息公开依申请公开工作流程",
                    ),
                    _block(
                        raw_asset_id="owasset_info_procedure",
                        raw_version_id="owver_info_procedure",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="申请人提出申请后，学校信息公开办公室负责初步审核，并由具体承办部门负责审核申请人提出的学校信息公开申请。",
                    ),
                    _block(
                        raw_asset_id="owasset_info_procedure",
                        raw_version_id="owver_info_procedure",
                        row_id="p-2",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="学校在15个工作日内作出答复。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.example.edu",
                raw_asset_id="owasset_info_material",
                raw_version_id="owver_info_material",
                normalized_canonical_url="https://xxgk.example.edu/info/1007/1114.htm",
                page_title="中央民族大学依申请公开信息申请表、审批表下载",
                page_family="article_detail",
                target_matches=[service_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-info-disclosure-material-1114",
                composition_group="information_disclosure",
                composition_role="material_source",
                blocks=[
                    _block(
                        raw_asset_id="owasset_info_material",
                        raw_version_id="owver_info_material",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学依申请公开信息申请表、审批表下载",
                    ),
                    _block(
                        raw_asset_id="owasset_info_material",
                        raw_version_id="owver_info_material",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="申请材料：中央民族大学信息公开申请表、中央民族大学依申请公开信息审批表。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.example.edu",
                raw_asset_id="owasset_info_contact",
                raw_version_id="owver_info_contact",
                normalized_canonical_url="https://xxgk.example.edu/xxgk/lxfs.htm",
                page_title="联系方式",
                page_family="article_detail",
                target_matches=[contact_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-info-disclosure-contact-lxfs",
                composition_group="information_disclosure",
                composition_role="contact_source",
                blocks=[
                    _block(
                        raw_asset_id="owasset_info_contact",
                        raw_version_id="owver_info_contact",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="联系方式",
                    ),
                    _block(
                        raw_asset_id="owasset_info_contact",
                        raw_version_id="owver_info_contact",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="办公地点：海淀校区知行堂北区；联系电话：010-68933971；电子邮箱：xxgk@muc.edu.cn；办公时间：周一至周五 08:30-11:30 14:00-17:00。",
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
            document = report.documents[0]
            self.assertEqual(document["target_collection"], "stable_reference")
            candidates_by_family = {
                candidate["consumer_family"]: candidate
                for candidate in report.consumer_candidate_pages
            }
            self.assertEqual(
                set(candidates_by_family.keys()),
                {"service_guide_candidate", "contact_directory_candidate"},
            )
            service_candidate = candidates_by_family["service_guide_candidate"]
            typed_candidate = service_candidate["typed_candidate"]
            self.assertEqual(
                typed_candidate["service_name"],
                "中央民族大学信息公开依申请公开工作流程",
            )
            self.assertTrue(typed_candidate["process_steps"])
            self.assertEqual(
                typed_candidate["materials"],
                ["中央民族大学信息公开申请表", "中央民族大学依申请公开信息审批表"],
            )
            self.assertEqual(
                typed_candidate["contacts"]["phones"],
                ["010-68933971"],
            )
            self.assertEqual(
                typed_candidate["contacts"]["emails"],
                ["xxgk@muc.edu.cn"],
            )
            self.assertEqual(
                typed_candidate["contacts"]["locations"],
                ["海淀校区知行堂北区"],
            )
            self.assertEqual(
                typed_candidate["contacts"]["office_hours"],
                ["周一至周五 08:30-11:30 14:00-17:00"],
            )
            self.assertEqual(service_candidate["quality_gate"]["decision"], "pass")
            self.assertEqual(service_candidate["target_job_id"], "owtarget_service_guide")
            self.assertEqual(
                service_candidate["target_candidate_id"],
                "owcand_info_disclosure_service",
            )
            self.assertEqual(
                service_candidate["target_id"],
                "campus-services-service-guide",
            )
            self.assertEqual(
                service_candidate["source_pack_entry_id"],
                "owsp-info-disclosure-procedure-1113",
            )
            self.assertEqual(
                service_candidate["composition_group"],
                "information_disclosure",
            )
            self.assertEqual(
                service_candidate["composition_role"],
                "procedure_source",
            )
            self.assertNotIn(
                "missing_required_evidence",
                service_candidate["quality_gate"]["reason_codes"],
            )
            contact_candidate = candidates_by_family["contact_directory_candidate"]
            self.assertEqual(contact_candidate["typed_candidate"]["phones"], ["010-68933971"])

    def test_email_service_composition_merges_policy_entry_and_material_sources(
        self,
    ) -> None:
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
                target_job_id="owtarget_email_service_guide",
                target_candidate_id="owcand_email_service",
                target_label="中央民族大学校园电子邮件服务",
            )
            contact_match = _target_match(
                consumer_family="contact_directory_candidate",
                materialization_policy="candidate_only",
                selected_write_target="campus_services/contact_directory",
                target_id="campus-services-contact-directory",
                target_job_id="owtarget_met_contact_directory",
                target_candidate_id="owcand_met_contact",
                target_label="中央民族大学信息化服务联系方式",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_email_bundle",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-03T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_email_policy",
                            raw_version_id="owver_email_policy",
                            normalized_canonical_url="https://met.example.edu/info/1024/1090.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-email-policy-1090",
                            composition_group="email_service",
                            composition_role="policy_source",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_email_entry",
                            raw_version_id="owver_email_entry",
                            normalized_canonical_url="https://met.example.edu/info/1046/1932.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-email-entry-1932",
                            composition_group="email_service",
                            composition_role="entry_source",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_email_material",
                            raw_version_id="owver_email_material",
                            normalized_canonical_url="https://met.example.edu/xzzq/sqbg/1.htm",
                            page_family="listing_page",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-email-material-forms",
                            composition_group="email_service",
                            composition_role="material_source",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_met_contact",
                            raw_version_id="owver_met_contact",
                            normalized_canonical_url="https://met.example.edu/contact/service.htm",
                            page_family="article_detail",
                            target_matches=[contact_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-met-service-contacts",
                            composition_group="email_service",
                            composition_role="contact_source",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_email_policy",
                raw_version_id="owver_email_policy",
                normalized_canonical_url="https://met.example.edu/info/1024/1090.htm",
                page_title="中央民族大学电子邮件管理办法",
                page_family="article_detail",
                target_matches=[service_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-email-policy-1090",
                composition_group="email_service",
                composition_role="policy_source",
                blocks=[
                    _block(
                        raw_asset_id="owasset_email_policy",
                        raw_version_id="owver_email_policy",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学电子邮件管理办法",
                    ),
                    _block(
                        raw_asset_id="owasset_email_policy",
                        raw_version_id="owver_email_policy",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="校园网电子邮件由网络中心负责运行和维护。",
                    ),
                    _block(
                        raw_asset_id="owasset_email_policy",
                        raw_version_id="owver_email_policy",
                        row_id="p-2",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="校园网电子邮箱的服务对象包含学校各单位、全体教职工、全日制在校学生和2014级及之后的毕业生。",
                    ),
                    _block(
                        raw_asset_id="owasset_email_policy",
                        raw_version_id="owver_email_policy",
                        row_id="p-3",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="新邮箱的申请方法：填写《E-MAIL申请表》并递交网络中心批准。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_email_entry",
                raw_version_id="owver_email_entry",
                normalized_canonical_url="https://met.example.edu/info/1046/1932.htm",
                page_title="邮箱登陆",
                page_family="article_detail",
                target_matches=[service_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-email-entry-1932",
                composition_group="email_service",
                composition_role="entry_source",
                blocks=[
                    _block(
                        raw_asset_id="owasset_email_entry",
                        raw_version_id="owver_email_entry",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="邮箱登陆",
                    ),
                    _block(
                        raw_asset_id="owasset_email_entry",
                        raw_version_id="owver_email_entry",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="邮箱登陆有三种方式：访问 mail.muc.edu.cn，输入账号和密码即可登陆；通过信息门户点击邮箱链接可直接登陆。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_email_material",
                raw_version_id="owver_email_material",
                normalized_canonical_url="https://met.example.edu/xzzq/sqbg/1.htm",
                page_title="申请表格",
                page_family="listing_page",
                target_matches=[service_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-email-material-forms",
                composition_group="email_service",
                composition_role="material_source",
                blocks=[
                    _block(
                        raw_asset_id="owasset_email_material",
                        raw_version_id="owver_email_material",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="申请表格",
                    ),
                    _block(
                        raw_asset_id="owasset_email_material",
                        raw_version_id="owver_email_material",
                        row_id="li-1",
                        row_index=1,
                        block_order=1,
                        block_role="list_item",
                        text="申请表格－中央民族大学教工电子邮件申请表",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_met_contact",
                raw_version_id="owver_met_contact",
                normalized_canonical_url="https://met.example.edu/contact/service.htm",
                page_title="信息化服务联系方式",
                page_family="article_detail",
                target_matches=[contact_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-met-service-contacts",
                composition_group="email_service",
                composition_role="contact_source",
                blocks=[
                    _block(
                        raw_asset_id="owasset_met_contact",
                        raw_version_id="owver_met_contact",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="信息化服务联系方式",
                    ),
                    _block(
                        raw_asset_id="owasset_met_contact",
                        raw_version_id="owver_met_contact",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="网络中心，电话：010-68932559。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            candidates_by_family = {
                candidate["consumer_family"]: candidate
                for candidate in report.consumer_candidate_pages
            }
            self.assertEqual(
                set(candidates_by_family.keys()),
                {"service_guide_candidate", "contact_directory_candidate"},
            )
            service_candidate = candidates_by_family["service_guide_candidate"]
            self.assertEqual(
                service_candidate["typed_candidate"]["service_name"],
                "中央民族大学校园电子邮件服务",
            )
            self.assertEqual(
                service_candidate["typed_candidate"]["responsible_office"],
                ["网络中心"],
            )
            self.assertIn(
                "申请表格－中央民族大学教工电子邮件申请表",
                service_candidate["typed_candidate"]["materials"],
            )
            self.assertNotIn(
                "申请表格",
                service_candidate["typed_candidate"]["materials"],
            )
            self.assertIn(
                "mail.muc.edu.cn",
                service_candidate["typed_candidate"]["entry_points"],
            )
            self.assertEqual(
                service_candidate["typed_candidate"]["field_source_urls"]["materials"],
                ["https://met.example.edu/xzzq/sqbg/1.htm"],
            )
            self.assertEqual(
                service_candidate["typed_candidate"]["field_source_urls"]["entry_points"],
                ["https://met.example.edu/info/1046/1932.htm"],
            )
            self.assertEqual(
                service_candidate["typed_candidate"]["field_source_urls"]["process_steps"],
                ["https://met.example.edu/info/1024/1090.htm"],
            )
            self.assertNotIn(
                "信息门户",
                service_candidate["typed_candidate"]["entry_points"],
            )
            self.assertEqual(
                service_candidate["typed_candidate"]["contacts"]["phones"],
                ["010-68932559"],
            )
            self.assertEqual(service_candidate["quality_gate"]["decision"], "pass")
            contact_candidate = candidates_by_family["contact_directory_candidate"]
            self.assertEqual(
                contact_candidate["typed_candidate"]["display_name"],
                "中央民族大学信息化服务联系方式",
            )

    def test_information_disclosure_composition_fail_closes_when_multiple_procedure_sources_exist(
        self,
    ) -> None:
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
                target_job_id="owtarget_service_guide",
                target_candidate_id="owcand_info_disclosure_service",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_info_disclosure_ambiguous_primary",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-03T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_info_procedure_a",
                            raw_version_id="owver_info_procedure_a",
                            normalized_canonical_url="https://xxgk.example.edu/info/1007/1113.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-info-disclosure-procedure-a",
                            composition_group="information_disclosure",
                            composition_role="procedure_source",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_info_procedure_b",
                            raw_version_id="owver_info_procedure_b",
                            normalized_canonical_url="https://xxgk.example.edu/info/1007/1115.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-info-disclosure-procedure-b",
                            composition_group="information_disclosure",
                            composition_role="procedure_source",
                        ),
                    ],
                },
            )
            for raw_asset_id, raw_version_id, url, title, text in [
                (
                    "owasset_info_procedure_a",
                    "owver_info_procedure_a",
                    "https://xxgk.example.edu/info/1007/1113.htm",
                    "中央民族大学信息公开依申请公开工作流程",
                    "申请人提出申请后，学校信息公开办公室负责初步审核。",
                ),
                (
                    "owasset_info_procedure_b",
                    "owver_info_procedure_b",
                    "https://xxgk.example.edu/info/1007/1115.htm",
                    "中央民族大学信息公开依申请公开补充说明",
                    "学校在15个工作日内作出答复。",
                ),
            ]:
                _write_output_page(
                    output_dir,
                    site_id="campus_public",
                    host="xxgk.example.edu",
                    raw_asset_id=raw_asset_id,
                    raw_version_id=raw_version_id,
                    normalized_canonical_url=url,
                    page_title=title,
                    page_family="article_detail",
                    target_matches=[service_match],
                    source_pack_id="tool-driven-first-slice.v1",
                    source_pack_entry_id=f"{raw_asset_id}-entry",
                    composition_group="information_disclosure",
                    composition_role="procedure_source",
                    blocks=[
                        _block(
                            raw_asset_id=raw_asset_id,
                            raw_version_id=raw_version_id,
                            row_id="title-1",
                            row_index=0,
                            block_order=0,
                            block_role="title",
                            text=title,
                        ),
                        _block(
                            raw_asset_id=raw_asset_id,
                            raw_version_id=raw_version_id,
                            row_id="p-1",
                            row_index=1,
                            block_order=1,
                            block_role="paragraph",
                            text=text,
                        ),
                    ],
                )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(
                [
                    candidate["consumer_family"]
                    for candidate in report.consumer_candidate_pages
                    if candidate["consumer_family"] == "service_guide_candidate"
                ],
                [],
            )

    def test_email_service_composition_fail_closes_without_policy_source(self) -> None:
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
                target_job_id="owtarget_email_service_guide",
                target_candidate_id="owcand_email_service",
                target_label="中央民族大学校园电子邮件服务",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_email_missing_policy",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-03T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_email_entry",
                            raw_version_id="owver_email_entry",
                            normalized_canonical_url="https://met.example.edu/info/1046/1932.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-email-entry-1932",
                            composition_group="email_service",
                            composition_role="entry_source",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_email_material",
                            raw_version_id="owver_email_material",
                            normalized_canonical_url="https://met.example.edu/xzzq/sqbg/1.htm",
                            page_family="listing_page",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-email-material-forms",
                            composition_group="email_service",
                            composition_role="material_source",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_email_entry",
                raw_version_id="owver_email_entry",
                normalized_canonical_url="https://met.example.edu/info/1046/1932.htm",
                page_title="邮箱登陆",
                page_family="article_detail",
                target_matches=[service_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-email-entry-1932",
                composition_group="email_service",
                composition_role="entry_source",
                blocks=[
                    _block(
                        raw_asset_id="owasset_email_entry",
                        raw_version_id="owver_email_entry",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="邮箱登陆",
                    ),
                    _block(
                        raw_asset_id="owasset_email_entry",
                        raw_version_id="owver_email_entry",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="访问 mail.muc.edu.cn，输入账号和密码即可登陆。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_email_material",
                raw_version_id="owver_email_material",
                normalized_canonical_url="https://met.example.edu/xzzq/sqbg/1.htm",
                page_title="申请表格",
                page_family="listing_page",
                target_matches=[service_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-email-material-forms",
                composition_group="email_service",
                composition_role="material_source",
                blocks=[
                    _block(
                        raw_asset_id="owasset_email_material",
                        raw_version_id="owver_email_material",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="申请表格",
                    ),
                    _block(
                        raw_asset_id="owasset_email_material",
                        raw_version_id="owver_email_material",
                        row_id="li-1",
                        row_index=1,
                        block_order=1,
                        block_role="list_item",
                        text="申请表格－中央民族大学教工电子邮件申请表",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(
                [
                    candidate["consumer_family"]
                    for candidate in report.consumer_candidate_pages
                    if candidate["consumer_family"] == "service_guide_candidate"
                ],
                [],
            )

    def test_email_service_composition_fail_closes_when_multiple_policy_sources_exist(self) -> None:
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
                target_job_id="owtarget_email_service_guide",
                target_candidate_id="owcand_email_service",
                target_label="中央民族大学校园电子邮件服务",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_email_ambiguous_policy",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-03T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_email_policy_a",
                            raw_version_id="owver_email_policy_a",
                            normalized_canonical_url="https://met.example.edu/info/1024/1090.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-email-policy-1090",
                            composition_group="email_service",
                            composition_role="policy_source",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_email_policy_b",
                            raw_version_id="owver_email_policy_b",
                            normalized_canonical_url="https://met.example.edu/info/1024/1091.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-email-policy-1091",
                            composition_group="email_service",
                            composition_role="policy_source",
                        ),
                    ],
                },
            )
            for raw_asset_id, raw_version_id, url, title, text in [
                (
                    "owasset_email_policy_a",
                    "owver_email_policy_a",
                    "https://met.example.edu/info/1024/1090.htm",
                    "电子邮件服务说明",
                    "校园电子邮件由网络中心负责受理。",
                ),
                (
                    "owasset_email_policy_b",
                    "owver_email_policy_b",
                    "https://met.example.edu/info/1024/1091.htm",
                    "电子邮件服务补充说明",
                    "访问 mail.muc.edu.cn 后按提示办理。",
                ),
            ]:
                _write_output_page(
                    output_dir,
                    site_id="campus_public",
                    host="met.example.edu",
                    raw_asset_id=raw_asset_id,
                    raw_version_id=raw_version_id,
                    normalized_canonical_url=url,
                    page_title=title,
                    page_family="article_detail",
                    target_matches=[service_match],
                    source_pack_id="tool-driven-first-slice.v1",
                    source_pack_entry_id=f"{raw_asset_id}-entry",
                    composition_group="email_service",
                    composition_role="policy_source",
                    blocks=[
                        _block(
                            raw_asset_id=raw_asset_id,
                            raw_version_id=raw_version_id,
                            row_id="title-1",
                            row_index=0,
                            block_order=0,
                            block_role="title",
                            text=title,
                        ),
                        _block(
                            raw_asset_id=raw_asset_id,
                            raw_version_id=raw_version_id,
                            row_id="p-1",
                            row_index=1,
                            block_order=1,
                            block_role="paragraph",
                            text=text,
                        ),
                    ],
                )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(
                [
                    candidate["consumer_family"]
                    for candidate in report.consumer_candidate_pages
                    if candidate["consumer_family"] == "service_guide_candidate"
                ],
                [],
            )

    def test_information_disclosure_composition_fail_closes_unknown_service_role_page(self) -> None:
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
                target_job_id="owtarget_service_guide",
                target_candidate_id="owcand_info_disclosure_service",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_info_disclosure_unknown_role",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-03T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_info_procedure",
                            raw_version_id="owver_info_procedure",
                            normalized_canonical_url="https://xxgk.example.edu/info/1007/1113.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-info-disclosure-procedure-1113",
                            composition_group="information_disclosure",
                            composition_role="procedure_source",
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_info_unknown",
                            raw_version_id="owver_info_unknown",
                            normalized_canonical_url="https://xxgk.example.edu/info/1007/1116.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-info-disclosure-unknown-1116",
                            composition_group="information_disclosure",
                            composition_role="faq_source",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.example.edu",
                raw_asset_id="owasset_info_procedure",
                raw_version_id="owver_info_procedure",
                normalized_canonical_url="https://xxgk.example.edu/info/1007/1113.htm",
                page_title="中央民族大学信息公开依申请公开工作流程",
                page_family="article_detail",
                target_matches=[service_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-info-disclosure-procedure-1113",
                composition_group="information_disclosure",
                composition_role="procedure_source",
                blocks=[
                    _block(
                        raw_asset_id="owasset_info_procedure",
                        raw_version_id="owver_info_procedure",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学信息公开依申请公开工作流程",
                    ),
                    _block(
                        raw_asset_id="owasset_info_procedure",
                        raw_version_id="owver_info_procedure",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="申请人提出申请后，学校信息公开办公室负责初步审核。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.example.edu",
                raw_asset_id="owasset_info_unknown",
                raw_version_id="owver_info_unknown",
                normalized_canonical_url="https://xxgk.example.edu/info/1007/1116.htm",
                page_title="信息公开常见问题",
                page_family="article_detail",
                target_matches=[service_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-info-disclosure-unknown-1116",
                composition_group="information_disclosure",
                composition_role="faq_source",
                blocks=[
                    _block(
                        raw_asset_id="owasset_info_unknown",
                        raw_version_id="owver_info_unknown",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="信息公开常见问题",
                    ),
                    _block(
                        raw_asset_id="owasset_info_unknown",
                        raw_version_id="owver_info_unknown",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="这里是补充说明。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            self.assertEqual(
                [
                    candidate["consumer_family"]
                    for candidate in report.consumer_candidate_pages
                    if candidate["consumer_family"] == "service_guide_candidate"
                ],
                [],
            )

    def test_service_guide_candidate_extracts_network_auth_host_entry(self) -> None:
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
                target_id="muc-it-network-auth-service-guide",
                target_label="中央民族大学校园网认证及使用说明",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schema_version": "official_web_source_truth_bundle.v1",
                    "crawlRunId": "owrun_network_auth_entry",
                    "site_id": "campus_public",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_network_auth",
                            raw_version_id="owver_network_auth",
                            normalized_canonical_url="https://met.example.edu/info/1046/2001.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-network-auth-2001",
                            composition_group="network_auth_service",
                            composition_role="primary",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_network_auth",
                raw_version_id="owver_network_auth",
                normalized_canonical_url="https://met.example.edu/info/1046/2001.htm",
                page_title="中央民族大学校园网新版认证系统上网使用说明",
                page_family="article_detail",
                target_matches=[service_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-network-auth-2001",
                composition_group="network_auth_service",
                composition_role="primary",
                blocks=[
                    _block(
                        raw_asset_id="owasset_network_auth",
                        raw_version_id="owver_network_auth",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学校园网新版认证系统上网使用说明",
                    ),
                    _block(
                        raw_asset_id="owasset_network_auth",
                        raw_version_id="owver_network_auth",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="步骤三：如果系统未自动弹出认证页面，请在浏览器地址栏中直接输入rz.muc.edu.cn，打开中央民族大学校园网认证平台。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            candidates_by_family = {
                candidate["consumer_family"]: candidate
                for candidate in report.consumer_candidate_pages
            }
            service_candidate = candidates_by_family["service_guide_candidate"]
            self.assertIn(
                "rz.muc.edu.cn",
                service_candidate["typed_candidate"]["entry_points"],
            )
            self.assertNotIn(
                "中央民族大学校园网新版认证系统",
                service_candidate["typed_candidate"]["entry_points"],
            )

    def test_service_guide_candidate_extracts_vpn_ordered_steps_and_deduplicates_entries(
        self,
    ) -> None:
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
                target_id="muc-it-vpn-service-guide",
                target_label="中央民族大学 VPN 使用说明",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schema_version": "official_web_source_truth_bundle.v1",
                    "crawlRunId": "owrun_vpn_steps",
                    "site_id": "campus_public",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_vpn",
                            raw_version_id="owver_vpn",
                            normalized_canonical_url="https://met.example.edu/info/1046/1674.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                            source_pack_id="tool-driven-first-slice.v1",
                            source_pack_entry_id="owsp-vpn-1674",
                            composition_group="vpn_service",
                            composition_role="primary",
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_vpn",
                raw_version_id="owver_vpn",
                normalized_canonical_url="https://met.example.edu/info/1046/1674.htm",
                page_title="中央民族大学VPN系统使用说明",
                page_family="article_detail",
                target_matches=[service_match],
                source_pack_id="tool-driven-first-slice.v1",
                source_pack_entry_id="owsp-vpn-1674",
                composition_group="vpn_service",
                composition_role="primary",
                blocks=[
                    _block(
                        raw_asset_id="owasset_vpn",
                        raw_version_id="owver_vpn",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学VPN系统使用说明",
                    ),
                    _block(
                        raw_asset_id="owasset_vpn",
                        raw_version_id="owver_vpn",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="1、访问 https://vpn.muc.edu.cn，进入中央民族大学VPN系统。",
                    ),
                    _block(
                        raw_asset_id="owasset_vpn",
                        raw_version_id="owver_vpn",
                        row_id="p-2",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="2、输入统一身份认证账号和密码登录。",
                    ),
                    _block(
                        raw_asset_id="owasset_vpn",
                        raw_version_id="owver_vpn",
                        row_id="p-3",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text="3、首次使用请根据系统提示下载客户端。",
                    ),
                    _block(
                        raw_asset_id="owasset_vpn",
                        raw_version_id="owver_vpn",
                        row_id="p-4",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="4、双击Install EasyConnect.pkg，根据提示完成安装。",
                    ),
                    _block(
                        raw_asset_id="owasset_vpn",
                        raw_version_id="owver_vpn",
                        row_id="p-5",
                        row_index=5,
                        block_order=5,
                        block_role="paragraph",
                        text="也可直接访问 vpn.muc.edu.cn 使用。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            service_candidate = next(
                candidate
                for candidate in report.consumer_candidate_pages
                if candidate["consumer_family"] == "service_guide_candidate"
            )
            typed_candidate = service_candidate["typed_candidate"]
            self.assertEqual(
                typed_candidate["process_steps"],
                [
                    "1、访问 https://vpn.muc.edu.cn，进入中央民族大学VPN系统。",
                    "2、输入统一身份认证账号和密码登录。",
                    "3、首次使用请根据系统提示下载客户端。",
                    "4、双击Install EasyConnect.pkg，根据提示完成安装。",
                ],
            )
            self.assertIn(
                "https://vpn.muc.edu.cn",
                typed_candidate["entry_points"],
            )
            self.assertNotIn("vpn.muc.edu.cn", typed_candidate["entry_points"])
            self.assertNotIn("APP", typed_candidate["entry_points"])
            self.assertEqual(
                [group["group_id"] for group in typed_candidate["procedure_groups"]],
                [
                    "service:official_web:vpn:procedure_group:direct_login",
                    "service:official_web:vpn:procedure_group:client_install",
                ],
            )
            self.assertEqual(
                typed_candidate["procedure_groups"][0]["steps"][0]["content"],
                "访问 https://vpn.muc.edu.cn，进入中央民族大学VPN系统。",
            )
            self.assertEqual(
                typed_candidate["procedure_groups"][1]["steps"][1]["content"],
                "双击Install EasyConnect.pkg，根据提示完成安装。",
            )
            self.assertEqual(
                typed_candidate["field_source_urls"]["procedure_groups"],
                ["https://met.example.edu/info/1046/1674.htm"],
            )

    def test_contact_candidate_extracts_labeled_contact_points(self) -> None:
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
                target_label="中央民族大学信息化服务联系方式",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_met_contact_points",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-03T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_met_contacts",
                            raw_version_id="owver_met_contacts",
                            normalized_canonical_url="https://met.example.edu/service-contacts",
                            page_family="article_detail",
                            target_matches=[contact_match],
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_met_contacts",
                raw_version_id="owver_met_contacts",
                normalized_canonical_url="https://met.example.edu/service-contacts",
                page_title="信息化服务联系方式",
                page_family="article_detail",
                target_matches=[contact_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_met_contacts",
                        raw_version_id="owver_met_contacts",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="信息化服务联系方式",
                    ),
                    _block(
                        raw_asset_id="owasset_met_contacts",
                        raw_version_id="owver_met_contacts",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="网络服务电话：010-68932559；一卡通服务电话：010-68933381；多媒体教室服务电话：010-68932625。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            candidate = report.consumer_candidate_pages[0]
            self.assertEqual(candidate["consumer_family"], "contact_directory_candidate")
            self.assertEqual(
                candidate["typed_candidate"]["display_name"],
                "中央民族大学信息化服务联系方式",
            )
            self.assertEqual(
                candidate["typed_candidate"]["contact_points"],
                [
                    {"label": "网络服务", "phone": "010-68932559"},
                    {"label": "一卡通服务", "phone": "010-68933381"},
                    {"label": "多媒体教室服务", "phone": "010-68932625"},
                ],
            )

    def test_service_and_contact_candidates_prefer_target_label_over_shell_title(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())
            service_match = {
                **_target_match(
                    consumer_family="service_guide_candidate",
                    materialization_policy="candidate_only",
                    selected_write_target="campus_services/service_guide",
                    target_id="campus-services-service-guide",
                ),
                "targetLabel": "中央民族大学 VPN 使用说明",
            }
            contact_match = {
                **_target_match(
                    consumer_family="contact_directory_candidate",
                    materialization_policy="candidate_only",
                    selected_write_target="campus_services/contact_directory",
                    target_id="campus-services-contact-directory",
                ),
                "targetLabel": "中央民族大学信息公开联系方式",
            }
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "sourceChannel": "official_web",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_target_label_preferred",
                    "collectionMode": "target-workset",
                    "generatedAt": "2026-05-03T09:00:00.000Z",
                    "pages": [
                        _page_bundle_entry(
                            raw_asset_id="owasset_vpn",
                            raw_version_id="owver_vpn",
                            normalized_canonical_url="https://met.example.edu/info/1046/1674.htm",
                            page_family="article_detail",
                            target_matches=[service_match],
                        ),
                        _page_bundle_entry(
                            raw_asset_id="owasset_contact",
                            raw_version_id="owver_contact",
                            normalized_canonical_url="https://xxgk.example.edu/lxfs.htm",
                            page_family="article_detail",
                            target_matches=[contact_match],
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_vpn",
                raw_version_id="owver_vpn",
                normalized_canonical_url="https://met.example.edu/info/1046/1674.htm",
                page_title="中央民族大学VPN系统使用说明",
                page_family="article_detail",
                target_matches=[service_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_vpn",
                        raw_version_id="owver_vpn",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学VPN系统使用说明",
                    ),
                    _block(
                        raw_asset_id="owasset_vpn",
                        raw_version_id="owver_vpn",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="访问 https://vpn.muc.edu.cn 登录即可使用 VPN 服务。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.example.edu",
                raw_asset_id="owasset_contact",
                raw_version_id="owver_contact",
                normalized_canonical_url="https://xxgk.example.edu/lxfs.htm",
                page_title="联系方式",
                page_family="article_detail",
                target_matches=[contact_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_contact",
                        raw_version_id="owver_contact",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="联系方式",
                    ),
                    _block(
                        raw_asset_id="owasset_contact",
                        raw_version_id="owver_contact",
                        row_id="p-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="电话：010-68932551。",
                    ),
                ],
            )

            report = replay_official_web_source_truth_local(
                output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

            by_family = {
                candidate["consumer_family"]: candidate
                for candidate in report.consumer_candidate_pages
            }
            self.assertEqual(
                by_family["service_guide_candidate"]["typed_candidate"]["service_name"],
                "中央民族大学 VPN 使用说明",
            )
            self.assertEqual(
                by_family["contact_directory_candidate"]["typed_candidate"]["display_name"],
                "中央民族大学信息公开联系方式",
            )

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
