from __future__ import annotations

import unittest
from datetime import UTC, datetime, timedelta

from campus_ingestion_core.official_web_release_task import (
    OfficialWebReleaseTask,
    build_official_web_release_task,
)


class OfficialWebReleaseTaskStateTest(unittest.TestCase):
    def test_claim_running_and_publish_clear_the_lease(self) -> None:
        now = datetime(2026, 5, 1, 8, 0, tzinfo=UTC)
        task = build_official_web_release_task(
            input_ref={
                "sourceObjectKeys": ["official_web/muc_public/runs/owrun/source-truth-bundle.json"],
                "sourceUrls": ["https://www.muc.edu.cn/"],
            },
            inventory_id="muc-main-homepage-contact",
            job_id="owtarget_contact",
            run_id="owrun",
            task_id="owtask_contact",
            task_type="official_web_selected_write_contact_directory",
            now=now,
        )

        claimed = task.claim(worker_id="worker-a", lease_seconds=300, now=now)
        running = claimed.mark_running(worker_id="worker-a", now=now + timedelta(seconds=1))
        published = running.publish(
            output_ref={"releaseId": "release_contact"},
            worker_id="worker-a",
            now=now + timedelta(seconds=2),
        )

        self.assertEqual(claimed.status, "claimed")
        self.assertEqual(claimed.attempt_count, 1)
        self.assertEqual(running.status, "running")
        self.assertEqual(published.status, "published")
        self.assertEqual(published.lease_owner, "")
        self.assertIsNone(published.lease_expires_at)
        self.assertEqual(published.output_ref["releaseId"], "release_contact")

    def test_non_owner_cannot_update_claimed_task(self) -> None:
        task = OfficialWebReleaseTask.from_payload(
            {
                "attemptCount": 1,
                "createdAt": "2026-05-01T08:00:00+00:00",
                "inputRef": {
                    "sourceObjectKeys": [
                        "official_web/muc_public/runs/owrun/source-truth-bundle.json"
                    ]
                },
                "inventoryId": "muc-main-homepage-contact",
                "jobId": "owtarget_contact",
                "leaseExpiresAt": "2026-05-01T08:05:00+00:00",
                "leaseOwner": "worker-a",
                "maxAttempts": 3,
                "runId": "owrun",
                "status": "claimed",
                "taskId": "owtask_contact",
                "taskType": "official_web_selected_write_contact_directory",
                "updatedAt": "2026-05-01T08:00:00+00:00",
            }
        )

        with self.assertRaisesRegex(ValueError, "not leased by this worker"):
            task.mark_running(
                worker_id="worker-b",
                now=datetime(2026, 5, 1, 8, 1, tzinfo=UTC),
            )

    def test_retryable_failure_dead_letters_after_max_attempts(self) -> None:
        now = datetime(2026, 5, 1, 8, 0, tzinfo=UTC)
        task = OfficialWebReleaseTask.from_payload(
            {
                "attemptCount": 3,
                "createdAt": "2026-05-01T08:00:00+00:00",
                "inputRef": {
                    "sourceObjectKeys": [
                        "official_web/muc_public/runs/owrun/source-truth-bundle.json"
                    ]
                },
                "inventoryId": "muc-main-homepage-contact",
                "jobId": "owtarget_contact",
                "leaseExpiresAt": "2026-05-01T08:05:00+00:00",
                "leaseOwner": "worker-a",
                "maxAttempts": 3,
                "runId": "owrun",
                "status": "running",
                "taskId": "owtask_contact",
                "taskType": "official_web_selected_write_contact_directory",
                "updatedAt": "2026-05-01T08:00:00+00:00",
            }
        )

        failed = task.fail_retryable(
            error_code="projection_failed",
            error_message="projection failed",
            worker_id="worker-a",
            now=now,
        )

        self.assertEqual(failed.status, "failed_terminal")
        self.assertEqual(failed.last_error_code, "projection_failed")


if __name__ == "__main__":
    unittest.main()
