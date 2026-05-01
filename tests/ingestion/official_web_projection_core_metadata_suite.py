from __future__ import annotations

import unittest

from .official_web_projection_test_support import *


class OfficialWebProjectionCoreMetadataTest(unittest.TestCase):
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

    def test_validate_official_web_projection_output_reports_invalid_consumer_candidate(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            projection_dir = Path(temp_dir) / "projection-output"
            _write_json(
                projection_dir / "projection-report.json",
                {
                    "schema_version": "official_web_projection_replay_report.v1",
                    "site_id": "campus_public",
                    "crawl_run_id": "owrun_projection_candidate_invalid",
                    "output_dir": str(Path(temp_dir) / "collector-output"),
                    "projection_output_dir": str(projection_dir),
                    "generated_at": "2026-05-01T09:00:00+00:00",
                    "counts": {
                        "pages_seen": 1,
                        "emitted_documents": 0,
                        "manual_review_pages": 0,
                        "consumer_candidate_pages": 1,
                    },
                    "documents": [],
                    "manual_review_pages": [],
                    "consumer_candidate_pages": [
                        {
                            "consumer_family": "contact_directory_candidate",
                            "materialization_policy": "candidate_only",
                            "target_corpus": "campus_services",
                            "target_collection": "contact_directory",
                            "normalized_canonical_url": "https://www.example.edu/contact",
                            "raw_asset_id": "owasset_contact",
                            "raw_version_id": "owver_contact",
                            "title": "联系我们",
                            "matched_evidence": [],
                            "selected_write_target": "",
                            "review_policy": "selected_write_requires_review",
                            "reason": "candidate_only consumer denominator match",
                        }
                    ],
                },
            )

            validation = validate_official_web_projection_output(projection_dir)

            self.assertFalse(validation.valid)
            self.assertEqual(validation.counts["consumer_candidate_pages"], 1)
            issue_codes = {issue["code"] for issue in validation.issues}
            self.assertIn("consumer_candidate_missing_matched_evidence", issue_codes)
            self.assertIn("consumer_candidate_missing_selected_write_target", issue_codes)
