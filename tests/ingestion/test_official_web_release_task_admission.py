from __future__ import annotations

import unittest
from datetime import UTC, datetime

from campus_ingestion_core.official_web_release_task_admission import (
    build_selected_write_release_task_from_candidate,
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

    def test_builds_selected_write_release_task_only_after_machine_field_review(self) -> None:
        task = build_selected_write_release_task_from_candidate(
            {
                "candidate_key": "owcand_contact_ready",
                "field_status": {
                    "email": "source_not_provided",
                    "location": "present",
                    "office_hours": "source_not_provided",
                    "organization_name": "present",
                    "phone": "present",
                    "source_url": "present",
                    "source_version_evidence": "present",
                },
                "inventory_id": "muc-main-homepage-contact",
                "matched_evidence": ["phone", "location"],
                "normalized_canonical_url": "https://www.muc.edu.cn/",
                "ready_for_selected_write": True,
                "optional_evidence": ["email", "location", "office_hours"],
                "optional_fields": ["email", "location", "office_hours"],
                "required_evidence": ["phone"],
                "required_fields": [
                    "organization_name",
                    "phone",
                    "source_url",
                    "source_version_evidence",
                ],
                "review_verdict": "pending_review",
                "selected_write_target": "campus_services/contact_directory",
                "source_ref": {
                    "raw_asset_id": "owasset_contact",
                    "raw_version_id": "owver_contact",
                    "normalized_canonical_url": "https://www.muc.edu.cn/",
                },
                "target_job_id": "owtarget_contact",
                "typed_candidate_schema_version": "official_web_contact_directory_candidate.v1",
            },
            run_id="owrun_contact",
            source_object_keys=[
                "official_web/muc_public/runs/owrun_contact/source-truth-bundle.json"
            ],
            now=datetime(2026, 5, 2, 8, 0, tzinfo=UTC),
        )

        self.assertEqual(task.task_type, "official_web_selected_write_contact_directory")
        self.assertEqual(task.inventory_id, "muc-main-homepage-contact")
        self.assertEqual(task.input_ref["fieldStatus"]["phone"], "present")
        self.assertEqual(task.input_ref["fieldStatus"]["email"], "source_not_provided")
        self.assertEqual(
            task.input_ref["policyVersion"],
            "official_web_selected_write_release_task_admission.v4",
        )
        self.assertEqual(
            task.input_ref["requiredEvidence"],
            ["phone"],
        )
        self.assertEqual(
            task.input_ref["optionalEvidence"],
            ["email", "location", "office_hours"],
        )

    def test_rejects_selected_write_release_task_without_field_review(self) -> None:
        with self.assertRaisesRegex(ValueError, "field_status"):
            build_selected_write_release_task_from_candidate(
                {
                    "candidate_key": "owcand_contact_ready",
                    "inventory_id": "muc-main-homepage-contact",
                    "normalized_canonical_url": "https://www.muc.edu.cn/",
                    "ready_for_selected_write": True,
                    "selected_write_target": "campus_services/contact_directory",
                    "source_ref": {
                        "raw_asset_id": "owasset_contact",
                        "raw_version_id": "owver_contact",
                        "normalized_canonical_url": "https://www.muc.edu.cn/",
                    },
                    "target_job_id": "owtarget_contact",
                },
                run_id="owrun_contact",
                source_object_keys=[
                    "official_web/muc_public/runs/owrun_contact/source-truth-bundle.json"
                ],
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
