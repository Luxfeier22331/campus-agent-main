from __future__ import annotations

import importlib
import io
import json
import unittest
from dataclasses import dataclass
from unittest.mock import patch

from campus_ingestion_core.wechat_public_notice_projection import (
    WeChatPublicNoticeProjectionBuildReport,
)

worker = importlib.import_module("campus_ingestion_worker.smoke_wechat_public_notice_runtime")


class SmokeWeChatPublicNoticeRuntimeWorkerCliTest(unittest.TestCase):
    def test_main_refuses_implicit_selection(self) -> None:
        with (
            patch("campus_ingestion_worker.smoke_wechat_public_notice_runtime.load_worker_env"),
            self.assertRaises(SystemExit),
        ):
            worker.main([])

    def test_main_supports_manifest_selection_and_emits_runtime_report(self) -> None:
        projection_report = WeChatPublicNoticeProjectionBuildReport(
            projection_entries=(_ProjectionEntry(source_notice_id="woa_article_alpha"),),
            total_article_count=1,
            retained_count=1,
            duplicate_suppressed_count=0,
            duplicate_source_family_counts={},
        )
        runtime_report = _RuntimeReport(
            source_corpus="campus_notices",
            source_collection="wechat_public_notice",
            selected_notice_ids=("woa_article_alpha",),
            projection_entry_count=1,
            completed_admission_batch_count=1,
            projection_entries_missing_admission_count=0,
            pending_multimodal_without_attempt_count=0,
            pending_multimodal_without_source_image_count=0,
            queryable_without_captured_body_count=0,
            source_truth_missing_object_count=0,
            read_model_ok=True,
            multimodal_provider_checked=False,
            multimodal_provider_ok=True,
            multimodal_provider_error="",
            ok=True,
        )

        with (
            patch("campus_ingestion_worker.smoke_wechat_public_notice_runtime.load_worker_env"),
            patch(
                "campus_ingestion_worker.smoke_wechat_public_notice_runtime.rebuild_wechat_public_notice_projection",
                return_value=projection_report,
            ) as rebuild_projection,
            patch(
                "campus_ingestion_worker.smoke_wechat_public_notice_runtime.run_wechat_public_notice_runtime_smoke",
                return_value=runtime_report,
            ) as run_smoke,
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
                ]
            )

        self.assertEqual(rebuild_projection.call_args.kwargs["dry_run"], True)
        self.assertEqual(run_smoke.call_args.kwargs["notice_ids"], ("woa_article_alpha",))
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["ok"], True)
        self.assertEqual(payload["selected_notice_ids"], ["woa_article_alpha"])


@dataclass(frozen=True, slots=True)
class _ProjectionEntry:
    source_notice_id: str


@dataclass(frozen=True, slots=True)
class _RuntimeReport:
    source_corpus: str
    source_collection: str
    selected_notice_ids: tuple[str, ...]
    projection_entry_count: int
    completed_admission_batch_count: int
    projection_entries_missing_admission_count: int
    pending_multimodal_without_attempt_count: int
    pending_multimodal_without_source_image_count: int
    queryable_without_captured_body_count: int
    source_truth_missing_object_count: int
    read_model_ok: bool
    multimodal_provider_checked: bool
    multimodal_provider_ok: bool
    multimodal_provider_error: str
    ok: bool


if __name__ == "__main__":
    unittest.main()
