from __future__ import annotations

import importlib
import io
import json
import tempfile
import unittest
from hashlib import sha256
from pathlib import Path
from unittest.mock import patch

from campus_ingestion_core.internal_notice_multimodal_processing import (
    InternalNoticeMultimodalProcessingReport,
)

worker = importlib.import_module("campus_ingestion_worker.process_internal_notice_multimodal")


class ProcessInternalNoticeMultimodalWorkerCliTest(unittest.TestCase):
    def test_main_refuses_implicit_full_scope_processing(self) -> None:
        with (
            patch("campus_ingestion_worker.process_internal_notice_multimodal.load_worker_env"),
            patch(
                "campus_ingestion_worker.process_internal_notice_multimodal.process_internal_notice_pending_multimodal_entries"
            ) as process,
            patch("sys.stderr", new_callable=io.StringIO),
            self.assertRaises(SystemExit),
        ):
            worker.main([])

        process.assert_not_called()

    def test_main_processes_selected_notice_ids(self) -> None:
        report = InternalNoticeMultimodalProcessingReport(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            selected_notice_ids=("351907",),
            projection_entry_count=2,
            pending_entry_count=1,
            processed_count=1,
            retained_for_notice_query_count=1,
            no_adoption_count=0,
            still_pending_count=0,
            failed_count=0,
            item_reports=(),
        )
        admission_store = object()

        with (
            patch("campus_ingestion_worker.process_internal_notice_multimodal.load_worker_env"),
            patch(
                "campus_ingestion_worker.process_internal_notice_multimodal.process_internal_notice_pending_multimodal_entries",
                return_value=report,
            ) as process,
            patch(
                "campus_ingestion_worker.process_internal_notice_multimodal.rebuild_internal_notice_read_model",
                return_value=(),
            ) as rebuild_read_model,
            patch(
                "campus_ingestion_worker.process_internal_notice_multimodal.record_internal_notice_consumption_admission",
                side_effect=("batch-multimodal-001", "batch-multimodal-001"),
            ) as record_admission,
            patch(
                "campus_ingestion_worker.process_internal_notice_multimodal.build_internal_notice_multimodal_attempt_store_from_env",
                return_value=object(),
            ) as build_attempt_store,
            patch(
                "campus_ingestion_worker.process_internal_notice_multimodal.build_internal_notice_consumption_admission_store_from_env",
                return_value=admission_store,
            ) as build_admission_store,
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(["--notice-id", "351907"])

        self.assertEqual(process.call_args.kwargs["notice_ids"], ("351907",))
        self.assertEqual(
            process.call_args.kwargs["admission_batch_id"],
            "batch-multimodal-001",
        )
        self.assertEqual(
            process.call_args.kwargs["admission_command"],
            "multimodal_process",
        )
        self.assertEqual(rebuild_read_model.call_args.kwargs["notice_ids"], ("351907",))
        build_admission_store.assert_called_once()
        build_attempt_store.assert_called_once_with(prefer_operator=True)
        self.assertEqual(record_admission.call_count, 2)
        started_kwargs = record_admission.call_args_list[0].kwargs
        completed_kwargs = record_admission.call_args_list[1].kwargs
        self.assertEqual(started_kwargs["command"], "multimodal_process")
        self.assertEqual(started_kwargs["notice_ids"], ("351907",))
        self.assertEqual(started_kwargs["status"], "started")
        self.assertEqual(started_kwargs["selection_source"], "explicit_notice_ids")
        self.assertEqual(started_kwargs["command_args"]["max_attempts"], 3)
        self.assertFalse(started_kwargs["command_args"]["skip_read_model_rebuild"])
        self.assertIs(started_kwargs["store"], admission_store)
        self.assertEqual(completed_kwargs["status"], "completed")
        self.assertEqual(completed_kwargs["batch_id"], "batch-multimodal-001")
        self.assertEqual(completed_kwargs["selection_source"], "explicit_notice_ids")
        self.assertIs(completed_kwargs["store"], admission_store)
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["batch_id"], "batch-multimodal-001")
        self.assertEqual(payload["processed_count"], 1)
        self.assertEqual(payload["retained_for_notice_query_count"], 1)
        self.assertEqual(payload["read_model_rebuilt_count"], 0)

    def test_main_merges_notice_ids_from_selection_path(self) -> None:
        report = InternalNoticeMultimodalProcessingReport(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            selected_notice_ids=("351907", "355222"),
            projection_entry_count=0,
            pending_entry_count=0,
            processed_count=0,
            retained_for_notice_query_count=0,
            no_adoption_count=0,
            still_pending_count=0,
            failed_count=0,
            item_reports=(),
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            selection_path = Path(temp_dir) / "selected-notices.json"
            selection_path.write_text(
                json.dumps({"selected_notice_ids": ["351907", "355222", "351907"]}),
                encoding="utf-8",
            )
            expected_sha256 = sha256(selection_path.read_bytes()).hexdigest()
            with (
                patch("campus_ingestion_worker.process_internal_notice_multimodal.load_worker_env"),
                patch(
                    "campus_ingestion_worker.process_internal_notice_multimodal.process_internal_notice_pending_multimodal_entries",
                    return_value=report,
                ) as process,
                patch(
                    "campus_ingestion_worker.process_internal_notice_multimodal.rebuild_internal_notice_read_model",
                    return_value=(),
                ),
                patch(
                    "campus_ingestion_worker.process_internal_notice_multimodal.build_internal_notice_consumption_admission_store_from_env"
                ),
                patch(
                    "campus_ingestion_worker.process_internal_notice_multimodal.build_internal_notice_multimodal_attempt_store_from_env"
                ),
                patch(
                    "campus_ingestion_worker.process_internal_notice_multimodal.record_internal_notice_consumption_admission",
                    side_effect=("batch-multimodal-001", "batch-multimodal-001"),
                ) as record_admission,
                patch("sys.stdout", new_callable=io.StringIO),
            ):
                worker.main(["--notice-id", "355222", "--selection-path", str(selection_path)])

        self.assertEqual(process.call_args.kwargs["notice_ids"], ("351907", "355222"))
        started_kwargs = record_admission.call_args_list[0].kwargs
        self.assertEqual(
            started_kwargs["selection_source"],
            "explicit_notice_ids+selection_path",
        )
        self.assertEqual(started_kwargs["selection_path"], str(selection_path))
        self.assertEqual(started_kwargs["selection_sha256"], expected_sha256)

    def test_main_can_skip_read_model_rebuild(self) -> None:
        report = InternalNoticeMultimodalProcessingReport(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            selected_notice_ids=("351907",),
            projection_entry_count=1,
            pending_entry_count=1,
            processed_count=1,
            retained_for_notice_query_count=1,
            no_adoption_count=0,
            still_pending_count=0,
            failed_count=0,
            item_reports=(),
        )

        with (
            patch("campus_ingestion_worker.process_internal_notice_multimodal.load_worker_env"),
            patch(
                "campus_ingestion_worker.process_internal_notice_multimodal.process_internal_notice_pending_multimodal_entries",
                return_value=report,
            ),
            patch(
                "campus_ingestion_worker.process_internal_notice_multimodal.rebuild_internal_notice_read_model"
            ) as rebuild_read_model,
            patch(
                "campus_ingestion_worker.process_internal_notice_multimodal.build_internal_notice_consumption_admission_store_from_env"
            ),
            patch(
                "campus_ingestion_worker.process_internal_notice_multimodal.record_internal_notice_consumption_admission",
                side_effect=("batch-multimodal-001", "batch-multimodal-001"),
            ),
            patch(
                "campus_ingestion_worker.process_internal_notice_multimodal.build_internal_notice_multimodal_attempt_store_from_env"
            ),
            patch("sys.stdout", new_callable=io.StringIO) as stdout,
        ):
            worker.main(["--notice-id", "351907", "--skip-read-model-rebuild"])

        rebuild_read_model.assert_not_called()
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["read_model_rebuilt_count"], 0)


if __name__ == "__main__":
    unittest.main()
