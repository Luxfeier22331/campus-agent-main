from __future__ import annotations

import unittest

from campus_ingestion_core.authenticated_notice_child_tasks import (
    AUTHENTICATED_NOTICE_CHILD_TASK_CONTRACT_SCHEMA_VERSION,
    build_child_task,
    build_progress_event,
    summarize_child_tasks,
)


class AuthenticatedNoticeChildTasksTest(unittest.TestCase):
    def test_child_task_identity_is_deterministic_and_operator_safe(self) -> None:
        task = build_child_task(
            parent_job_id="job-001",
            run_id="run-001",
            task_kind="ocr_table_extraction",
            processor_profile_id="image_schedule_notice",
            state="completed",
            source_unit_id="notice:muc_internal_portal:355867",
            media_ref_id="inline-image-1",
            attempt_ordinal=1,
            reason_code="ocr_table_rows_extracted",
            input_refs=[{"role": "source_object", "sha256": "a" * 64}],
            output_refs=[{"role": "normalized_output", "sha256": "b" * 64}],
        )
        same_task = build_child_task(
            parent_job_id="job-001",
            run_id="run-001",
            task_kind="ocr_table_extraction",
            processor_profile_id="image_schedule_notice",
            state="completed",
            source_unit_id="notice:muc_internal_portal:355867",
            media_ref_id="inline-image-1",
            attempt_ordinal=1,
        )

        self.assertEqual(
            task["schema_version"],
            AUTHENTICATED_NOTICE_CHILD_TASK_CONTRACT_SCHEMA_VERSION,
        )
        self.assertEqual(task["task_id"], same_task["task_id"])
        self.assertNotIn("raw_html", task)
        self.assertNotIn("ocr_payload", task)
        self.assertEqual(task["state"], "completed")
        self.assertEqual(task["processor_profile_id"], "image_schedule_notice")

    def test_progress_event_and_summary_expose_blocked_child_task(self) -> None:
        completed = build_child_task(
            parent_job_id="job-001",
            run_id="run-001",
            task_kind="source_unit_import",
            processor_profile_id="text_notice",
            state="completed",
            reason_code="source_truth_imported",
        )
        manual_review = build_child_task(
            parent_job_id="job-001",
            run_id="run-001",
            task_kind="downstream_materialization",
            processor_profile_id="mixed_notice",
            state="manual_review",
            reason_code="downstream_materialization_missing",
        )
        event = build_progress_event(
            parent_job_id="job-001",
            run_id="run-001",
            child_task_id=manual_review["task_id"],
            stage="downstream_materialization",
            transition="manual_review",
            reason_code="downstream_materialization_missing",
            message="downstream materialization evidence is missing",
        )
        summary = summarize_child_tasks([completed, manual_review])

        self.assertEqual(summary["highest_severity"], "medium")
        self.assertEqual(summary["blocked_child_task_id"], manual_review["task_id"])
        self.assertEqual(summary["by_state"]["manual_review"], 1)
        self.assertEqual(event["reason_code"], "downstream_materialization_missing")
        self.assertNotIn("raw_message", event)


if __name__ == "__main__":
    unittest.main()
