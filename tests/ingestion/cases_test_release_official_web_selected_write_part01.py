# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.test_release_official_web_selected_write_support import *


class ReleaseOfficialWebSelectedWriteTestPart01(unittest.TestCase):
    def test_preview_selected_write_contact_directory_builds_bundle_without_publish_side_effects(
        self,
    ) -> None:
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
            self.assertEqual(
                result.source_bundle_key,
                "official_web/muc_public/runs/owrun_contact/source-truth-bundle.json",
            )
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
                (
                    root / "selected-write-preview" / "preview-output" / "projection-bundle.json"
                ).read_text(encoding="utf-8")
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
            self.assertEqual(
                full_preview_bundle["contact_records"][0]["display_name"], "中央民族大学"
            )

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
            self.assertEqual(
                result.bundle["service_guide_records"][0]["display_name"],
                "中央民族大学信息公开申请",
            )
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

    def test_preview_selected_write_academic_calendar_builds_bundle_without_publish_side_effects(
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
                **_selected_write_task(selected_write_target="calendar/academic_calendar"),
                "inventoryId": "muc-public-academic-calendar",
            }

            def fake_replay(**_: object) -> dict[str, object]:
                return {
                    "consumer_candidate_pages": [
                        {
                            "consumer_family": "academic_calendar_candidate",
                            "materialization_policy": "candidate_only",
                            "normalized_canonical_url": "https://www.muc.edu.cn/ggfw/mdxl.htm",
                            "quality_gate": {"decision": "pass"},
                            "raw_asset_id": "owasset_calendar",
                            "raw_version_id": "owver_calendar",
                            "selected_write_target": "calendar/academic_calendar",
                            "target_job_id": "owtarget_contact",
                            "typed_candidate": {
                                "academic_year_label": "2025-2026学年",
                                "term_label": "春季学期",
                                "date_range": "2026-05-09 至 2026-05-09",
                                "calendar_arrangement": "2026-05-09 执行周一课表。",
                                "holiday_name": "",
                                "week_index": 10,
                                "class_day_pattern": "执行周一课表",
                                "records": [
                                    {
                                        "academic_year_label": "2025-2026学年",
                                        "term_label": "春季学期",
                                        "start_date": "2026-05-09",
                                        "end_date": "2026-05-09",
                                        "week_index": 10,
                                        "day_kind": "makeup_class_day",
                                        "class_day_pattern": "执行周一课表",
                                        "is_makeup_class": True,
                                        "holiday_name": "",
                                    }
                                ],
                                "source_title": "中央民族大学校历",
                                "source_url": "https://www.muc.edu.cn/ggfw/mdxl.htm",
                            },
                            "typed_candidate_schema_version": (
                                "official_web_academic_calendar_candidate.v1"
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
                    projection_reporter=_FakeProjectionReporter(),
                )

            self.assertEqual(result.status, "previewed")
            self.assertEqual(result.collection, "academic_calendar")
            self.assertEqual(result.record_count, 1)
            self.assertEqual(result.full_record_count, 1)
            record = result.bundle["academic_calendar_records"][0]
            self.assertEqual(record["academic_year_label"], "2025-2026学年")
            self.assertEqual(record["record_family"], "class_day_override")
            self.assertEqual(record["week_index"], 10)
            self.assertEqual(record["class_day_pattern"], "执行周一课表")
            self.assertTrue(record["is_makeup_class"])
            self.assertNotIn(
                (
                    "campus-rag-derived",
                    "calendar/releases/academic_calendar/current/academic-calendar-projection.json",
                ),
                object_store.objects,
            )

    def test_preview_selected_write_returns_task_scope_bundle_while_preserving_full_bundle(
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
                (
                    root / "selected-write-preview" / "preview-output" / "projection-bundle.json"
                ).read_text(encoding="utf-8")
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


if __name__ == "__main__":
    unittest.main()
