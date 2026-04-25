from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.internal_notice_consumption_admission import (
    InternalNoticeConsumptionAdmissionRecord,
    PostgresInternalNoticeConsumptionAdmissionStore,
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
            store=store,
        )

        self.assertTrue(batch_id.startswith("internal_notice_consumption:projection_rebuild:"))
        self.assertEqual(len(store.records), 1)
        record = store.records[0]
        self.assertEqual(record.selected_notice_ids, ("351907", "355222"))
        self.assertEqual(record.result_counts, {"projection_entry_count": 4})

    def test_postgres_store_records_admission_batch_payload(self) -> None:
        store = object.__new__(PostgresInternalNoticeConsumptionAdmissionStore)
        store.database_url = "postgresql://example.test/db"
        store.table_name = "ingestion_projection.internal_notice_consumption_admission"
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
                )
            )

        query, params = cursor.execute_calls[0]
        self.assertIn("insert into", query)
        self.assertIn("on conflict (batch_id) do update", query)
        self.assertEqual(params[0], "batch-001")
        self.assertEqual(params[4], ["351907", "355222"])
        self.assertEqual(json.loads(params[7])["projection_entry_count"], 4)

    def test_builder_uses_dedicated_database_url_before_projection_fallback(self) -> None:
        with patch(
            "campus_ingestion_core.internal_notice_consumption_admission.PostgresInternalNoticeConsumptionAdmissionStore"
        ) as store_cls:
            build_internal_notice_consumption_admission_store_from_env(
                {
                    "INTERNAL_NOTICE_CONSUMPTION_ADMISSION_DATABASE_URL": "postgresql://admission/db",
                    "NOTICE_CONSUMPTION_PROJECTION_DATABASE_URL": "postgresql://projection/db",
                }
            )

        store_cls.assert_called_once_with(database_url="postgresql://admission/db")


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
