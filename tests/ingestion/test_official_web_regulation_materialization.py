from __future__ import annotations

import json
import unittest
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory

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
            self.assertEqual(
                units[0]["metadata"]["normalization_quality"],
                "passed",
            )
            self.assertEqual(
                units[0]["metadata"]["selected_write_target"],
                "regulations/institutional_rules",
            )

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
        expected_urls = _collected_regulation_urls(source_pack_dir)
        self.assertEqual(len(expected_urls), 12)

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


def _collected_regulation_urls(source_pack_dir: Path) -> set[str]:
    bundle = json.loads((source_pack_dir / "source-truth-bundle.json").read_text(encoding="utf-8"))
    urls: set[str] = set()
    for page in bundle["pages"]:
        target_matches = page.get("targetMatches") or []
        if any(
            match.get("targetId") == "official-web-institutional-rules" for match in target_matches
        ):
            urls.add(str(page["normalizedCanonicalUrl"]))
    return urls
