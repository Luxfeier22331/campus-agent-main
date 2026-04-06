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


if __name__ == "__main__":
    unittest.main()
