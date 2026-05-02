from __future__ import annotations

import os
from collections.abc import Sequence
from datetime import datetime
from threading import RLock
from typing import Any, Protocol

from campus_ingestion_core.official_web_release_task import (
    OfficialWebReleaseTask,
    utc_now,
)
from campus_ingestion_core.postgres_runtime import build_operator_postgres_connection_url
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

DEFAULT_OFFICIAL_WEB_RELEASE_TASK_LEASE_SECONDS = 300
DEFAULT_OFFICIAL_WEB_RELEASE_TASK_TABLE = "ingestion_queue.official_web_release_tasks"
OFFICIAL_WEB_RELEASE_TASK_DATABASE_ENV_KEY = "OFFICIAL_WEB_RELEASE_TASK_DATABASE_URL"
OFFICIAL_WEB_RELEASE_TASK_OPERATOR_DATABASE_ENV_KEY = (
    "OFFICIAL_WEB_RELEASE_TASK_OPERATOR_DATABASE_URL"
)
OFFICIAL_WEB_RELEASE_TASK_MANAGEMENT_DATABASE_ENV_KEY = (
    "OFFICIAL_WEB_RELEASE_TASK_MANAGEMENT_DATABASE_URL"
)


class OfficialWebReleaseTaskStoreError(RuntimeError):
    pass


class OfficialWebReleaseTaskConflictError(OfficialWebReleaseTaskStoreError):
    pass


class OfficialWebReleaseTaskLeaseError(OfficialWebReleaseTaskStoreError):
    pass


class OfficialWebReleaseTaskNotFoundError(OfficialWebReleaseTaskStoreError):
    pass


class OfficialWebReleaseTaskStore(Protocol):
    def create_or_get_task(self, task: OfficialWebReleaseTask) -> OfficialWebReleaseTask: ...

    def get_task(self, task_id: str) -> OfficialWebReleaseTask | None: ...

    def claim_task(
        self,
        task_id: str,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_OFFICIAL_WEB_RELEASE_TASK_LEASE_SECONDS,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask | None: ...

    def claim_next_task(
        self,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_OFFICIAL_WEB_RELEASE_TASK_LEASE_SECONDS,
        now: datetime | None = None,
        task_types: Sequence[str] = (),
    ) -> OfficialWebReleaseTask | None: ...

    def heartbeat_task(
        self,
        task_id: str,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_OFFICIAL_WEB_RELEASE_TASK_LEASE_SECONDS,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask: ...

    def mark_task_running(
        self,
        task_id: str,
        *,
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask: ...

    def mark_task_materialized(
        self,
        task_id: str,
        *,
        output_ref: dict[str, Any],
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask: ...

    def mark_task_published(
        self,
        task_id: str,
        *,
        output_ref: dict[str, Any],
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask: ...

    def mark_task_indexed(
        self,
        task_id: str,
        *,
        output_ref: dict[str, Any],
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask: ...

    def fail_task_retryable(
        self,
        task_id: str,
        *,
        error_code: str,
        error_message: str,
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask: ...

    def fail_task_terminal(
        self,
        task_id: str,
        *,
        error_code: str,
        error_message: str,
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask: ...

    def list_tasks(
        self,
        *,
        limit: int = 100,
        include_terminal: bool = True,
    ) -> tuple[OfficialWebReleaseTask, ...]: ...


class InMemoryOfficialWebReleaseTaskStore:
    def __init__(self) -> None:
        self._tasks_by_id: dict[str, OfficialWebReleaseTask] = {}
        self._lock = RLock()

    def create_or_get_task(self, task: OfficialWebReleaseTask) -> OfficialWebReleaseTask:
        with self._lock:
            existing = self._tasks_by_id.get(task.task_id)
            if existing is not None:
                if existing != task:
                    raise OfficialWebReleaseTaskConflictError(
                        f"official web release task conflicts: {task.task_id}"
                    )
                return existing
            self._tasks_by_id[task.task_id] = task
            return task

    def get_task(self, task_id: str) -> OfficialWebReleaseTask | None:
        with self._lock:
            return self._tasks_by_id.get(str(task_id or "").strip())

    def claim_task(
        self,
        task_id: str,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_OFFICIAL_WEB_RELEASE_TASK_LEASE_SECONDS,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask | None:
        timestamp = now or utc_now()
        normalized_task_id = str(task_id or "").strip()
        with self._lock:
            selected = self._tasks_by_id.get(normalized_task_id)
            if selected is None:
                return None
            if selected.status not in {
                "queued",
                "failed_retryable",
            } and not selected.is_lease_expired(now=timestamp):
                return None
            claimed = selected.claim(
                worker_id=worker_id,
                lease_seconds=lease_seconds,
                now=timestamp,
            )
            self._tasks_by_id[claimed.task_id] = claimed
            return claimed

    def claim_next_task(
        self,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_OFFICIAL_WEB_RELEASE_TASK_LEASE_SECONDS,
        now: datetime | None = None,
        task_types: Sequence[str] = (),
    ) -> OfficialWebReleaseTask | None:
        timestamp = now or utc_now()
        allowed_task_types = {str(item).strip() for item in task_types if str(item).strip()}
        with self._lock:
            candidates = [
                task
                for task in self._tasks_by_id.values()
                if (
                    task.status in {"queued", "failed_retryable"}
                    or task.is_lease_expired(now=timestamp)
                )
                and (not allowed_task_types or task.task_type in allowed_task_types)
            ]
            if not candidates:
                return None
            selected = sorted(candidates, key=lambda item: (item.created_at, item.task_id))[0]
            claimed = selected.claim(
                worker_id=worker_id,
                lease_seconds=lease_seconds,
                now=timestamp,
            )
            self._tasks_by_id[claimed.task_id] = claimed
            return claimed

    def heartbeat_task(
        self,
        task_id: str,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_OFFICIAL_WEB_RELEASE_TASK_LEASE_SECONDS,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask:
        return self._update_owned(
            task_id,
            lambda task: task.heartbeat(
                worker_id=worker_id,
                lease_seconds=lease_seconds,
                now=now,
            ),
        )

    def mark_task_running(
        self,
        task_id: str,
        *,
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask:
        return self._update_owned(
            task_id,
            lambda task: task.mark_running(worker_id=worker_id, now=now),
        )

    def mark_task_materialized(
        self,
        task_id: str,
        *,
        output_ref: dict[str, Any],
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask:
        return self._update_owned(
            task_id,
            lambda task: task.materialize(
                output_ref=output_ref,
                worker_id=worker_id,
                now=now,
            ),
        )

    def mark_task_published(
        self,
        task_id: str,
        *,
        output_ref: dict[str, Any],
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask:
        return self._update_owned(
            task_id,
            lambda task: task.publish(output_ref=output_ref, worker_id=worker_id, now=now),
        )

    def mark_task_indexed(
        self,
        task_id: str,
        *,
        output_ref: dict[str, Any],
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask:
        return self._update_owned(
            task_id,
            lambda task: task.mark_indexed(output_ref=output_ref, worker_id=worker_id, now=now),
        )

    def fail_task_retryable(
        self,
        task_id: str,
        *,
        error_code: str,
        error_message: str,
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask:
        return self._update_owned(
            task_id,
            lambda task: task.fail_retryable(
                error_code=error_code,
                error_message=error_message,
                worker_id=worker_id,
                now=now,
            ),
        )

    def fail_task_terminal(
        self,
        task_id: str,
        *,
        error_code: str,
        error_message: str,
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask:
        return self._update_owned(
            task_id,
            lambda task: task.fail_terminal(
                error_code=error_code,
                error_message=error_message,
                worker_id=worker_id,
                now=now,
            ),
        )

    def list_tasks(
        self,
        *,
        limit: int = 100,
        include_terminal: bool = True,
    ) -> tuple[OfficialWebReleaseTask, ...]:
        terminal_statuses = {"indexed", "published", "failed_terminal"}
        with self._lock:
            rows = [
                task
                for task in self._tasks_by_id.values()
                if include_terminal or task.status not in terminal_statuses
            ]
        return tuple(
            sorted(rows, key=lambda item: (item.updated_at, item.task_id), reverse=True)[
                : _positive_int(limit, "limit")
            ]
        )

    def _update_owned(
        self,
        task_id: str,
        update: Any,
    ) -> OfficialWebReleaseTask:
        with self._lock:
            task = self._require(task_id)
            try:
                updated = update(task)
            except ValueError as exc:
                raise OfficialWebReleaseTaskLeaseError(str(exc)) from exc
            self._tasks_by_id[updated.task_id] = updated
            return updated

    def _require(self, task_id: str) -> OfficialWebReleaseTask:
        normalized = str(task_id or "").strip()
        task = self._tasks_by_id.get(normalized)
        if task is None:
            raise OfficialWebReleaseTaskNotFoundError(
                f"official web release task not found: {normalized}"
            )
        return task


class PostgresOfficialWebReleaseTaskStore:
    def __init__(
        self,
        database_url: str,
        *,
        table_name: str = DEFAULT_OFFICIAL_WEB_RELEASE_TASK_TABLE,
    ) -> None:
        self.database_url = database_url.strip()
        if not self.database_url:
            raise ValueError("official web release task database url is required")
        self.table_name = table_name
        self._ensure_schema()

    def create_or_get_task(self, task: OfficialWebReleaseTask) -> OfficialWebReleaseTask:
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(self._insert_query(), _insert_params(task))
            row = cursor.fetchone()
            if row is not None:
                return _task_from_row(row)
            cursor.execute(f"{self._select_query()} where task_id = %s", (task.task_id,))
            existing = cursor.fetchone()
        if existing is None:
            raise OfficialWebReleaseTaskNotFoundError(
                f"official web release task not found after create: {task.task_id}"
            )
        return _task_from_row(existing)

    def get_task(self, task_id: str) -> OfficialWebReleaseTask | None:
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(f"{self._select_query()} where task_id = %s", (str(task_id),))
            row = cursor.fetchone()
        return None if row is None else _task_from_row(row)

    def claim_task(
        self,
        task_id: str,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_OFFICIAL_WEB_RELEASE_TASK_LEASE_SECONDS,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask | None:
        del now
        table_sql = _qualified_table_sql(self.table_name)
        query = f"""
            update {table_sql}
            set
                status = 'claimed',
                attempt_count = attempt_count + 1,
                lease_owner = %s,
                lease_expires_at = now() + (%s * interval '1 second'),
                updated_at = now()
            where task_id = %s
                and (
                    status in ('queued', 'failed_retryable')
                    or (
                        status in ('claimed', 'running')
                        and (lease_expires_at is null or lease_expires_at <= now())
                    )
                )
            returning {self._returning_columns()}
        """
        with (
            _postgres_connection(self.database_url, autocommit=False) as conn,
            conn.cursor() as cursor,
        ):
            cursor.execute(query, (str(worker_id), int(lease_seconds), str(task_id)))
            row = cursor.fetchone()
        return None if row is None else _task_from_row(row)

    def claim_next_task(
        self,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_OFFICIAL_WEB_RELEASE_TASK_LEASE_SECONDS,
        now: datetime | None = None,
        task_types: Sequence[str] = (),
    ) -> OfficialWebReleaseTask | None:
        del now
        table_sql = _qualified_table_sql(self.table_name)
        params: list[object] = []
        task_type_filter = ""
        normalized_task_types = tuple(str(item).strip() for item in task_types if str(item).strip())
        if normalized_task_types:
            placeholders = ", ".join(["%s"] * len(normalized_task_types))
            task_type_filter = f"and task_type in ({placeholders})"
            params.extend(normalized_task_types)
        params.extend((str(worker_id), int(lease_seconds)))
        query = f"""
            with candidate as (
                select task_id
                from {table_sql}
                where (
                    status in ('queued', 'failed_retryable')
                    or (
                        status in ('claimed', 'running')
                        and (lease_expires_at is null or lease_expires_at <= now())
                    )
                )
                {task_type_filter}
                order by created_at asc, task_id asc
                limit 1
                for update skip locked
            )
            update {table_sql} as task
            set
                status = 'claimed',
                attempt_count = attempt_count + 1,
                lease_owner = %s,
                lease_expires_at = now() + (%s * interval '1 second'),
                updated_at = now()
            from candidate
            where task.task_id = candidate.task_id
            returning {self._returning_columns("task")}
        """
        with (
            _postgres_connection(self.database_url, autocommit=False) as conn,
            conn.cursor() as cursor,
        ):
            cursor.execute(query, tuple(params))
            row = cursor.fetchone()
        return None if row is None else _task_from_row(row)

    def heartbeat_task(
        self,
        task_id: str,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_OFFICIAL_WEB_RELEASE_TASK_LEASE_SECONDS,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask:
        del now
        table_sql = _qualified_table_sql(self.table_name)
        query = f"""
            update {table_sql}
            set
                lease_expires_at = now() + (%s * interval '1 second'),
                updated_at = now()
            where task_id = %s
                and status in ('claimed', 'running')
                and lease_owner = %s
                and (lease_expires_at is null or lease_expires_at > now())
            returning {self._returning_columns()}
        """
        return self._update_owned(
            query, (int(lease_seconds), str(task_id), str(worker_id)), task_id
        )

    def mark_task_running(
        self,
        task_id: str,
        *,
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask:
        del now
        return self._set_status(task_id, status="running", worker_id=worker_id)

    def mark_task_materialized(
        self,
        task_id: str,
        *,
        output_ref: dict[str, Any],
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask:
        del now
        return self._set_status(
            task_id,
            status="materialized",
            worker_id=worker_id,
            output_ref=output_ref,
            terminal=False,
        )

    def mark_task_published(
        self,
        task_id: str,
        *,
        output_ref: dict[str, Any],
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask:
        del now
        return self._set_status(
            task_id,
            status="published",
            worker_id=worker_id,
            output_ref=output_ref,
            terminal=True,
        )

    def mark_task_indexed(
        self,
        task_id: str,
        *,
        output_ref: dict[str, Any],
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask:
        del now
        return self._set_status(
            task_id,
            status="indexed",
            worker_id=worker_id,
            output_ref=output_ref,
            terminal=True,
        )

    def fail_task_retryable(
        self,
        task_id: str,
        *,
        error_code: str,
        error_message: str,
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask:
        del now
        table_sql = _qualified_table_sql(self.table_name)
        query = f"""
            update {table_sql}
            set
                status = case
                    when attempt_count >= max_attempts then 'failed_terminal'
                    else 'failed_retryable'
                end,
                lease_owner = null,
                lease_expires_at = null,
                last_error_code = %s,
                last_error_message = %s,
                updated_at = now()
            where task_id = %s
                and status in ('claimed', 'running')
                and lease_owner = %s
                and (lease_expires_at is null or lease_expires_at > now())
            returning {self._returning_columns()}
        """
        return self._update_owned(
            query,
            (str(error_code), str(error_message or ""), str(task_id), str(worker_id)),
            task_id,
        )

    def fail_task_terminal(
        self,
        task_id: str,
        *,
        error_code: str,
        error_message: str,
        worker_id: str,
        now: datetime | None = None,
    ) -> OfficialWebReleaseTask:
        del now
        table_sql = _qualified_table_sql(self.table_name)
        query = f"""
            update {table_sql}
            set
                status = 'failed_terminal',
                lease_owner = null,
                lease_expires_at = null,
                last_error_code = %s,
                last_error_message = %s,
                updated_at = now()
            where task_id = %s
                and status in ('claimed', 'running')
                and lease_owner = %s
                and (lease_expires_at is null or lease_expires_at > now())
            returning {self._returning_columns()}
        """
        return self._update_owned(
            query,
            (str(error_code), str(error_message or ""), str(task_id), str(worker_id)),
            task_id,
        )

    def list_tasks(
        self,
        *,
        limit: int = 100,
        include_terminal: bool = True,
    ) -> tuple[OfficialWebReleaseTask, ...]:
        terminal_filter = ""
        if not include_terminal:
            terminal_filter = "where status not in ('indexed', 'published', 'failed_terminal')"
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(
                f"""
                {self._select_query()}
                {terminal_filter}
                order by updated_at desc, task_id desc
                limit %s
                """,
                (_positive_int(limit, "limit"),),
            )
            rows = cursor.fetchall()
        return tuple(_task_from_row(row) for row in rows)

    def _set_status(
        self,
        task_id: str,
        *,
        status: str,
        worker_id: str,
        output_ref: dict[str, Any] | None = None,
        terminal: bool = False,
    ) -> OfficialWebReleaseTask:
        table_sql = _qualified_table_sql(self.table_name)
        lease_update = "lease_owner = null, lease_expires_at = null," if terminal else ""
        output_update = "output_ref = %s::jsonb," if output_ref is not None else ""
        params: list[object] = [status]
        if output_ref is not None:
            params.append(_json_dump(output_ref))
        params.extend((str(task_id), str(worker_id)))
        query = f"""
            update {table_sql}
            set
                status = %s,
                {output_update}
                {lease_update}
                updated_at = now()
            where task_id = %s
                and status in ('claimed', 'running', 'materialized')
                and lease_owner = %s
                and (lease_expires_at is null or lease_expires_at > now())
            returning {self._returning_columns()}
        """
        return self._update_owned(query, tuple(params), task_id)

    def _update_owned(
        self,
        query: str,
        params: tuple[object, ...],
        task_id: str,
    ) -> OfficialWebReleaseTask:
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(query, params)
            row = cursor.fetchone()
        if row is None:
            if self.get_task(task_id) is None:
                raise OfficialWebReleaseTaskNotFoundError(
                    f"official web release task not found: {task_id}"
                )
            raise OfficialWebReleaseTaskLeaseError(
                "official web release task is not leased by this worker"
            )
        return _task_from_row(row)

    def _ensure_schema(self) -> None:
        table_sql = _qualified_table_sql(self.table_name)
        suffix = _table_index_suffix(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            _ensure_table_schema(cursor, table_name=self.table_name)
            cursor.execute(
                f"""
                create table if not exists {table_sql} (
                    task_id text primary key,
                    task_type text not null,
                    status text not null,
                    inventory_id text not null,
                    job_id text not null,
                    run_id text not null,
                    selected_write_target text not null default '',
                    publish_alias boolean not null default false,
                    input_ref jsonb not null,
                    output_ref jsonb,
                    attempt_count integer not null default 0,
                    max_attempts integer not null default 3,
                    lease_owner text,
                    lease_expires_at timestamptz,
                    last_error_code text,
                    last_error_message text,
                    created_at timestamptz not null,
                    updated_at timestamptz not null
                )
                """
            )
            cursor.execute(
                f"""
                create index if not exists {suffix}_status_updated_idx
                on {table_sql} (status, updated_at)
                """
            )
            cursor.execute(
                f"""
                create index if not exists {suffix}_run_inventory_idx
                on {table_sql} (run_id, inventory_id)
                """
            )

    def _insert_query(self) -> str:
        table_sql = _qualified_table_sql(self.table_name)
        return f"""
            insert into {table_sql} (
                task_id,
                task_type,
                status,
                inventory_id,
                job_id,
                run_id,
                selected_write_target,
                publish_alias,
                input_ref,
                output_ref,
                attempt_count,
                max_attempts,
                lease_owner,
                lease_expires_at,
                last_error_code,
                last_error_message,
                created_at,
                updated_at
            )
            values (
                %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb,
                %s, %s, %s, %s, %s, %s, %s, %s
            )
            on conflict (task_id) do nothing
            returning {self._returning_columns()}
        """

    def _select_query(self) -> str:
        return f"select {self._returning_columns()} from {_qualified_table_sql(self.table_name)}"

    def _returning_columns(self, prefix: str | None = None) -> str:
        columns = (
            "task_id",
            "task_type",
            "status",
            "inventory_id",
            "job_id",
            "run_id",
            "selected_write_target",
            "publish_alias",
            "input_ref",
            "output_ref",
            "attempt_count",
            "max_attempts",
            "lease_owner",
            "lease_expires_at",
            "last_error_code",
            "last_error_message",
            "created_at",
            "updated_at",
        )
        if not prefix:
            return ", ".join(columns)
        return ", ".join(f"{prefix}.{column}" for column in columns)


def build_official_web_release_task_store_from_env(
    env: dict[str, str] | None = None,
    *,
    table_name: str = DEFAULT_OFFICIAL_WEB_RELEASE_TASK_TABLE,
) -> OfficialWebReleaseTaskStore:
    source = env if env is not None else os.environ
    database_url = (
        (source.get(OFFICIAL_WEB_RELEASE_TASK_OPERATOR_DATABASE_ENV_KEY) or "").strip()
        or (source.get(OFFICIAL_WEB_RELEASE_TASK_MANAGEMENT_DATABASE_ENV_KEY) or "").strip()
        or (source.get(OFFICIAL_WEB_RELEASE_TASK_DATABASE_ENV_KEY) or "").strip()
        or (source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY) or "").strip()
        or (source.get(SHARED_POSTGRES_MANAGEMENT_ENV_KEY) or "").strip()
        or (source.get(SHARED_POSTGRES_ENV_KEY) or "").strip()
    )
    if not database_url:
        raise ValueError(
            f"{OFFICIAL_WEB_RELEASE_TASK_OPERATOR_DATABASE_ENV_KEY} or "
            f"{OFFICIAL_WEB_RELEASE_TASK_DATABASE_ENV_KEY} or {SHARED_POSTGRES_ENV_KEY} is required"
        )
    if (
        source.get(OFFICIAL_WEB_RELEASE_TASK_OPERATOR_DATABASE_ENV_KEY)
        or source.get(OFFICIAL_WEB_RELEASE_TASK_MANAGEMENT_DATABASE_ENV_KEY)
        or source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY)
        or source.get(SHARED_POSTGRES_MANAGEMENT_ENV_KEY)
    ):
        database_url = build_operator_postgres_connection_url(database_url)
    return PostgresOfficialWebReleaseTaskStore(database_url, table_name=table_name)


def _insert_params(task: OfficialWebReleaseTask) -> tuple[object, ...]:
    return (
        task.task_id,
        task.task_type,
        task.status,
        task.inventory_id,
        task.job_id,
        task.run_id,
        task.selected_write_target,
        task.publish_alias,
        _json_dump(dict(task.input_ref)),
        _json_dump(dict(task.output_ref or {})),
        task.attempt_count,
        task.max_attempts,
        task.lease_owner or None,
        task.lease_expires_at,
        task.last_error_code or None,
        task.last_error_message or None,
        task.created_at,
        task.updated_at,
    )


def _task_from_row(row: Sequence[Any]) -> OfficialWebReleaseTask:
    return OfficialWebReleaseTask(
        task_id=str(row[0]),
        task_type=str(row[1]),
        status=str(row[2]),
        inventory_id=str(row[3]),
        job_id=str(row[4]),
        run_id=str(row[5]),
        selected_write_target=str(row[6] or ""),
        publish_alias=bool(row[7]),
        input_ref=_coerce_json_payload(row[8]),
        output_ref=_coerce_json_payload(row[9]) if row[9] is not None else None,
        attempt_count=int(row[10]),
        max_attempts=int(row[11]),
        lease_owner=str(row[12] or ""),
        lease_expires_at=row[13],
        last_error_code=str(row[14] or ""),
        last_error_message=str(row[15] or ""),
        created_at=row[16],
        updated_at=row[17],
    )


def _json_dump(value: dict[str, Any]) -> str:
    import json

    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _positive_int(value: object, label: str) -> int:
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must be positive") from exc
    if parsed <= 0:
        raise ValueError(f"{label} must be positive")
    return parsed


__all__ = [
    "DEFAULT_OFFICIAL_WEB_RELEASE_TASK_LEASE_SECONDS",
    "DEFAULT_OFFICIAL_WEB_RELEASE_TASK_TABLE",
    "OFFICIAL_WEB_RELEASE_TASK_DATABASE_ENV_KEY",
    "OFFICIAL_WEB_RELEASE_TASK_MANAGEMENT_DATABASE_ENV_KEY",
    "OFFICIAL_WEB_RELEASE_TASK_OPERATOR_DATABASE_ENV_KEY",
    "InMemoryOfficialWebReleaseTaskStore",
    "OfficialWebReleaseTaskConflictError",
    "OfficialWebReleaseTaskLeaseError",
    "OfficialWebReleaseTaskNotFoundError",
    "OfficialWebReleaseTaskStore",
    "OfficialWebReleaseTaskStoreError",
    "PostgresOfficialWebReleaseTaskStore",
    "build_official_web_release_task_store_from_env",
]
