from __future__ import annotations

import json

import unittest

from unittest.mock import patch

from campus_ingestion_core.structured_projection_postgres import (
    PostgresStructuredProjectionPublisher,
    build_structured_projection_publisher_from_env,
)


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


__all__ = [name for name in globals() if not name.startswith("__")]
