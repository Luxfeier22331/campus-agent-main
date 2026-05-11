# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from campus_ingestion_worker.release_official_web_selected_write_candidates import (
    _matching_selected_write_candidates,
)
from campus_ingestion_worker.release_official_web_selected_write_common import (
    _candidate_source_ref,
    _evidence,
)

from tests.ingestion.test_release_official_web_selected_write_support import *


class ReleaseOfficialWebSelectedWriteTestPart06(unittest.TestCase):
    def test_rejects_snake_case_machine_field_status_in_release_task_input_ref(self) -> None:
        with TemporaryDirectory() as temp_dir:
            task = _selected_write_task()
            input_ref = dict(task["inputRef"])
            input_ref["field_status"] = input_ref.pop("fieldStatus")
            task = {**task, "inputRef": input_ref}

            with self.assertRaisesRegex(Exception, "fieldStatus"):
                release_official_web_selected_write(
                    release_task=task,
                    object_store=_FakeObjectStore(),
                    derived_object_store=_FakeObjectStore(),
                    projection_reporter=_FakeProjectionReporter(),
                    structured_projection_publisher=_FakeStructuredProjectionPublisher(),
                    work_dir=Path(temp_dir),
                )

    def test_rejects_snake_case_required_fields_in_release_task_input_ref(self) -> None:
        with TemporaryDirectory() as temp_dir:
            task = _selected_write_task()
            input_ref = dict(task["inputRef"])
            input_ref["required_fields"] = input_ref.pop("requiredFields")
            task = {**task, "inputRef": input_ref}

            with self.assertRaisesRegex(Exception, "requiredFields"):
                release_official_web_selected_write(
                    release_task=task,
                    object_store=_FakeObjectStore(),
                    derived_object_store=_FakeObjectStore(),
                    projection_reporter=_FakeProjectionReporter(),
                    structured_projection_publisher=_FakeStructuredProjectionPublisher(),
                    work_dir=Path(temp_dir),
                )

    def test_rejects_snake_case_source_urls_in_release_task_input_ref(self) -> None:
        with TemporaryDirectory() as temp_dir:
            task = _selected_write_task()
            input_ref = dict(task["inputRef"])
            input_ref["source_urls"] = input_ref.pop("sourceUrls")
            task = {**task, "inputRef": input_ref}

            with self.assertRaisesRegex(Exception, "sourceUrls"):
                release_official_web_selected_write(
                    release_task=task,
                    object_store=_FakeObjectStore(),
                    derived_object_store=_FakeObjectStore(),
                    projection_reporter=_FakeProjectionReporter(),
                    structured_projection_publisher=_FakeStructuredProjectionPublisher(),
                    work_dir=Path(temp_dir),
                )

    def test_worker_selected_write_task_requires_canonical_identity_fields(self) -> None:
        replay_report = {
            "consumer_candidate_pages": [
                {
                    "consumer_family": "contact_directory_candidate",
                    "materialization_policy": "candidate_only",
                    "normalized_canonical_url": "https://www.muc.edu.cn/",
                    "quality_gate": {"decision": "pass"},
                    "selected_write_target": "campus_services/contact_directory",
                    "target_job_id": "owtarget_contact",
                    "typed_candidate": {"display_name": "中央民族大学"},
                }
            ]
        }
        selected_write_task = {
            "evidenceJson": {"sourceUrls": ["https://www.muc.edu.cn/"]},
            "inventoryId": "muc-main-homepage-contact",
            "job_id": "owtarget_contact",
            "selected_write_target": "campus_services/contact_directory",
        }

        with self.assertRaisesRegex(Exception, "selectedWriteTarget"):
            _matching_selected_write_candidates(
                replay_report=replay_report,
                selected_write_task=selected_write_task,
            )

    def test_worker_selected_write_task_requires_canonical_job_id(self) -> None:
        replay_report = {
            "consumer_candidate_pages": [
                {
                    "consumer_family": "contact_directory_candidate",
                    "materialization_policy": "candidate_only",
                    "normalized_canonical_url": "https://www.muc.edu.cn/",
                    "quality_gate": {"decision": "pass"},
                    "selected_write_target": "campus_services/contact_directory",
                    "target_job_id": "owtarget_contact",
                    "typed_candidate": {"display_name": "中央民族大学"},
                }
            ]
        }
        selected_write_task = {
            "evidenceJson": {"sourceUrls": ["https://www.muc.edu.cn/"]},
            "inventoryId": "muc-main-homepage-contact",
            "job_id": "owtarget_contact",
            "selectedWriteTarget": "campus_services/contact_directory",
        }

        with self.assertRaisesRegex(Exception, "jobId"):
            _matching_selected_write_candidates(
                replay_report=replay_report,
                selected_write_task=selected_write_task,
            )

    def test_worker_selected_write_task_ignores_legacy_evidence_container(self) -> None:
        self.assertEqual(
            _evidence({"evidence": {"sourceUrls": ["https://www.muc.edu.cn/"]}}),
            {},
        )

    def test_worker_candidate_source_ref_requires_canonical_inventory_id(self) -> None:
        with self.assertRaisesRegex(Exception, "inventoryId"):
            _candidate_source_ref(
                candidate={"raw_version_id": "owver_contact"},
                selected_write_task={"inventory_id": "muc-main-homepage-contact"},
            )


if __name__ == "__main__":
    unittest.main()
