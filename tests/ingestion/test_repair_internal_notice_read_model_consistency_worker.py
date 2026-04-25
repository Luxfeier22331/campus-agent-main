from __future__ import annotations

import importlib
import io
import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.internal_notice_read_model import (
    InternalNoticeReadModelConsistencyReport,
    InternalNoticeReadModelRepairReport,
)

worker = importlib.import_module(
    "campus_ingestion_worker.repair_internal_notice_read_model_consistency"
)


class RepairInternalNoticeReadModelConsistencyWorkerCliTest(unittest.TestCase):
    def test_main_repairs_selected_notice_ids_and_records_admission(self) -> None:
        report = InternalNoticeReadModelRepairReport(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            selected_notice_ids=("355222",),
            before=InternalNoticeReadModelConsistencyReport(
                source_corpus="campus_notices",
                source_collection="internal_notice",
                selected_notice_ids=("355222",),
                projection_entry_count=2,
                projection_queryable_count=1,
                read_model_entry_count=0,
                missing_queryable_projection_unit_ids=("notice_unit:355222:procurement",),
                extra_read_model_unit_ids=(),
                ok=False,
            ),
            after=InternalNoticeReadModelConsistencyReport(
                source_corpus="campus_notices",
                source_collection="internal_notice",
                selected_notice_ids=("355222",),
                projection_entry_count=2,
                projection_queryable_count=1,
                read_model_entry_count=1,
                missing_queryable_projection_unit_ids=(),
                extra_read_model_unit_ids=(),
                ok=True,
            ),
            rebuilt_count=1,
        )
        admission_store = object()

        with (
            patch(
                "campus_ingestion_worker.repair_internal_notice_read_model_consistency.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.repair_internal_notice_read_model_consistency.repair_internal_notice_read_model_consistency",
                return_value=report,
            ) as repair,
            patch(
                "campus_ingestion_worker.repair_internal_notice_read_model_consistency.build_internal_notice_consumption_admission_store_from_env",
                return_value=admission_store,
            ) as build_admission_store,
            patch(
                "campus_ingestion_worker.repair_internal_notice_read_model_consistency.record_internal_notice_consumption_admission",
                return_value="batch-repair-001",
            ) as record_admission,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(["--notice-id", "355222"])

        self.assertEqual(repair.call_args.kwargs["notice_ids"], ("355222",))
        build_admission_store.assert_called_once()
        self.assertEqual(record_admission.call_count, 2)
        started_kwargs = record_admission.call_args_list[0].kwargs
        completed_kwargs = record_admission.call_args_list[1].kwargs
        self.assertEqual(started_kwargs["command"], "read_model_repair")
        self.assertEqual(started_kwargs["status"], "started")
        self.assertEqual(started_kwargs["selection_source"], "explicit_notice_ids")
        self.assertIs(started_kwargs["store"], admission_store)
        self.assertEqual(completed_kwargs["status"], "completed")
        self.assertEqual(completed_kwargs["batch_id"], "batch-repair-001")
        self.assertEqual(completed_kwargs["result_counts"], {"rebuilt_count": 1})
        self.assertIs(completed_kwargs["store"], admission_store)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["batch_id"], "batch-repair-001")
        self.assertEqual(payload["rebuilt_count"], 1)
        self.assertTrue(payload["after"]["ok"])

    def test_main_records_failed_admission_when_repair_fails(self) -> None:
        admission_store = object()

        with (
            patch(
                "campus_ingestion_worker.repair_internal_notice_read_model_consistency.load_worker_env"
            ),
            patch(
                "campus_ingestion_worker.repair_internal_notice_read_model_consistency.repair_internal_notice_read_model_consistency",
                side_effect=RuntimeError("repair failed"),
            ),
            patch(
                "campus_ingestion_worker.repair_internal_notice_read_model_consistency.build_internal_notice_consumption_admission_store_from_env",
                return_value=admission_store,
            ),
            patch(
                "campus_ingestion_worker.repair_internal_notice_read_model_consistency.record_internal_notice_consumption_admission",
                side_effect=("batch-repair-001", "batch-repair-001"),
            ) as record_admission,
            self.assertRaisesRegex(RuntimeError, "repair failed"),
        ):
            worker.main(["--notice-id", "355222"])

        self.assertEqual(record_admission.call_count, 2)
        failed_kwargs = record_admission.call_args_list[1].kwargs
        self.assertEqual(failed_kwargs["status"], "failed")
        self.assertEqual(failed_kwargs["batch_id"], "batch-repair-001")
        self.assertEqual(failed_kwargs["error"], "repair failed")
        self.assertIs(failed_kwargs["store"], admission_store)


if __name__ == "__main__":
    unittest.main()
