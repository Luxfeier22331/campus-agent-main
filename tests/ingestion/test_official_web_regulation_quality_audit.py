from __future__ import annotations

import importlib
import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.official_web_regulation_quality_audit import (
    OfficialWebRegulationQualityAuditDocumentReport,
    OfficialWebRegulationQualityAuditReport,
    audit_official_web_regulation_batch_quality,
    official_web_regulation_quality_audit_report_to_dict,
)

from tests.ingestion.official_web_projection_test_support import (
    _block,
    _declarations_payload,
    _target_match,
    _write_json,
    _write_output_page,
)

audit_worker = importlib.import_module(
    "campus_ingestion_worker.audit_official_web_regulation_quality"
)


class OfficialWebRegulationQualityAuditTest(unittest.TestCase):
    def test_audit_counts_title_normalization_and_trial_status(self) -> None:
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
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_regulation_quality_audit_title_normalization",
                    "collectionMode": "target-workset",
                    "pages": [
                        {
                            "rawAssetId": "owasset_portal_rule",
                            "rawVersionId": "owver_portal_rule",
                            "normalizedCanonicalUrl": "https://met.example.edu/info/1024/1088.htm",
                            "pageFamily": "article_detail",
                            "pageManifestObjectKey": (
                                "official_web/owasset_portal_rule/undated/owver_portal_rule/"
                                "source-truth/page-manifest.json"
                            ),
                            "contentBlocksObjectKey": (
                                "official_web/owasset_portal_rule/undated/owver_portal_rule/"
                                "source-truth/content-blocks.jsonl"
                            ),
                            "providerExtractionObjectKey": (
                                "official_web/owasset_portal_rule/undated/owver_portal_rule/"
                                "provider/cheerio-basic/page-extraction.json"
                            ),
                            "responseHtmlObjectKey": (
                                "official_web/owasset_portal_rule/undated/owver_portal_rule/"
                                "capture/response.html"
                            ),
                            "responseBodyHash": "hash-portal-rule",
                            "blockCount": 2,
                            "targetMatches": [regulation_match],
                            "selectedWriteTarget": "regulations/institutional_rules",
                            "materializationPolicy": "release_gate_required",
                            "reviewPolicy": "release_gate_required",
                        }
                    ],
                },
            )
            _write_output_page(
                output_dir,
                site_id="campus_public",
                host="met.example.edu",
                raw_asset_id="owasset_portal_rule",
                raw_version_id="owver_portal_rule",
                normalized_canonical_url="https://met.example.edu/info/1024/1088.htm",
                page_title="中央民族大学 信息门户运行管理办法（试行）",
                page_family="article_detail",
                target_matches=[regulation_match],
                blocks=[
                    _block(
                        raw_asset_id="owasset_portal_rule",
                        raw_version_id="owver_portal_rule",
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="中央民族大学 信息门户运行管理办法（试行）",
                    ),
                    _block(
                        raw_asset_id="owasset_portal_rule",
                        raw_version_id="owver_portal_rule",
                        row_id="paragraph-1",
                        row_index=1,
                        block_order=1,
                        block_role="paragraph",
                        text="第一条 为规范信息门户运行管理，制定本办法。",
                    ),
                ],
            )

            report = audit_official_web_regulation_batch_quality(
                source_truth_output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

        self.assertTrue(report.passed)
        self.assertEqual(report.title_normalized_count, 1)
        self.assertEqual(report.title_status_kind_counts, {"trial": 1})
        document = report.documents[0]
        self.assertEqual(document.title, "中央民族大学信息门户运行管理办法（试行）")
        self.assertEqual(document.title_raw, "中央民族大学 信息门户运行管理办法（试行）")
        self.assertEqual(document.title_status_kind, "trial")

    def test_audit_batches_materialized_regulations_and_reports_clean_pass(self) -> None:
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
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_regulation_quality_audit_pass",
                    "collectionMode": "target-workset",
                    "pages": [
                        {
                            "rawAssetId": "owasset_card",
                            "rawVersionId": "owver_card",
                            "normalizedCanonicalUrl": "https://met.example.edu/info/1024/1086.htm",
                            "pageFamily": "article_detail",
                            "pageManifestObjectKey": (
                                "official_web/owasset_card/undated/owver_card/"
                                "source-truth/page-manifest.json"
                            ),
                            "contentBlocksObjectKey": (
                                "official_web/owasset_card/undated/owver_card/"
                                "source-truth/content-blocks.jsonl"
                            ),
                            "providerExtractionObjectKey": (
                                "official_web/owasset_card/undated/owver_card/"
                                "provider/cheerio-basic/page-extraction.json"
                            ),
                            "responseHtmlObjectKey": (
                                "official_web/owasset_card/undated/owver_card/"
                                "capture/response.html"
                            ),
                            "responseBodyHash": "hash-card",
                            "blockCount": 3,
                            "targetMatches": [regulation_match],
                            "selectedWriteTarget": "regulations/institutional_rules",
                            "materializationPolicy": "release_gate_required",
                            "reviewPolicy": "release_gate_required",
                        }
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
                        row_id="title-1",
                        row_index=0,
                        block_order=0,
                        block_role="title",
                        text="校 园 一 卡 通 管 理 规 定",
                    ),
                    _block(
                        raw_asset_id="owasset_card",
                        raw_version_id="owver_card",
                        row_id="heading-1",
                        row_index=1,
                        block_order=1,
                        block_role="heading",
                        text="学生工作",
                    ),
                    _block(
                        raw_asset_id="owasset_card",
                        raw_version_id="owver_card",
                        row_id="paragraph-1",
                        row_index=2,
                        block_order=2,
                        block_role="paragraph",
                        text=(
                            "中央民族大学校园一卡通管理规定 第一章 总则"
                            "第一条 为规范校园一卡通使用与管理，制定本规定。"
                            "第二条 本规定适用于中央民族大学校园一卡通用户。"
                        ),
                    ),
                ],
            )

            report = audit_official_web_regulation_batch_quality(
                source_truth_output_dir=output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

        self.assertTrue(report.passed)
        self.assertEqual(report.candidate_count, 1)
        self.assertEqual(report.selected_target_document_count, 1)
        self.assertEqual(report.audited_document_count, 1)
        self.assertEqual(report.counts_by_collection, {"institutional_rules": 1})
        self.assertEqual(report.title_normalized_count, 1)
        self.assertEqual(report.wrapper_removed_count, 1)
        self.assertEqual(report.issue_counts, {})
        self.assertEqual(report.chunk_issue_counts, {})
        document = report.documents[0]
        self.assertEqual(document.title, "校园一卡通管理规定")
        self.assertEqual(document.title_raw, "校 园 一 卡 通 管 理 规 定")
        self.assertEqual(document.quality_verdict, "passed")
        self.assertTrue(document.wrapper_removed)
        self.assertGreaterEqual(document.chapter_count, 1)
        self.assertGreaterEqual(document.chunk_count, 1)
        self.assertGreaterEqual(document.chunk_count, 1)
        self.assertGreaterEqual(document.answer_bearing_chunk_count, 1)

    def test_audit_uses_live_source_pack_materialization_when_present(self) -> None:
        source_truth_output_dir = (
            Path("var")
            / "official-web-source-pack-live-seam"
            / "owrun_source_pack_live_20260504T122734Z"
            / "collector-output"
        )
        if not source_truth_output_dir.exists():
            self.skipTest("live official-web source-pack evidence is not present")
        declarations_path = Path(
            "configs/sources/official_web/muc_public/projection-declarations.json"
        )
        with TemporaryDirectory() as temp_dir:
            projection_dir = Path(temp_dir) / "projection-output"
            report = audit_official_web_regulation_batch_quality(
                source_truth_output_dir=source_truth_output_dir,
                projection_output_dir=projection_dir,
                declarations_path=declarations_path,
            )

        self.assertGreaterEqual(report.candidate_count, 11)
        self.assertGreaterEqual(report.selected_target_document_count, 11)
        self.assertGreaterEqual(report.audited_document_count, 11)
        self.assertIn("institutional_rules", report.counts_by_collection)
        self.assertIn("passed", report.normalization_verdict_counts)
        self.assertGreaterEqual(report.total_chunk_count, report.audited_document_count)
        self.assertEqual(report.soft_wrap_residue_document_count, 0)
        payload = official_web_regulation_quality_audit_report_to_dict(report)
        self.assertEqual(
            payload["schema_version"],
            "official_web_regulation_quality_audit.v1",
        )


class OfficialWebRegulationQualityAuditWorkerCliTest(unittest.TestCase):
    def test_main_prints_quality_audit_json(self) -> None:
        with (
            patch.object(audit_worker, "load_worker_env"),
            patch.object(
                audit_worker,
                "audit_official_web_regulation_batch_quality",
            ) as run_audit,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            run_audit.return_value = {
                "unexpected": "dict-return-is-wrong-type"
            }
            report = OfficialWebRegulationQualityAuditReport(
                schema_version="official_web_regulation_quality_audit.v1",
                source_truth_output_dir="/tmp/collector-output",
                projection_output_dir="/tmp/projection-output",
                passed=True,
                candidate_count=1,
                selected_target_document_count=1,
                audited_document_count=1,
                total_chunk_count=2,
                total_answer_bearing_chunk_count=2,
                counts_by_collection={"institutional_rules": 1},
                normalization_verdict_counts={"passed": 1},
                title_status_kind_counts={"trial": 1},
                issue_counts={},
                chunk_issue_counts={},
                title_normalized_count=1,
                wrapper_removed_count=0,
                soft_wrap_repair_count=0,
                soft_wrap_residue_document_count=0,
                documents=(
                    OfficialWebRegulationQualityAuditDocumentReport(
                        target_document_id="official_web_regulation:doc-001",
                        target_collection="institutional_rules",
                        title="中央民族大学信息门户运行管理办法（试行）",
                        title_raw="中央民族大学 信息门户运行管理办法（试行）",
                        title_base="中央民族大学信息门户运行管理办法",
                        title_status_kind="trial",
                        title_status_qualifier="试行",
                        source_url="https://met.example.edu/info/1024/1088.htm",
                        quality_verdict="passed",
                        wrapper_removed=False,
                        suspicious_prefix=False,
                        chapter_count=1,
                        article_count=1,
                        soft_wrap_repair_count=0,
                        soft_wrap_residue_count=0,
                        canonical_line_count=3,
                        chunk_count=2,
                        answer_bearing_chunk_count=2,
                        token_summary={"min": 20, "max": 30, "avg": 25.0, "median": 25},
                        issue_codes=(),
                        chunk_issue_counts={},
                        examples=(),
                    ),
                ),
            )
            run_audit.return_value = report
            audit_worker.main(
                [
                    "--source-truth-output-dir",
                    "/tmp/collector-output",
                    "--projection-output-dir",
                    "/tmp/projection-output",
                    "--declarations-path",
                    "/tmp/projection-declarations.json",
                ]
            )

        kwargs = run_audit.call_args.kwargs
        self.assertEqual(
            kwargs["source_truth_output_dir"],
            Path("/tmp/collector-output").resolve(),
        )
        self.assertEqual(
            kwargs["projection_output_dir"],
            Path("/tmp/projection-output").resolve(),
        )
        self.assertEqual(
            kwargs["declarations_path"],
            Path("/tmp/projection-declarations.json").resolve(),
        )
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["title_normalized_count"], 1)
        self.assertEqual(
            payload["documents"][0]["title_raw"],
            "中央民族大学 信息门户运行管理办法（试行）",
        )


if __name__ == "__main__":
    unittest.main()
