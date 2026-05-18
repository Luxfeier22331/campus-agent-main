from __future__ import annotations

import importlib
import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import patch

worker = importlib.import_module("campus_ingestion_worker.show_collected_notice_ingest_queue")


class _FakeStore:
    def list_status_counts(self) -> dict[str, int]:
        return {
            "queued": 2,
            "leased": 1,
            "succeeded": 3,
            "failed_retryable": 0,
            "failed_terminal": 1,
            "dead_letter": 1,
            "manual_review": 2,
            "blocked": 1,
            "cancelled": 1,
        }

    def operator_summary(self) -> dict[str, object]:
        return {
            "oldest_pending_age_seconds": 3600,
            "retry_due_count": 4,
            "manual_review_reason_counts": {"media_gate_requires_manual_review": 2},
            "dead_letter_reason_counts": {"source_object_unavailable": 1},
        }


class ShowCollectedNoticeIngestQueueWorkerTest(unittest.TestCase):
    def test_main_prints_read_only_queue_status_counts(self) -> None:
        stdout = StringIO()

        with (
            patch("campus_ingestion_worker.show_collected_notice_ingest_queue.load_worker_env"),
            patch(
                "campus_ingestion_worker.show_collected_notice_ingest_queue."
                "build_notice_ingest_queue_store_from_env",
                return_value=_FakeStore(),
            ) as build_store,
            redirect_stdout(stdout),
        ):
            worker.main(["--json"])

        build_store.assert_called_once()
        payload = json.loads(stdout.getvalue())
        self.assertEqual(payload["queue"], "notice_ingest")
        self.assertFalse(payload["write_enabled"])
        self.assertEqual(payload["status_counts"]["queued"], 2)
        self.assertEqual(payload["status_counts"]["dead_letter"], 1)
        self.assertEqual(payload["status_counts"]["manual_review"], 2)
        self.assertEqual(payload["operator_summary"]["retry_due_count"], 4)
        self.assertEqual(
            payload["operator_summary"]["manual_review_reason_counts"],
            {"media_gate_requires_manual_review": 2},
        )


if __name__ == "__main__":
    unittest.main()
