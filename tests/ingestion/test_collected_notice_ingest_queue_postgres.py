from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from campus_ingestion_core.collected_notice_ingest_queue import (
    NoticeIngestObjectRef,
    build_notice_ingest_job,
)
from campus_ingestion_core.collected_notice_ingest_queue_postgres import (
    DEFAULT_NOTICE_INGEST_QUEUE_TABLE,
    PostgresNoticeIngestQueueStore,
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
    def __init__(self, rows: list[tuple[object, ...]] | None = None) -> None:
        self.rows = list(rows or [])
        self.execute_calls: list[tuple[str, tuple[object, ...]]] = []

    def execute(self, query: str, params: tuple[object, ...] = ()) -> None:
        self.execute_calls.append((query, params))

    def fetchone(self) -> tuple[object, ...] | None:
        if not self.rows:
            return None
        return self.rows.pop(0)

    def fetchall(self) -> list[tuple[object, ...]]:
        rows = list(self.rows)
        self.rows.clear()
        return rows


class PostgresNoticeIngestQueueStoreTest(unittest.TestCase):
    def test_postgres_schema_has_required_columns_unique_idempotency_and_status_check(self) -> None:
        cursor = _RecordingCursor()

        with patch(
            "campus_ingestion_core.collected_notice_ingest_queue_postgres._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            PostgresNoticeIngestQueueStore("postgresql://example.test/db")

        sql = "\n".join(query for query, _ in cursor.execute_calls)
        self.assertIn('create schema if not exists "ingestion_queue"', sql)
        self.assertIn("create table if not exists", sql)
        for column in (
            "job_id text primary key",
            "idempotency_key text not null",
            "job_kind text not null",
            "source_channel text not null",
            "source_surface text not null",
            "source_identity text not null",
            "capture_id text not null",
            "capture_manifest_object_ref jsonb not null",
            "source_object_refs jsonb not null",
            "content_hash text not null",
            "run_id text not null",
            "enqueue_source text not null",
            "replay_batch_id text not null",
            "priority integer not null",
            "status text not null",
            "attempt_count integer not null",
            "max_attempts integer not null",
            "leased_by text",
            "lease_expires_at timestamptz",
            "next_retry_after timestamptz",
            "last_error_code text",
            "last_error_message text",
            "created_at timestamptz not null",
            "updated_at timestamptz not null",
            "job_payload jsonb not null",
        ):
            self.assertIn(column, sql)
        self.assertIn("unique (idempotency_key)", sql)
        self.assertIn("check (status in", sql)

    def test_postgres_enqueue_uses_idempotent_insert_then_fetch_existing(self) -> None:
        job = _job("muc_internal_portal:355512", content_hash="sha256-a", priority=50)
        existing_row = _record_row(job, status="queued")
        cursor = _RecordingCursor([None, existing_row])
        store = object.__new__(PostgresNoticeIngestQueueStore)
        store.database_url = "postgresql://example.test/db"
        store.table_name = DEFAULT_NOTICE_INGEST_QUEUE_TABLE

        with patch(
            "campus_ingestion_core.collected_notice_ingest_queue_postgres._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            record = store.enqueue(job)

        self.assertEqual(record.job_id, job.job_id)
        insert_query = cursor.execute_calls[0][0].lower()
        select_query = cursor.execute_calls[1][0].lower()
        self.assertIn("on conflict (idempotency_key) do nothing", insert_query)
        self.assertIn("returning", insert_query)
        self.assertIn("where idempotency_key = %s", select_query)

    def test_postgres_lease_next_uses_skip_locked_and_expired_lease_condition(self) -> None:
        job = _job("muc_internal_portal:355512", content_hash="sha256-a", priority=50)
        cursor = _RecordingCursor([_record_row(job, status="leased", leased_by="worker-a")])
        store = object.__new__(PostgresNoticeIngestQueueStore)
        store.database_url = "postgresql://example.test/db"
        store.table_name = DEFAULT_NOTICE_INGEST_QUEUE_TABLE

        with patch(
            "campus_ingestion_core.collected_notice_ingest_queue_postgres._postgres_connection",
            return_value=_FakeConnectionContextManager(cursor),
        ):
            leased = store.lease_next(worker_id="worker-a", lease_seconds=300)

        self.assertEqual(leased.job_id, job.job_id)
        lease_query = cursor.execute_calls[0][0].lower()
        self.assertIn("for update skip locked", lease_query)
        self.assertIn("status = 'queued'", lease_query)
        self.assertIn("status = 'leased'", lease_query)
        self.assertIn("status = 'failed_retryable'", lease_query)
        self.assertIn("next_retry_after <= now()", lease_query)
        self.assertIn("lease_expires_at < now()", lease_query)
        self.assertIn("order by priority asc, created_at asc, job_id asc", lease_query)


def _job(source_identity: str, *, content_hash: str, priority: int) -> object:
    return build_notice_ingest_job(
        source_channel="authenticated_notice_portal",
        source_surface="notice",
        source_identity=source_identity,
        capture_id=f"capture:{source_identity}:{content_hash}",
        capture_manifest_object_ref=NoticeIngestObjectRef(
            bucket="campus-rag-source",
            key=f"authenticated_notice_portal/{content_hash}/notice-manifest.json",
            role="source-truth/notice-manifest.json",
        ),
        source_object_refs=(
            NoticeIngestObjectRef(
                bucket="campus-rag-source",
                key=f"authenticated_notice_portal/{content_hash}/bundle.json",
                role="collector-run/bundle.json",
            ),
        ),
        content_hash=content_hash,
        run_id="run-001",
        enqueue_source="historical_backfill",
        replay_batch_id="phase-4-7-backfill",
        priority=priority,
    )


def _record_row(job: object, *, status: str, leased_by: str | None = None) -> tuple[object, ...]:
    payload = job.to_payload()
    return (
        payload["job_id"],
        payload["idempotency_key"],
        payload["job_kind"],
        payload["source_channel"],
        payload["source_surface"],
        payload["source_identity"],
        payload["capture_id"],
        json.dumps(payload["capture_manifest_object_ref"]),
        json.dumps(payload["source_object_refs"]),
        payload["content_hash"],
        payload["run_id"],
        payload["enqueue_source"],
        payload["replay_batch_id"],
        payload["priority"],
        status,
        0,
        3,
        leased_by,
        None,
        None,
        None,
        None,
        "2026-04-29T12:00:00+00:00",
        "2026-04-29T12:00:00+00:00",
        json.dumps(payload),
    )


if __name__ == "__main__":
    unittest.main()
