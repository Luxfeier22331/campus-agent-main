# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.test_release_official_web_selected_write_support import *


class ReleaseOfficialWebSelectedWriteTestPart03(unittest.TestCase):
    def test_releases_academic_calendar_candidate_to_structured_projection(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            current_key = (
                "calendar/releases/academic_calendar/current/academic-calendar-projection.json"
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
                    ).encode("utf-8")
                }
            )
            task = {
                **_selected_write_task(selected_write_target="calendar/academic_calendar"),
                "inventoryId": "muc-public-academic-calendar",
            }
            publisher = _FakeStructuredProjectionPublisher()

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
                                "date_range": "2026-05-01 至 2026-05-05",
                                "calendar_arrangement": "2026-05-01 至 2026-05-05 劳动节假期。",
                                "holiday_name": "劳动节假期",
                                "week_index": 9,
                                "class_day_pattern": "",
                                "records": [
                                    {
                                        "academic_year_label": "2025-2026学年",
                                        "term_label": "春季学期",
                                        "start_date": "2026-05-01",
                                        "end_date": "2026-05-05",
                                        "week_index": 9,
                                        "day_kind": "holiday",
                                        "class_day_pattern": "",
                                        "is_makeup_class": False,
                                        "holiday_name": "劳动节假期",
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
                result = release_official_web_selected_write(
                    release_task=task,
                    object_store=object_store,
                    derived_object_store=object_store,
                    projection_reporter=_FakeProjectionReporter(),
                    structured_projection_publisher=publisher,
                    work_dir=root / "selected-write",
                    derived_bucket="campus-rag-derived",
                )

            self.assertEqual(result.status, "published")
            self.assertEqual(result.collection, "academic_calendar")
            self.assertEqual(result.record_count, 1)
            self.assertEqual(result.full_record_count, 1)
            self.assertEqual(publisher.published[0]["collection"], "academic_calendar")
            bundle = json.loads(object_store.objects[("campus-rag-derived", current_key)])
            record = bundle["academic_calendar_records"][0]
            self.assertEqual(record["holiday_name"], "劳动节假期")
            self.assertEqual(record["record_family"], "named_event")
            self.assertEqual(record["event_name"], "劳动节假期")
            self.assertEqual(record["event_end_date_exclusive"], "2026-05-06")
            self.assertEqual(record["display_end_date"], "2026-05-05")
            self.assertEqual(record["day_kind"], "holiday")
            self.assertEqual(record["field_status"]["calendar_arrangement"], "present")
            self.assertEqual(
                record["required_fields"],
                [
                    "academic_year_label",
                    "term_label",
                    "date_range",
                    "calendar_arrangement",
                    "source_url",
                    "source_version_evidence",
                ],
            )

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
                        _selected_write_task(selected_write_target="campus_services/service_guide")[
                            "inputRef"
                        ]
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
                                "entry_points": ["https://xxgk.muc.edu.cn/info/1007/1114.htm"],
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

    def test_service_guide_carry_forward_adds_public_source_refs_from_inventory(self) -> None:
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
                            "source_documents": [],
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
                                    "entry_refs": [
                                        {
                                            "entry_id": "service:official_web:vpn:entry:1",
                                            "entry_type": "online_url",
                                            "label": "https://vpn.muc.edu.cn",
                                            "location_ref": "",
                                            "source_refs": [
                                                "official_web:muc-it-vpn-service-guide:owver_vpn"
                                            ],
                                            "url": "https://vpn.muc.edu.cn",
                                        }
                                    ],
                                    "extraction_status": "ready",
                                    "guide_sections": [
                                        {
                                            "content": "1. 登录 VPN。",
                                            "order": 1,
                                            "section_id": "service:official_web:vpn:section:procedure",
                                            "section_type": "procedure",
                                            "source_refs": [
                                                "official_web:muc-it-vpn-service-guide:owver_vpn"
                                            ],
                                            "title": "中央民族大学 VPN 使用说明",
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
                                "contacts": {},
                                "entry_points": [],
                                "materials": [],
                                "process_steps": ["申请人提交申请"],
                                "responsible_office": [],
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
                )

            records_by_name = {
                str(record["display_name"]): record
                for record in result.full_bundle["service_guide_records"]
            }
            carried_record = records_by_name["中央民族大学 VPN 使用说明"]
            expected_source_ref = "https://met.muc.edu.cn/info/1046/1674.htm"
            self.assertIn(expected_source_ref, carried_record["source_refs"])
            self.assertIn(
                expected_source_ref,
                carried_record["guide_sections"][0]["source_refs"],
            )
            self.assertIn(
                expected_source_ref,
                carried_record["entry_refs"][0]["source_refs"],
            )

    def test_single_service_guide_composition_keeps_material_source_refs(self) -> None:
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
                        _selected_write_task(selected_write_target="campus_services/service_guide")[
                            "inputRef"
                        ]
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
                        {
                            "raw_asset_id": "owasset_info_contact",
                            "raw_version_id": "owver_info_contact",
                            "normalized_canonical_url": "https://xxgk.muc.edu.cn/xxgk/lxfs.htm",
                        },
                    ],
                    "sourceUrls": [
                        "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                        "https://xxgk.muc.edu.cn/info/1007/1114.htm",
                        "https://xxgk.muc.edu.cn/xxgk/lxfs.htm",
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
                            "source_refs": [
                                "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                                "https://xxgk.muc.edu.cn/info/1007/1114.htm",
                                "https://xxgk.muc.edu.cn/xxgk/lxfs.htm",
                            ],
                            "target_job_id": "owtarget_contact",
                            "typed_candidate": {
                                "contacts": {
                                    "phones": ["010-68930000"],
                                },
                                "entry_points": ["https://xxgk.muc.edu.cn/info/1007/1114.htm"],
                                "field_source_urls": {
                                    "contacts": ["https://xxgk.muc.edu.cn/xxgk/lxfs.htm"],
                                    "entry_points": ["https://xxgk.muc.edu.cn/info/1007/1114.htm"],
                                    "materials": ["https://xxgk.muc.edu.cn/info/1007/1114.htm"],
                                    "process_steps": ["https://xxgk.muc.edu.cn/info/1007/1113.htm"],
                                    "responsible_office": [
                                        "https://xxgk.muc.edu.cn/info/1007/1113.htm"
                                    ],
                                },
                                "materials": [
                                    "中央民族大学依申请公开信息审批表",
                                    "中央民族大学信息公开申请表",
                                ],
                                "process_steps": ["申请人提交信息公开申请"],
                                "responsible_office": ["学校信息公开办公室"],
                                "service_name": "中央民族大学信息公开申请",
                                "source_title": "中央民族大学信息公开申请",
                                "source_url": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                                "supporting_source_urls": [
                                    "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                                    "https://xxgk.muc.edu.cn/info/1007/1114.htm",
                                    "https://xxgk.muc.edu.cn/xxgk/lxfs.htm",
                                ],
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
            self.assertEqual(
                record["source_refs"],
                [
                    "official_web:muc-information-disclosure-application-process:owver_info_procedure",
                    "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                    "https://xxgk.muc.edu.cn/info/1007/1114.htm",
                    "https://xxgk.muc.edu.cn/xxgk/lxfs.htm",
                ],
            )
            self.assertEqual(
                [item["name"] for item in record["materials"]],
                [
                    "中央民族大学依申请公开信息审批表",
                    "中央民族大学信息公开申请表",
                ],
            )
            self.assertEqual(
                record["materials"][0]["source_refs"],
                ["https://xxgk.muc.edu.cn/info/1007/1114.htm"],
            )
            self.assertEqual(
                record["materials"][1]["source_refs"],
                ["https://xxgk.muc.edu.cn/info/1007/1114.htm"],
            )
            required_materials_sections = [
                section
                for section in record["guide_sections"]
                if section["section_type"] == "required_materials"
            ]
            self.assertEqual(
                required_materials_sections[0]["source_refs"],
                ["https://xxgk.muc.edu.cn/info/1007/1114.htm"],
            )


if __name__ == "__main__":
    unittest.main()
