# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.test_official_web_regulation_materialization_support import *


class OfficialWebRegulationMaterializationTestPart01(unittest.TestCase):
    def test_worker_generated_at_from_report_is_utc_iso_timestamp(self) -> None:
        with TemporaryDirectory() as temp_dir:
            report_path = Path(temp_dir) / "materialization-report.json"
            report_path.write_text("{}", encoding="utf-8")

            generated_at = _generated_at_from_report(report_path)

            parsed = datetime.fromisoformat(generated_at)
            self.assertIsNotNone(parsed.tzinfo)
            self.assertEqual(parsed.utcoffset().total_seconds(), 0)

    def test_materializes_fanout_regulation_candidates_into_canonical_reader_inputs(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            work_dir = root / "work"
            _write_json(declarations_path, _declarations_payload())

            regulation_match = _target_match(
                consumer_family="regulation_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="regulations/institutional_rules",
                target_id="official-web-institutional-rules",
                review_policy="release_gate_required",
                target_label="中央民族大学电子邮件管理办法",
            )
            service_match = _target_match(
                consumer_family="service_guide_candidate",
                materialization_policy="candidate_only",
                selected_write_target="campus_services/service_guide",
                target_id="campus-services-service-guide",
                review_policy="selected_write_requires_review",
                target_label="中央民族大学校园电子邮件服务",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_regulation_test",
                    "collectionMode": "target-workset",
                    "pages": [
                        {
                            "rawAssetId": "owasset_email_policy",
                            "rawVersionId": "owver_email_policy",
                            "normalizedCanonicalUrl": "https://met.example.edu/info/1024/1090.htm",
                            "pageFamily": "article_detail",
                            "pageManifestObjectKey": (
                                "official_web/owasset_email_policy/undated/"
                                "owver_email_policy/source-truth/page-manifest.json"
                            ),
                            "contentBlocksObjectKey": (
                                "official_web/owasset_email_policy/undated/"
                                "owver_email_policy/source-truth/content-blocks.jsonl"
                            ),
                            "providerExtractionObjectKey": (
                                "official_web/owasset_email_policy/undated/"
                                "owver_email_policy/provider/cheerio-basic/page-extraction.json"
                            ),
                            "responseHtmlObjectKey": (
                                "official_web/owasset_email_policy/undated/"
                                "owver_email_policy/capture/response.html"
                            ),
                            "responseBodyHash": "hash-email-policy",
                            "blockCount": 3,
                            "targetMatches": [service_match, regulation_match],
                            "selectedWriteTarget": "campus_services/service_guide",
                            "materializationPolicy": "candidate_only",
                            "reviewPolicy": "selected_write_requires_review",
                            "targetJobId": "owtarget_service",
                            "targetCandidateId": "owcandidate_service",
                            "targetDeclarationVersion": "muc_public_target_source_map_v2",
                        }
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
                target_matches=[service_match, regulation_match],
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
                        text="第一条 为规范校园网电子邮件管理，制定本办法。",
                    ),
                    _block(
                        raw_asset_id="owasset_email_policy",
                        raw_version_id="owver_email_policy",
                        row_id="p-2",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text="第二条 校园网电子邮箱服务对象包括全体教职工和全日制在校学生。",
                    ),
                ],
            )

            object_store = _FakeObjectStore()
            registry = InMemoryDocumentRegistry()
            raw_registry = InMemoryRawAssetRegistry()
            report = materialize_official_web_regulation_candidates(
                source_truth_output_dir=output_dir,
                projection_output_dir=projection_dir,
                work_dir=work_dir,
                declarations_path=declarations_path,
                object_store=object_store,
                document_registry=registry,
                raw_asset_registry=raw_registry,
                object_store_settings=_object_store_settings(),
            )

            self.assertEqual(report.candidate_count, 1)
            self.assertEqual(report.materialized_document_count, 1)
            records = registry.list_by_scope("regulations", "institutional_rules")
            self.assertEqual(len(records), 1)
            record = records[0]
            self.assertEqual(record.source_channel, "official_web")
            self.assertEqual(record.revision_track, "current-effective")
            self.assertTrue(record.is_current)
            self.assertEqual(record.visibility_level, "public")
            self.assertEqual(record.raw_asset.raw_asset_id, "owasset_email_policy")
            self.assertEqual(record.raw_asset.raw_version_id, "owver_email_policy")
            self.assertTrue(record.canonical_markdown_object_key)
            self.assertTrue(record.document_units_object_key)

            canonical = object_store.get_bytes(
                bucket="campus-rag-derived",
                key=record.canonical_markdown_object_key or "",
            ).decode("utf-8")
            self.assertIn("# 中央民族大学电子邮件管理办法", canonical)
            self.assertIn("第一条 为规范校园网电子邮件管理，制定本办法。", canonical)
            self.assertIn("> Source URL: https://met.example.edu/info/1024/1090.htm", canonical)

            units = [
                json.loads(line)
                for line in object_store.get_bytes(
                    bucket="campus-rag-derived",
                    key=record.document_units_object_key or "",
                )
                .decode("utf-8")
                .splitlines()
                if line.strip()
            ]
            self.assertEqual(units[0]["doc_id"], record.document_id)
            self.assertEqual(units[0]["version_id"], record.version_id)
            self.assertEqual(units[0]["metadata"]["source_channel"], "official_web")
            self.assertEqual(units[0]["unit_type"], "regulation_title")
            self.assertEqual(units[0]["metadata"]["content_role"], "regulation_title")
            self.assertEqual(
                units[0]["metadata"]["normalization_quality"]["quality_verdict"],
                "passed",
            )
            self.assertEqual(
                units[0]["metadata"]["normalization_quality"]["normalizer_version"],
                REGULATION_CANONICAL_NORMALIZER_VERSION,
            )
            self.assertEqual(
                units[0]["metadata"]["selected_write_target"],
                "regulations/institutional_rules",
            )
            self.assertEqual(
                units[0]["metadata"]["promotion_class"],
                "formal_regulation",
            )
            self.assertEqual(units[0]["metadata"]["is_answer_bearing"], True)
            self.assertTrue(any(unit["row_type"] == "paragraph" for unit in units[1:]))

            reader_report = publish_document_reader_assets(
                bucket_derived="campus-rag-derived",
                generated_at="2026-05-05T00:00:00+00:00",
                object_store=object_store,
                records=records,
            )
            self.assertEqual(reader_report.document_count, 1)
            self.assertEqual(reader_report.public_entry_count, 1)
            self.assertEqual(
                reader_report.manifest["collections"][0]["corpus"],
                "regulations",
            )
            self.assertEqual(
                reader_report.manifest["collections"][0]["collection"],
                "institutional_rules",
            )

    def test_normalizes_display_titles_and_status_qualifiers(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            work_dir = root / "work"
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
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_regulation_title_test",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page(
                            raw_asset_id="owasset_card",
                            raw_version_id="owver_card",
                            normalized_canonical_url="https://met.example.edu/info/1024/1086.htm",
                            target_matches=[regulation_match],
                        ),
                        _page(
                            raw_asset_id="owasset_network",
                            raw_version_id="owver_network",
                            normalized_canonical_url="https://met.example.edu/info/1024/1188.htm",
                            target_matches=[regulation_match],
                        ),
                        _page(
                            raw_asset_id="owasset_portal",
                            raw_version_id="owver_portal",
                            normalized_canonical_url="https://met.example.edu/info/1024/1088.htm",
                            target_matches=[regulation_match],
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_card",
                raw_version_id="owver_card",
                normalized_canonical_url="https://met.example.edu/info/1024/1086.htm",
                page_title="校 园 一 卡 通 管 理 规 定",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_card",
                        raw_version_id="owver_card",
                        row_id="card-title",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="校 园 一 卡 通 管 理 规 定",
                    ),
                    _block(
                        raw_asset_id="owasset_card",
                        raw_version_id="owver_card",
                        row_id="card-p1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 为规范校园一卡通管理，制定本规定。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_network",
                raw_version_id="owver_network",
                normalized_canonical_url="https://met.example.edu/info/1024/1188.htm",
                page_title="中央民族大学网络与信息安全管理办法（最新）",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_network",
                        raw_version_id="owver_network",
                        row_id="network-title",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学网络与信息安全管理办法（最新）",
                    ),
                    _block(
                        raw_asset_id="owasset_network",
                        raw_version_id="owver_network",
                        row_id="network-p1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 为加强网络与信息安全管理，制定本办法。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_portal",
                raw_version_id="owver_portal",
                normalized_canonical_url="https://met.example.edu/info/1024/1088.htm",
                page_title="中央民族大学信息门户运行管理办法（试行）",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_portal",
                        raw_version_id="owver_portal",
                        row_id="portal-title",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学信息门户运行管理办法（试行）",
                    ),
                    _block(
                        raw_asset_id="owasset_portal",
                        raw_version_id="owver_portal",
                        row_id="portal-p1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 为规范信息门户运行管理，制定本办法。",
                    ),
                ],
            )

            object_store = _FakeObjectStore()
            registry = InMemoryDocumentRegistry()
            raw_registry = InMemoryRawAssetRegistry()
            materialize_official_web_regulation_candidates(
                source_truth_output_dir=output_dir,
                projection_output_dir=projection_dir,
                work_dir=work_dir,
                declarations_path=declarations_path,
                object_store=object_store,
                document_registry=registry,
                raw_asset_registry=raw_registry,
                object_store_settings=_object_store_settings(),
            )

            records = registry.list_by_scope("regulations", "institutional_rules")
            by_url = {record.source_uri: record for record in records}
            card = by_url["https://met.example.edu/info/1024/1086.htm"]
            network = by_url["https://met.example.edu/info/1024/1188.htm"]
            portal = by_url["https://met.example.edu/info/1024/1088.htm"]
            card_canonical = object_store.get_bytes(
                bucket="campus-rag-derived",
                key=card.canonical_markdown_object_key or "",
            ).decode("utf-8")
            network_canonical = object_store.get_bytes(
                bucket="campus-rag-derived",
                key=network.canonical_markdown_object_key or "",
            ).decode("utf-8")
            card_units = _read_units(
                object_store.get_bytes(
                    bucket="campus-rag-derived",
                    key=card.document_units_object_key or "",
                )
            )
            network_units = _read_units(
                object_store.get_bytes(
                    bucket="campus-rag-derived",
                    key=network.document_units_object_key or "",
                )
            )
            portal_units = _read_units(
                object_store.get_bytes(
                    bucket="campus-rag-derived",
                    key=portal.document_units_object_key or "",
                )
            )

            self.assertIn("# 校园一卡通管理规定", card_canonical)
            self.assertNotIn("校 园 一 卡 通 管 理 规 定", card_canonical)
            self.assertNotIn("校 园 一 卡 通 管 理 规 定", card_units[0]["clean_text"])
            self.assertIn("校园一卡通管理规定", card.canonical_markdown_object_key or "")
            self.assertNotIn("校-园-一-卡-通", card.canonical_markdown_object_key or "")
            self.assertIn("# 中央民族大学网络与信息安全管理办法", network_canonical)
            self.assertNotIn("（最新）", network_canonical)
            self.assertNotIn("（最新）", network_units[0]["clean_text"])
            self.assertNotIn("最新", network.canonical_markdown_object_key or "")
            self.assertEqual(
                portal_units[0]["metadata"]["title"],
                "中央民族大学信息门户运行管理办法（试行）",
            )
            self.assertEqual(portal_units[0]["metadata"]["title_status_qualifier"], "试行")
            self.assertEqual(portal_units[0]["metadata"]["title_status_kind"], "trial")
            self.assertEqual(
                portal_units[0]["metadata"]["title_base"], "中央民族大学信息门户运行管理办法"
            )

    def test_materialization_recovers_structured_regulation_rows_for_dense_public_rule(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            work_dir = root / "work"
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
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_info_disclosure_dense_structure",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page(
                            raw_asset_id="owasset_info_1107",
                            raw_version_id="owver_info_1107",
                            normalized_canonical_url="https://xxgk.muc.edu.cn/info/1005/1107.htm",
                            target_matches=[regulation_match],
                        )
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.muc.edu.cn",
                raw_asset_id="owasset_info_1107",
                raw_version_id="owver_info_1107",
                normalized_canonical_url="https://xxgk.muc.edu.cn/info/1005/1107.htm",
                page_title="中央民族大学信息公开实施细则",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_info_1107",
                        raw_version_id="owver_info_1107",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学信息公开实施细则",
                    ),
                    _block(
                        raw_asset_id="owasset_info_1107",
                        raw_version_id="owver_info_1107",
                        row_id="paragraph-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text=(
                            "第一章 总则第一条 为进一步推进依法治校，制定本细则。"
                            "第二条 本细则所称信息，是指学校产生的信息。"
                            "第二章 信息公开的工作机构第三条 学校成立信息公开工作领导小组。"
                        ),
                    ),
                ],
            )

            object_store = _FakeObjectStore()
            registry = InMemoryDocumentRegistry()
            raw_registry = InMemoryRawAssetRegistry()
            materialize_official_web_regulation_candidates(
                source_truth_output_dir=output_dir,
                projection_output_dir=projection_dir,
                work_dir=work_dir,
                declarations_path=declarations_path,
                object_store=object_store,
                document_registry=registry,
                raw_asset_registry=raw_registry,
                object_store_settings=_object_store_settings(),
            )

            record = registry.list_by_scope("regulations", "institutional_rules")[0]
            units = _read_units(
                object_store.get_bytes(
                    bucket="campus-rag-derived",
                    key=record.document_units_object_key or "",
                )
            )

            self.assertGreater(len(units), 4)
            self.assertEqual(units[0]["unit_type"], "regulation_title")
            self.assertTrue(any(unit["row_type"] == "heading" for unit in units[1:]))
            self.assertTrue(any(unit["row_type"] == "paragraph" for unit in units[1:]))
            self.assertTrue(
                any(
                    unit["clean_text"] == "第一章 总则"
                    and unit["metadata"]["is_answer_bearing"] is False
                    for unit in units
                )
            )
            self.assertTrue(
                any(
                    unit["clean_text"].startswith("第一条 为进一步推进依法治校")
                    and unit["metadata"]["content_role"] == "regulation_body"
                    for unit in units
                )
            )


if __name__ == "__main__":
    unittest.main()
