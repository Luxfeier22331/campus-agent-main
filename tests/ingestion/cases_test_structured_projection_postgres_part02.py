# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.test_structured_projection_postgres_support import *


class StructuredProjectionPostgresPublisherTestPart02(unittest.TestCase):
    def test_publish_contact_directory_release_writes_pg_read_model_and_aux_tables(self) -> None:
        publisher = object.__new__(PostgresStructuredProjectionPublisher)
        publisher.database_url = "postgresql://projection.example/db"
        publisher.schema = "ingestion_projection"
        bundle = {
            "schema_version": "campus_services_contact_directory_projection.v1",
            "contact_records": [
                {
                    "contact_id": "contact:handbook:1234",
                    "display_name": "保卫处",
                    "aliases": ["保卫处"],
                    "contact_group": "校级办公与公共服务",
                    "department": "保卫处",
                    "phones": [{"phone_id": "contact:handbook:1234:phone:1", "number": "68930010"}],
                    "emails": [],
                    "location_refs": [],
                    "source_refs": ["handbook:student_rules:pages:261-261#page=261"],
                    "extraction_status": "ready",
                }
            ],
            "conflict_records": [
                {
                    "contact_id": "contact:handbook:conflicted",
                    "source_refs": ["handbook:student_rules:pages:261-261#page=261"],
                    "reason": "duplicate_phone_number",
                }
            ],
            "manual_review_sources": [
                {
                    "source_ref": "handbook:student_rules:pages:261-261#page=261",
                    "reason": "unparsed_handbook_phone_line",
                    "line": "招生办 6893-0001 ext.201",
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
                collection="contact_directory",
                release_id="contact-directory-20260427T090000",
                generated_at="2026-04-27T09:00:00+08:00",
                schema_version="campus_services_contact_directory_projection.v1",
                artifact_object_key=(
                    "campus_services/releases/contact_directory/contact-directory-"
                    "20260427T090000/contact-directory-projection.json"
                ),
                artifact_checksum="sha256:test",
                bundle=bundle,
                validation_status="valid",
            )

        executed_sql = "\n".join(query for query, _params in cursor.execute_calls)
        self.assertIn("contact_directory_read_model", executed_sql)
        self.assertIn("contact_directory_conflicts", executed_sql)
        self.assertIn("contact_directory_manual_review_sources", executed_sql)
        contact_insert_index = next(
            index
            for index, (query, _params) in enumerate(cursor.execute_calls)
            if "contact_directory_read_model" in query and "jsonb_to_recordset" in query
        )
        contact_payload = json.loads(cursor.execute_calls[contact_insert_index][1][0])
        self.assertEqual(contact_payload[0]["record_id"], "contact:handbook:1234")
        self.assertEqual(contact_payload[0]["display_name"], "保卫处")

    def test_publish_academic_calendar_release_writes_pg_read_model(self) -> None:
        publisher = object.__new__(PostgresStructuredProjectionPublisher)
        publisher.database_url = "postgresql://projection.example/db"
        publisher.schema = "ingestion_projection"
        bundle = {
            "schema_version": "academic_calendar_projection.v1",
            "academic_calendar_records": [
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
                    "source_refs": ["official_web:muc-public-academic-calendar:owver"],
                }
            ],
        }
        cursor = _RecordingCursor()

        with patch(
            "campus_ingestion_core.structured_projection_postgres._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            publisher.publish_release(
                corpus="calendar",
                collection="academic_calendar",
                release_id="academic-calendar-20260504T090000",
                generated_at="2026-05-04T09:00:00+08:00",
                schema_version="academic_calendar_projection.v1",
                artifact_object_key=(
                    "calendar/releases/academic_calendar/academic-calendar-20260504T090000/"
                    "academic-calendar-projection.json"
                ),
                artifact_checksum="sha256:test",
                bundle=bundle,
                validation_status="valid",
            )

        executed_sql = "\n".join(query for query, _params in cursor.execute_calls)
        self.assertIn("academic_calendar_read_model", executed_sql)
        self.assertIn("week_index", executed_sql)
        self.assertIn("holiday_name", executed_sql)
        typed_insert_index = next(
            index
            for index, (query, _params) in enumerate(cursor.execute_calls)
            if "academic_calendar_read_model" in query and "jsonb_to_recordset" in query
        )
        typed_payload = json.loads(cursor.execute_calls[typed_insert_index][1][0])
        self.assertEqual(typed_payload[0]["record"]["term_label"], "春季学期")
        self.assertEqual(typed_payload[0]["holiday_name"], "劳动节假期")
        self.assertEqual(typed_payload[0]["week_index"], 9)

    def test_typed_insert_outer_select_reads_cte_columns_not_recordset_alias(self) -> None:
        query = PostgresStructuredProjectionPublisher._recordset_insert_query(
            "transport_routes",
            '"ingestion_projection"."transport_routes"',
        )

        outer_select = query.split(")\n            select", maxsplit=1)[1].split(
            "from rows",
            maxsplit=1,
        )[0]

        self.assertNotIn("item.", outer_select)
        self.assertIn("route_id", outer_select)
        self.assertIn("array_agg(value)", query.split("from jsonb_to_recordset", maxsplit=1)[0])

    def test_release_upsert_updates_source_notice_ids_once(self) -> None:
        publisher = object.__new__(PostgresStructuredProjectionPublisher)
        publisher.schema = "ingestion_projection"

        query = publisher._release_upsert_query()

        self.assertEqual(query.count("source_notice_ids = excluded.source_notice_ids"), 1)

    def test_promote_release_updates_current_pointer_after_release_check(self) -> None:
        publisher = object.__new__(PostgresStructuredProjectionPublisher)
        publisher.database_url = "postgresql://projection.example/db"
        publisher.schema = "ingestion_projection"
        cursor = _RecordingCursor(fetchone_results=[("service-guide-20260427T090000",)])

        with patch(
            "campus_ingestion_core.structured_projection_postgres._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            publisher.promote_release(
                corpus="campus_services",
                collection="service_guide",
                release_id="service-guide-20260427T090000",
            )

        release_check_index = next(
            index
            for index, (query, _params) in enumerate(cursor.execute_calls)
            if "structured_projection_releases" in query and "select release_id" in query
        )
        current_pointer_index = next(
            index
            for index, (query, _params) in enumerate(cursor.execute_calls)
            if "structured_projection_current" in query and "on conflict" in query
        )
        self.assertLess(release_check_index, current_pointer_index)

    def test_publisher_env_uses_campus_shared_postgres_only(self) -> None:
        publisher = build_structured_projection_publisher_from_env(
            {
                "STRUCTURED_PROJECTION" + "_OPERATOR_DATABASE_URL": (
                    "postgresql://operator.example/db"
                ),
                "STRUCTURED_PROJECTION" + "_DATABASE_URL": "postgresql://runtime.example/db",
            }
        )

        self.assertIsNone(publisher)

        with patch.object(PostgresStructuredProjectionPublisher, "_ensure_schema"):
            publisher = build_structured_projection_publisher_from_env(
                {
                    "CAMPUS_SHARED_POSTGRES_URL": "postgres://shared.example/db",
                    "STRUCTURED_PROJECTION" + "_OPERATOR_DATABASE_URL": (
                        "postgresql://operator.example/db"
                    ),
                    "STRUCTURED_PROJECTION" + "_DATABASE_URL": ("postgresql://runtime.example/db"),
                    "STRUCTURED_PROJECTION" + "_SCHEMA": "custom_projection",
                }
            )

        if publisher is None:
            self.fail("publisher should be built from CAMPUS_SHARED_POSTGRES_URL")
        self.assertEqual(publisher.database_url, "postgres://shared.example/db")
        self.assertEqual(publisher.schema, "ingestion_projection")

    def test_publisher_env_accepts_collection_bootstrap_scope(self) -> None:
        with patch.object(PostgresStructuredProjectionPublisher, "_ensure_schema"):
            publisher = build_structured_projection_publisher_from_env(
                {
                    "CAMPUS_SHARED_POSTGRES_URL": "postgres://shared.example/db",
                },
                bootstrap_collections=("transport_schedule",),
            )

        if publisher is None:
            self.fail("publisher should be built from CAMPUS_SHARED_POSTGRES_URL")
        self.assertEqual(publisher.bootstrap_collections, ("transport_schedule",))

    def test_ensure_schema_limits_bootstrap_to_requested_collection(self) -> None:
        publisher = object.__new__(PostgresStructuredProjectionPublisher)
        publisher.database_url = "postgresql://projection.example/db"
        publisher.schema = "ingestion_projection"
        publisher.bootstrap_collections = ("transport_schedule",)
        cursor = _RecordingCursor()

        publisher._ensure_schema(cursor)

        executed_sql = "\n".join(query for query, _params in cursor.execute_calls)
        self.assertIn("transport_schedule_snapshots", executed_sql)
        self.assertIn("transport_routes", executed_sql)
        self.assertIn("transport_scheduled_departures", executed_sql)
        self.assertNotIn("service_guide_read_model", executed_sql)
        self.assertNotIn("contact_directory_read_model", executed_sql)
        self.assertNotIn("academic_calendar_read_model", executed_sql)


if __name__ == "__main__":
    unittest.main()
