from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.internal_notice_multimodal_processing import (
    InternalNoticeMultimodalDrainReport,
)

worker = importlib.import_module("campus_ingestion_worker.drain_internal_notice_pending_multimodal")


class DrainInternalNoticePendingMultimodalWorkerCliTest(unittest.TestCase):
    def test_main_drains_projection_pending_notices_without_real_smoke(self) -> None:
        report = InternalNoticeMultimodalDrainReport(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            selected_notice_ids=(),
            pending_notice_ids=("351907", "355222"),
            scanned_projection_entry_count=3,
            batch_count=1,
            projection_entry_count=2,
            pending_entry_count=2,
            processed_count=2,
            retained_for_notice_query_count=2,
            no_adoption_count=0,
            still_pending_count=0,
            failed_count=0,
            item_reports=(),
        )
        admission_store = object()
        projection_store = object()

        with (
            patch(
                "campus_ingestion_worker.drain_internal_notice_pending_multimodal.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.drain_internal_notice_pending_multimodal."
                "build_notice_consumption_projection_store_from_env",
                return_value=projection_store,
            ) as build_projection_store,
            patch(
                "campus_ingestion_worker.drain_internal_notice_pending_multimodal."
                "drain_internal_notice_pending_multimodal_entries",
                return_value=report,
            ) as drain,
            patch(
                "campus_ingestion_worker.drain_internal_notice_pending_multimodal."
                "build_internal_notice_multimodal_attempt_store_from_env",
                return_value=object(),
            ),
            patch(
                "campus_ingestion_worker.drain_internal_notice_pending_multimodal."
                "build_internal_notice_consumption_admission_store_from_env",
                return_value=admission_store,
            ),
            patch(
                "campus_ingestion_worker.drain_internal_notice_pending_multimodal."
                "record_internal_notice_consumption_admission",
                side_effect=("batch-drain-001", "batch-drain-001"),
            ) as record_admission,
            patch(
                "campus_ingestion_worker.drain_internal_notice_pending_multimodal."
                "rebuild_internal_notice_read_model",
                return_value=(),
            ) as rebuild_read_model,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(["--limit", "10", "--batch-size", "5"])

        build_projection_store.assert_called_once()
        self.assertIs(drain.call_args.kwargs["projection_store"], projection_store)
        self.assertEqual(drain.call_args.kwargs["limit"], 10)
        self.assertEqual(drain.call_args.kwargs["batch_size"], 5)
        self.assertEqual(
            drain.call_args.kwargs["admission_batch_id"],
            "batch-drain-001",
        )
        self.assertEqual(
            rebuild_read_model.call_args.kwargs["notice_ids"],
            ("351907", "355222"),
        )
        started_kwargs = record_admission.call_args_list[0].kwargs
        completed_kwargs = record_admission.call_args_list[1].kwargs
        self.assertEqual(started_kwargs["command"], "multimodal_drain")
        self.assertEqual(started_kwargs["notice_ids"], ())
        self.assertEqual(started_kwargs["selection_source"], "projection_pending_scan")
        self.assertEqual(started_kwargs["command_args"]["limit"], 10)
        self.assertEqual(completed_kwargs["notice_ids"], ("351907", "355222"))
        self.assertEqual(completed_kwargs["status"], "completed")
        self.assertIs(completed_kwargs["store"], admission_store)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["batch_id"], "batch-drain-001")
        self.assertEqual(payload["pending_notice_ids"], ["351907", "355222"])
        self.assertEqual(payload["processed_count"], 2)


if __name__ == "__main__":
    unittest.main()
