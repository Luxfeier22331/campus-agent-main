from __future__ import annotations

import importlib
import io
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from campus_ingestion_core.wechat_public_notice_multimodal import (
    WeChatPublicNoticeMultimodalProcessingReport,
)

worker = importlib.import_module(
    "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal"
)


class DrainWeChatPublicNoticePendingMultimodalWorkerCliTest(unittest.TestCase):
    def test_main_drains_pending_projection_notices_and_rebuilds_read_model(self) -> None:
        report = WeChatPublicNoticeMultimodalProcessingReport(
            source_corpus="campus_notices",
            source_collection="wechat_public_notice",
            selected_notice_ids=("woa_article_1",),
            pending_notice_ids=("woa_article_1",),
            projection_entry_count=1,
            pending_entry_count=1,
            scanned_image_count=1,
            attempted_image_count=1,
            admitted_count=1,
            no_extractable_text_count=0,
            terminal_failure_count=0,
            still_pending_count=0,
            item_reports=(),
        )

        projection_store = SimpleNamespace(
            list_by_scope=lambda source_corpus, source_collection, notice_ids=(): ("entry-1",)
        )

        with (
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "build_notice_consumption_projection_store_from_env",
                return_value=projection_store,
            ) as build_projection_store,
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "ObjectStoreSettings.from_env",
                return_value=SimpleNamespace(
                    bucket_source="source",
                    bucket_derived="derived",
                ),
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "S3ObjectStoreAdmin",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "S3ObjectStoreWriter",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "select_wechat_public_notice_pending_multimodal_notice_ids",
                return_value=("woa_article_1",),
            ) as select_notice_ids,
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "process_wechat_public_notice_pending_multimodal_entries",
                return_value=report,
            ) as process_entries,
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "_build_projection_request_from_projection_entries",
                return_value="projection-request",
            ) as build_request,
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "rebuild_wechat_public_notice_projection",
                return_value=SimpleNamespace(
                    projection_entries=(SimpleNamespace(source_notice_id="woa_article_1"),)
                ),
            ) as rebuild_projection,
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "materialize_wechat_public_notice_read_model",
                return_value=("row-1",),
            ) as rebuild_read_model,
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "build_internal_notice_read_model_store_from_env",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "build_internal_notice_consumption_admission_store_from_env",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "record_internal_notice_consumption_admission",
                side_effect=("wechat-mm-batch-1", "wechat-mm-batch-1"),
            ) as record_admission,
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "build_wechat_public_notice_multimodal_attempt_store_from_env",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "build_document_registry_from_env",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "ChatCompletionsWeChatPublicNoticeMultimodalProvider.from_env",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "HttpxWeChatPublicNoticeInlineImageFetcher",
                return_value=object(),
            ),
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(["--limit", "10", "--batch-size", "5", "--max-attempts", "2"])

        build_projection_store.assert_called_once()
        select_notice_ids.assert_called_once()
        self.assertEqual(process_entries.call_args.kwargs["notice_ids"], ("woa_article_1",))
        self.assertEqual(process_entries.call_args.kwargs["max_attempts"], 2)
        build_request.assert_called_once()
        self.assertEqual(
            build_request.call_args.kwargs["consumer_admission_batch_id"],
            "wechat-mm-batch-1",
        )
        rebuild_projection.assert_called_once_with(
            request="projection-request",
            projection_store=build_projection_store.return_value,
        )
        rebuild_read_model.assert_called_once()
        completed_kwargs = record_admission.call_args_list[1].kwargs
        self.assertEqual(completed_kwargs["status"], "completed")
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["batch_id"], "wechat-mm-batch-1")
        self.assertEqual(payload["read_model_rebuilt_count"], 1)

    def test_main_fails_batch_when_terminal_multimodal_failure_exists(self) -> None:
        report = WeChatPublicNoticeMultimodalProcessingReport(
            source_corpus="campus_notices",
            source_collection="wechat_public_notice",
            selected_notice_ids=("woa_article_1",),
            pending_notice_ids=("woa_article_1",),
            projection_entry_count=1,
            pending_entry_count=1,
            scanned_image_count=1,
            attempted_image_count=1,
            admitted_count=0,
            no_extractable_text_count=0,
            terminal_failure_count=1,
            still_pending_count=0,
            item_reports=(),
        )
        projection_store = SimpleNamespace(
            list_by_scope=lambda source_corpus, source_collection, notice_ids=(): ("entry-1",)
        )

        with (
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "build_notice_consumption_projection_store_from_env",
                return_value=projection_store,
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "ObjectStoreSettings.from_env",
                return_value=SimpleNamespace(bucket_source="source", bucket_derived="derived"),
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "S3ObjectStoreAdmin",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "S3ObjectStoreWriter",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "select_wechat_public_notice_pending_multimodal_notice_ids",
                return_value=("woa_article_1",),
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "process_wechat_public_notice_pending_multimodal_entries",
                return_value=report,
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "_build_projection_request_from_projection_entries",
                return_value="projection-request",
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "rebuild_wechat_public_notice_projection",
                return_value=SimpleNamespace(
                    projection_entries=(SimpleNamespace(source_notice_id="woa_article_1"),)
                ),
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "materialize_wechat_public_notice_read_model",
                return_value=(),
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "build_internal_notice_read_model_store_from_env",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "build_internal_notice_consumption_admission_store_from_env",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "record_internal_notice_consumption_admission",
                side_effect=("wechat-mm-batch-2", "wechat-mm-batch-2"),
            ) as record_admission,
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "build_wechat_public_notice_multimodal_attempt_store_from_env",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "build_document_registry_from_env",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "ChatCompletionsWeChatPublicNoticeMultimodalProvider.from_env",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.drain_wechat_public_notice_pending_multimodal."
                "HttpxWeChatPublicNoticeInlineImageFetcher",
                return_value=object(),
            ),
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
            self.assertRaises(SystemExit) as raised,
        ):
            worker.main(["--limit", "10"])

        self.assertEqual(raised.exception.code, 1)
        failed_kwargs = record_admission.call_args_list[1].kwargs
        self.assertEqual(failed_kwargs["status"], "failed")
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["terminal_failure_count"], 1)
        self.assertEqual(payload["status"], "failed")


if __name__ == "__main__":
    unittest.main()
