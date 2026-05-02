from __future__ import annotations

import unittest
from datetime import UTC, datetime

from campus_ingestion_core.official_web_release_task_admission import (
    build_stable_reference_release_task_from_gate,
)
from campus_ingestion_core.official_web_release_task_store import (
    InMemoryOfficialWebReleaseTaskStore,
)
from campus_ingestion_worker.admit_official_web_release_gate import (
    admit_official_web_release_gate,
)


class OfficialWebReleaseTaskAdmissionTest(unittest.TestCase):
    def test_worker_admits_approved_stable_reference_gate_into_task_store(self) -> None:
        store = InMemoryOfficialWebReleaseTaskStore()

        report = admit_official_web_release_gate(
            release_gate=_approved_gate(),
            release_task_store=store,
        )

        self.assertEqual(report["admitted_count"], 1)
        task = store.get_task("owrelease_school_intro")
        self.assertIsNotNone(task)
        self.assertEqual(task.task_type if task else "", "official_web_stable_reference")
        self.assertEqual(task.status if task else "", "queued")

    def test_builds_stable_reference_release_task_from_approved_gate(self) -> None:
        task = build_stable_reference_release_task_from_gate(
            _approved_gate(),
            now=datetime(2026, 5, 2, 8, 0, tzinfo=UTC),
        )

        self.assertEqual(task.task_id, "owrelease_school_intro")
        self.assertEqual(task.task_type, "official_web_stable_reference")
        self.assertEqual(task.status, "queued")
        self.assertEqual(task.inventory_id, "muc-school-introduction-reference")
        self.assertEqual(task.job_id, "owtarget_school_intro")
        self.assertEqual(task.run_id, "owrun_001")
        self.assertEqual(task.selected_write_target, "official_web/stable_reference")
        self.assertFalse(task.publish_alias)
        self.assertEqual(
            task.input_ref["sourceObjectKeys"],
            ["official_web/muc_public/runs/owrun_001/source-truth-bundle.json"],
        )

    def test_rejects_unapproved_or_non_stable_reference_gate(self) -> None:
        with self.assertRaisesRegex(ValueError, "approved"):
            build_stable_reference_release_task_from_gate(
                {
                    "decision": "rejected",
                    "evidenceJson": {
                        "selectedWriteTarget": "official_web/stable_reference",
                        "sourceObjectKeys": ["official_web/run/source-truth-bundle.json"],
                    },
                    "inventoryId": "muc-school-introduction-reference",
                    "jobId": "owtarget_school_intro",
                    "releaseId": "owrelease_school_intro",
                    "runId": "owrun_001",
                    "status": "rejected",
                }
            )

        with self.assertRaisesRegex(ValueError, "stable-reference"):
            build_stable_reference_release_task_from_gate(
                {
                    "decision": "approved",
                    "evidenceJson": {
                        "selectedWriteTarget": "campus_services/contact_directory",
                        "sourceObjectKeys": ["official_web/run/source-truth-bundle.json"],
                    },
                    "inventoryId": "muc-contact",
                    "jobId": "owtarget_contact",
                    "releaseId": "owrelease_contact",
                    "runId": "owrun_001",
                    "status": "approved",
                }
            )


def _approved_gate() -> dict[str, object]:
    return {
        "decision": "approved",
        "evidenceJson": {
            "selectedWriteTarget": "official_web/stable_reference",
            "sourceObjectKeys": ["official_web/muc_public/runs/owrun_001/source-truth-bundle.json"],
            "sourceUrls": ["https://www.muc.edu.cn/xxgk1/xxjj.htm"],
        },
        "inventoryId": "muc-school-introduction-reference",
        "jobId": "owtarget_school_intro",
        "publishAlias": False,
        "releaseId": "owrelease_school_intro",
        "runId": "owrun_001",
        "status": "approved",
    }


if __name__ == "__main__":
    unittest.main()
