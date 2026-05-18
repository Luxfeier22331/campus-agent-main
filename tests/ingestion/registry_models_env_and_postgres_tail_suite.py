from __future__ import annotations

from tests.ingestion.registry_models_test_support import *


class RegistryModelsEnvAndPostgresTailSuite(unittest.TestCase):
    def test_postgres_raw_asset_registry_list_by_scope_paginates_large_scope_reads(self) -> None:
        first = replace(
            _handbook_raw_asset_record(),
            raw_asset_id="asset:001",
            raw_version_id="sha256:001",
        )
        second = replace(
            _handbook_raw_asset_record(),
            raw_asset_id="asset:002",
            raw_version_id="sha256:002",
            content_hash="raw-002",
            object_key="official_pdf/student-handbook/undated/sha256/raw-002/capture/student-handbook.pdf",
        )
        page_rows = (
            ((json.dumps(asdict(first), ensure_ascii=False),),),
            ((json.dumps(asdict(second), ensure_ascii=False),),),
            (),
        )
        fetchall_calls: list[tuple[str, tuple[object, ...]]] = []

        def _fetchall(query: str, params: tuple[object, ...]) -> tuple[tuple[object, ...], ...]:
            fetchall_calls.append((query, params))
            return page_rows[len(fetchall_calls) - 1]

        with patch.object(PostgresRawAssetRegistry, "_ensure_schema", return_value=None):
            registry = PostgresRawAssetRegistry("postgresql://registry.example/postgres")

        with (
            patch("campus_ingestion_core.registry.DEFAULT_RAW_ASSET_REGISTRY_SCAN_PAGE_SIZE", 1),
            patch.object(registry, "_fetchall", side_effect=_fetchall),
        ):
            records = registry.list_by_scope("regulations", "student_rules")

        self.assertEqual(records, (first, second))
        self.assertEqual(len(fetchall_calls), 3)
        self.assertIn("limit %s", fetchall_calls[0][0].lower())
        self.assertEqual(fetchall_calls[0][1], ("regulations", "student_rules", 1))
        self.assertIn("(raw_asset_id, raw_version_id) > (%s, %s)", fetchall_calls[1][0])
        self.assertEqual(
            fetchall_calls[1][1],
            (
                "regulations",
                "student_rules",
                first.raw_asset_id,
                first.raw_version_id,
                1,
            ),
        )

    def test_postgres_document_registry_replace_scope_uses_bulk_recordset_insert(self) -> None:
        class _RecordingCursor:
            def __init__(self) -> None:
                self.execute_calls: list[tuple[str, tuple[object, ...] | None]] = []
                self.executemany_calls: list[tuple[str, tuple[tuple[object, ...], ...]]] = []

            def execute(self, sql: str, params: tuple[object, ...] | None = None) -> None:
                self.execute_calls.append((sql, params))

            def executemany(self, sql: str, params_seq) -> None:
                self.executemany_calls.append((sql, tuple(params_seq)))

        class _CursorContext:
            def __init__(self, cursor: _RecordingCursor) -> None:
                self.cursor = cursor

            def __enter__(self) -> _RecordingCursor:
                return self.cursor

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

        class _ConnectionContext:
            def __init__(self, cursor: _RecordingCursor) -> None:
                self._cursor = cursor

            def __enter__(self) -> _ConnectionContext:
                return self

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

            def cursor(self) -> _CursorContext:
                return _CursorContext(self._cursor)

        with patch.object(PostgresDocumentRegistry, "_ensure_schema", return_value=None):
            registry = PostgresDocumentRegistry("postgresql://registry.example/postgres")
        cursor = _RecordingCursor()
        handbook_record = _handbook_document_record(
            version_id="v2:test-001",
            content_hash="sha256:test-002",
            ingestion_timestamp="2026-03-23T10:00:00+00:00",
        )
        curriculum_record = _curriculum_document_record()

        with patch(
            "campus_ingestion_core.registry._postgres_connection",
            return_value=_ConnectionContext(cursor),
        ):
            registry.replace_scope(
                "regulations",
                "student_rules",
                (handbook_record, curriculum_record),
            )

        self.assertEqual(cursor.executemany_calls, [])
        self.assertTrue(any("jsonb_to_recordset" in sql for sql, _params in cursor.execute_calls))

    def test_postgres_raw_asset_registry_upsert_many_uses_bulk_recordset_insert(self) -> None:
        class _RecordingCursor:
            def __init__(self) -> None:
                self.execute_calls: list[tuple[str, tuple[object, ...] | None]] = []
                self.executemany_calls: list[tuple[str, tuple[tuple[object, ...], ...]]] = []

            def execute(self, sql: str, params: tuple[object, ...] | None = None) -> None:
                self.execute_calls.append((sql, params))

            def executemany(self, sql: str, params_seq) -> None:
                self.executemany_calls.append((sql, tuple(params_seq)))

        class _CursorContext:
            def __init__(self, cursor: _RecordingCursor) -> None:
                self.cursor = cursor

            def __enter__(self) -> _RecordingCursor:
                return self.cursor

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

        class _ConnectionContext:
            def __init__(self, cursor: _RecordingCursor) -> None:
                self._cursor = cursor

            def __enter__(self) -> _ConnectionContext:
                return self

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

            def cursor(self) -> _CursorContext:
                return _CursorContext(self._cursor)

        with patch.object(PostgresRawAssetRegistry, "_ensure_schema", return_value=None):
            registry = PostgresRawAssetRegistry("postgresql://registry.example/postgres")
        cursor = _RecordingCursor()
        first = replace(
            _handbook_raw_asset_record(),
            raw_asset_id="asset:001",
            raw_version_id="sha256:001",
        )
        second = replace(
            _curriculum_raw_asset_record(),
            raw_asset_id="asset:002",
            raw_version_id="sha256:002",
        )

        with patch(
            "campus_ingestion_core.registry._postgres_connection",
            return_value=_ConnectionContext(cursor),
        ):
            registry.upsert_many((first, second))

        self.assertEqual(cursor.executemany_calls, [])
        self.assertTrue(any("jsonb_to_recordset" in sql for sql, _params in cursor.execute_calls))

    def test_attachment_fetch_status_store_repairs_legacy_fetch_status_check(self) -> None:
        class _RecordingCursor:
            def __init__(self) -> None:
                self.execute_calls: list[tuple[str, tuple[object, ...] | None]] = []

            def execute(self, sql: str, params: tuple[object, ...] | None = None) -> None:
                self.execute_calls.append((sql, params))

            def fetchall(self) -> list[tuple[str]]:
                return [("authenticated_notice_attachment_fetch_status_fetch_status_check",)]

        class _CursorContext:
            def __init__(self, cursor: _RecordingCursor) -> None:
                self.cursor = cursor

            def __enter__(self) -> _RecordingCursor:
                return self.cursor

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

        class _ConnectionContext:
            def __init__(self, cursor: _RecordingCursor) -> None:
                self._cursor = cursor

            def __enter__(self) -> _ConnectionContext:
                return self

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

            def cursor(self) -> _CursorContext:
                return _CursorContext(self._cursor)

        cursor = _RecordingCursor()

        with patch(
            "campus_ingestion_core.authenticated_notice_attachment_fetch_status_store._patched_postgres_connection",
            return_value=_ConnectionContext(cursor),
        ):
            PostgresAuthenticatedNoticeAttachmentFetchStatusStore(
                "postgresql://registry.example/postgres"
            )

        statements = [sql for sql, _params in cursor.execute_calls]
        self.assertTrue(
            any(
                'drop constraint if exists "authenticated_notice_attachment_fetch_status_fetch_status_check"'
                in sql
                for sql in statements
            )
        )
        self.assertTrue(any("'reference_only'" in sql for sql in statements))
