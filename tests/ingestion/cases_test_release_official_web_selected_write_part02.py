# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.test_release_official_web_selected_write_support import *


class ReleaseOfficialWebSelectedWriteTestPart02(unittest.TestCase):
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

            self.assertEqual(result.record_count, 1)
            self.assertEqual(result.full_record_count, 2)
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

    def test_selected_write_carry_forward_ignores_public_url_source_refs_for_inventory_replacement(
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
                            "source_documents": [],
                            "contact_records": [
                                {
                                    "aliases": ["信息公开"],
                                    "contact_group": "official_web",
                                    "contact_id": "contact:official_web:info-disclosure",
                                    "department": "信息公开",
                                    "display_name": "信息公开",
                                    "emails": [],
                                    "extraction_status": "ready",
                                    "location_refs": [],
                                    "phones": [
                                        {
                                            "label": "电话号码",
                                            "number": "010-68932551",
                                            "phone_id": "contact:official_web:info-disclosure:phone:1",
                                            "source_refs": ["https://www.muc.edu.cn/"],
                                        }
                                    ],
                                    "source_refs": ["https://www.muc.edu.cn/"],
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
                                "locations": [],
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
                    structured_projection_publisher=_FakeStructuredProjectionPublisher(),
                    work_dir=root / "selected-write",
                )

            self.assertEqual(result.record_count, 1)
            self.assertEqual(result.full_record_count, 2)
            bundle = json.loads(object_store.objects[("campus-rag-derived", current_key)])
            self.assertEqual(
                {record["display_name"] for record in bundle["contact_records"]},
                {"信息公开", "中央民族大学"},
            )

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
            current_key = (
                "campus_services/releases/service_guide/current/service-guide-projection.json"
            )
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
                            "schema_version": "campus_services_service_guide_projection.v1",
                            "generated_at": "2026-05-01T07:00:00+00:00",
                            "source_families": ["official_web_curated_service_guide_v1"],
                            "service_guide_records": [
                                {
                                    "aliases": ["VPN"],
                                    "audience": ["unknown"],
                                    "campus_scope": "all",
                                    "category": "campus_service",
                                    "contact_refs": [],
                                    "display_name": "中央民族大学 VPN 使用说明",
                                    "effective_from": "2026-05-01T00:00:00+00:00",
                                    "effective_until": "9999-12-31T23:59:59+00:00",
                                    "eligibility_notes": [],
                                    "entry_refs": [],
                                    "extraction_status": "ready",
                                    "guide_sections": [
                                        {
                                            "section_id": "service:official_web:vpn:section:overview",
                                            "section_type": "overview",
                                            "title": "中央民族大学 VPN 使用说明",
                                            "content": "VPN 使用说明。",
                                            "order": 1,
                                            "source_refs": [
                                                "official_web:muc-it-vpn-service-guide:owver_vpn"
                                            ],
                                        }
                                    ],
                                    "materials": [],
                                    "office_hours": [],
                                    "service_id": "service:official_web:vpn",
                                    "source_refs": [
                                        "official_web:muc-it-vpn-service-guide:owver_vpn"
                                    ],
                                }
                            ],
                            "conflict_records": [],
                            "manual_review_sources": [],
                        }
                    ).encode("utf-8"),
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
                    derived_bucket="campus-rag-derived",
                )

            self.assertEqual(result.status, "published")
            self.assertEqual(result.collection, "service_guide")
            self.assertEqual(result.record_count, 1)
            self.assertEqual(result.full_record_count, 2)
            self.assertEqual(publisher.published[0]["collection"], "service_guide")
            bundle = json.loads(object_store.objects[("campus-rag-derived", current_key)])
            records_by_name = {
                str(record["display_name"]): record for record in bundle["service_guide_records"]
            }
            self.assertEqual(
                set(records_by_name),
                {"中央民族大学 VPN 使用说明", "中央民族大学信息公开申请"},
            )
            record = records_by_name["中央民族大学信息公开申请"]
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


if __name__ == "__main__":
    unittest.main()
