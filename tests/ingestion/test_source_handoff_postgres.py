from __future__ import annotations

import unittest

from campus_ingestion_core.source_handoff_postgres import (
    DEFAULT_INGESTION_CONTROL_SCHEMA,
    build_ingestion_control_schema_sql,
)


class SourceHandoffPostgresTest(unittest.TestCase):
    def test_bootstrap_sql_is_additive_and_declares_canonical_tables(self) -> None:
        sql = build_ingestion_control_schema_sql()

        self.assertIn(f"create schema if not exists {DEFAULT_INGESTION_CONTROL_SCHEMA}", sql)
        for table_name in (
            "source_handoffs",
            "source_handoff_objects",
            "source_object_verifications",
            "ingestion_executions",
            "ingestion_steps",
            "ingestion_child_tasks",
            "ingestion_events",
        ):
            self.assertIn(
                f"create table if not exists {DEFAULT_INGESTION_CONTROL_SCHEMA}.{table_name}", sql
            )
        self.assertIn("for update skip locked", sql.lower())
        self.assertNotIn("drop table", sql.lower())
        self.assertNotIn("official_web.", sql)


if __name__ == "__main__":
    unittest.main()
