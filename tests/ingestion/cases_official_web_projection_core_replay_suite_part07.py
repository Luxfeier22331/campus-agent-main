# ruff: noqa: F403,F405
from __future__ import annotations

import json
import unittest

from tests.ingestion.official_web_projection_core_replay_suite_support import *


class OfficialWebProjectionCoreReplayTestPart07(unittest.TestCase):
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

    def test_replay_official_web_source_truth_local_supports_explicit_route_override(
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

    def test_repo_tracked_projection_routing_keeps_query_enabled_surfaces_closed(
        self,
    ) -> None:
        payload = json.loads(
            Path("configs/sources/official_web/muc_public/projection-routing.json").read_text(
                encoding="utf-8"
            )
        )
        routes = payload.get("routes")
        self.assertIsInstance(routes, list)
        self.assertEqual(routes, [])

    def test_replay_official_web_source_truth_local_keeps_generic_shell_pages_in_manual_review_for_muc_public_pages(
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


if __name__ == "__main__":
    unittest.main()
