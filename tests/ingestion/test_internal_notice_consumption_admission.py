from __future__ import annotations

import json
import unittest
from dataclasses import asdict
from unittest.mock import patch

from campus_ingestion_core.internal_notice_consumption_admission import (
    InMemoryInternalNoticeConsumptionAdmissionStore,
    InternalNoticeConsumptionAdmissionEventRecord,
    InternalNoticeConsumptionAdmissionRecord,
    PostgresInternalNoticeConsumptionAdmissionStore,
    build_internal_notice_consumption_admission_record,
    build_internal_notice_consumption_admission_store_from_env,
    record_internal_notice_consumption_admission,
)


class InternalNoticeConsumptionAdmissionTest(unittest.TestCase):
    def test_record_internal_notice_consumption_admission_writes_to_store(self) -> None:
        store = _CapturingAdmissionStore()

        batch_id = record_internal_notice_consumption_admission(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            command="projection_rebuild",
            notice_ids=("351907", "351907", "355222"),
            result_counts={"projection_entry_count": 4},
            selection_source="selection_path",
            selection_path="/tmp/selected-notices.json",
            selection_sha256="sha256-selection",
            command_args={"selection_path": "/tmp/selected-notices.json"},
            store=store,
        )

        self.assertTrue(batch_id.startswith("internal_notice_consumption:projection_rebuild:"))
        self.assertEqual(len(store.records), 1)
        record = store.records[0]
        self.assertEqual(record.selected_notice_ids, ("351907", "355222"))
        self.assertEqual(record.result_counts, {"projection_entry_count": 4})
        self.assertEqual(record.selection_source, "selection_path")
        self.assertEqual(record.selection_path, "/tmp/selected-notices.json")
        self.assertEqual(record.selection_sha256, "sha256-selection")
        self.assertEqual(record.command_args, {"selection_path": "/tmp/selected-notices.json"})

    def test_build_record_preserves_batch_id_for_lifecycle_updates(self) -> None:
        started = build_internal_notice_consumption_admission_record(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            command="multimodal_process",
            notice_ids=("351907",),
            status="started",
        )
        completed = build_internal_notice_consumption_admission_record(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            command="multimodal_process",
            notice_ids=("351907",),
            status="completed",
            batch_id=started.batch_id,
            created_at=started.created_at,
            result_counts={"processed_count": 1},
        )

        self.assertEqual(completed.batch_id, started.batch_id)
        self.assertEqual(completed.created_at, started.created_at)
        self.assertEqual(completed.status, "completed")
        self.assertEqual(completed.result_counts, {"processed_count": 1})

    def test_build_record_preserves_selection_provenance(self) -> None:
        record = build_internal_notice_consumption_admission_record(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            command="read_model_rebuild",
            notice_ids=("355222",),
            selection_source="explicit_notice_ids",
            selection_path="",
            selection_sha256="",
            command_args={"notice_ids": ["355222"], "selection_source": "explicit_notice_ids"},
        )

        self.assertEqual(record.selection_source, "explicit_notice_ids")
        self.assertEqual(record.selection_path, "")
        self.assertEqual(record.selection_sha256, "")
        self.assertEqual(
            record.command_args,
            {"notice_ids": ["355222"], "selection_source": "explicit_notice_ids"},
        )

    def test_in_memory_store_keeps_current_batch_and_append_only_events(self) -> None:
        store = InMemoryInternalNoticeConsumptionAdmissionStore()
        started_batch_id = record_internal_notice_consumption_admission(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            command="multimodal_drain",
            notice_ids=("351907",),
            status="started",
            created_at="2026-04-25T00:00:00Z",
            store=store,
        )

        record_internal_notice_consumption_admission(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            command="multimodal_drain",
            notice_ids=("351907",),
            status="completed",
            batch_id=started_batch_id,
            created_at="2026-04-25T00:00:00Z",
            result_counts={"processed_count": 1},
            store=store,
        )

        current_records = store.list_records(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            commands=("multimodal_drain",),
            limit=10,
        )
        events = store.list_events(
            source_corpus="campus_notices",
            source_collection="internal_notice",
            batch_ids=(started_batch_id,),
            limit=10,
        )

        self.assertEqual(len(current_records), 1)
        self.assertEqual(current_records[0].status, "completed")
        self.assertEqual([event.status for event in events], ["started", "completed"])
        self.assertEqual(len({event.event_id for event in events}), 2)
        self.assertIsInstance(events[0], InternalNoticeConsumptionAdmissionEventRecord)

    def test_postgres_store_records_admission_batch_payload(self) -> None:
        store = object.__new__(PostgresInternalNoticeConsumptionAdmissionStore)
        store.database_url = "postgresql://example.test/db"
        store.table_name = "ingestion_projection.internal_notice_consumption_admission"
        store.event_table_name = "ingestion_projection.internal_notice_consumption_admission_event"
        cursor = _PagedCursor([])

        with patch(
            "campus_ingestion_core.internal_notice_consumption_admission._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            store.record(
                InternalNoticeConsumptionAdmissionRecord(
                    batch_id="batch-001",
                    source_corpus="campus_notices",
                    source_collection="internal_notice",
                    command="projection_rebuild",
                    selected_notice_ids=("351907", "355222"),
                    status="completed",
                    result_counts={"projection_entry_count": 4},
                    created_at="2026-04-25T00:00:00Z",
                    error="",
                    selection_source="selection_path",
                    selection_path="/tmp/selected-notices.json",
                    selection_sha256="sha256-selection",
                    command_args={"selection_path": "/tmp/selected-notices.json"},
                )
            )

        query, params = cursor.execute_calls[0]
        self.assertIn("insert into", query)
        self.assertIn("on conflict (batch_id) do update", query)
        self.assertEqual(params[0], "batch-001")
        self.assertEqual(params[4], ["351907", "355222"])
        self.assertEqual(params[7], "")
        self.assertEqual(json.loads(params[8])["projection_entry_count"], 4)
        self.assertEqual(params[9], "selection_path")
        self.assertEqual(params[10], "/tmp/selected-notices.json")
        self.assertEqual(params[11], "sha256-selection")
        self.assertEqual(json.loads(params[12]), {"selection_path": "/tmp/selected-notices.json"})
        event_query, event_params = cursor.execute_calls[1]
        self.assertIn("internal_notice_consumption_admission_event", event_query)
        self.assertIn("on conflict (event_id) do nothing", event_query)
        self.assertEqual(event_params[1], "batch-001")
        self.assertEqual(event_params[6], "completed")

    def test_postgres_store_lists_admission_batches_by_notice_command_and_status(self) -> None:
        store = object.__new__(PostgresInternalNoticeConsumptionAdmissionStore)
        store.database_url = "postgresql://example.test/db"
        store.table_name = "ingestion_projection.internal_notice_consumption_admission"
        store.event_table_name = "ingestion_projection.internal_notice_consumption_admission_event"
        record = InternalNoticeConsumptionAdmissionRecord(
            batch_id="batch-001",
            source_corpus="campus_notices",
            source_collection="internal_notice",
            command="multimodal_process",
            selected_notice_ids=("351907",),
            status="completed",
            result_counts={"processed_count": 1},
            created_at="2026-04-25T00:00:00Z",
            error="",
            selection_source="explicit_notice_ids",
            selection_path="",
            selection_sha256="",
            command_args={"notice_ids": ["351907"]},
        )
        cursor = _PagedCursor([[(json.dumps(asdict(record)),)]])

        with patch(
            "campus_ingestion_core.internal_notice_consumption_admission._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            records = store.list_records(
                source_corpus="campus_notices",
                source_collection="internal_notice",
                notice_ids=("351907",),
                commands=("multimodal_process",),
                statuses=("completed",),
                limit=20,
            )

        self.assertEqual(records, (record,))
        query, params = cursor.execute_calls[0]
        self.assertIn("selected_notice_ids && %s", query)
        self.assertIn("command = any(%s)", query)
        self.assertIn("status = any(%s)", query)
        self.assertIn("limit %s", query)
        self.assertEqual(
            params,
            (
                "campus_notices",
                "internal_notice",
                ["351907"],
                ["multimodal_process"],
                ["completed"],
                20,
            ),
        )

    def test_postgres_store_lists_append_only_admission_events(self) -> None:
        store = object.__new__(PostgresInternalNoticeConsumptionAdmissionStore)
        store.database_url = "postgresql://example.test/db"
        store.table_name = "ingestion_projection.internal_notice_consumption_admission"
        store.event_table_name = "ingestion_projection.internal_notice_consumption_admission_event"
        event = InternalNoticeConsumptionAdmissionEventRecord(
            event_id="event-001",
            batch_id="batch-001",
            source_corpus="campus_notices",
            source_collection="internal_notice",
            command="multimodal_drain",
            selected_notice_ids=("351907",),
            status="started",
            result_counts={},
            created_at="2026-04-25T00:00:00Z",
            event_created_at="2026-04-25T00:00:01Z",
            error="",
            selection_source="projection_pending_scan",
            selection_path="",
            selection_sha256="",
            command_args={"limit": 10},
        )
        cursor = _PagedCursor([[(json.dumps(asdict(event)),)]])

        with patch(
            "campus_ingestion_core.internal_notice_consumption_admission._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            events = store.list_events(
                source_corpus="campus_notices",
                source_collection="internal_notice",
                batch_ids=("batch-001",),
                commands=("multimodal_drain",),
                statuses=("started",),
                limit=20,
            )

        self.assertEqual(events, (event,))
        query, params = cursor.execute_calls[0]
        self.assertIn("batch_id = any(%s)", query)
        self.assertIn("command = any(%s)", query)
        self.assertIn("status = any(%s)", query)
        self.assertEqual(
            params,
            (
                "campus_notices",
                "internal_notice",
                ["batch-001"],
                ["multimodal_drain"],
                ["started"],
                20,
            ),
        )

    def test_builder_uses_dedicated_database_url_before_shared_postgres(self) -> None:
        with patch(
            "campus_ingestion_core.internal_notice_consumption_admission.PostgresInternalNoticeConsumptionAdmissionStore"
        ) as store_cls:
            build_internal_notice_consumption_admission_store_from_env(
                {
                    "INTERNAL_NOTICE_CONSUMPTION_ADMISSION_DATABASE_URL": "postgresql://admission/db",
                    "CAMPUS_SHARED_POSTGRES_URL": "postgresql://shared/db",
                }
            )

        store_cls.assert_called_once_with(database_url="postgresql://admission/db")

    def test_builder_rejects_projection_url_without_admission_or_shared_url(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "INTERNAL_NOTICE_CONSUMPTION_ADMISSION_DATABASE_URL or CAMPUS_SHARED_POSTGRES_URL",
        ):
            build_internal_notice_consumption_admission_store_from_env(
                {
                    "NOTICE_CONSUMPTION_PROJECTION_DATABASE_URL": "postgresql://projection/db",
                }
            )


class _CapturingAdmissionStore:
    def __init__(self) -> None:
        self.records: list[InternalNoticeConsumptionAdmissionRecord] = []

    def record(self, record: InternalNoticeConsumptionAdmissionRecord) -> None:
        self.records.append(record)


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


class _PagedCursor:
    def __init__(self, pages: list[list[tuple[object, ...]]]) -> None:
        self._pages = list(pages)
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []

    def execute(self, query: str, params: tuple[object, ...] = ()) -> None:
        self.execute_calls.append((query, params))

    def fetchall(self) -> list[tuple[object, ...]]:
        if not self._pages:
            return []
        return self._pages.pop(0)


if __name__ == "__main__":
    unittest.main()
