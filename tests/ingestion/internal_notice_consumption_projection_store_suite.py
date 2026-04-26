from __future__ import annotations

import json
import unittest
from dataclasses import asdict
from unittest.mock import patch

from campus_ingestion_core.notice_consumption_projection import (
    PostgresNoticeConsumptionProjectionStore,
)

from tests.ingestion.internal_notice_consumption_projection_test_support import (
    _FakeConnectionContextManager,
    _PagedCursor,
    _projection_entry,
)


class NoticeConsumptionProjectionPostgresStoreTest(unittest.TestCase):
    def test_postgres_store_list_by_scope_rehydrates_record_payloads(self) -> None:
        store = object.__new__(PostgresNoticeConsumptionProjectionStore)
        store.database_url = "postgresql://example.test/db"
        store.table_name = "ingestion_projection.notice_consumption_projection"
        entry = _projection_entry("000001")
        cursor = _PagedCursor([[(json.dumps(asdict(entry)),)]])

        with patch(
            "campus_ingestion_core.notice_consumption_projection._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            records = store.list_by_scope(
                "campus_notices",
                "internal_notice",
                notice_ids=("000001",),
            )

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].source_notice_id, entry.source_notice_id)
        self.assertEqual(records[0].primary_role, entry.primary_role)
        self.assertEqual(records[0].target_surface, entry.target_surface)
        self.assertEqual(records[0].consumption_status, entry.consumption_status)
        query, params = cursor.execute_calls[0]
        self.assertIn("source_notice_id = any(%s)", query)
        self.assertEqual(params, ("campus_notices", "internal_notice", ["000001"]))

    def test_postgres_store_replace_notices_deletes_selected_notice_units_before_upsert(
        self,
    ) -> None:
        store = object.__new__(PostgresNoticeConsumptionProjectionStore)
        store.database_url = "postgresql://example.test/db"
        store.table_name = "ingestion_projection.notice_consumption_projection"
        entry = _projection_entry("000001")
        cursor = _PagedCursor([])

        with patch(
            "campus_ingestion_core.notice_consumption_projection._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            store.replace_notices(
                "campus_notices",
                "internal_notice",
                notice_ids=("000001",),
                records=(entry,),
            )

        delete_query, delete_params = cursor.execute_calls[0]
        self.assertIn("source_notice_id = any(%s)", delete_query)
        self.assertEqual(delete_params, ("campus_notices", "internal_notice", ["000001"]))
        upsert_query, _upsert_params = cursor.execute_calls[1]
        self.assertIn("jsonb_to_recordset", upsert_query)


if __name__ == "__main__":
    unittest.main()
