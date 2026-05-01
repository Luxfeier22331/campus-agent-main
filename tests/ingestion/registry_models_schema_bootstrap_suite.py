from __future__ import annotations

from tests.ingestion.registry_models_test_support import *


class RegistryModelsSchemaBootstrapSuite(unittest.TestCase):
    def test_ensure_table_schema_serializes_schema_bootstrap_with_advisory_lock(self) -> None:
        class _RecordingCursor:
            def __init__(self) -> None:
                self.calls: list[tuple[str, tuple[object, ...] | None]] = []

            def execute(self, sql: str, params: tuple[object, ...] | None = None) -> None:
                self.calls.append((sql.strip(), params))

        cursor = _RecordingCursor()

        _ensure_table_schema(cursor, table_name="ingestion_closeout.closeout_runs")

        self.assertEqual(
            cursor.calls,
            [
                (
                    "select pg_advisory_lock(%s, hashtext(%s))",
                    (174901, "ingestion_closeout"),
                ),
                ('create schema if not exists "ingestion_closeout"', None),
                (
                    "select pg_advisory_unlock(%s, hashtext(%s))",
                    (174901, "ingestion_closeout"),
                ),
            ],
        )

    def test_ensure_table_schema_releases_advisory_lock_after_create_failure(self) -> None:
        class _FailingCursor:
            def __init__(self) -> None:
                self.calls: list[tuple[str, tuple[object, ...] | None]] = []

            def execute(self, sql: str, params: tuple[object, ...] | None = None) -> None:
                self.calls.append((sql.strip(), params))
                if sql.strip().startswith("create schema if not exists"):
                    raise RuntimeError("bootstrap failed")

        cursor = _FailingCursor()

        with self.assertRaisesRegex(RuntimeError, "bootstrap failed"):
            _ensure_table_schema(cursor, table_name="ingestion_closeout.closeout_runs")

        self.assertEqual(
            cursor.calls,
            [
                (
                    "select pg_advisory_lock(%s, hashtext(%s))",
                    (174901, "ingestion_closeout"),
                ),
                ('create schema if not exists "ingestion_closeout"', None),
                (
                    "select pg_advisory_unlock(%s, hashtext(%s))",
                    (174901, "ingestion_closeout"),
                ),
            ],
        )

    def test_registry_builders_require_database_url(self) -> None:
        with self.assertRaisesRegex(
            ValueError, "DOCUMENT_REGISTRY_DATABASE_URL or CAMPUS_SHARED_POSTGRES_URL"
        ):
            build_document_registry_from_env({})
        with self.assertRaisesRegex(
            ValueError,
            (
                "RAW_ASSET_REGISTRY_DATABASE_URL or DOCUMENT_REGISTRY_DATABASE_URL or "
                "CAMPUS_SHARED_POSTGRES_URL"
            ),
        ):
            build_raw_asset_registry_from_env({})
