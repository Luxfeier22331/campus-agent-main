from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.structured_projection_postgres import (
    PostgresStructuredProjectionPublisher,
    build_structured_projection_publisher_from_env,
)


class StructuredProjectionPostgresPublisherTest(unittest.TestCase):
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
                    "source_refs": ["notice:muc_internal_portal:354777"],
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

    def test_publish_service_status_release_writes_pg_read_model(self) -> None:
        publisher = object.__new__(PostgresStructuredProjectionPublisher)
        publisher.database_url = "postgresql://projection.example/db"
        publisher.schema = "ingestion_projection"
        bundle = {
            "schema_version": "campus_services_projection_bundle.v1",
            "service_status_records": [
                {
                    "subject_id": "library-haidian",
                    "display_name": "海淀校区图书馆",
                    "aliases": ["图书馆"],
                    "campus_scope": "haidian",
                    "observed_status": "open",
                    "effective_from": "2026-04-24T08:00:00+08:00",
                    "effective_until": "2026-04-24T22:00:00+08:00",
                    "override_source_refs": ["notice:library-hours"],
                    "related_notice_refs": ["notice:library-hours"],
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
                collection="service_status",
                release_id="service-status-20260427T090000",
                generated_at="2026-04-27T09:00:00+08:00",
                schema_version="campus_services_projection_bundle.v1",
                artifact_object_key=(
                    "campus_services/releases/service_status/service-status-"
                    "20260427T090000/service-status-projection.json"
                ),
                artifact_checksum="sha256:test",
                bundle=bundle,
                validation_status="valid",
            )

        executed_sql = "\n".join(query for query, _params in cursor.execute_calls)
        self.assertIn("service_status_read_model", executed_sql)
        self.assertIn("subject_id", executed_sql)
        self.assertIn("observed_status", executed_sql)
        typed_insert_index = next(
            index
            for index, (query, _params) in enumerate(cursor.execute_calls)
            if "service_status_read_model" in query and "jsonb_to_recordset" in query
        )
        typed_payload = json.loads(cursor.execute_calls[typed_insert_index][1][0])
        self.assertEqual(typed_payload[0]["record_id"], "library-haidian")

    def test_typed_insert_outer_select_reads_cte_columns_not_recordset_alias(self) -> None:
        query = PostgresStructuredProjectionPublisher._recordset_insert_query(
            "service_status_read_model",
            '"ingestion_projection"."service_status_read_model"',
        )

        outer_select = query.split(")\n            select", maxsplit=1)[1].split(
            "from rows",
            maxsplit=1,
        )[0]

        self.assertNotIn("item.", outer_select)
        self.assertIn("subject_id", outer_select)
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


class _FakeCursorContextManager:
    def __init__(self, cursor: object) -> None:
        self._cursor = cursor

    def __enter__(self) -> object:
        return self._cursor

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


class _FakeConnectionContextManager:
    def __init__(self, cursor: object) -> None:
        self._cursor = cursor

    def __enter__(self) -> _FakeConnectionContextManager:
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False

    def cursor(self) -> _FakeCursorContextManager:
        return _FakeCursorContextManager(self._cursor)


class _RecordingCursor:
    def __init__(self, fetchone_results: list[tuple[object, ...] | None] | None = None) -> None:
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []
        self.fetchone_results = list(fetchone_results or [])

    def execute(self, query: str, params: tuple[object, ...] = ()) -> None:
        self.execute_calls.append((query, params))

    def fetchone(self) -> tuple[object, ...] | None:
        if not self.fetchone_results:
            return None
        return self.fetchone_results.pop(0)


if __name__ == "__main__":
    unittest.main()
