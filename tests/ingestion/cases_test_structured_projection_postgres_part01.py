# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.test_structured_projection_postgres_support import *


class StructuredProjectionPostgresPublisherTestPart01(unittest.TestCase):
    def test_publish_transport_schedule_release_writes_typed_rows_before_current_pointer(
        self,
    ) -> None:
        publisher = object.__new__(PostgresStructuredProjectionPublisher)
        publisher.database_url = "postgresql://projection.example/db"
        publisher.schema = "ingestion_projection"
        bundle = {
            "schema_version": "campus_services_projection_bundle.v1",
            "transport_schedule_snapshots": [
                {
                    "snapshot_id": "snapshot:bus:2026-04-20",
                    "published_at": "2026-04-20T18:00:00+08:00",
                    "effective_from": "2026-04-21T00:00:00+08:00",
                    "source_ref": "notice:muc_internal_portal:355122",
                    "is_current": True,
                }
            ],
            "transport_routes": [{"route_id": "route:haidian-to-fengtai"}],
            "scheduled_departures": [
                {
                    "snapshot_id": "snapshot:bus:2026-04-20",
                    "route_id": "route:haidian-to-fengtai",
                    "service_dates": ["2026-04-25"],
                    "departure_time": "06:50",
                    "operational_comment": "仅限学生乘坐",
                    "departure_status": "changed",
                    "departure_kind": "student",
                }
            ],
            "transport_service_exceptions": [],
        }
        cursor = _RecordingCursor()

        with patch(
            "campus_ingestion_core.structured_projection_postgres._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            publisher.publish_release(
                corpus="campus_services",
                collection="transport_schedule",
                release_id="transport-schedule-20260427T090000",
                generated_at="2026-04-27T09:00:00+08:00",
                schema_version="campus_services_projection_bundle.v1",
                artifact_object_key=(
                    "campus_services/releases/transport_schedule/transport-schedule-"
                    "20260427T090000/campus-services-projection.json"
                ),
                artifact_checksum="sha256:test",
                bundle=bundle,
                validation_status="valid",
            )

        executed_sql = "\n".join(query for query, _params in cursor.execute_calls)
        self.assertIn("transport_schedule_snapshots", executed_sql)
        self.assertIn("transport_scheduled_departures", executed_sql)
        self.assertIn("structured_projection_current", executed_sql)
        self.assertIn("snapshot_id", executed_sql)
        self.assertIn("departure_time", executed_sql)
        typed_insert_index = next(
            index
            for index, (query, _params) in enumerate(cursor.execute_calls)
            if "transport_schedule_snapshots" in query and "jsonb_to_recordset" in query
        )
        current_pointer_index = next(
            index
            for index, (query, _params) in enumerate(cursor.execute_calls)
            if "structured_projection_current" in query and "on conflict" in query
        )
        self.assertLess(typed_insert_index, current_pointer_index)
        typed_payload = json.loads(cursor.execute_calls[typed_insert_index][1][0])
        self.assertEqual(typed_payload[0]["release_id"], "transport-schedule-20260427T090000")
        self.assertEqual(typed_payload[0]["record"]["snapshot_id"], "snapshot:bus:2026-04-20")
        departure_insert_index = next(
            index
            for index, (query, _params) in enumerate(cursor.execute_calls)
            if "transport_scheduled_departures" in query and "jsonb_to_recordset" in query
        )
        departure_payload = json.loads(cursor.execute_calls[departure_insert_index][1][0])
        self.assertEqual(departure_payload[0]["operational_comment"], "仅限学生乘坐")
        self.assertEqual(departure_payload[0]["departure_status"], "changed")
        self.assertEqual(departure_payload[0]["departure_kind"], "student")

    def test_publish_release_can_stage_without_current_pointer(self) -> None:
        publisher = object.__new__(PostgresStructuredProjectionPublisher)
        publisher.database_url = "postgresql://projection.example/db"
        publisher.schema = "ingestion_projection"
        bundle = {
            "schema_version": "campus_services_projection_bundle.v1",
            "transport_schedule_snapshots": [
                {
                    "snapshot_id": "snapshot:bus:2026-04-20",
                    "published_at": "2026-04-20T18:00:00+08:00",
                    "effective_from": "2026-04-21T00:00:00+08:00",
                    "source_ref": "notice:muc_internal_portal:355122",
                    "is_current": True,
                }
            ],
            "transport_routes": [{"route_id": "route:haidian-to-fengtai"}],
            "scheduled_departures": [],
            "transport_service_exceptions": [],
        }
        cursor = _RecordingCursor()

        with patch(
            "campus_ingestion_core.structured_projection_postgres._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            report = publisher.publish_release(
                corpus="campus_services",
                collection="transport_schedule",
                release_id="transport-schedule-stage-355881",
                generated_at="2026-04-28T09:00:00+08:00",
                schema_version="campus_services_projection_bundle.v1",
                artifact_object_key=(
                    "campus_services/releases/transport_schedule/transport-schedule-stage-355881/"
                    "campus-services-projection.json"
                ),
                artifact_checksum="sha256:test",
                bundle=bundle,
                validation_status="valid",
                promote_current=False,
            )

        self.assertFalse(report.current)
        executed_sql = "\n".join(query for query, _params in cursor.execute_calls)
        self.assertIn("structured_projection_releases", executed_sql)
        current_pointer_queries = [
            query
            for query, _params in cursor.execute_calls
            if "structured_projection_current" in query and "on conflict" in query
        ]
        self.assertEqual(current_pointer_queries, [])

    def test_transport_release_notice_rows_keep_processing_timestamps(self) -> None:
        publisher = object.__new__(PostgresStructuredProjectionPublisher)
        publisher.database_url = "postgresql://projection.example/db"
        publisher.schema = "ingestion_projection"
        bundle = {
            "schema_version": "campus_services_projection_bundle.v1",
            "transport_schedule_snapshots": [],
            "transport_routes": [],
            "scheduled_departures": [],
            "transport_service_exceptions": [],
            "transport_release_notices": [
                {
                    "source_notice_id": "355881",
                    "source_ref": "notice:muc_internal_portal:355881",
                    "source_notice_release_time": "2026-04-25T16:26:00+08:00",
                    "admitted_at": "2026-04-28T08:30:00+08:00",
                    "materialized_at": "2026-04-28T09:00:00+08:00",
                }
            ],
        }
        cursor = _RecordingCursor()

        with patch(
            "campus_ingestion_core.structured_projection_postgres._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            publisher.publish_release(
                corpus="campus_services",
                collection="transport_schedule",
                release_id="transport-schedule-stage-355881",
                generated_at="2026-04-28T09:00:00+08:00",
                schema_version="campus_services_projection_bundle.v1",
                artifact_object_key=(
                    "campus_services/releases/transport_schedule/transport-schedule-stage-355881/"
                    "campus-services-projection.json"
                ),
                artifact_checksum="sha256:test",
                bundle=bundle,
                validation_status="valid",
                promote_current=False,
            )

        release_notice_index = next(
            index
            for index, (query, _params) in enumerate(cursor.execute_calls)
            if "transport_release_notices" in query and "jsonb_to_recordset" in query
        )
        release_notice_payload = json.loads(cursor.execute_calls[release_notice_index][1][0])
        self.assertEqual(release_notice_payload[0]["source_notice_id"], "355881")
        self.assertEqual(
            release_notice_payload[0]["source_notice_release_time"],
            "2026-04-25T16:26:00+08:00",
        )
        self.assertEqual(release_notice_payload[0]["admitted_at"], "2026-04-28T08:30:00+08:00")
        self.assertEqual(
            release_notice_payload[0]["materialized_at"],
            "2026-04-28T09:00:00+08:00",
        )

    def test_publish_transport_schedule_release_writes_rejected_and_operational_rows(
        self,
    ) -> None:
        publisher = object.__new__(PostgresStructuredProjectionPublisher)
        publisher.database_url = "postgresql://projection.example/db"
        publisher.schema = "ingestion_projection"
        bundle = {
            "schema_version": "campus_services_projection_bundle.v1",
            "transport_schedule_snapshots": [
                {
                    "snapshot_id": "snapshot:bus:2026-04-20",
                    "published_at": "2026-04-20T18:00:00+08:00",
                    "effective_from": "2026-04-21T00:00:00+08:00",
                    "source_ref": "notice:muc_internal_portal:355122",
                    "is_current": True,
                }
            ],
            "transport_routes": [{"route_id": "route:haidian-to-fengtai"}],
            "scheduled_departures": [],
            "transport_service_exceptions": [],
            "transport_operational_notices": [
                {
                    "notice_id": "353903",
                    "source_ref": "notice:muc_internal_portal:353903",
                    "notice_kind": "boarding_point_change",
                    "route_ids": ["route:fengtai-to-haidian"],
                    "effective_from": "2026-01-01T00:00:00+08:00",
                    "effective_until": "",
                    "operational_comment": "更改通勤班车丰台校区乘车点。",
                }
            ],
            "transport_rejected_sources": [
                {
                    "schema_version": "transport_schedule_rejected_sources.v1",
                    "source_notice_id": "228282",
                    "source_ref": "notice:muc_internal_portal:228282",
                    "reason": "reservation_open_time_only",
                    "candidate_kind": "transport_schedule",
                }
            ],
        }
        cursor = _RecordingCursor()

        with patch(
            "campus_ingestion_core.structured_projection_postgres._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            publisher.publish_release(
                corpus="campus_services",
                collection="transport_schedule",
                release_id="transport-schedule-20260427T090000",
                generated_at="2026-04-27T09:00:00+08:00",
                schema_version="campus_services_projection_bundle.v1",
                artifact_object_key=(
                    "campus_services/releases/transport_schedule/transport-schedule-"
                    "20260427T090000/campus-services-projection.json"
                ),
                artifact_checksum="sha256:test",
                bundle=bundle,
                validation_status="valid",
            )

        executed_sql = "\n".join(query for query, _params in cursor.execute_calls)
        self.assertIn("transport_operational_notices", executed_sql)
        self.assertIn("transport_rejected_sources", executed_sql)
        operational_insert_index = next(
            index
            for index, (query, _params) in enumerate(cursor.execute_calls)
            if "transport_operational_notices" in query and "jsonb_to_recordset" in query
        )
        rejected_insert_index = next(
            index
            for index, (query, _params) in enumerate(cursor.execute_calls)
            if "transport_rejected_sources" in query and "jsonb_to_recordset" in query
        )
        operational_payload = json.loads(cursor.execute_calls[operational_insert_index][1][0])
        rejected_payload = json.loads(cursor.execute_calls[rejected_insert_index][1][0])
        self.assertEqual(operational_payload[0]["notice_kind"], "boarding_point_change")
        self.assertEqual(rejected_payload[0]["reason"], "reservation_open_time_only")

    def test_publish_service_guide_release_writes_service_records_and_review_tables(self) -> None:
        publisher = object.__new__(PostgresStructuredProjectionPublisher)
        publisher.database_url = "postgresql://projection.example/db"
        publisher.schema = "ingestion_projection"
        bundle = {
            "schema_version": "campus_services_service_guide_projection.v1",
            "service_guide_records": [
                {
                    "service_id": "service:transport-reservation:subway-shuttle",
                    "display_name": "地铁接驳车预约说明",
                    "guide_sections": [
                        {
                            "section_id": "service:transport-reservation:subway-shuttle:section:procedure",
                            "section_type": "procedure",
                            "title": "预约流程",
                            "content": "1. 打开民大通。 2. 选择地铁接驳车预约。",
                            "order": 1,
                            "source_refs": ["notice:muc_internal_portal:354777"],
                        }
                    ],
                    "procedure_groups": [
                        {
                            "group_id": (
                                "service:transport-reservation:subway-shuttle:"
                                "procedure_group:reservation"
                            ),
                            "title": "预约流程",
                            "focus_tags": ["procedure", "reservation"],
                            "order": 1,
                            "steps": [
                                {
                                    "step_id": (
                                        "service:transport-reservation:subway-shuttle:"
                                        "procedure_group:reservation:step:1"
                                    ),
                                    "content": "打开民大通。",
                                    "order": 1,
                                    "source_refs": ["notice:muc_internal_portal:354777"],
                                }
                            ],
                            "source_refs": ["notice:muc_internal_portal:354777"],
                        }
                    ],
                    "materials": [
                        {
                            "material_id": "service:transport-reservation:subway-shuttle:material:1",
                            "name": "预约凭证",
                            "required": True,
                            "note": "上车时出示",
                            "source_refs": ["notice:muc_internal_portal:354777"],
                        }
                    ],
                    "entry_refs": [
                        {
                            "entry_id": "service:transport-reservation:subway-shuttle:entry:1",
                            "label": "民大通",
                            "entry_type": "app",
                            "url": "",
                            "location_ref": "",
                            "source_refs": ["notice:muc_internal_portal:354777"],
                        }
                    ],
                    "office_hours": [
                        {
                            "hours_id": "service:transport-reservation:subway-shuttle:hours:1",
                            "label": "预约开放时间",
                            "day_pattern": "工作日",
                            "time_range": "09:00-22:00",
                            "effective_note": "",
                            "source_refs": ["notice:muc_internal_portal:354777"],
                        }
                    ],
                    "contact_refs": [
                        {
                            "contact_id": "service:transport-reservation:subway-shuttle:contact:1",
                            "label": "后勤保障处",
                            "department": "后勤保障处",
                            "phone": "010-68930000",
                            "email": "",
                            "location_ref": "",
                            "source_refs": ["notice:muc_internal_portal:354777"],
                        }
                    ],
                    "eligibility_notes": ["仅限在校学生预约。"],
                    "field_status": {
                        "service_process": "present",
                        "service_entry": "present",
                        "office_hours": "present",
                        "phone": "present",
                    },
                    "source_refs": ["notice:muc_internal_portal:354777"],
                    "extraction_status": "ready",
                }
            ],
            "conflict_records": [{"service_id": "service:conflicted"}],
            "manual_review_sources": [{"service_id": "service:manual"}],
        }
        cursor = _RecordingCursor()

        with patch(
            "campus_ingestion_core.structured_projection_postgres._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            publisher.publish_release(
                corpus="campus_services",
                collection="service_guide",
                release_id="service-guide-20260427T090000",
                generated_at="2026-04-27T09:00:00+08:00",
                schema_version="campus_services_service_guide_projection.v1",
                artifact_object_key=(
                    "campus_services/releases/service_guide/service-guide-"
                    "20260427T090000/service-guide-projection.json"
                ),
                artifact_checksum="sha256:test",
                bundle=bundle,
                validation_status="valid",
            )

        executed_sql = "\n".join(query for query, _params in cursor.execute_calls)
        self.assertIn("service_guide_read_model", executed_sql)
        self.assertIn("service_guide_conflicts", executed_sql)
        self.assertIn("service_guide_manual_review_sources", executed_sql)
        self.assertIn("service_id", executed_sql)
        self.assertIn("search_text", executed_sql)
        self.assertIn("procedure_groups", executed_sql)
        self.assertIn("field_status", executed_sql)
        self.assertIn("entry_refs", executed_sql)
        self.assertIn("office_hours", executed_sql)
        self.assertIn("contact_refs", executed_sql)
        typed_insert_index = next(
            index
            for index, (query, _params) in enumerate(cursor.execute_calls)
            if "service_guide_read_model" in query and "jsonb_to_recordset" in query
        )
        typed_payload = json.loads(cursor.execute_calls[typed_insert_index][1][0])
        self.assertEqual(
            typed_payload[0]["procedure_groups"][0]["group_id"],
            "service:transport-reservation:subway-shuttle:procedure_group:reservation",
        )
        self.assertEqual(
            typed_payload[0]["entry_refs"][0]["label"],
            "民大通",
        )
        self.assertEqual(
            typed_payload[0]["office_hours"][0]["label"],
            "预约开放时间",
        )
        self.assertEqual(
            typed_payload[0]["contact_refs"][0]["phone"],
            "010-68930000",
        )
        self.assertEqual(
            typed_payload[0]["eligibility_notes"],
            ["仅限在校学生预约。"],
        )
        self.assertEqual(
            typed_payload[0]["field_status"]["service_process"],
            "present",
        )

    def test_publish_service_guide_release_keeps_flat_legacy_record_compatible(self) -> None:
        publisher = object.__new__(PostgresStructuredProjectionPublisher)
        publisher.database_url = "postgresql://projection.example/db"
        publisher.schema = "ingestion_projection"
        bundle = {
            "schema_version": "campus_services_service_guide_projection.v1",
            "service_guide_records": [
                {
                    "service_id": "service:handbook:legacy-check-in",
                    "display_name": "宿舍入住办理",
                    "aliases": ["宿舍入住", "入住"],
                    "category": "student_housing",
                    "campus_scope": "all",
                    "audience": ["student"],
                    "effective_from": "2018-09-01T00:00:00+08:00",
                    "effective_until": "2099-12-31T23:59:59+08:00",
                    "source_refs": ["handbook:student_rules:pages:252-255#page=253"],
                    "guide_sections": [
                        {
                            "section_id": "service:handbook:legacy-check-in:section:procedure",
                            "section_type": "procedure",
                            "title": "宿舍入住办理",
                            "content": "1. 持通知书到院系注册。 2. 到指定公寓楼报到。",
                            "order": 1,
                            "source_refs": ["handbook:student_rules:pages:252-255#page=253"],
                        }
                    ],
                    "materials": [],
                    "entry_refs": [],
                    "office_hours": [],
                    "contact_refs": [],
                    "eligibility_notes": ["新生"],
                    "extraction_status": "ready",
                }
            ],
            "conflict_records": [],
            "manual_review_sources": [],
        }
        cursor = _RecordingCursor()

        with patch(
            "campus_ingestion_core.structured_projection_postgres._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            publisher.publish_release(
                corpus="campus_services",
                collection="service_guide",
                release_id="service-guide-legacy-20260504T090000",
                generated_at="2026-05-04T09:00:00+08:00",
                schema_version="campus_services_service_guide_projection.v1",
                artifact_object_key=(
                    "campus_services/releases/service_guide/service-guide-"
                    "legacy-20260504T090000/service-guide-projection.json"
                ),
                artifact_checksum="sha256:test",
                bundle=bundle,
                validation_status="valid",
            )

        typed_insert_index = next(
            index
            for index, (query, _params) in enumerate(cursor.execute_calls)
            if "service_guide_read_model" in query and "jsonb_to_recordset" in query
        )
        typed_payload = json.loads(cursor.execute_calls[typed_insert_index][1][0])
        self.assertEqual(
            typed_payload[0]["record"]["service_id"], "service:handbook:legacy-check-in"
        )
        self.assertEqual(typed_payload[0]["procedure_groups"], None)
        self.assertEqual(typed_payload[0]["field_status"], None)


if __name__ == "__main__":
    unittest.main()
