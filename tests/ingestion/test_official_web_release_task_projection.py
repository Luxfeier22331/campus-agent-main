from __future__ import annotations

import json
import unittest
from datetime import UTC, datetime

from campus_ingestion_core.official_web_release_task import build_official_web_release_task
from campus_ingestion_core.official_web_release_task_projection import (
    OFFICIAL_WEB_RELEASE_TASK_REDACTION_VERSION,
    build_official_web_release_task_operator_snapshot,
)


class OfficialWebReleaseTaskProjectionTest(unittest.TestCase):
    def test_operator_snapshot_redacts_object_store_and_raw_payload_fields(self) -> None:
        task = build_official_web_release_task(
            input_ref={
                "bucket": "campus-rag-source",
                "objectKey": "official_web/muc_public/runs/owrun/source-truth-bundle.json",
                "rawHtml": "<html>secret</html>",
                "sourceObjectKeys": [
                    "official_web/muc_public/runs/owrun/source-truth-bundle.json",
                    "official_web/muc_public/runs/owrun/page-manifest.json",
                ],
                "sourceUrls": ["https://www.muc.edu.cn/"],
            },
            inventory_id="muc-main-homepage-contact",
            job_id="owtarget_contact",
            run_id="owrun",
            selected_write_target="campus_services/contact_directory",
            task_id="owrelease_contact",
            task_type="official_web_selected_write_contact_directory",
            now=datetime(2026, 5, 1, 8, 0, tzinfo=UTC),
        ).claim(worker_id="worker-a", lease_seconds=300, now=datetime(2026, 5, 1, 8, 1, tzinfo=UTC))
        task = task.materialize(
            output_ref={
                "artifactObjectKey": "campus_services/releases/contact_directory/current.json",
                "bucket": "campus-rag-derived",
                "recordCount": 3,
                "releaseId": "release_contact",
            },
            worker_id="worker-a",
            now=datetime(2026, 5, 1, 8, 2, tzinfo=UTC),
        )

        snapshot = build_official_web_release_task_operator_snapshot(
            task,
            projected_at="2026-05-01T08:03:00+00:00",
        )

        self.assertEqual(snapshot["schemaVersion"], "official_web_release_task_projection.v1")
        self.assertEqual(snapshot["id"], "owrelease_contact")
        self.assertEqual(snapshot["taskId"], "owrelease_contact")
        self.assertEqual(snapshot["taskType"], "official_web_selected_write_contact_directory")
        self.assertEqual(snapshot["inventoryId"], "muc-main-homepage-contact")
        self.assertEqual(snapshot["jobId"], "owtarget_contact")
        self.assertEqual(snapshot["runId"], "owrun")
        self.assertEqual(snapshot["selectedWriteTarget"], "campus_services/contact_directory")
        self.assertEqual(snapshot["lifecycleStatus"], "materialized")
        self.assertEqual(snapshot["latestStage"], "materialized")
        self.assertEqual(snapshot["attemptCount"], 1)
        self.assertEqual(snapshot["redactionVersion"], OFFICIAL_WEB_RELEASE_TASK_REDACTION_VERSION)
        self.assertEqual(snapshot["inputSummary"]["sourceObjectCount"], 2)
        self.assertEqual(snapshot["inputSummary"]["sourceUrls"], ["https://www.muc.edu.cn/"])
        self.assertEqual(snapshot["outputSummary"]["releaseId"], "release_contact")
        self.assertEqual(snapshot["outputSummary"]["recordCount"], 3)

        encoded = json.dumps(snapshot, ensure_ascii=False)
        self.assertNotIn("source-truth-bundle.json", encoded)
        self.assertNotIn("campus-rag-source", encoded)
        self.assertNotIn("campus-rag-derived", encoded)
        self.assertNotIn("rawHtml", encoded)
        self.assertNotIn("artifactObjectKey", encoded)


if __name__ == "__main__":
    unittest.main()
