from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.notice_consumption_projection import NoticeConsumptionProjectionEntry
from campus_ingestion_core.wechat_public_notice_projection import (
    WeChatPublicNoticeProjectionBuildReport,
)

worker = importlib.import_module("campus_ingestion_worker.smoke_wechat_public_notice_phase5")


class SmokeWeChatPublicNoticePhase5WorkerCliTest(unittest.TestCase):
    def test_main_refuses_implicit_selection(self) -> None:
        with (
            patch("campus_ingestion_worker.smoke_wechat_public_notice_phase5.load_worker_env"),
            patch(
                "campus_ingestion_worker.smoke_wechat_public_notice_phase5.rebuild_wechat_public_notice_projection"
            ) as rebuild,
            self.assertRaises(SystemExit),
        ):
            worker.main([])

        rebuild.assert_not_called()

    def test_main_emits_ok_summary_for_valid_projection(self) -> None:
        report = WeChatPublicNoticeProjectionBuildReport(
            projection_entries=(
                _entry(
                    source_notice_id="woa_article_alpha",
                    consumption_status="retained_for_notice_query",
                    target_surface="notice_level_query",
                    dedupe_status="unique",
                ),
                _entry(
                    source_notice_id="woa_article_duplicate",
                    consumption_status="no_adoption",
                    target_surface="unsupported",
                    dedupe_status="suppressed_duplicate",
                ),
            ),
            total_article_count=2,
            retained_count=1,
            duplicate_suppressed_count=1,
            duplicate_source_family_counts={"official_web_public_notice": 1},
        )

        with (
            patch("campus_ingestion_worker.smoke_wechat_public_notice_phase5.load_worker_env"),
            patch(
                "campus_ingestion_worker.smoke_wechat_public_notice_phase5.rebuild_wechat_public_notice_projection",
                return_value=report,
            ) as rebuild,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(
                [
                    "--article-manifest-key",
                    (
                        "wechat_official_account/muc/2026/woa_ver_alpha/"
                        "source-truth/article-manifest.json"
                    ),
                    "--source-bucket",
                    "source",
                    "--min-article-count",
                    "2",
                    "--min-retained-count",
                    "1",
                    "--min-duplicate-suppressed-count",
                    "1",
                    "--require-suppressed-source-family",
                    "official_web_public_notice",
                ]
            )

        self.assertEqual(rebuild.call_args.kwargs["dry_run"], True)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["ok"], True)
        self.assertEqual(payload["projection"]["article_count"], 2)
        self.assertEqual(payload["projection"]["duplicate_suppressed_count"], 1)
        self.assertEqual(payload["projection"]["query_serving_opened"], False)

    def test_main_exits_non_zero_when_projection_smoke_fails(self) -> None:
        report = WeChatPublicNoticeProjectionBuildReport(
            projection_entries=(
                _entry(
                    source_notice_id="woa_article_bad",
                    consumption_status="no_adoption",
                    target_surface="notice_level_query",
                    dedupe_status="suppressed_duplicate",
                ),
            ),
            total_article_count=1,
            retained_count=0,
            duplicate_suppressed_count=1,
            duplicate_source_family_counts={"official_web_public_notice": 1},
        )

        with (
            patch("campus_ingestion_worker.smoke_wechat_public_notice_phase5.load_worker_env"),
            patch(
                "campus_ingestion_worker.smoke_wechat_public_notice_phase5.rebuild_wechat_public_notice_projection",
                return_value=report,
            ),
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
            self.assertRaises(SystemExit) as exit_ctx,
        ):
            worker.main(
                [
                    "--article-manifest-key",
                    (
                        "wechat_official_account/muc/2026/woa_ver_bad/"
                        "source-truth/article-manifest.json"
                    ),
                    "--source-bucket",
                    "source",
                ]
            )

        self.assertEqual(exit_ctx.exception.code, 1)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["ok"], False)
        self.assertTrue(payload["errors"])


def _entry(
    *,
    source_notice_id: str,
    consumption_status: str,
    target_surface: str,
    dedupe_status: str,
) -> NoticeConsumptionProjectionEntry:
    return NoticeConsumptionProjectionEntry(
        source_family="wechat_public_notice",
        source_corpus="campus_notices",
        source_collection="wechat_public_notice",
        source_notice_id=source_notice_id,
        unit_id=f"notice_unit:wechat:{source_notice_id}",
        primary_role="notice_window",
        semantic_owner="notice_body",
        default_agent="notice-agent",
        target_surface=target_surface,
        temporal_policy="announcement_window",
        completeness_status="reference_only",
        answerability="reference_only",
        consumption_status=consumption_status,
        source_notice_document_id=f"wechat_notice:{source_notice_id}",
        source_document_id=f"wechat_notice:{source_notice_id}",
        role_metadata={
            "body_state": "not_captured",
            "dedupe_status": dedupe_status,
        },
    )


if __name__ == "__main__":
    unittest.main()
