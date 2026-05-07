from __future__ import annotations

import json
import unittest
from dataclasses import replace
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.collected_notice_regulation_text_normalization import (
    REGULATION_CANONICAL_NORMALIZER_VERSION,
)
from campus_ingestion_core.document_reader_publisher import publish_document_reader_assets
from campus_ingestion_core.in_memory_registries import (
    InMemoryDocumentRegistry,
    InMemoryRawAssetRegistry,
)
from campus_ingestion_core.official_web_regulation_materialization import (
    materialize_official_web_regulation_candidates,
)
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_worker.materialize_official_web_regulations import (
    _generated_at_from_report,
)
from campus_ingestion_worker.materialize_official_web_regulations import (
    main as materialize_worker_main,
)

from tests.ingestion.official_web_projection_test_support import (
    _block,
    _declarations_payload,
    _target_match,
    _write_json,
    _write_output_page,
)


class _FakeObjectStore:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.objects[(bucket, key)] = data

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def delete_prefix(
        self,
        *,
        bucket: str,
        prefix: str,
        exclude_keys: tuple[str, ...] = (),
        include_path_segment_suffix: str | None = None,
    ) -> None:
        excluded = set(exclude_keys)
        for object_key in tuple(self.objects):
            object_bucket, key = object_key
            if (
                object_bucket == bucket
                and key.startswith(prefix)
                and key not in excluded
                and _matches_path_segment_suffix(key, include_path_segment_suffix)
            ):
                del self.objects[object_key]


class OfficialWebRegulationMaterializationTest(unittest.TestCase):
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

    def test_materialization_keeps_official_web_page_title_for_public_plan_documents(self) -> None:
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
            source_url = "https://xxgk.muc.edu.cn/info/1198/6451.htm"
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_staff_plan_title_regression",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page(
                            raw_asset_id="owasset_staff_plan_6451",
                            raw_version_id="owver_staff_plan_6451",
                            normalized_canonical_url=source_url,
                            target_matches=[regulation_match],
                        )
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.muc.edu.cn",
                raw_asset_id="owasset_staff_plan_6451",
                raw_version_id="owver_staff_plan_6451",
                normalized_canonical_url=source_url,
                page_title="中央民族大学事业发展“十三五”规划",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_staff_plan_6451",
                        raw_version_id="owver_staff_plan_6451",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学事业发展“十三五”规划",
                    ),
                    _block(
                        raw_asset_id="owasset_staff_plan_6451",
                        raw_version_id="owver_staff_plan_6451",
                        row_id="paragraph-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text=(
                            "第一章 发展基础 根据《中央民族大学章程》，"
                            "学校制定中央民族大学事业发展“十三五”规划。"
                            "第一条 本规划用于指导学校事业发展。"
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
            canonical = object_store.get_bytes(
                bucket="campus-rag-derived",
                key=record.canonical_markdown_object_key or "",
            ).decode("utf-8")
            units = _read_units(
                object_store.get_bytes(
                    bucket="campus-rag-derived",
                    key=record.document_units_object_key or "",
                )
            )

            self.assertIn("# 中央民族大学事业发展“十三五”规划", canonical)
            self.assertNotIn("# 中央民族大学章程", canonical)
            self.assertEqual(units[0]["metadata"]["title"], "中央民族大学事业发展“十三五”规划")
            self.assertEqual(units[0]["metadata"]["title_raw"], "中央民族大学事业发展“十三五”规划")
            self.assertIn(
                "中央民族大学事业发展-十三五-规划", record.document_units_object_key or ""
            )
            self.assertNotIn("中央民族大学章程", record.document_units_object_key or "")

    def test_materialization_keeps_source_title_when_body_references_related_rule(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            work_dir = root / "work"
            _write_json(declarations_path, _declarations_payload())
            regulation_match = _target_match(
                consumer_family="student_regulation_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="regulations/student_rules",
                target_id="official-web-student-rules",
                review_policy="release_gate_required",
            )
            source_url = "https://xxgk.muc.edu.cn/info/1247/4911.htm"
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_student_transfer_title_regression",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page(
                            raw_asset_id="owasset_student_transfer_4911",
                            raw_version_id="owver_student_transfer_4911",
                            normalized_canonical_url=source_url,
                            target_matches=[regulation_match],
                        )
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.muc.edu.cn",
                raw_asset_id="owasset_student_transfer_4911",
                raw_version_id="owver_student_transfer_4911",
                normalized_canonical_url=source_url,
                page_title="本科生转专业实施细则",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_student_transfer_4911",
                        raw_version_id="owver_student_transfer_4911",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="本科生转专业实施细则",
                    ),
                    _block(
                        raw_asset_id="owasset_student_transfer_4911",
                        raw_version_id="owver_student_transfer_4911",
                        row_id="paragraph-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text=(
                            "为充分体现学校“以人为本、以学生为主体”的教育理念，"
                            "根据《中央民族大学本科学生学籍管理规定》关于学生转专业的有关条款，"
                            "结合学校实际情况，进一步健全转专业管理制度，特对原有相关办法进行修订。"
                            "一、基本原则（一）本办法的适用对象为一年级在籍在校本科学生。"
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

            record = registry.list_by_scope("regulations", "student_rules")[0]
            canonical = object_store.get_bytes(
                bucket="campus-rag-derived",
                key=record.canonical_markdown_object_key or "",
            ).decode("utf-8")
            units = _read_units(
                object_store.get_bytes(
                    bucket="campus-rag-derived",
                    key=record.document_units_object_key or "",
                )
            )

            self.assertIn("# 本科生转专业实施细则", canonical)
            self.assertNotIn("# 中央民族大学本科学生学籍管理规定", canonical)
            self.assertEqual(units[0]["metadata"]["title"], "本科生转专业实施细则")
            self.assertEqual(units[0]["metadata"]["title_raw"], "本科生转专业实施细则")
            self.assertIn("本科生转专业实施细则", record.document_units_object_key or "")
            self.assertNotIn("本科学生学籍管理规定", record.document_units_object_key or "")

    def test_materialization_preserves_regulation_preface_and_drops_inline_link_child_duplicate(
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
            source_url = "https://xxgk.muc.edu.cn/info/1290/5651.htm"
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_staff_position_preface_link_regression",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page(
                            raw_asset_id="owasset_staff_position_5651",
                            raw_version_id="owver_staff_position_5651",
                            normalized_canonical_url=source_url,
                            target_matches=[regulation_match],
                        )
                    ],
                },
            )
            title = "中央民族大学岗位设置与聘用管理暂行办法"
            parent_dom_path = (
                "body[1] > div[4] > div[1] > div[2] > form[1] > div[1] > div[1] > div[1] > p[134]"
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.muc.edu.cn",
                raw_asset_id="owasset_staff_position_5651",
                raw_version_id="owver_staff_position_5651",
                normalized_canonical_url=source_url,
                page_title=title,
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_staff_position_5651",
                        raw_version_id="owver_staff_position_5651",
                        row_id="head-title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text=title,
                        is_main_content=False,
                        dom_path="head[1] > title[1]",
                    ),
                    _block(
                        raw_asset_id="owasset_staff_position_5651",
                        raw_version_id="owver_staff_position_5651",
                        row_id="sidebar-heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="干部人事",
                        dom_path="body[1] > div[4] > div[1] > div[1] > h1[1]",
                    ),
                    _block(
                        raw_asset_id="owasset_staff_position_5651",
                        raw_version_id="owver_staff_position_5651",
                        row_id="title-1",
                        row_index=2,
                        block_order=2,
                        block_role="heading",
                        text=title,
                        dom_path=(
                            "body[1] > div[4] > div[1] > div[2] > form[1] > "
                            "div[1] > center[1] > h1[1]"
                        ),
                    ),
                    _block(
                        raw_asset_id="owasset_staff_position_5651",
                        raw_version_id="owver_staff_position_5651",
                        row_id="preface-1",
                        row_index=3,
                        block_order=3,
                        block_role="paragraph",
                        text=(
                            "为切实做好学校岗位设置与聘用工作，根据《国家民委事业单位岗位设置管理实施意见》"
                            "等文件精神和经国家民委批复的《中央民族大学岗位设置方案》的有关规定，"
                            "制定本暂行办法。"
                        ),
                        dom_path=(
                            "body[1] > div[4] > div[1] > div[2] > form[1] > "
                            "div[1] > div[1] > div[1] > p[1]"
                        ),
                    ),
                    _block(
                        raw_asset_id="owasset_staff_position_5651",
                        raw_version_id="owver_staff_position_5651",
                        row_id="chapter-1",
                        row_index=4,
                        block_order=4,
                        block_role="paragraph",
                        text="第一章 总 则",
                    ),
                    _block(
                        raw_asset_id="owasset_staff_position_5651",
                        raw_version_id="owver_staff_position_5651",
                        row_id="section-1",
                        row_index=5,
                        block_order=5,
                        block_role="paragraph",
                        text="一、岗位设置与聘用原则",
                    ),
                    _block(
                        raw_asset_id="owasset_staff_position_5651",
                        raw_version_id="owver_staff_position_5651",
                        row_id="item-17",
                        row_index=6,
                        block_order=6,
                        block_role="paragraph",
                        text="(17) 国家科技支撑计划、国际科技合作计划、国家攀登计划、科技基础条件平台建设计划项目主持人。",
                        dom_path=parent_dom_path,
                    ),
                    _block(
                        raw_asset_id="owasset_staff_position_5651",
                        raw_version_id="owver_staff_position_5651",
                        row_id="item-17-link",
                        row_index=7,
                        block_order=7,
                        block_role="link",
                        text="科技基础条件平台建设计划",
                        link_target="http://program.most.gov.cn/page/pds/mian1_DD.htm?planId=DD",
                        dom_path=f"{parent_dom_path} > a[1]",
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
            canonical = object_store.get_bytes(
                bucket="campus-rag-derived",
                key=record.canonical_markdown_object_key or "",
            ).decode("utf-8")
            units = _read_units(
                object_store.get_bytes(
                    bucket="campus-rag-derived",
                    key=record.document_units_object_key or "",
                )
            )

            self.assertIn("为切实做好学校岗位设置与聘用工作", canonical)
            self.assertIn("制定本暂行办法。", canonical)
            self.assertIn(
                "为切实做好学校岗位设置与聘用工作", "\n".join(unit["clean_text"] for unit in units)
            )
            self.assertNotIn("\n干部人事\n", canonical)
            self.assertFalse(any(unit["clean_text"] == "干部人事" for unit in units))
            self.assertIn("科技基础条件平台建设计划项目主持人。", canonical)
            self.assertNotIn("项目主持人。\n科技基础条件平台建设计划", canonical)
            self.assertNotIn("项目主持人。科技基础条件平台建设计划", canonical)

    def test_materialization_drops_wrapper_heading_and_recovers_formal_title_from_body(
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
                consumer_family="student_regulation_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="regulations/student_rules",
                target_id="official-web-student-rules",
                review_policy="release_gate_required",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_student_rule_recovery_4871",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page(
                            raw_asset_id="owasset_student_rule_4871",
                            raw_version_id="owver_student_rule_4871",
                            normalized_canonical_url="https://xxgk.muc.edu.cn/info/1247/4871.htm",
                            target_matches=[regulation_match],
                        )
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.muc.edu.cn",
                raw_asset_id="owasset_student_rule_4871",
                raw_version_id="owver_student_rule_4871",
                normalized_canonical_url="https://xxgk.muc.edu.cn/info/1247/4871.htm",
                page_title="成人高等教育学籍管理",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_student_rule_4871",
                        raw_version_id="owver_student_rule_4871",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="成人高等教育学籍管理",
                    ),
                    _block(
                        raw_asset_id="owasset_student_rule_4871",
                        raw_version_id="owver_student_rule_4871",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="学生工作",
                    ),
                    _block(
                        raw_asset_id="owasset_student_rule_4871",
                        raw_version_id="owver_student_rule_4871",
                        row_id="paragraph-1",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text=(
                            "中央民族大学成人高等学历教育学生学籍管理规定 "
                            "第一章 总则第一条 为加强我校成人高等学历教育学生的学籍管理，制定本规定。"
                            "第二条 本规定适用于我校成人高等学历教育学生。"
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

            record = registry.list_by_scope("regulations", "student_rules")[0]
            canonical = object_store.get_bytes(
                bucket="campus-rag-derived",
                key=record.canonical_markdown_object_key or "",
            ).decode("utf-8")
            units = _read_units(
                object_store.get_bytes(
                    bucket="campus-rag-derived",
                    key=record.document_units_object_key or "",
                )
            )

            self.assertIn("# 中央民族大学成人高等学历教育学生学籍管理规定", canonical)
            self.assertNotIn("学生工作", canonical)
            self.assertEqual(units[0]["clean_text"], "中央民族大学成人高等学历教育学生学籍管理规定")
            self.assertFalse(any(unit["clean_text"] == "学生工作" for unit in units))

    def test_worker_scope_refresh_prunes_stale_local_document_artifact_directories(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            declarations_path = root / "projection-declarations.json"
            object_store_root = root / "object-store"
            worker_output_dir = root / "worker-output"
            stale_dir = (
                object_store_root
                / "campus-rag-derived"
                / "regulations"
                / "documents"
                / "institutional_rules"
                / "校-园-一-卡-通-管-理-规-定--old"
            )
            stale_dir.mkdir(parents=True)
            (stale_dir / "current-effective").mkdir()
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
                    "crawlRunId": "owrun_regulation_local_prune_test",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page(
                            raw_asset_id="owasset_card",
                            raw_version_id="owver_card",
                            normalized_canonical_url="https://met.example.edu/info/1024/1086.htm",
                            target_matches=[regulation_match],
                        )
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

            materialize_worker_main(
                [
                    "--source-truth-output-dir",
                    str(output_dir),
                    "--declarations-path",
                    str(declarations_path),
                    "--output-dir",
                    str(worker_output_dir),
                    "--object-store-root",
                    str(object_store_root),
                    "--scope-refresh",
                ]
            )

            scope_dir = (
                object_store_root
                / "campus-rag-derived"
                / "regulations"
                / "documents"
                / "institutional_rules"
            )
            document_dirs = sorted(path.name for path in scope_dir.iterdir() if path.is_dir())
            self.assertEqual(len(document_dirs), 1)
            self.assertTrue(document_dirs[0].startswith("校园一卡通管理规定--"))

    def test_scope_refresh_prunes_stale_derived_document_objects_for_selected_scope(self) -> None:
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
            source_url = "https://xxgk.muc.edu.cn/info/1198/6451.htm"
            document_id = "official_web_regulation:12ce0e9b47598c5d"
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_regulation_stale_artifact_prune_test",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page(
                            raw_asset_id="owasset_plan",
                            raw_version_id="owver_plan",
                            normalized_canonical_url=source_url,
                            target_matches=[regulation_match],
                        )
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="xxgk.muc.edu.cn",
                raw_asset_id="owasset_plan",
                raw_version_id="owver_plan",
                normalized_canonical_url=source_url,
                page_title="中央民族大学事业发展“十三五”规划",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_plan",
                        raw_version_id="owver_plan",
                        row_id="plan-title",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学事业发展“十三五”规划",
                    ),
                    _block(
                        raw_asset_id="owasset_plan",
                        raw_version_id="owver_plan",
                        row_id="plan-p1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 本规划用于指导学校事业发展。",
                    ),
                ],
            )

            object_store = _FakeObjectStore()
            object_store.put_bytes(
                bucket="campus-rag-derived",
                key=(
                    "regulations/documents/institutional_rules/"
                    "中央民族大学章程--12ce0e9b/current-effective/undated/document-units.jsonl"
                ),
                data=(
                    json.dumps(
                        {
                            "clean_text": "中央民族大学章程",
                            "doc_id": document_id,
                            "entitlement_groups": [],
                            "row_type": "heading",
                            "visibility_level": "public",
                        },
                        ensure_ascii=False,
                    ).encode("utf-8")
                    + b"\n"
                ),
                content_type="application/x-ndjson",
            )
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
                scope_refresh=True,
            )
            current_record = registry.current_version(document_id)
            self.assertIsNotNone(current_record)
            stale_record = replace(
                current_record,
                version_id="owregver:stale-title",
                content_hash="sha256:stale-title",
                is_current=False,
                status="superseded",
                document_units_object_key=(
                    "regulations/documents/institutional_rules/"
                    "中央民族大学章程--12ce0e9b/current-effective/undated/document-units.jsonl"
                ),
                canonical_markdown_object_key=(
                    "regulations/documents/institutional_rules/"
                    "中央民族大学章程--12ce0e9b/current-effective/undated/canonical.md"
                ),
                processed_object_keys=(
                    "regulations/documents/institutional_rules/"
                    "中央民族大学章程--12ce0e9b/current-effective/undated/canonical.md",
                    "regulations/documents/institutional_rules/"
                    "中央民族大学章程--12ce0e9b/current-effective/undated/document-units.jsonl",
                ),
            )
            registry.upsert(stale_record)
            object_store.put_bytes(
                bucket="campus-rag-derived",
                key=(
                    "regulations/documents/institutional_rules/"
                    "中央民族大学章程--12ce0e9b/current-effective/undated/canonical.md"
                ),
                data=b"# stale title\n",
                content_type="text/markdown; charset=utf-8",
            )

            materialize_official_web_regulation_candidates(
                source_truth_output_dir=output_dir,
                projection_output_dir=projection_dir,
                work_dir=work_dir,
                declarations_path=declarations_path,
                object_store=object_store,
                document_registry=registry,
                raw_asset_registry=raw_registry,
                object_store_settings=_object_store_settings(),
                scope_refresh=True,
            )

            derived_keys = {
                key for bucket, key in object_store.objects if bucket == "campus-rag-derived"
            }
            self.assertFalse(any("中央民族大学章程--12ce0e9b" in key for key in derived_keys))
            self.assertTrue(
                any("中央民族大学事业发展-十三五-规划--12ce0e9b" in key for key in derived_keys)
            )

    def test_worker_materialization_report_includes_selected_documents_for_downstream_reuse(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            declarations_path = root / "projection-declarations.json"
            object_store_root = root / "object-store"
            worker_output_dir = root / "worker-output"
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
                    "crawlRunId": "owrun_regulation_report_contract_test",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page(
                            raw_asset_id="owasset_card",
                            raw_version_id="owver_card",
                            normalized_canonical_url="https://met.example.edu/info/1024/1086.htm",
                            target_matches=[regulation_match],
                        )
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

            materialize_worker_main(
                [
                    "--source-truth-output-dir",
                    str(output_dir),
                    "--declarations-path",
                    str(declarations_path),
                    "--output-dir",
                    str(worker_output_dir),
                    "--object-store-root",
                    str(object_store_root),
                ]
            )

            report = json.loads(
                (worker_output_dir / "materialization-report.json").read_text(encoding="utf-8")
            )
            summary = json.loads(
                (
                    worker_output_dir / "official-web-regulation-materialization-summary.json"
                ).read_text(encoding="utf-8")
            )

            self.assertEqual(report["materialized_document_count"], 1)
            self.assertEqual(len(report["selected_target_document_ids"]), 1)
            self.assertEqual(len(report["materialized_documents"]), 1)
            materialized = report["materialized_documents"][0]
            self.assertEqual(
                report["selected_target_document_ids"],
                [materialized["target_document_id"]],
            )
            self.assertEqual(materialized["target_corpus"], "regulations")
            self.assertEqual(materialized["target_collection"], "institutional_rules")
            self.assertEqual(materialized["source_channel"], "official_web")
            self.assertEqual(materialized["title"], "校园一卡通管理规定")
            self.assertEqual(materialized["title_raw"], "校 园 一 卡 通 管 理 规 定")
            self.assertEqual(
                materialized["normalization_quality"]["quality_verdict"],
                "passed",
            )
            self.assertEqual(len(materialized["canonical_markdown_sha256"]), 64)
            self.assertEqual(len(materialized["document_units_sha256"]), 64)
            self.assertEqual(
                summary["materialization_report"]["selected_target_document_ids"],
                report["selected_target_document_ids"],
            )

    def test_document_identity_stays_stable_across_title_cleanup(self) -> None:
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
            source_url = "https://met.example.edu/info/1024/1086.htm"

            first_record = _materialize_single_title(
                declarations_path=declarations_path,
                output_dir=output_dir,
                projection_dir=projection_dir,
                raw_asset_id="owasset_card",
                raw_version_id="owver_card",
                source_url=source_url,
                title="校 园 一 卡 通 管 理 规 定",
                target_matches=[regulation_match],
                work_dir=work_dir,
            )
            second_record = _materialize_single_title(
                declarations_path=declarations_path,
                output_dir=output_dir,
                projection_dir=projection_dir,
                raw_asset_id="owasset_card",
                raw_version_id="owver_card",
                source_url=source_url,
                title="中央民族大学校园一卡通管理规定",
                target_matches=[regulation_match],
                work_dir=work_dir,
            )

            self.assertEqual(first_record["document_id"], second_record["document_id"])

    def test_materializes_all_collected_live_source_pack_regulation_pages_when_present(
        self,
    ) -> None:
        source_pack_dir = (
            Path("var")
            / "official-web-source-pack-live-seam"
            / "owrun_source_pack_live_20260504T122734Z"
            / "collector-output"
        )
        if not source_pack_dir.exists():
            self.skipTest("live official-web source-pack evidence is not present")
        projection_dir = (
            Path("var")
            / "official-web-source-pack-live-seam"
            / "owrun_source_pack_live_20260504T122734Z"
            / "executions"
            / "owevt_completed_0f9f6de598f44845b2de924ba6ce3b90"
            / "projection-output"
        )
        if not projection_dir.exists():
            self.skipTest("live official-web projection evidence is not present")
        expected_urls = _materializable_regulation_urls(projection_dir)
        self.assertEqual(len(expected_urls), 11)

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_store = _FakeObjectStore()
            registry = InMemoryDocumentRegistry()
            raw_registry = InMemoryRawAssetRegistry()
            report = materialize_official_web_regulation_candidates(
                source_truth_output_dir=source_pack_dir,
                projection_output_dir=root / "projection-output",
                work_dir=root / "work",
                declarations_path=Path(
                    "configs/sources/official_web/muc_public/projection-declarations.json"
                ),
                object_store=object_store,
                document_registry=registry,
                raw_asset_registry=raw_registry,
                object_store_settings=_object_store_settings(),
                scope_refresh=True,
            )

            self.assertEqual(set(report.source_urls), expected_urls)
            self.assertEqual(report.candidate_count, len(expected_urls))
            self.assertEqual(report.materialized_document_count, len(expected_urls))
            records = registry.list_by_scope("regulations", "institutional_rules")
            self.assertEqual(len(records), len(expected_urls))
            self.assertEqual(
                {
                    record.source_uri
                    for record in records
                    if record.source_channel == "official_web"
                    and record.canonical_markdown_object_key
                    and record.document_units_object_key
                },
                expected_urls,
            )
            reader_report = publish_document_reader_assets(
                bucket_derived="campus-rag-derived",
                generated_at="2026-05-05T00:00:00+00:00",
                object_store=object_store,
                records=records,
            )
            self.assertEqual(reader_report.document_count, len(expected_urls))
            self.assertEqual(reader_report.public_entry_count, len(expected_urls))

    def test_materializes_regulation_candidates_into_multiple_selected_write_scopes(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "collector-output"
            projection_dir = root / "projection-output"
            declarations_path = root / "projection-declarations.json"
            work_dir = root / "work"
            _write_json(declarations_path, _declarations_payload())
            student_match = _target_match(
                consumer_family="regulation_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="regulations/student_rules",
                target_id="official-web-student-rules",
                review_policy="release_gate_required",
            )
            scoped_match = _target_match(
                consumer_family="regulation_candidate",
                materialization_policy="release_gate_required",
                selected_write_target="regulations/scoped_rules",
                target_id="official-web-scoped-rules",
                review_policy="release_gate_required",
            )
            _write_json(
                output_dir / "source-truth-bundle.json",
                {
                    "schemaVersion": "official_web_source_truth_bundle.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_official_web_multi_scope_regulations",
                    "collectionMode": "target-workset",
                    "pages": [
                        _page(
                            raw_asset_id="owasset_student_rule",
                            raw_version_id="owver_student_rule",
                            normalized_canonical_url="https://www.example.edu/rules/student-award.htm",
                            target_matches=[student_match],
                        ),
                        _page(
                            raw_asset_id="owasset_scoped_rule",
                            raw_version_id="owver_scoped_rule",
                            normalized_canonical_url="https://www.example.edu/rules/summer-lab.htm",
                            target_matches=[scoped_match],
                        ),
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_student_rule",
                raw_version_id="owver_student_rule",
                normalized_canonical_url="https://www.example.edu/rules/student-award.htm",
                page_title="中央民族大学学生奖学金评定办法",
                page_family="article_detail",
                target_matches=[student_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_student_rule",
                        raw_version_id="owver_student_rule",
                        row_id="student-title",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学学生奖学金评定办法",
                    ),
                    _block(
                        raw_asset_id="owasset_student_rule",
                        raw_version_id="owver_student_rule",
                        row_id="student-p1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 为规范学生奖学金评定工作，制定本办法。",
                    ),
                ],
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="www.example.edu",
                raw_asset_id="owasset_scoped_rule",
                raw_version_id="owver_scoped_rule",
                normalized_canonical_url="https://www.example.edu/rules/summer-lab.htm",
                page_title="中央民族大学暑期实验室安全管理规定",
                page_family="article_detail",
                target_matches=[scoped_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_scoped_rule",
                        raw_version_id="owver_scoped_rule",
                        row_id="scoped-title",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学暑期实验室安全管理规定",
                    ),
                    _block(
                        raw_asset_id="owasset_scoped_rule",
                        raw_version_id="owver_scoped_rule",
                        row_id="scoped-p1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 为规范暑期实验室开放期间的安全管理，制定本规定。",
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
                scope_refresh=True,
            )

            self.assertEqual(report.candidate_count, 2)
            self.assertEqual(report.materialized_document_count, 2)
            student_records = registry.list_by_scope("regulations", "student_rules")
            scoped_records = registry.list_by_scope("regulations", "scoped_rules")
            self.assertEqual(len(student_records), 1)
            self.assertEqual(len(scoped_records), 1)
            self.assertEqual(
                student_records[0].source_uri,
                "https://www.example.edu/rules/student-award.htm",
            )
            self.assertEqual(
                scoped_records[0].source_uri,
                "https://www.example.edu/rules/summer-lab.htm",
            )


def _object_store_settings() -> ObjectStoreSettings:
    return ObjectStoreSettings(
        endpoint="http://localhost:9000",
        access_key="test",
        secret_key="test",
        region="us-east-1",
        bucket_source="campus-rag-source",
        bucket_derived="campus-rag-derived",
        secure=False,
    )


def _matches_path_segment_suffix(key: str, suffix: str | None) -> bool:
    if suffix is None:
        return True
    return any(segment.endswith(suffix) for segment in key.split("/"))


def _page(
    *,
    raw_asset_id: str,
    raw_version_id: str,
    normalized_canonical_url: str,
    target_matches: list[dict[str, object]],
) -> dict[str, object]:
    return {
        "rawAssetId": raw_asset_id,
        "rawVersionId": raw_version_id,
        "normalizedCanonicalUrl": normalized_canonical_url,
        "pageFamily": "article_detail",
        "pageManifestObjectKey": (
            f"official_web/{raw_asset_id}/undated/{raw_version_id}/source-truth/page-manifest.json"
        ),
        "contentBlocksObjectKey": (
            f"official_web/{raw_asset_id}/undated/{raw_version_id}/"
            "source-truth/content-blocks.jsonl"
        ),
        "providerExtractionObjectKey": (
            f"official_web/{raw_asset_id}/undated/{raw_version_id}/"
            "provider/cheerio-basic/page-extraction.json"
        ),
        "responseHtmlObjectKey": (
            f"official_web/{raw_asset_id}/undated/{raw_version_id}/capture/response.html"
        ),
        "responseBodyHash": f"hash-{raw_asset_id}",
        "blockCount": 2,
        "targetMatches": target_matches,
        "selectedWriteTarget": "regulations/institutional_rules",
        "materializationPolicy": "release_gate_required",
        "reviewPolicy": "release_gate_required",
    }


def _read_units(payload: bytes) -> list[dict[str, object]]:
    return [json.loads(line) for line in payload.decode("utf-8").splitlines() if line.strip()]


def _materialize_single_title(
    *,
    declarations_path: Path,
    output_dir: Path,
    projection_dir: Path,
    raw_asset_id: str,
    raw_version_id: str,
    source_url: str,
    target_matches: list[dict[str, object]],
    title: str,
    work_dir: Path,
) -> dict[str, str]:
    _write_json(
        output_dir / "source-truth-bundle.json",
        {
            "schemaVersion": "official_web_source_truth_bundle.v1",
            "siteId": "campus_public",
            "crawlRunId": "owrun_regulation_identity_test",
            "collectionMode": "target-workset",
            "pages": [
                _page(
                    raw_asset_id=raw_asset_id,
                    raw_version_id=raw_version_id,
                    normalized_canonical_url=source_url,
                    target_matches=target_matches,
                )
            ],
        },
    )
    _write_output_page(
        output_dir,
        site_id="campus_public",
        host="met.example.edu",
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        normalized_canonical_url=source_url,
        page_title=title,
        page_family="article_detail",
        target_matches=target_matches,
        blocks=[
            _block(
                raw_asset_id=raw_asset_id,
                raw_version_id=raw_version_id,
                row_id="title",
                row_index=0,
                block_order=0,
                block_role="title",
                text=title,
            ),
            _block(
                raw_asset_id=raw_asset_id,
                raw_version_id=raw_version_id,
                row_id="p1",
                row_index=1,
                block_order=1,
                block_role="paragraph",
                text="第一条 为规范校园一卡通管理，制定本规定。",
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
    if len(records) != 1:
        raise AssertionError(f"expected one materialized record, got {len(records)}")
    record = records[0]
    return {
        "document_id": record.document_id,
        "version_id": record.version_id,
    }


def _materializable_regulation_urls(projection_dir: Path) -> set[str]:
    report = json.loads((projection_dir / "projection-report.json").read_text(encoding="utf-8"))
    return {
        str(candidate["normalized_canonical_url"])
        for candidate in report.get("consumer_candidate_pages") or []
        if str(candidate.get("selected_write_target") or "").strip()
        == "regulations/institutional_rules"
    }
