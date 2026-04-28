from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

worker = importlib.import_module("campus_ingestion_worker.purge_wechat_public_notices")


class PurgeWeChatPublicNoticesWorkerCliTest(unittest.TestCase):
    def test_main_requires_explicit_notice_ids(self) -> None:
        with (
            patch("campus_ingestion_worker.purge_wechat_public_notices.load_worker_env"),
            self.assertRaises(SystemExit),
        ):
            worker.main([])

    def test_main_requires_yes_for_destructive_purge(self) -> None:
        with (
            patch("campus_ingestion_worker.purge_wechat_public_notices.load_worker_env"),
            self.assertRaises(SystemExit),
        ):
            worker.main(["--notice-id", "woa_article_alpha"])

    def test_main_purges_projection_and_read_model_rows(self) -> None:
        projection_store = _ReplaceStore(existing_count=2)
        read_model_store = _ReplaceStore(existing_count=1)
        admission_store = object()
        with (
            patch("campus_ingestion_worker.purge_wechat_public_notices.load_worker_env"),
            patch(
                "campus_ingestion_worker.purge_wechat_public_notices.build_notice_consumption_projection_store_from_env",
                return_value=projection_store,
            ),
            patch(
                "campus_ingestion_worker.purge_wechat_public_notices.build_internal_notice_read_model_store_from_env",
                return_value=read_model_store,
            ),
            patch(
                "campus_ingestion_worker.purge_wechat_public_notices.build_internal_notice_consumption_admission_store_from_env",
                return_value=admission_store,
            ),
            patch(
                "campus_ingestion_worker.purge_wechat_public_notices.record_internal_notice_consumption_admission",
                side_effect=("batch-wechat-purge-001", "batch-wechat-purge-001"),
            ) as record_admission,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(["--notice-id", "woa_article_alpha", "--yes"])

        self.assertEqual(projection_store.replace_calls[0]["notice_ids"], ("woa_article_alpha",))
        self.assertEqual(read_model_store.replace_calls[0]["notice_ids"], ("woa_article_alpha",))
        self.assertEqual(projection_store.replace_calls[0]["records"], ())
        self.assertEqual(read_model_store.replace_calls[0]["records"], ())
        self.assertEqual(record_admission.call_count, 2)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["batch_id"], "batch-wechat-purge-001")
        self.assertEqual(payload["projection_removed_count"], 2)
        self.assertEqual(payload["read_model_removed_count"], 1)


class _ReplaceStore:
    def __init__(self, *, existing_count: int) -> None:
        self.existing_count = existing_count
        self.replace_calls: list[dict[str, object]] = []

    def list_by_scope(self, *args, **kwargs):
        return tuple(f"row-{index}" for index in range(self.existing_count))

    def replace_notices(self, source_corpus, source_collection, *, notice_ids, records):
        self.replace_calls.append(
            {
                "source_corpus": source_corpus,
                "source_collection": source_collection,
                "notice_ids": notice_ids,
                "records": records,
            }
        )


if __name__ == "__main__":
    unittest.main()
