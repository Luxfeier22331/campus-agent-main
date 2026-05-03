from __future__ import annotations

import json
import unittest
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_worker.release_official_web_selected_write import (
    preview_official_web_selected_write,
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


class _ExplodingStructuredProjectionPublisher:
    def publish_release(self, **_: object) -> _PublishReport:
        raise AssertionError("publish_release should not be called during selected-write preview")


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
            "targetLabel": "中央民族大学学生校园卡服务",
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
            "targetLabel": "中央民族大学主页页脚联系方式",
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
    def test_preview_selected_write_contact_directory_builds_bundle_without_publish_side_effects(
        self,
    ) -> None:
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
                                "contact_points": [
                                    {"label": "总机", "phone": "010-68932442"},
                                ],
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
                result = preview_official_web_selected_write(
                    release_task=_selected_write_task(),
                    object_store=object_store,
                    work_dir=root / "selected-write-preview",
                    projection_reporter=reporter,
                )

            self.assertEqual(result.status, "previewed")
            self.assertEqual(result.collection, "contact_directory")
            self.assertEqual(result.record_count, 1)
            self.assertEqual(result.full_record_count, 1)
            self.assertEqual(result.source_bundle_key, "official_web/muc_public/runs/owrun_contact/source-truth-bundle.json")
            self.assertEqual(
                [snapshot["status"] for snapshot in reporter.snapshots],
                ["running", "materialized", "previewed"],
            )
            self.assertNotIn(
                (
                    "campus-rag-derived",
                    "campus_services/releases/contact_directory/current/contact-directory-projection.json",
                ),
                object_store.objects,
            )
            bundle = result.bundle
            self.assertEqual(bundle["contact_records"][0]["display_name"], "中央民族大学")
            self.assertEqual(bundle["contact_records"][0]["phones"][0]["number"], "010-68932442")
            self.assertEqual(
                bundle["contact_records"][0]["field_status"]["office_hours"],
                "source_not_provided",
            )
            preview_bundle = json.loads(
                (root / "selected-write-preview" / "preview-output" / "projection-bundle.json").read_text(
                    encoding="utf-8"
                )
            )
            full_preview_bundle = json.loads(
                (
                    root
                    / "selected-write-preview"
                    / "preview-output"
                    / "full-projection-bundle.json"
                ).read_text(encoding="utf-8")
            )
            self.assertEqual(preview_bundle["contact_records"][0]["display_name"], "中央民族大学")
            self.assertEqual(full_preview_bundle["contact_records"][0]["display_name"], "中央民族大学")

    def test_preview_selected_write_service_guide_builds_bundle_without_publish_side_effects(
        self,
    ) -> None:
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
                                "contacts": {
                                    "emails": ["xxgk@example.edu.cn"],
                                    "locations": ["办公楼101室"],
                                    "office_hours": ["工作日 8:30-11:30"],
                                    "phones": ["010-68930000"],
                                },
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
                result = preview_official_web_selected_write(
                    release_task=task,
                    object_store=object_store,
                    work_dir=root / "selected-write-preview",
                    projection_reporter=_FakeProjectionReporter(),
                )

            self.assertEqual(result.status, "previewed")
            self.assertEqual(result.collection, "service_guide")
            self.assertEqual(result.record_count, 1)
            self.assertEqual(result.full_record_count, 1)
            self.assertEqual(result.bundle["service_guide_records"][0]["display_name"], "中央民族大学信息公开申请")
            self.assertEqual(
                result.bundle["service_guide_records"][0]["contact_refs"][0]["phone"],
                "010-68930000",
            )
            self.assertEqual(
                result.bundle["service_guide_records"][0]["office_hours"][0]["label"],
                "工作日 8:30-11:30",
            )
            self.assertEqual(
                result.full_bundle["service_guide_records"][0]["display_name"],
                "中央民族大学信息公开申请",
            )
            self.assertNotIn(
                (
                    "campus-rag-derived",
                    "campus_services/releases/service_guide/current/service-guide-projection.json",
                ),
                object_store.objects,
            )

    def test_preview_selected_write_returns_task_scope_bundle_while_preserving_full_bundle(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            current_key = "campus_services/releases/contact_directory/current/contact-directory-projection.json"
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
                    ).encode("utf-8"),
                    (
                        "campus-rag-derived",
                        current_key,
                    ): json.dumps(
                        {
                            "schema_version": "campus_services_contact_directory_projection.v1",
                            "generated_at": "2026-05-01T07:00:00+00:00",
                            "source_families": ["official_web_contact_directory_candidate_v1"],
                            "source_documents": [],
                            "contact_records": [
                                {
                                    "aliases": ["联系方式"],
                                    "contact_group": "official_web",
                                    "contact_id": "contact:official_web:existing",
                                    "department": "联系方式",
                                    "display_name": "联系方式",
                                    "emails": [],
                                    "extraction_status": "ready",
                                    "location_refs": [],
                                    "phones": [
                                        {
                                            "label": "电话号码",
                                            "number": "010-68932551",
                                            "phone_id": "contact:official_web:existing:phone:1",
                                            "source_refs": [
                                                "official_web:muc-information-disclosure-contact:owver_info_contact"
                                            ],
                                        }
                                    ],
                                    "source_refs": [
                                        "official_web:muc-information-disclosure-contact:owver_info_contact"
                                    ],
                                }
                            ],
                            "conflict_records": [],
                            "manual_review_sources": [],
                        }
                    ).encode("utf-8"),
                }
            )

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
                                "contact_points": [
                                    {"label": "总机", "phone": "010-68932442"},
                                ],
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
                result = preview_official_web_selected_write(
                    release_task=_selected_write_task(),
                    object_store=object_store,
                    work_dir=root / "selected-write-preview",
                )

            self.assertEqual(result.record_count, 1)
            self.assertEqual(result.full_record_count, 2)
            self.assertEqual(
                [record["display_name"] for record in result.bundle["contact_records"]],
                ["中央民族大学"],
            )
            self.assertEqual(
                {record["display_name"] for record in result.full_bundle["contact_records"]},
                {"联系方式", "中央民族大学"},
            )
            preview_bundle = json.loads(
                (root / "selected-write-preview" / "preview-output" / "projection-bundle.json").read_text(
                    encoding="utf-8"
                )
            )
            full_preview_bundle = json.loads(
                (
                    root
                    / "selected-write-preview"
                    / "preview-output"
                    / "full-projection-bundle.json"
                ).read_text(encoding="utf-8")
            )
            self.assertEqual(
                [record["display_name"] for record in preview_bundle["contact_records"]],
                ["中央民族大学"],
            )
            self.assertEqual(
                {record["display_name"] for record in full_preview_bundle["contact_records"]},
                {"联系方式", "中央民族大学"},
            )

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
                                "contact_points": [
                                    {"label": "总机", "phone": "010-68932442"},
                                ],
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
            self.assertIn(
                "中央民族大学主页页脚联系方式",
                bundle["contact_records"][0]["aliases"],
            )
            self.assertEqual(bundle["contact_records"][0]["phones"][0]["number"], "010-68932442")
            self.assertEqual(bundle["contact_records"][0]["phones"][0]["label"], "总机")
            self.assertEqual(bundle["contact_records"][0]["field_status"]["phone"], "present")
            self.assertEqual(
                bundle["contact_records"][0]["field_status"]["office_hours"],
                "source_not_provided",
            )
            self.assertEqual(
                bundle["contact_records"][0]["required_fields"],
                [
                    "organization_name",
                    "phone",
                    "source_url",
                    "source_version_evidence",
                ],
            )
            self.assertEqual(
                bundle["contact_records"][0]["optional_fields"],
                ["email", "location", "office_hours"],
            )
            self.assertEqual(
                bundle["contact_records"][0]["release_record_state"],
                "newly_selected",
            )

    def test_selected_write_contact_directory_carries_forward_existing_current_records(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            current_key = "campus_services/releases/contact_directory/current/contact-directory-projection.json"
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
                    ).encode("utf-8"),
                    (
                        "campus-rag-derived",
                        current_key,
                    ): json.dumps(
                        {
                            "schema_version": "campus_services_contact_directory_projection.v1",
                            "generated_at": "2026-05-01T07:00:00+00:00",
                            "source_families": ["official_web_contact_directory_candidate_v1"],
                            "source_documents": [
                                {
                                    "title": "muc-information-disclosure-contact",
                                    "source_refs": ["https://www.muc.edu.cn/xxgk/lxfs.htm"],
                                }
                            ],
                            "contact_records": [
                                {
                                    "aliases": ["联系方式"],
                                    "contact_group": "official_web",
                                    "contact_id": "contact:official_web:existing",
                                    "department": "联系方式",
                                    "display_name": "联系方式",
                                    "emails": [],
                                    "extraction_status": "ready",
                                    "location_refs": [],
                                    "phones": [
                                        {
                                            "label": "电话号码",
                                            "number": "010-68932551",
                                            "phone_id": ("contact:official_web:existing:phone:1"),
                                            "source_refs": [
                                                "official_web:muc-information-disclosure-contact:owver_info_contact"
                                            ],
                                        }
                                    ],
                                    "source_refs": [
                                        "official_web:muc-information-disclosure-contact:owver_info_contact"
                                    ],
                                }
                            ],
                            "conflict_records": [],
                            "manual_review_sources": [],
                        }
                    ).encode("utf-8"),
                }
            )
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
                                "contact_points": [
                                    {"label": "总机", "phone": "010-68932442"},
                                ],
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
                    release_task=_selected_write_task(),
                    object_store=object_store,
                    derived_object_store=object_store,
                    projection_reporter=_FakeProjectionReporter(),
                    structured_projection_publisher=publisher,
                    work_dir=root / "selected-write",
                )

            self.assertEqual(result.record_count, 2)
            bundle = json.loads(object_store.objects[("campus-rag-derived", current_key)])
            records_by_name = {
                str(record["display_name"]): record for record in bundle["contact_records"]
            }
            self.assertEqual(set(records_by_name), {"联系方式", "中央民族大学"})
            self.assertEqual(
                records_by_name["联系方式"]["phones"][0]["number"],
                "010-68932551",
            )
            self.assertEqual(
                records_by_name["中央民族大学"]["phones"][0]["number"],
                "010-68932442",
            )
            self.assertEqual(
                records_by_name["中央民族大学"]["location_refs"][0]["location_ref"],
                "海淀校区：北京市海淀区中关村南大街27号",
            )
            self.assertEqual(
                records_by_name["中央民族大学"]["location_refs"][0]["address_text"],
                "海淀校区：北京市海淀区中关村南大街27号",
            )
            self.assertEqual(
                records_by_name["联系方式"]["release_record_state"],
                "carried_forward",
            )
            self.assertEqual(
                records_by_name["中央民族大学"]["release_record_state"],
                "newly_selected",
            )
            self.assertEqual(
                bundle["release_record_lineage"],
                {"carried_forward": 1, "newly_selected": 1},
            )
            published_bundle = publisher.published[0]["bundle"]
            self.assertEqual(len(published_bundle["contact_records"]), 2)

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
                                "contacts": {
                                    "emails": ["xxgk@example.edu.cn"],
                                    "locations": ["办公楼101室"],
                                    "office_hours": ["工作日 8:30-11:30"],
                                    "phones": ["010-68930000"],
                                },
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
            self.assertIn("中央民族大学学生校园卡服务", record["aliases"])
            self.assertEqual(record["materials"][0]["name"], "申请表")
            self.assertEqual(record["contact_refs"][0]["phone"], "010-68930000")
            self.assertEqual(record["contact_refs"][0]["email"], "xxgk@example.edu.cn")
            self.assertEqual(record["contact_refs"][0]["location_ref"], "办公楼101室")
            self.assertEqual(record["office_hours"][0]["label"], "工作日 8:30-11:30")
            self.assertEqual(record["field_status"]["service_process"], "present")
            self.assertEqual(
                record["field_status"]["service_entry"],
                "source_not_provided",
            )
            self.assertEqual(
                record["required_fields"],
                [
                    "service_name",
                    "process_steps",
                    "source_url",
                    "source_version_evidence",
                    "service_process",
                ],
            )
            self.assertEqual(
                record["optional_fields"],
                ["service_entry", "required_materials", "service_material"],
            )
            self.assertEqual(record["release_record_state"], "newly_selected")

    def test_service_guide_composition_uses_all_selected_write_sources(self) -> None:
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
                "inputRef": {
                    **dict(
                        _selected_write_task(
                            selected_write_target="campus_services/service_guide"
                        )["inputRef"]
                    ),
                    "fieldStatus": {
                        "process_steps": "present",
                        "required_materials": "present",
                        "service_entry": "present",
                        "service_material": "present",
                        "service_name": "present",
                        "service_process": "present",
                        "source_url": "present",
                        "source_version_evidence": "present",
                    },
                    "sourceRefs": [
                        {
                            "raw_asset_id": "owasset_info_procedure",
                            "raw_version_id": "owver_info_procedure",
                            "normalized_canonical_url": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                        },
                        {
                            "raw_asset_id": "owasset_info_material",
                            "raw_version_id": "owver_info_material",
                            "normalized_canonical_url": "https://xxgk.muc.edu.cn/info/1007/1114.htm",
                        },
                    ],
                    "sourceUrls": [
                        "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                        "https://xxgk.muc.edu.cn/info/1007/1114.htm",
                    ],
                    "targetLabel": "中央民族大学信息公开依申请公开工作流程",
                },
            }

            def fake_replay(**_: object) -> dict[str, object]:
                return {
                    "consumer_candidate_pages": [
                        {
                            "consumer_family": "service_guide_candidate",
                            "materialization_policy": "candidate_only",
                            "normalized_canonical_url": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                            "quality_gate": {"decision": "pass"},
                            "raw_asset_id": "owasset_info_procedure",
                            "raw_version_id": "owver_info_procedure",
                            "selected_write_target": "campus_services/service_guide",
                            "target_job_id": "owtarget_contact",
                            "typed_candidate": {
                                "contacts": {},
                                "entry_points": [],
                                "materials": [],
                                "process_steps": ["申请人提交信息公开申请"],
                                "responsible_office": ["学校信息公开办公室"],
                                "service_name": "中央民族大学信息公开申请",
                                "source_title": "中央民族大学信息公开申请",
                                "source_url": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                            },
                            "typed_candidate_schema_version": "official_web_service_guide_candidate.v1",
                        },
                        {
                            "consumer_family": "service_guide_candidate",
                            "materialization_policy": "candidate_only",
                            "normalized_canonical_url": "https://xxgk.muc.edu.cn/info/1007/1114.htm",
                            "quality_gate": {"decision": "pass"},
                            "raw_asset_id": "owasset_info_material",
                            "raw_version_id": "owver_info_material",
                            "selected_write_target": "campus_services/service_guide",
                            "target_job_id": "owtarget_contact",
                            "typed_candidate": {
                                "contacts": {},
                                "entry_points": [
                                    "https://xxgk.muc.edu.cn/info/1007/1114.htm"
                                ],
                                "materials": ["中央民族大学信息公开申请表"],
                                "process_steps": [],
                                "responsible_office": [],
                                "service_name": "中央民族大学信息公开申请表下载",
                                "source_title": "中央民族大学信息公开申请表下载",
                                "source_url": "https://xxgk.muc.edu.cn/info/1007/1114.htm",
                            },
                            "typed_candidate_schema_version": "official_web_service_guide_candidate.v1",
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
                result = preview_official_web_selected_write(
                    release_task=task,
                    object_store=object_store,
                    work_dir=root / "selected-write-preview",
                )

            record = result.bundle["service_guide_records"][0]
            self.assertEqual(
                record["display_name"],
                "中央民族大学信息公开依申请公开工作流程",
            )
            self.assertEqual(
                record["source_refs"],
                [
                    "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                    "https://xxgk.muc.edu.cn/info/1007/1114.htm",
                ],
            )
            self.assertEqual(record["materials"][0]["name"], "中央民族大学信息公开申请表")
            self.assertEqual(
                record["materials"][0]["source_refs"],
                ["https://xxgk.muc.edu.cn/info/1007/1114.htm"],
            )
            self.assertEqual(
                record["entry_refs"][0]["url"],
                "https://xxgk.muc.edu.cn/info/1007/1114.htm",
            )

    def test_preview_selected_write_contact_directory_prefers_target_label_for_generic_shell_title(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            task = {
                **_selected_write_task(),
                "inventoryId": "muc-information-disclosure-contact",
                "inputRef": {
                    **dict(_selected_write_task()["inputRef"]),
                    "sourceUrls": ["https://xxgk.muc.edu.cn/xxgk/lxfs.htm"],
                    "targetLabel": "中央民族大学信息公开联系方式",
                },
            }
            object_store = _FakeObjectStore(
                {
                    (
                        "campus-rag-source",
                        "official_web/muc_public/runs/owrun_contact/source-truth-bundle.json",
                    ): json.dumps(
                        {"pages": [], "runId": "owrun_contact", "siteId": "muc_public"}
                    ).encode("utf-8")
                }
            )

            def fake_replay(**_: object) -> dict[str, object]:
                return {
                    "consumer_candidate_pages": [
                        {
                            "consumer_family": "contact_directory_candidate",
                            "materialization_policy": "candidate_only",
                            "normalized_canonical_url": "https://xxgk.muc.edu.cn/xxgk/lxfs.htm",
                            "quality_gate": {"decision": "pass"},
                            "raw_asset_id": "owasset_contact",
                            "raw_version_id": "owver_contact",
                            "selected_write_target": "campus_services/contact_directory",
                            "target_job_id": "owtarget_contact",
                            "typed_candidate": {
                                "contact_points": [],
                                "display_name": "联系方式",
                                "phones": ["010-68932551"],
                                "emails": [],
                                "locations": [],
                                "source_title": "联系方式",
                                "source_url": "https://xxgk.muc.edu.cn/xxgk/lxfs.htm",
                            },
                            "typed_candidate_schema_version": (
                                "official_web_contact_directory_candidate.v1"
                            ),
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
                result = preview_official_web_selected_write(
                    release_task=task,
                    object_store=object_store,
                    work_dir=root / "selected-write-preview",
                )

            record = result.bundle["contact_records"][0]
            self.assertEqual(record["display_name"], "中央民族大学信息公开联系方式")
            self.assertEqual(
                record["aliases"],
                ["中央民族大学信息公开联系方式", "联系方式", "信息公开"],
            )

    def test_preview_selected_write_service_guide_prefers_target_label_for_policy_shell_title(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            task = {
                **_selected_write_task(selected_write_target="campus_services/service_guide"),
                "inventoryId": "muc-it-email-service-guide",
                "jobId": "owtarget_email",
                "inputRef": {
                    **dict(
                        _selected_write_task(
                            selected_write_target="campus_services/service_guide"
                        )["inputRef"]
                    ),
                    "sourceUrls": ["https://met.muc.edu.cn/info/1024/1090.htm"],
                    "targetLabel": "中央民族大学校园电子邮件服务",
                },
            }
            object_store = _FakeObjectStore(
                {
                    (
                        "campus-rag-source",
                        "official_web/muc_public/runs/owrun_contact/source-truth-bundle.json",
                    ): json.dumps(
                        {"pages": [], "runId": "owrun_contact", "siteId": "muc_public"}
                    ).encode("utf-8")
                }
            )

            def fake_replay(**_: object) -> dict[str, object]:
                return {
                    "consumer_candidate_pages": [
                        {
                            "consumer_family": "service_guide_candidate",
                            "materialization_policy": "candidate_only",
                            "normalized_canonical_url": "https://met.muc.edu.cn/info/1024/1090.htm",
                            "quality_gate": {"decision": "pass"},
                            "raw_asset_id": "owasset_email",
                            "raw_version_id": "owver_email",
                            "selected_write_target": "campus_services/service_guide",
                            "target_job_id": "owtarget_email",
                            "typed_candidate": {
                                "contacts": {
                                    "emails": [],
                                    "locations": [],
                                    "office_hours": [],
                                    "phones": ["010-68932559"],
                                },
                                "entry_points": [],
                                "materials": ["E-MAIL申请表"],
                                "process_steps": ["填写申请表", "递交网络中心审批"],
                                "responsible_office": ["网络中心"],
                                "service_name": "中央民族大学电子邮件管理办法",
                                "source_title": "中央民族大学电子邮件管理办法",
                                "source_url": "https://met.muc.edu.cn/info/1024/1090.htm",
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
                result = preview_official_web_selected_write(
                    release_task=task,
                    object_store=object_store,
                    work_dir=root / "selected-write-preview",
                )

            record = result.bundle["service_guide_records"][0]
            self.assertEqual(record["display_name"], "中央民族大学校园电子邮件服务")
            self.assertEqual(
                record["aliases"],
                ["中央民族大学校园电子邮件服务", "中央民族大学电子邮件管理办法", "校园邮箱"],
            )
            self.assertEqual(record["effective_from"], "2026-05-01T00:00:00+00:00")

    def test_preview_selected_write_contact_directory_adds_source_faithful_aliases(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            task = {
                **_selected_write_task(selected_write_target="campus_services/contact_directory"),
                "inventoryId": "muc-it-service-contacts",
                "jobId": "owtarget_it_contacts",
                "inputRef": {
                    **dict(
                        _selected_write_task(
                            selected_write_target="campus_services/contact_directory"
                        )["inputRef"]
                    ),
                    "sourceUrls": ["https://met.muc.edu.cn/info/1008/1847.htm"],
                    "targetLabel": "中央民族大学信息化服务联系方式",
                },
            }
            object_store = _FakeObjectStore(
                {
                    (
                        "campus-rag-source",
                        "official_web/muc_public/runs/owrun_contact/source-truth-bundle.json",
                    ): json.dumps(
                        {"pages": [], "runId": "owrun_contact", "siteId": "muc_public"}
                    ).encode("utf-8")
                }
            )

            def fake_replay(**_: object) -> dict[str, object]:
                return {
                    "consumer_candidate_pages": [
                        {
                            "consumer_family": "contact_directory_candidate",
                            "materialization_policy": "candidate_only",
                            "normalized_canonical_url": "https://met.muc.edu.cn/info/1008/1847.htm",
                            "quality_gate": {"decision": "pass"},
                            "raw_asset_id": "owasset_it_contact",
                            "raw_version_id": "owver_it_contact",
                            "selected_write_target": "campus_services/contact_directory",
                            "target_job_id": "owtarget_it_contacts",
                            "typed_candidate": {
                                "contact_points": [
                                    {"label": "网络服务", "phone": "010-68932559"},
                                ],
                                "display_name": "中央民族大学信息化服务联系方式",
                                "emails": [],
                                "locations": ["北京市海淀区中关村南大街27号"],
                                "phones": ["010-68932559"],
                                "source_title": "信息化服务联系方式",
                                "source_url": "https://met.muc.edu.cn/info/1008/1847.htm",
                            },
                            "typed_candidate_schema_version": (
                                "official_web_contact_directory_candidate.v1"
                            ),
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
                result = preview_official_web_selected_write(
                    release_task=task,
                    object_store=object_store,
                    work_dir=root / "selected-write-preview",
                )

            record = result.bundle["contact_records"][0]
            self.assertEqual(record["display_name"], "中央民族大学信息化服务联系方式")
            self.assertEqual(
                record["aliases"],
                ["中央民族大学信息化服务联系方式", "信息化服务联系方式", "信息化办"],
            )


if __name__ == "__main__":
    unittest.main()
