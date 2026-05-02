from __future__ import annotations

import json
import unittest
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_worker.release_official_web_selected_write import (
    release_official_web_selected_write,
)


class _FakeObjectStore:
    def __init__(self, objects: dict[tuple[str, str], bytes] | None = None) -> None:
        self.objects = dict(objects or {})

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.objects[(bucket, key)] = data


class _FakeProjectionReporter:
    def __init__(self) -> None:
        self.snapshots: list[dict[str, object]] = []

    def report(self, *, snapshot: dict[str, object]) -> None:
        self.snapshots.append(snapshot)


@dataclass(frozen=True)
class _PublishReport:
    corpus: str
    collection: str
    release_id: str
    schema_version: str
    current: bool
    counts: dict[str, int]


class _FakeStructuredProjectionPublisher:
    def __init__(self) -> None:
        self.published: list[dict[str, object]] = []

    def publish_release(self, **kwargs: object) -> _PublishReport:
        self.published.append(dict(kwargs))
        return _PublishReport(
            corpus=str(kwargs["corpus"]),
            collection=str(kwargs["collection"]),
            release_id=str(kwargs["release_id"]),
            schema_version=str(kwargs["schema_version"]),
            current=True,
            counts={"records": 1},
        )


def _selected_write_task(
    *,
    selected_write_target: str = "campus_services/contact_directory",
) -> dict[str, object]:
    task_type = (
        "official_web_selected_write_service_guide"
        if selected_write_target == "campus_services/service_guide"
        else "official_web_selected_write_contact_directory"
    )
    input_ref: dict[str, object]
    if selected_write_target == "campus_services/service_guide":
        input_ref = {
            "fieldStatus": {
                "process_steps": "present",
                "required_materials": "source_not_provided",
                "service_entry": "source_not_provided",
                "service_material": "source_not_provided",
                "service_name": "present",
                "service_process": "present",
                "source_url": "present",
                "source_version_evidence": "present",
            },
            "optionalEvidence": ["service_entry", "service_material"],
            "optionalFields": ["service_entry", "required_materials", "service_material"],
            "policyVersion": "official_web_selected_write_admission.v1",
            "requiredEvidence": ["service_process"],
            "requiredFields": [
                "service_name",
                "process_steps",
                "source_url",
                "source_version_evidence",
                "service_process",
            ],
            "sourceObjectKeys": [
                "official_web/muc_public/runs/owrun_contact/source-truth-bundle.json"
            ],
            "sourceUrls": ["https://www.muc.edu.cn/"],
        }
    else:
        input_ref = {
            "fieldStatus": {
                "email": "source_not_provided",
                "location": "present",
                "office_hours": "source_not_provided",
                "organization_name": "present",
                "phone": "present",
                "source_url": "present",
                "source_version_evidence": "present",
            },
            "optionalEvidence": ["email", "location", "office_hours"],
            "optionalFields": ["email", "location", "office_hours"],
            "policyVersion": "official_web_selected_write_admission.v1",
            "requiredEvidence": ["phone"],
            "requiredFields": [
                "organization_name",
                "phone",
                "source_url",
                "source_version_evidence",
            ],
            "sourceObjectKeys": [
                "official_web/muc_public/runs/owrun_contact/source-truth-bundle.json"
            ],
            "sourceUrls": ["https://www.muc.edu.cn/"],
        }
    return {
        "createdAt": "2026-05-01T08:00:00+00:00",
        "inputRef": input_ref,
        "inventoryId": "muc-main-homepage-contact",
        "jobId": "owtarget_contact",
        "runId": "owrun_contact",
        "selectedWriteId": "owselected_muc_main_homepage_contact_owrun_contact",
        "selectedWriteTarget": selected_write_target,
        "status": "claimed",
        "taskId": "owselected_muc_main_homepage_contact_owrun_contact",
        "taskType": task_type,
        "updatedAt": "2026-05-01T08:00:00+00:00",
    }


class ReleaseOfficialWebSelectedWriteTest(unittest.TestCase):
    def test_releases_contact_directory_candidate_to_structured_projection(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_store = _FakeObjectStore(
                {
                    (
                        "campus-rag-source",
                        "official_web/muc_public/runs/owrun_contact/source-truth-bundle.json",
                    ): json.dumps(
                        {
                            "pages": [],
                            "runId": "owrun_contact",
                            "siteId": "muc_public",
                        }
                    ).encode("utf-8")
                }
            )
            reporter = _FakeProjectionReporter()
            publisher = _FakeStructuredProjectionPublisher()

            def fake_replay(**_: object) -> dict[str, object]:
                return {
                    "consumer_candidate_pages": [
                        {
                            "consumer_family": "contact_directory_candidate",
                            "materialization_policy": "candidate_only",
                            "normalized_canonical_url": "https://www.muc.edu.cn/",
                            "quality_gate": {"decision": "pass"},
                            "raw_asset_id": "owasset_contact",
                            "raw_version_id": "owver_contact",
                            "selected_write_target": "campus_services/contact_directory",
                            "target_job_id": "owtarget_contact",
                            "typed_candidate": {
                                "display_name": "中央民族大学",
                                "emails": [],
                                "locations": ["海淀校区：北京市海淀区中关村南大街27号"],
                                "phones": ["010-68932442"],
                                "source_title": "中央民族大学",
                                "source_url": "https://www.muc.edu.cn/",
                            },
                            "typed_candidate_schema_version": (
                                "official_web_contact_directory_candidate.v1"
                            ),
                        },
                        {
                            "consumer_family": "contact_directory_candidate",
                            "materialization_policy": "candidate_only",
                            "normalized_canonical_url": "https://www.muc.edu.cn/other.htm",
                            "quality_gate": {"decision": "pass"},
                            "raw_asset_id": "owasset_other",
                            "raw_version_id": "owver_other",
                            "selected_write_target": "campus_services/contact_directory",
                            "target_job_id": "owtarget_other",
                            "typed_candidate": {"display_name": "其他"},
                            "typed_candidate_schema_version": (
                                "official_web_contact_directory_candidate.v1"
                            ),
                        },
                    ]
                }

            with (
                patch(
                    "campus_ingestion_worker.release_official_web_selected_write.materialize_replay_input"
                ),
                patch(
                    "campus_ingestion_worker.release_official_web_selected_write.replay_official_web_source_truth_local",
                    side_effect=fake_replay,
                ),
            ):
                result = release_official_web_selected_write(
                    release_task=_selected_write_task(),
                    object_store=object_store,
                    derived_object_store=object_store,
                    projection_reporter=reporter,
                    structured_projection_publisher=publisher,
                    work_dir=root / "selected-write",
                )

            self.assertEqual(result.status, "published")
            self.assertEqual(result.collection, "contact_directory")
            self.assertEqual(result.record_count, 1)
            self.assertEqual(
                [snapshot["status"] for snapshot in reporter.snapshots],
                ["running", "materialized", "published"],
            )
            self.assertEqual(publisher.published[0]["collection"], "contact_directory")
            current_key = "campus_services/releases/contact_directory/current/contact-directory-projection.json"
            bundle = json.loads(object_store.objects[("campus-rag-derived", current_key)])
            self.assertEqual(bundle["contact_records"][0]["display_name"], "中央民族大学")
            self.assertEqual(bundle["contact_records"][0]["phones"][0]["number"], "010-68932442")

    def test_fails_closed_for_unqueued_auto_admitted_selected_write_task(self) -> None:
        with TemporaryDirectory() as temp_dir:
            task = {**_selected_write_task(), "status": "queued"}
            with self.assertRaisesRegex(
                Exception, "selected-write release task must already be claimed or running"
            ):
                release_official_web_selected_write(
                    release_task=task,
                    object_store=_FakeObjectStore(),
                    derived_object_store=_FakeObjectStore(),
                    projection_reporter=_FakeProjectionReporter(),
                    structured_projection_publisher=_FakeStructuredProjectionPublisher(),
                    work_dir=Path(temp_dir),
                )

    def test_fails_closed_for_operator_blocked_selected_write_task(self) -> None:
        with TemporaryDirectory() as temp_dir:
            task = {**_selected_write_task(), "taskType": "official_web_stable_reference"}
            with self.assertRaisesRegex(Exception, "unsupported selected-write release task type"):
                release_official_web_selected_write(
                    release_task=task,
                    object_store=_FakeObjectStore(),
                    derived_object_store=_FakeObjectStore(),
                    projection_reporter=_FakeProjectionReporter(),
                    structured_projection_publisher=_FakeStructuredProjectionPublisher(),
                    work_dir=Path(temp_dir),
                )

    def test_fails_closed_for_selected_write_task_without_machine_field_status(self) -> None:
        with TemporaryDirectory() as temp_dir:
            task = _selected_write_task()
            input_ref = dict(task["inputRef"])
            input_ref.pop("fieldStatus")
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

    def test_releases_service_guide_candidate_to_structured_projection(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            object_store = _FakeObjectStore(
                {
                    (
                        "campus-rag-source",
                        "official_web/muc_public/runs/owrun_contact/source-truth-bundle.json",
                    ): json.dumps(
                        {
                            "pages": [],
                            "runId": "owrun_contact",
                            "siteId": "muc_public",
                        }
                    ).encode("utf-8")
                }
            )
            task = {
                **_selected_write_task(selected_write_target="campus_services/service_guide"),
                "inventoryId": "muc-information-disclosure-application-process",
            }
            reporter = _FakeProjectionReporter()
            publisher = _FakeStructuredProjectionPublisher()

            def fake_replay(**_: object) -> dict[str, object]:
                return {
                    "consumer_candidate_pages": [
                        {
                            "consumer_family": "service_guide_candidate",
                            "materialization_policy": "candidate_only",
                            "normalized_canonical_url": "https://www.muc.edu.cn/",
                            "quality_gate": {"decision": "pass"},
                            "raw_asset_id": "owasset_service",
                            "raw_version_id": "owver_service",
                            "selected_write_target": "campus_services/service_guide",
                            "target_job_id": "owtarget_contact",
                            "typed_candidate": {
                                "entry_points": ["https://www.muc.edu.cn/"],
                                "materials": ["申请表"],
                                "process_steps": ["申请人提交申请", "学校信息公开办公室受理"],
                                "responsible_office": ["学校信息公开办公室"],
                                "service_name": "中央民族大学信息公开申请",
                                "source_title": "中央民族大学信息公开申请",
                                "source_url": "https://www.muc.edu.cn/",
                            },
                            "typed_candidate_schema_version": "official_web_service_guide_candidate.v1",
                        }
                    ]
                }

            with (
                patch(
                    "campus_ingestion_worker.release_official_web_selected_write.materialize_replay_input"
                ),
                patch(
                    "campus_ingestion_worker.release_official_web_selected_write.replay_official_web_source_truth_local",
                    side_effect=fake_replay,
                ),
            ):
                result = release_official_web_selected_write(
                    release_task=task,
                    object_store=object_store,
                    derived_object_store=object_store,
                    projection_reporter=reporter,
                    structured_projection_publisher=publisher,
                    work_dir=root / "selected-write",
                )

            self.assertEqual(result.status, "published")
            self.assertEqual(result.collection, "service_guide")
            self.assertEqual(result.record_count, 1)
            self.assertEqual(publisher.published[0]["collection"], "service_guide")
            current_key = (
                "campus_services/releases/service_guide/current/service-guide-projection.json"
            )
            bundle = json.loads(object_store.objects[("campus-rag-derived", current_key)])
            record = bundle["service_guide_records"][0]
            self.assertEqual(record["display_name"], "中央民族大学信息公开申请")
            self.assertEqual(record["materials"][0]["name"], "申请表")


if __name__ == "__main__":
    unittest.main()
