from __future__ import annotations

import json
import os
from collections.abc import Sequence
from datetime import datetime

from campus_ingestion_core.collected_notice_ingest_queue import NoticeIngestJob
from campus_ingestion_core.collected_notice_ingest_queue_store import (
    DEFAULT_NOTICE_INGEST_QUEUE_LEASE_SECONDS,
    DEFAULT_NOTICE_INGEST_QUEUE_MAX_ATTEMPTS,
    NoticeIngestQueueLeaseError,
    NoticeIngestQueueNotFoundError,
    NoticeIngestQueueRecord,
    build_notice_ingest_queue_operator_summary,
    build_notice_ingest_queue_record,
    notice_ingest_job_from_payload,
    zero_status_counts,
)
from campus_ingestion_core.postgres_runtime import (
    build_operator_postgres_connection_url,
    normalize_postgres_connection_url,
)
from campus_ingestion_core.registry import (
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
    _coerce_json_payload,
    _ensure_table_schema,
    _postgres_connection,
    _qualified_table_sql,
    _table_index_suffix,
)

DEFAULT_NOTICE_INGEST_QUEUE_SCHEMA = "ingestion_queue"
DEFAULT_NOTICE_INGEST_QUEUE_BASENAME = "notice_ingest_jobs"
DEFAULT_NOTICE_INGEST_QUEUE_TABLE = (
    f"{DEFAULT_NOTICE_INGEST_QUEUE_SCHEMA}.{DEFAULT_NOTICE_INGEST_QUEUE_BASENAME}"
)
DEFAULT_NOTICE_INGEST_QUEUE_ENV_KEY = "NOTICE_INGEST_QUEUE_DATABASE_URL"
DEFAULT_NOTICE_INGEST_QUEUE_OPERATOR_ENV_KEY = "NOTICE_INGEST_QUEUE_OPERATOR_DATABASE_URL"
DEFAULT_NOTICE_INGEST_QUEUE_MANAGEMENT_ENV_KEY = "NOTICE_INGEST_QUEUE_MANAGEMENT_DATABASE_URL"


class PostgresNoticeIngestQueueStore:
    def __init__(
        self,
        database_url: str,
        *,
        table_name: str = DEFAULT_NOTICE_INGEST_QUEUE_TABLE,
    ) -> None:
        self.database_url = normalize_postgres_connection_url(database_url)
        if not self.database_url:
            raise ValueError("notice ingest queue database url is required")
        self.table_name = table_name
        self._ensure_schema()

    def enqueue(
        self,
        job: NoticeIngestJob,
        *,
        max_attempts: int = DEFAULT_NOTICE_INGEST_QUEUE_MAX_ATTEMPTS,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        record = build_notice_ingest_queue_record(job, max_attempts=max_attempts, now=now)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(self._insert_query(), _insert_params(record))
            row = cursor.fetchone()
            if row is not None:
                return _record_from_row(row)
            cursor.execute(
                f"{self._select_query()} where idempotency_key = %s",
                (record.idempotency_key,),
            )
            existing = cursor.fetchone()
            if existing is None:
                raise NoticeIngestQueueNotFoundError(
                    f"notice ingest job not found after enqueue: {record.idempotency_key}"
                )
            return _record_from_row(existing)

    def enqueue_many(
        self,
        jobs: Sequence[NoticeIngestJob],
        *,
        max_attempts: int = DEFAULT_NOTICE_INGEST_QUEUE_MAX_ATTEMPTS,
        now: datetime | None = None,
    ) -> tuple[NoticeIngestQueueRecord, ...]:
        return tuple(self.enqueue(job, max_attempts=max_attempts, now=now) for job in jobs)

    def get(self, job_id: str) -> NoticeIngestQueueRecord | None:
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(f"{self._select_query()} where job_id = %s", (str(job_id),))
            row = cursor.fetchone()
        return None if row is None else _record_from_row(row)

    def lease_next(
        self,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_NOTICE_INGEST_QUEUE_LEASE_SECONDS,
        replay_batch_id: str | None = None,
        run_id: str | None = None,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord | None:
        del now
        table_sql = _qualified_table_sql(self.table_name)
        replay_filter = ""
        run_filter = ""
        params: list[object] = []
        normalized_replay_batch_id = str(replay_batch_id or "").strip()
        if normalized_replay_batch_id:
            replay_filter = "and replay_batch_id = %s"
            params.append(normalized_replay_batch_id)
        normalized_run_id = str(run_id or "").strip()
        if normalized_run_id:
            run_filter = "and run_id = %s"
            params.append(normalized_run_id)
        params.extend((str(worker_id), int(lease_seconds)))
        query = f"""
            with candidate as (
                select job_id
                from {table_sql}
                where
                    (
                        status = 'queued'
                        or (
                        status = 'failed_retryable'
                        and (next_retry_after is null or next_retry_after <= now())
                        )
                        or (
                        status = 'leased'
                        and (lease_expires_at is null or lease_expires_at < now())
                        )
                    )
                    {replay_filter}
                    {run_filter}
                order by priority asc, created_at asc, job_id asc
                limit 1
                for update skip locked
            )
            update {table_sql} as queue
            set
                status = 'leased',
                leased_by = %s,
                lease_expires_at = now() + (%s * interval '1 second'),
                next_retry_after = null,
                updated_at = now()
            from candidate
            where queue.job_id = candidate.job_id
            returning {self._returning_columns("queue")}
        """
        with (
            _postgres_connection(self.database_url, autocommit=False) as conn,
            conn.cursor() as cursor,
        ):
            cursor.execute(query, tuple(params))
            row = cursor.fetchone()
        return None if row is None else _record_from_row(row)

    def heartbeat(
        self,
        job_id: str,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_NOTICE_INGEST_QUEUE_LEASE_SECONDS,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        del now
        table_sql = _qualified_table_sql(self.table_name)
        query = f"""
            update {table_sql}
            set
                lease_expires_at = now() + (%s * interval '1 second'),
                updated_at = now()
            where job_id = %s
                and status = 'leased'
                and leased_by = %s
                and (lease_expires_at is null or lease_expires_at > now())
            returning {self._returning_columns()}
        """
        return self._update_owned_job(
            query,
            (int(lease_seconds), str(job_id), str(worker_id)),
            job_id=str(job_id),
        )

    def release(
        self,
        job_id: str,
        *,
        worker_id: str,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        del now
        table_sql = _qualified_table_sql(self.table_name)
        query = f"""
            update {table_sql}
            set
                status = 'queued',
                leased_by = null,
                lease_expires_at = null,
                next_retry_after = null,
                updated_at = now()
            where job_id = %s
                and status = 'leased'
                and leased_by = %s
                and (lease_expires_at is null or lease_expires_at > now())
            returning {self._returning_columns()}
        """
        return self._update_owned_job(query, (str(job_id), str(worker_id)), job_id=str(job_id))

    def complete(
        self,
        job_id: str,
        *,
        worker_id: str,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        del now
        table_sql = _qualified_table_sql(self.table_name)
        query = f"""
            update {table_sql}
            set
                status = 'succeeded',
                leased_by = null,
                lease_expires_at = null,
                next_retry_after = null,
                last_error_code = null,
                last_error_message = null,
                updated_at = now()
            where job_id = %s
                and status = 'leased'
                and leased_by = %s
                and (lease_expires_at is null or lease_expires_at > now())
            returning {self._returning_columns()}
        """
        return self._update_owned_job(query, (str(job_id), str(worker_id)), job_id=str(job_id))

    def fail_retryable(
        self,
        job_id: str,
        *,
        worker_id: str,
        error_code: str,
        error_message: str,
        retry_after_seconds: int = 0,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        del now
        table_sql = _qualified_table_sql(self.table_name)
        query = f"""
            update {table_sql}
            set
                attempt_count = attempt_count + 1,
                status = case
                    when attempt_count + 1 >= max_attempts then 'dead_letter'
                    else 'failed_retryable'
                end,
                leased_by = null,
                lease_expires_at = null,
                next_retry_after = case
                    when attempt_count + 1 >= max_attempts then null
                    else now() + (%s * interval '1 second')
                end,
                last_error_code = %s,
                last_error_message = %s,
                updated_at = now()
            where job_id = %s
                and status = 'leased'
                and leased_by = %s
                and (lease_expires_at is null or lease_expires_at > now())
            returning {self._returning_columns()}
        """
        return self._update_owned_job(
            query,
            (
                int(retry_after_seconds),
                str(error_code),
                str(error_message or ""),
                str(job_id),
                str(worker_id),
            ),
            job_id=str(job_id),
        )

    def fail_terminal(
        self,
        job_id: str,
        *,
        worker_id: str,
        error_code: str,
        error_message: str,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        del now
        table_sql = _qualified_table_sql(self.table_name)
        query = f"""
            update {table_sql}
            set
                status = 'failed_terminal',
                leased_by = null,
                lease_expires_at = null,
                next_retry_after = null,
                last_error_code = %s,
                last_error_message = %s,
                updated_at = now()
            where job_id = %s
                and status = 'leased'
                and leased_by = %s
                and (lease_expires_at is null or lease_expires_at > now())
            returning {self._returning_columns()}
        """
        return self._update_owned_job(
            query,
            (str(error_code), str(error_message or ""), str(job_id), str(worker_id)),
            job_id=str(job_id),
        )

    def dead_letter(
        self,
        job_id: str,
        *,
        error_code: str | None = None,
        error_message: str | None = None,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        del now
        table_sql = _qualified_table_sql(self.table_name)
        query = f"""
            update {table_sql}
            set
                status = 'dead_letter',
                leased_by = null,
                lease_expires_at = null,
                next_retry_after = null,
                last_error_code = coalesce(%s, last_error_code),
                last_error_message = coalesce(%s, last_error_message),
                updated_at = now()
            where job_id = %s
            returning {self._returning_columns()}
        """
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(query, (error_code, error_message, str(job_id)))
            row = cursor.fetchone()
        if row is None:
            raise NoticeIngestQueueNotFoundError(f"notice ingest job not found: {job_id}")
        return _record_from_row(row)

    def manual_review(
        self,
        job_id: str,
        *,
        worker_id: str,
        error_code: str,
        error_message: str,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        del now
        table_sql = _qualified_table_sql(self.table_name)
        query = f"""
            update {table_sql}
            set
                status = 'manual_review',
                leased_by = null,
                lease_expires_at = null,
                next_retry_after = null,
                last_error_code = %s,
                last_error_message = %s,
                updated_at = now()
            where job_id = %s
                and status = 'leased'
                and leased_by = %s
                and (lease_expires_at is null or lease_expires_at > now())
            returning {self._returning_columns()}
        """
        return self._update_owned_job(
            query,
            (str(error_code), str(error_message or ""), str(job_id), str(worker_id)),
            job_id=str(job_id),
        )

    def block(
        self,
        job_id: str,
        *,
        error_code: str,
        error_message: str,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        del now
        return self._set_unowned_terminal_status(
            job_id,
            status="blocked",
            error_code=error_code,
            error_message=error_message,
        )

    def cancel(
        self,
        job_id: str,
        *,
        error_code: str,
        error_message: str,
        now: datetime | None = None,
    ) -> NoticeIngestQueueRecord:
        del now
        return self._set_unowned_terminal_status(
            job_id,
            status="cancelled",
            error_code=error_code,
            error_message=error_message,
        )

    def list_status_counts(self) -> dict[str, int]:
        table_sql = _qualified_table_sql(self.table_name)
        counts = zero_status_counts()
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(f"select status, count(*) from {table_sql} group by status", ())
            rows = cursor.fetchall()
        for status, count in rows:
            counts[str(status)] = int(count)
        return counts

    def operator_summary(self, *, now: datetime | None = None) -> dict[str, object]:
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(self._select_query(), ())
            rows = cursor.fetchall()
        records = tuple(_record_from_row(row) for row in rows)
        return build_notice_ingest_queue_operator_summary(records, now=now)

    def _ensure_schema(self) -> None:
        table_sql = _qualified_table_sql(self.table_name)
        suffix = _table_index_suffix(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            _ensure_table_schema(cursor, table_name=self.table_name)
            cursor.execute(
                f"""
                create table if not exists {table_sql} (
                    job_id text primary key,
                    idempotency_key text not null,
                    job_kind text not null,
                    source_channel text not null,
                    source_surface text not null,
                    source_identity text not null,
                    capture_id text not null,
                    capture_manifest_object_ref jsonb not null,
                    source_object_refs jsonb not null,
                    content_hash text not null,
                    run_id text not null,
                    enqueue_source text not null,
                    replay_batch_id text not null,
                    priority integer not null,
                    status text not null,
                    attempt_count integer not null default 0,
                    max_attempts integer not null default 3,
                    leased_by text,
                    lease_expires_at timestamptz,
                    next_retry_after timestamptz,
                    last_error_code text,
                    last_error_message text,
                    created_at timestamptz not null,
                    updated_at timestamptz not null,
                    job_payload jsonb not null,
                    unique (idempotency_key),
                    check (priority >= 0),
                    check (attempt_count >= 0),
                    check (max_attempts > 0),
                    check (status in (
                        'queued',
                        'leased',
                        'succeeded',
                        'failed_retryable',
                        'failed_terminal',
                        'dead_letter',
                        'manual_review',
                        'blocked',
                        'cancelled'
                    ))
                )
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_lease_candidates
                on {table_sql} (status, priority, created_at, job_id)
                where status in ('queued', 'leased', 'failed_retryable')
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_source_identity
                on {table_sql} (source_channel, source_surface, source_identity)
                """
            )

    def _insert_query(self) -> str:
        table_sql = _qualified_table_sql(self.table_name)
        return f"""
            insert into {table_sql} (
                job_id, idempotency_key, job_kind, source_channel, source_surface,
                source_identity, capture_id, capture_manifest_object_ref,
                source_object_refs, content_hash, run_id, enqueue_source,
                replay_batch_id, priority, status, attempt_count, max_attempts,
                leased_by, lease_expires_at, next_retry_after,
                last_error_code, last_error_message,
                created_at, updated_at, job_payload
            )
            values (
                %s, %s, %s, %s, %s,
                %s, %s, %s::jsonb,
                %s::jsonb, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s::jsonb
            )
            on conflict (idempotency_key) do nothing
            returning {self._returning_columns()}
        """

    def _select_query(self) -> str:
        table_sql = _qualified_table_sql(self.table_name)
        return f"select {self._returning_columns()} from {table_sql}"

    def _returning_columns(self, qualifier: str | None = None) -> str:
        columns = (
            "job_id",
            "idempotency_key",
            "job_kind",
            "source_channel",
            "source_surface",
            "source_identity",
            "capture_id",
            "capture_manifest_object_ref",
            "source_object_refs",
            "content_hash",
            "run_id",
            "enqueue_source",
            "replay_batch_id",
            "priority",
            "status",
            "attempt_count",
            "max_attempts",
            "leased_by",
            "lease_expires_at",
            "next_retry_after",
            "last_error_code",
            "last_error_message",
            "created_at",
            "updated_at",
            "job_payload",
        )
        if qualifier is None:
            return ", ".join(columns)
        return ", ".join(f"{qualifier}.{column}" for column in columns)

    def _update_owned_job(
        self,
        query: str,
        params: tuple[object, ...],
        *,
        job_id: str,
    ) -> NoticeIngestQueueRecord:
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(query, params)
            row = cursor.fetchone()
        if row is None:
            raise NoticeIngestQueueLeaseError(
                f"notice ingest job is not currently leased by this worker: {job_id}"
            )
        return _record_from_row(row)

    def _set_unowned_terminal_status(
        self,
        job_id: str,
        *,
        status: str,
        error_code: str,
        error_message: str,
    ) -> NoticeIngestQueueRecord:
        table_sql = _qualified_table_sql(self.table_name)
        query = f"""
            update {table_sql}
            set
                status = %s,
                leased_by = null,
                lease_expires_at = null,
                next_retry_after = null,
                last_error_code = %s,
                last_error_message = %s,
                updated_at = now()
            where job_id = %s
            returning {self._returning_columns()}
        """
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(query, (status, str(error_code), str(error_message or ""), str(job_id)))
            row = cursor.fetchone()
        if row is None:
            raise NoticeIngestQueueNotFoundError(f"notice ingest job not found: {job_id}")
        return _record_from_row(row)


def build_notice_ingest_queue_store_from_env(
    env: dict[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> PostgresNoticeIngestQueueStore:
    source = env if env is not None else dict(os.environ)
    if prefer_operator:
        database_url = (
            source.get(DEFAULT_NOTICE_INGEST_QUEUE_OPERATOR_ENV_KEY)
            or source.get(DEFAULT_NOTICE_INGEST_QUEUE_MANAGEMENT_ENV_KEY)
            or source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY)
            or source.get(SHARED_POSTGRES_MANAGEMENT_ENV_KEY)
            or ""
        ).strip()
        if not database_url:
            raise ValueError(
                f"{DEFAULT_NOTICE_INGEST_QUEUE_OPERATOR_ENV_KEY} or "
                f"{DEFAULT_NOTICE_INGEST_QUEUE_MANAGEMENT_ENV_KEY} or "
                f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} or "
                f"{SHARED_POSTGRES_MANAGEMENT_ENV_KEY} is required when prefer_operator=True"
            )
        return PostgresNoticeIngestQueueStore(build_operator_postgres_connection_url(database_url))
    database_url = (
        source.get(DEFAULT_NOTICE_INGEST_QUEUE_ENV_KEY) or source.get(SHARED_POSTGRES_ENV_KEY) or ""
    ).strip()
    if not database_url:
        raise ValueError(
            f"{DEFAULT_NOTICE_INGEST_QUEUE_ENV_KEY} or {SHARED_POSTGRES_ENV_KEY} is required"
        )
    return PostgresNoticeIngestQueueStore(database_url)


def _insert_params(record: NoticeIngestQueueRecord) -> tuple[object, ...]:
    job_payload = record.job.to_payload()
    return (
        record.job_id,
        record.idempotency_key,
        record.job_kind,
        record.source_channel,
        record.source_surface,
        record.source_identity,
        record.capture_id,
        json.dumps(job_payload["capture_manifest_object_ref"], ensure_ascii=False),
        json.dumps(job_payload["source_object_refs"], ensure_ascii=False),
        record.content_hash,
        record.run_id,
        record.enqueue_source,
        record.replay_batch_id,
        record.priority,
        record.status,
        record.attempt_count,
        record.max_attempts,
        record.leased_by,
        record.lease_expires_at,
        record.next_retry_after,
        record.last_error_code,
        record.last_error_message,
        record.created_at,
        record.updated_at,
        json.dumps(job_payload, ensure_ascii=False),
    )


def _record_from_row(row: tuple[object, ...]) -> NoticeIngestQueueRecord:
    payload = _coerce_json_payload(row[24])
    return NoticeIngestQueueRecord(
        job=notice_ingest_job_from_payload(payload),
        status=str(row[14]),
        attempt_count=int(row[15]),
        max_attempts=int(row[16]),
        leased_by=None if row[17] is None else str(row[17]),
        lease_expires_at=row[18],
        next_retry_after=row[19],
        last_error_code=None if row[20] is None else str(row[20]),
        last_error_message=None if row[21] is None else str(row[21]),
        created_at=row[22],
        updated_at=row[23],
    )


__all__ = [
    "DEFAULT_NOTICE_INGEST_QUEUE_BASENAME",
    "DEFAULT_NOTICE_INGEST_QUEUE_ENV_KEY",
    "DEFAULT_NOTICE_INGEST_QUEUE_MANAGEMENT_ENV_KEY",
    "DEFAULT_NOTICE_INGEST_QUEUE_OPERATOR_ENV_KEY",
    "DEFAULT_NOTICE_INGEST_QUEUE_SCHEMA",
    "DEFAULT_NOTICE_INGEST_QUEUE_TABLE",
    "PostgresNoticeIngestQueueStore",
    "build_notice_ingest_queue_store_from_env",
]
