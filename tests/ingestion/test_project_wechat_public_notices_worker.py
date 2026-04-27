from __future__ import annotations

import importlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from campus_ingestion_core.notice_consumption_projection import NoticeConsumptionProjectionEntry
from campus_ingestion_core.wechat_public_notice_projection import (
    WeChatPublicNoticeProjectionBuildReport,
    WeChatReadModelEvidenceEntry,
    WeChatSourceTruthArtifactRefs,
)

worker = importlib.import_module("campus_ingestion_worker.project_wechat_public_notices")


class ProjectWeChatPublicNoticesWorkerCliTest(unittest.TestCase):
    def test_main_refuses_implicit_full_scope_projection(self) -> None:
        with (
            patch("campus_ingestion_worker.project_wechat_public_notices.load_worker_env"),
            patch(
                "campus_ingestion_worker.project_wechat_public_notices.rebuild_wechat_public_notice_projection"
            ) as rebuild,
            patch("sys.stderr", new_callable=io.StringIO),
            self.assertRaises(SystemExit),
        ):
            worker.main([])

        rebuild.assert_not_called()

    def test_main_projects_explicit_manifest_refs_and_records_admission(self) -> None:
        report = WeChatPublicNoticeProjectionBuildReport(
            projection_entries=(_projection_entry("woa_article_alpha"),),
            total_article_count=1,
            retained_count=1,
            duplicate_suppressed_count=0,
            duplicate_source_family_counts={},
        )
        admission_store = object()
        manifest_key = (
            "wechat_official_account/muc/2026/woa_ver_alpha/source-truth/article-manifest.json"
        )
        with (
            patch("campus_ingestion_worker.project_wechat_public_notices.load_worker_env"),
            patch(
                "campus_ingestion_worker.project_wechat_public_notices.rebuild_wechat_public_notice_projection",
                return_value=report,
            ) as rebuild,
            patch(
                "campus_ingestion_worker.project_wechat_public_notices.build_internal_notice_consumption_admission_store_from_env",
                return_value=admission_store,
            ) as build_store,
            patch(
                "campus_ingestion_worker.project_wechat_public_notices.record_internal_notice_consumption_admission",
                side_effect=("batch-wechat-001", "batch-wechat-001"),
            ) as record_admission,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(
                [
                    "--article-manifest-key",
                    manifest_key,
                    "--source-bucket",
                    "source",
                ]
            )

        build_store.assert_called_once()
        self.assertEqual(rebuild.call_args.kwargs["dry_run"], False)
        request = rebuild.call_args.kwargs["request"]
        self.assertEqual(request.source_corpus, "campus_notices")
        self.assertEqual(request.source_collection, "wechat_public_notice")
        self.assertEqual(len(request.artifact_refs), 1)
        self.assertEqual(request.artifact_refs[0].bucket, "source")
        self.assertEqual(request.artifact_refs[0].article_manifest_key, manifest_key)
        self.assertEqual(
            request.artifact_refs[0].content_blocks_key,
            "wechat_official_account/muc/2026/woa_ver_alpha/source-truth/content-blocks.jsonl",
        )
        self.assertEqual(
            request.artifact_refs[0].media_refs_key,
            "wechat_official_account/muc/2026/woa_ver_alpha/source-truth/media-refs.jsonl",
        )
        self.assertEqual(record_admission.call_count, 2)
        started_kwargs = record_admission.call_args_list[0].kwargs
        completed_kwargs = record_admission.call_args_list[1].kwargs
        self.assertEqual(started_kwargs["command"], "wechat_public_notice_projection_rebuild")
        self.assertEqual(started_kwargs["selection_source"], "explicit_manifest_keys")
        self.assertEqual(started_kwargs["notice_ids"], ())
        self.assertIs(started_kwargs["store"], admission_store)
        self.assertEqual(completed_kwargs["status"], "completed")
        self.assertEqual(completed_kwargs["batch_id"], "batch-wechat-001")
        self.assertEqual(completed_kwargs["notice_ids"], ("woa_article_alpha",))
        self.assertEqual(completed_kwargs["result_counts"]["projection_entry_count"], 1)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["batch_id"], "batch-wechat-001")
        self.assertEqual(payload["projection_entry_count"], 1)
        self.assertEqual(payload["query_serving_opened"], False)
        self.assertEqual(payload["projection_write_performed"], True)
        self.assertEqual(payload["retained_count"], 1)
        self.assertEqual(payload["read_model_evidence_count"], 0)

    def test_main_supports_selection_path_dry_run_and_evidence_output(self) -> None:
        report = WeChatPublicNoticeProjectionBuildReport(
            projection_entries=(_projection_entry("woa_article_beta"),),
            total_article_count=1,
            retained_count=1,
            duplicate_suppressed_count=0,
            duplicate_source_family_counts={},
        )
        refs = (
            WeChatSourceTruthArtifactRefs(
                article_manifest_key=(
                    "wechat_official_account/muc/2026/woa_ver_beta/source-truth/article-manifest.json"
                ),
                content_blocks_key=(
                    "wechat_official_account/muc/2026/woa_ver_beta/source-truth/content-blocks.jsonl"
                ),
                media_refs_key=(
                    "wechat_official_account/muc/2026/woa_ver_beta/source-truth/media-refs.jsonl"
                ),
                bucket="source",
            ),
        )
        evidence = (
            WeChatReadModelEvidenceEntry(
                source_family="wechat_public_notice",
                source_notice_id="woa_article_beta",
                title="beta",
                source_url="https://mp.weixin.qq.com/s/beta",
                published_at="2026-04-23T08:00:00+08:00",
                target_surface="notice_level_query",
                consumption_status="retained_for_notice_query",
                body_excerpt="beta",
                provenance_refs=("manifest.json",),
            ),
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            selection_path = Path(temp_dir) / "selection.json"
            selection_path.write_text('{"source_truth_articles":[]}', encoding="utf-8")

            with (
                patch("campus_ingestion_worker.project_wechat_public_notices.load_worker_env"),
                patch(
                    "campus_ingestion_worker.project_wechat_public_notices.parse_wechat_projection_selection_path",
                    return_value=refs,
                ) as parse_selection,
                patch(
                    "campus_ingestion_worker.project_wechat_public_notices.rebuild_wechat_public_notice_projection",
                    return_value=report,
                ) as rebuild,
                patch(
                    "campus_ingestion_worker.project_wechat_public_notices.build_wechat_public_notice_read_model_evidence_entries",
                    return_value=evidence,
                ) as build_evidence,
                patch(
                    "campus_ingestion_worker.project_wechat_public_notices.build_internal_notice_consumption_admission_store_from_env"
                ),
                patch(
                    "campus_ingestion_worker.project_wechat_public_notices.record_internal_notice_consumption_admission",
                    side_effect=("batch-wechat-002", "batch-wechat-002"),
                ) as record_admission,
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                worker.main(
                    [
                        "--selection-path",
                        str(selection_path),
                        "--source-bucket",
                        "source",
                        "--dry-run",
                        "--emit-read-model-evidence",
                    ]
                )

        parse_selection.assert_called_once_with(selection_path, default_bucket="source")
        self.assertEqual(rebuild.call_args.kwargs["dry_run"], True)
        build_evidence.assert_called_once()
        started_kwargs = record_admission.call_args_list[0].kwargs
        self.assertEqual(started_kwargs["command"], "wechat_public_notice_projection_dry_run")
        self.assertEqual(started_kwargs["selection_source"], "selection_path")
        self.assertEqual(started_kwargs["selection_path"], str(selection_path))
        self.assertTrue(started_kwargs["selection_sha256"])
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["projection_write_performed"], False)
        self.assertEqual(payload["read_model_evidence_emitted"], True)
        self.assertEqual(payload["read_model_evidence_count"], 1)

    def test_main_records_failed_admission_when_projection_fails(self) -> None:
        manifest_key = (
            "wechat_official_account/muc/2026/woa_ver_fail/source-truth/article-manifest.json"
        )
        admission_store = object()

        with (
            patch("campus_ingestion_worker.project_wechat_public_notices.load_worker_env"),
            patch(
                "campus_ingestion_worker.project_wechat_public_notices.rebuild_wechat_public_notice_projection",
                side_effect=RuntimeError("projection failed"),
            ),
            patch(
                "campus_ingestion_worker.project_wechat_public_notices.build_internal_notice_consumption_admission_store_from_env",
                return_value=admission_store,
            ),
            patch(
                "campus_ingestion_worker.project_wechat_public_notices.record_internal_notice_consumption_admission",
                side_effect=("batch-wechat-003", "batch-wechat-003"),
            ) as record_admission,
            self.assertRaisesRegex(RuntimeError, "projection failed"),
        ):
            worker.main(
                [
                    "--article-manifest-key",
                    manifest_key,
                    "--source-bucket",
                    "source",
                ]
            )

        self.assertEqual(record_admission.call_count, 2)
        failed_kwargs = record_admission.call_args_list[1].kwargs
        self.assertEqual(failed_kwargs["status"], "failed")
        self.assertEqual(failed_kwargs["batch_id"], "batch-wechat-003")
        self.assertEqual(failed_kwargs["error"], "projection failed")
        self.assertIs(failed_kwargs["store"], admission_store)


def _projection_entry(source_notice_id: str) -> NoticeConsumptionProjectionEntry:
    return NoticeConsumptionProjectionEntry(
        source_family="wechat_public_notice",
        source_corpus="campus_notices",
        source_collection="wechat_public_notice",
        source_notice_id=source_notice_id,
        unit_id=f"notice_unit:wechat:{source_notice_id}",
        primary_role="notice_window",
        semantic_owner="notice_body",
        default_agent="notice-agent",
        target_surface="notice_level_query",
        temporal_policy="announcement_window",
        completeness_status="reference_only",
        answerability="reference_only",
        consumption_status="retained_for_notice_query",
        source_notice_document_id=f"wechat_notice:muc:{source_notice_id}",
        source_document_id=f"wechat_notice:muc:{source_notice_id}",
        role_metadata={"notice_title": source_notice_id},
    )


if __name__ == "__main__":
    unittest.main()
