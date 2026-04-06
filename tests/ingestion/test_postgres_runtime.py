from __future__ import annotations

import importlib
import unittest
from unittest.mock import patch


SESSION_POOLER_URL = (
    "postgresql://postgres.project-ref:secret@"
    "aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require"
)
DIRECT_SUPABASE_URL = (
    "postgresql://postgres:secret@db.project-ref.supabase.co:5432/postgres?sslmode=require"
)
TRANSACTION_POOLER_URL = (
    "postgresql://postgres:secret@db.project-ref.supabase.co:6543/postgres?sslmode=require"
)


class PersistentPostgresRuntimeTest(unittest.TestCase):
    def tearDown(self) -> None:
        try:
            runtime = importlib.import_module("campus_ingestion_core.postgres_runtime")
        except ModuleNotFoundError:
            return
        runtime.close_persistent_postgres_pools()

    def test_validate_runtime_url_accepts_supabase_session_pooler(self) -> None:
        runtime = importlib.import_module("campus_ingestion_core.postgres_runtime")

        self.assertEqual(
            runtime.validate_persistent_postgres_runtime_url(SESSION_POOLER_URL),
            SESSION_POOLER_URL,
        )

    def test_validate_runtime_url_rejects_supabase_direct_connection(self) -> None:
        runtime = importlib.import_module("campus_ingestion_core.postgres_runtime")

        with self.assertRaisesRegex(ValueError, "session pooler"):
            runtime.validate_persistent_postgres_runtime_url(DIRECT_SUPABASE_URL)

    def test_validate_runtime_url_rejects_supabase_transaction_pooler(self) -> None:
        runtime = importlib.import_module("campus_ingestion_core.postgres_runtime")

        with self.assertRaisesRegex(ValueError, "session pooler"):
            runtime.validate_persistent_postgres_runtime_url(TRANSACTION_POOLER_URL)

    def test_validate_runtime_url_requires_sslmode_require_for_supabase_pooler(self) -> None:
        runtime = importlib.import_module("campus_ingestion_core.postgres_runtime")

        with self.assertRaisesRegex(ValueError, "sslmode=require"):
            runtime.validate_persistent_postgres_runtime_url(
                SESSION_POOLER_URL.replace("?sslmode=require", "")
            )

    def test_pooled_connection_reuses_same_pool_for_same_url_and_autocommit(self) -> None:
        runtime = importlib.import_module("campus_ingestion_core.postgres_runtime")

        created: list[object] = []

        class _BorrowContext:
            def __init__(self, pool: _FakePool) -> None:
                self.pool = pool

            def __enter__(self) -> object:
                self.pool.borrow_count += 1
                return object()

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

        class _FakePool:
            def __init__(self, *args, **kwargs) -> None:
                self.args = args
                self.kwargs = kwargs
                self.borrow_count = 0
                self.closed = False

            def connection(self) -> _BorrowContext:
                return _BorrowContext(self)

            def close(self) -> None:
                self.closed = True

        def _build_pool(*args, **kwargs) -> _FakePool:
            pool = _FakePool(*args, **kwargs)
            created.append(pool)
            return pool

        with patch("campus_ingestion_core.postgres_runtime.ConnectionPool", side_effect=_build_pool):
            with runtime.pooled_postgres_connection("postgresql://registry.example/postgres"):
                pass
            with runtime.pooled_postgres_connection("postgresql://registry.example/postgres"):
                pass

        self.assertEqual(len(created), 1)
        self.assertEqual(created[0].borrow_count, 2)

    def test_pooled_connection_separates_autocommit_pools(self) -> None:
        runtime = importlib.import_module("campus_ingestion_core.postgres_runtime")

        created: list[object] = []

        class _FakeConnection:
            def commit(self) -> None:
                return None

            def rollback(self) -> None:
                return None

        class _BorrowContext:
            def __init__(self, pool: _FakePool) -> None:
                self.pool = pool

            def __enter__(self) -> _FakeConnection:
                self.pool.borrow_count += 1
                return self.pool.connection_object

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

        class _FakePool:
            def __init__(self, *args, **kwargs) -> None:
                self.args = args
                self.kwargs = kwargs
                self.borrow_count = 0
                self.closed = False
                self.connection_object = _FakeConnection()

            def connection(self) -> _BorrowContext:
                return _BorrowContext(self)

            def close(self) -> None:
                self.closed = True

        def _build_pool(*args, **kwargs) -> _FakePool:
            pool = _FakePool(*args, **kwargs)
            created.append(pool)
            return pool

        with patch("campus_ingestion_core.postgres_runtime.ConnectionPool", side_effect=_build_pool):
            with runtime.pooled_postgres_connection("postgresql://registry.example/postgres"):
                pass
            with runtime.pooled_postgres_connection(
                "postgresql://registry.example/postgres",
                autocommit=False,
            ):
                pass

        self.assertEqual(len(created), 2)
        autocommit_values = sorted(
            bool(pool.kwargs["kwargs"]["autocommit"]) for pool in created
        )
        self.assertEqual(autocommit_values, [False, True])

    def test_pooled_connection_uses_lazy_single_connection_pool_for_supabase_session_pooler(
        self,
    ) -> None:
        runtime = importlib.import_module("campus_ingestion_core.postgres_runtime")

        created: list[object] = []

        class _BorrowContext:
            def __init__(self, pool: _FakePool) -> None:
                self.pool = pool

            def __enter__(self) -> object:
                self.pool.borrow_count += 1
                return object()

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

        class _FakePool:
            def __init__(self, *args, **kwargs) -> None:
                self.args = args
                self.kwargs = kwargs
                self.borrow_count = 0

            def connection(self) -> _BorrowContext:
                return _BorrowContext(self)

            def close(self) -> None:
                return None

        def _build_pool(*args, **kwargs) -> _FakePool:
            pool = _FakePool(*args, **kwargs)
            created.append(pool)
            return pool

        with patch("campus_ingestion_core.postgres_runtime.ConnectionPool", side_effect=_build_pool):
            with runtime.pooled_postgres_connection(SESSION_POOLER_URL):
                pass

        self.assertEqual(len(created), 1)
        self.assertEqual(
            created[0].kwargs["min_size"],
            runtime.SUPABASE_SESSION_POOLER_RUNTIME_POOL_MIN_SIZE,
        )
        self.assertEqual(
            created[0].kwargs["max_size"],
            runtime.SUPABASE_SESSION_POOLER_RUNTIME_POOL_MAX_SIZE,
        )

    def test_pooled_connection_keeps_default_pool_size_for_non_supabase_runtime(self) -> None:
        runtime = importlib.import_module("campus_ingestion_core.postgres_runtime")

        created: list[object] = []

        class _BorrowContext:
            def __init__(self, pool: _FakePool) -> None:
                self.pool = pool

            def __enter__(self) -> object:
                self.pool.borrow_count += 1
                return object()

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

        class _FakePool:
            def __init__(self, *args, **kwargs) -> None:
                self.args = args
                self.kwargs = kwargs
                self.borrow_count = 0

            def connection(self) -> _BorrowContext:
                return _BorrowContext(self)

            def close(self) -> None:
                return None

        def _build_pool(*args, **kwargs) -> _FakePool:
            pool = _FakePool(*args, **kwargs)
            created.append(pool)
            return pool

        with patch("campus_ingestion_core.postgres_runtime.ConnectionPool", side_effect=_build_pool):
            with runtime.pooled_postgres_connection("postgresql://registry.example/postgres"):
                pass

        self.assertEqual(len(created), 1)
        self.assertEqual(
            created[0].kwargs["min_size"],
            runtime.DEFAULT_PERSISTENT_POSTGRES_POOL_MIN_SIZE,
        )
        self.assertEqual(
            created[0].kwargs["max_size"],
            runtime.DEFAULT_PERSISTENT_POSTGRES_POOL_MAX_SIZE,
        )

    def test_pooled_connection_commits_non_autocommit_borrow_on_success(self) -> None:
        runtime = importlib.import_module("campus_ingestion_core.postgres_runtime")

        class _FakeConnection:
            def __init__(self) -> None:
                self.commit_count = 0
                self.rollback_count = 0

            def commit(self) -> None:
                self.commit_count += 1

            def rollback(self) -> None:
                self.rollback_count += 1

        class _BorrowContext:
            def __init__(self, connection: _FakeConnection) -> None:
                self.connection = connection

            def __enter__(self) -> _FakeConnection:
                return self.connection

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

        class _FakePool:
            def __init__(self, *args, **kwargs) -> None:
                del args, kwargs
                self.connection_object = _FakeConnection()

            def connection(self) -> _BorrowContext:
                return _BorrowContext(self.connection_object)

            def close(self) -> None:
                return None

        created: list[_FakePool] = []

        def _build_pool(*args, **kwargs) -> _FakePool:
            pool = _FakePool(*args, **kwargs)
            created.append(pool)
            return pool

        with patch("campus_ingestion_core.postgres_runtime.ConnectionPool", side_effect=_build_pool):
            with runtime.pooled_postgres_connection(
                "postgresql://registry.example/postgres",
                autocommit=False,
            ) as conn:
                self.assertIs(conn, created[0].connection_object)

        self.assertEqual(created[0].connection_object.commit_count, 1)
        self.assertEqual(created[0].connection_object.rollback_count, 0)

    def test_pooled_connection_rolls_back_non_autocommit_borrow_on_error(self) -> None:
        runtime = importlib.import_module("campus_ingestion_core.postgres_runtime")

        class _FakeConnection:
            def __init__(self) -> None:
                self.commit_count = 0
                self.rollback_count = 0

            def commit(self) -> None:
                self.commit_count += 1

            def rollback(self) -> None:
                self.rollback_count += 1

        class _BorrowContext:
            def __init__(self, connection: _FakeConnection) -> None:
                self.connection = connection

            def __enter__(self) -> _FakeConnection:
                return self.connection

            def __exit__(self, exc_type, exc, tb) -> bool:
                return False

        class _FakePool:
            def __init__(self, *args, **kwargs) -> None:
                del args, kwargs
                self.connection_object = _FakeConnection()

            def connection(self) -> _BorrowContext:
                return _BorrowContext(self.connection_object)

            def close(self) -> None:
                return None

        created: list[_FakePool] = []

        def _build_pool(*args, **kwargs) -> _FakePool:
            pool = _FakePool(*args, **kwargs)
            created.append(pool)
            return pool

        with patch("campus_ingestion_core.postgres_runtime.ConnectionPool", side_effect=_build_pool):
            with self.assertRaisesRegex(RuntimeError, "boom"):
                with runtime.pooled_postgres_connection(
                    "postgresql://registry.example/postgres",
                    autocommit=False,
                ):
                    raise RuntimeError("boom")

        self.assertEqual(created[0].connection_object.commit_count, 0)
        self.assertEqual(created[0].connection_object.rollback_count, 1)


if __name__ == "__main__":
    unittest.main()
