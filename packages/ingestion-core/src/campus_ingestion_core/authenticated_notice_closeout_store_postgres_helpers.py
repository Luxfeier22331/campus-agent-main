from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import asdict
from typing import Any

from campus_ingestion_core.authenticated_notice_closeout_models import (
    CloseoutBatch,
    CloseoutPromotionBatch,
    CloseoutRun,
    CloseoutShard,
    CloseoutWorker,
    parse_optional_timestamp,
    utc_now_dt,
)
from campus_ingestion_core.registry import (
    _coerce_json_payload,
    _ensure_table_schema,
    _postgres_connection,
    _qualified_table_sql,
    _table_index_suffix,
)


class _PostgresAuthenticatedNoticeCloseoutStoreCursorHelpers:
    database_url: str
    run_table: str
    shard_table: str
    batch_table: str
    worker_table: str
    notice_stage_table: str
    raw_asset_stage_table: str
    document_stage_table: str
    milestone_table: str
    promotion_table: str
    promotion_batch_table: str

    def _ensure_schema(self) -> None:
        table_specs = {
            self.run_table: """
                create table if not exists {table_sql} (
                    run_id text primary key,
                    state text not null,
                    updated_at timestamptz not null,
                    record jsonb not null
                )
            """,
            self.shard_table: """
                create table if not exists {table_sql} (
                    run_id text not null,
                    shard_id integer not null,
                    state text not null,
                    updated_at timestamptz not null,
                    record jsonb not null,
                    primary key (run_id, shard_id)
                )
            """,
            self.batch_table: """
                create table if not exists {table_sql} (
                    run_id text not null,
                    batch_id integer not null,
                    shard_id integer not null,
                    worker_id text,
                    state text not null,
                    updated_at timestamptz not null,
                    record jsonb not null,
                    primary key (run_id, batch_id)
                )
            """,
            self.worker_table: """
                create table if not exists {table_sql} (
                    run_id text not null,
                    worker_id text not null,
                    state text not null,
                    updated_at timestamptz not null,
                    record jsonb not null,
                    primary key (run_id, worker_id)
                )
            """,
            self.notice_stage_table: """
                create table if not exists {table_sql} (
                    run_id text not null,
                    notice_id text not null,
                    shard_id integer not null,
                    batch_id integer,
                    updated_at timestamptz not null,
                    record jsonb not null,
                    primary key (run_id, notice_id)
                )
            """,
            self.raw_asset_stage_table: """
                create table if not exists {table_sql} (
                    run_id text not null,
                    raw_asset_id text not null,
                    raw_version_id text not null,
                    shard_id integer not null,
                    batch_id integer,
                    updated_at timestamptz not null,
                    record jsonb not null,
                    primary key (run_id, raw_asset_id, raw_version_id)
                )
            """,
            self.document_stage_table: """
                create table if not exists {table_sql} (
                    run_id text not null,
                    document_id text not null,
                    revision_track text not null,
                    version_id text not null,
                    shard_id integer not null,
                    batch_id integer not null,
                    updated_at timestamptz not null,
                    record jsonb not null,
                    primary key (run_id, document_id, revision_track, version_id)
                )
            """,
            self.milestone_table: """
                create table if not exists {table_sql} (
                    run_id text not null,
                    milestone_name text not null,
                    updated_at timestamptz not null,
                    record jsonb not null,
                    primary key (run_id, milestone_name)
                )
            """,
            self.promotion_table: """
                create table if not exists {table_sql} (
                    run_id text not null,
                    promotion_id text not null,
                    updated_at timestamptz not null,
                    record jsonb not null,
                    primary key (run_id, promotion_id)
                )
            """,
            self.promotion_batch_table: """
                create table if not exists {table_sql} (
                    run_id text not null,
                    promotion_id text not null,
                    batch_id integer not null,
                    state text not null,
                    updated_at timestamptz not null,
                    record jsonb not null,
                    primary key (run_id, promotion_id, batch_id)
                )
            """,
        }
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
                for table_name, statement in table_specs.items():
                    _ensure_table_schema(cursor, table_name=table_name)
                    table_sql = _qualified_table_sql(table_name)
                    cursor.execute(statement.format(table_sql=table_sql))
                    cursor.execute(
                        f"""
                        create index if not exists idx_{_table_index_suffix(table_name)}_updated_at
                        on {table_sql} (updated_at desc)
                        """
                    )
                self._ensure_hot_columns_and_indexes(cursor)

    def _ensure_hot_columns_and_indexes(self, cursor) -> None:
        run_table_sql = _qualified_table_sql(self.run_table)
        batch_table_sql = _qualified_table_sql(self.batch_table)
        worker_table_sql = _qualified_table_sql(self.worker_table)
        notice_stage_table_sql = _qualified_table_sql(self.notice_stage_table)
        raw_asset_stage_table_sql = _qualified_table_sql(self.raw_asset_stage_table)
        document_stage_table_sql = _qualified_table_sql(self.document_stage_table)
        cursor.execute(
            f"alter table {run_table_sql} add column if not exists completed_batch_count integer"
        )
        cursor.execute(
            f"alter table {run_table_sql} add column if not exists running_batch_count integer"
        )
        cursor.execute(
            f"alter table {run_table_sql} add column if not exists pending_batch_count integer"
        )
        cursor.execute(
            f"alter table {run_table_sql} add column if not exists active_worker_count integer"
        )
        cursor.execute(
            f"alter table {batch_table_sql} add column if not exists lease_expires_at timestamptz"
        )
        cursor.execute(
            f"alter table {worker_table_sql} add column if not exists active_batch_count integer"
        )
        cursor.execute(
            f"update {run_table_sql} set "
            "completed_batch_count = coalesce(completed_batch_count, coalesce((record->>'completed_batch_count')::integer, 0)), "
            "running_batch_count = coalesce(running_batch_count, coalesce((record->>'running_batch_count')::integer, 0)), "
            "pending_batch_count = coalesce(pending_batch_count, coalesce((record->>'pending_batch_count')::integer, 0)), "
            "active_worker_count = coalesce(active_worker_count, coalesce((record->>'active_worker_count')::integer, 0))"
        )
        cursor.execute(
            f"update {batch_table_sql} set "
            "lease_expires_at = coalesce(lease_expires_at, nullif(record->>'lease_expires_at', '')::timestamptz)"
        )
        cursor.execute(
            f"update {worker_table_sql} set "
            "active_batch_count = coalesce(active_batch_count, coalesce((record->>'active_batch_count')::integer, 0))"
        )
        cursor.execute(
            f"""
            create index if not exists idx_{_table_index_suffix(self.run_table)}_state_batches
            on {run_table_sql} (state, pending_batch_count, running_batch_count, active_worker_count)
            """
        )
        cursor.execute(
            f"""
            create index if not exists idx_{_table_index_suffix(self.batch_table)}_claim_hot
            on {batch_table_sql} (run_id, state, lease_expires_at, batch_id)
            """
        )
        cursor.execute(
            f"""
            create index if not exists idx_{_table_index_suffix(self.batch_table)}_worker_hot
            on {batch_table_sql} (run_id, worker_id, state)
            """
        )
        cursor.execute(
            f"""
            create index if not exists idx_{_table_index_suffix(self.worker_table)}_active_hot
            on {worker_table_sql} (run_id, active_batch_count, state)
            """
        )
        cursor.execute(
            f"""
            create index if not exists idx_{_table_index_suffix(self.notice_stage_table)}_run_shard_batch
            on {notice_stage_table_sql} (run_id, shard_id, batch_id)
            """
        )
        cursor.execute(
            f"""
            create index if not exists idx_{_table_index_suffix(self.raw_asset_stage_table)}_run_shard_batch
            on {raw_asset_stage_table_sql} (run_id, shard_id, batch_id)
            """
        )
        cursor.execute(
            f"""
            create index if not exists idx_{_table_index_suffix(self.document_stage_table)}_run_shard_batch
            on {document_stage_table_sql} (run_id, shard_id, batch_id)
            """
        )

    def _save_run_cursor(self, cursor, run: CloseoutRun) -> None:
        self._upsert_by_primary_key_cursor(
            cursor=cursor,
            table_name=self.run_table,
            key_columns=("run_id",),
            row={
                "run_id": run.run_id,
                "state": run.state.value,
                "completed_batch_count": run.completed_batch_count,
                "running_batch_count": run.running_batch_count,
                "pending_batch_count": run.pending_batch_count,
                "active_worker_count": run.active_worker_count,
                "updated_at": utc_now_dt(),
                "record": asdict(run),
            },
        )

    def _save_shard_cursor(self, cursor, run_id: str, shard: CloseoutShard) -> None:
        self._upsert_by_primary_key_cursor(
            cursor=cursor,
            table_name=self.shard_table,
            key_columns=("run_id", "shard_id"),
            row={
                "run_id": run_id,
                "shard_id": shard.shard_id,
                "state": shard.state.value,
                "updated_at": utc_now_dt(),
                "record": asdict(shard),
            },
        )

    def _save_batch_cursor(self, cursor, run_id: str, batch: CloseoutBatch) -> None:
        self._upsert_by_primary_key_cursor(
            cursor=cursor,
            table_name=self.batch_table,
            key_columns=("run_id", "batch_id"),
            row={
                "run_id": run_id,
                "batch_id": batch.batch_id,
                "shard_id": batch.shard_id,
                "worker_id": batch.worker_id,
                "state": batch.state.value,
                "lease_expires_at": parse_optional_timestamp(batch.lease_expires_at),
                "updated_at": utc_now_dt(),
                "record": asdict(batch),
            },
        )

    def _save_worker_cursor(self, cursor, run_id: str, worker: CloseoutWorker) -> None:
        self._upsert_by_primary_key_cursor(
            cursor=cursor,
            table_name=self.worker_table,
            key_columns=("run_id", "worker_id"),
            row={
                "run_id": run_id,
                "worker_id": worker.worker_id,
                "state": worker.state.value,
                "active_batch_count": worker.active_batch_count,
                "updated_at": utc_now_dt(),
                "record": asdict(worker),
            },
        )

    def _save_promotion_batch_cursor(
        self,
        cursor,
        run_id: str,
        batch: CloseoutPromotionBatch,
    ) -> None:
        self._upsert_by_primary_key_cursor(
            cursor=cursor,
            table_name=self.promotion_batch_table,
            key_columns=("run_id", "promotion_id", "batch_id"),
            row={
                "run_id": run_id,
                "promotion_id": batch.promotion_id,
                "batch_id": batch.batch_id,
                "state": batch.state.value,
                "updated_at": utc_now_dt(),
                "record": asdict(batch),
            },
        )

    def _stage_notice_cursor(
        self,
        *,
        cursor,
        run_id: str,
        shard_id: int,
        batch_id: int,
        notice: dict[str, Any],
        artifact_keys: Sequence[str],
    ) -> None:
        self._stage_notices_cursor(
            cursor=cursor,
            rows=(
                {
                    "run_id": run_id,
                    "notice_id": str(notice["notice_id"]),
                    "shard_id": shard_id,
                    "batch_id": batch_id,
                    "updated_at": utc_now_dt(),
                    "record": {
                        "run_id": run_id,
                        "shard_id": shard_id,
                        "batch_id": batch_id,
                        "notice": dict(notice),
                        "artifact_keys": list(artifact_keys),
                    },
                },
            ),
        )

    def _stage_raw_cursor(
        self,
        *,
        cursor,
        run_id: str,
        shard_id: int,
        batch_id: int,
        raw_record: dict[str, Any],
        source_artifact_keys: dict[str, str],
    ) -> None:
        self._stage_raw_assets_cursor(
            cursor=cursor,
            rows=(
                {
                    "run_id": run_id,
                    "raw_asset_id": str(raw_record["raw_asset_id"]),
                    "raw_version_id": str(raw_record["raw_version_id"]),
                    "shard_id": shard_id,
                    "batch_id": batch_id,
                    "updated_at": utc_now_dt(),
                    "record": {
                        "run_id": run_id,
                        "shard_id": shard_id,
                        "batch_id": batch_id,
                        "raw_record": dict(raw_record),
                        "source_artifact_keys": dict(source_artifact_keys),
                    },
                },
            ),
        )

    def _stage_document_cursor(
        self,
        *,
        cursor,
        run_id: str,
        shard_id: int,
        batch_id: int,
        document: dict[str, Any],
        staged_object_keys: dict[str, str],
        final_object_keys: dict[str, str],
        content_hash: str,
        staged_object_metadata: dict[str, dict[str, Any]],
    ) -> None:
        self._stage_documents_cursor(
            cursor=cursor,
            rows=(
                {
                    "run_id": run_id,
                    "document_id": str(document["document_id"]),
                    "revision_track": str(document["revision_track"]),
                    "version_id": str(document["version_id"]),
                    "shard_id": shard_id,
                    "batch_id": batch_id,
                    "updated_at": utc_now_dt(),
                    "record": {
                        "run_id": run_id,
                        "shard_id": shard_id,
                        "batch_id": batch_id,
                        "document": dict(document),
                        "staged_object_keys": dict(staged_object_keys),
                        "final_object_keys": dict(final_object_keys),
                        "content_hash": content_hash,
                        "staged_object_metadata": dict(staged_object_metadata),
                    },
                },
            ),
        )

    def _stage_notices_cursor(self, *, cursor, rows: Sequence[dict[str, Any]]) -> None:
        self._upsert_many_by_primary_key_cursor(
            cursor=cursor,
            table_name=self.notice_stage_table,
            key_columns=("run_id", "notice_id"),
            column_types={
                "run_id": "text",
                "notice_id": "text",
                "shard_id": "integer",
                "batch_id": "integer",
                "updated_at": "timestamptz",
                "record": "jsonb",
            },
            rows=rows,
        )

    def _stage_raw_assets_cursor(self, *, cursor, rows: Sequence[dict[str, Any]]) -> None:
        self._upsert_many_by_primary_key_cursor(
            cursor=cursor,
            table_name=self.raw_asset_stage_table,
            key_columns=("run_id", "raw_asset_id", "raw_version_id"),
            column_types={
                "run_id": "text",
                "raw_asset_id": "text",
                "raw_version_id": "text",
                "shard_id": "integer",
                "batch_id": "integer",
                "updated_at": "timestamptz",
                "record": "jsonb",
            },
            rows=rows,
        )

    def _stage_documents_cursor(self, *, cursor, rows: Sequence[dict[str, Any]]) -> None:
        self._upsert_many_by_primary_key_cursor(
            cursor=cursor,
            table_name=self.document_stage_table,
            key_columns=("run_id", "document_id", "revision_track", "version_id"),
            column_types={
                "run_id": "text",
                "document_id": "text",
                "revision_track": "text",
                "version_id": "text",
                "shard_id": "integer",
                "batch_id": "integer",
                "updated_at": "timestamptz",
                "record": "jsonb",
            },
            rows=rows,
        )

    def _require_run_cursor(self, cursor, run_id: str) -> CloseoutRun:
        cursor.execute(
            f"select record from {self.run_table} where run_id = %s for update",
            (run_id,),
        )
        row = cursor.fetchone()
        if row is None:
            raise ValueError(f"closeout run not found: {run_id}")
        return CloseoutRun.from_dict(_coerce_json_payload(row[0]))

    def _require_shard_cursor(
        self,
        cursor,
        run_id: str,
        shard_id: int,
    ) -> CloseoutShard:
        cursor.execute(
            f"select record from {self.shard_table} where run_id = %s and shard_id = %s for update",
            (run_id, shard_id),
        )
        row = cursor.fetchone()
        if row is None:
            raise ValueError(f"closeout shard not found: {run_id}/{shard_id}")
        return CloseoutShard.from_dict(_coerce_json_payload(row[0]))

    def _lock_batch_worker_context_cursor(
        self,
        *,
        cursor,
        run_id: str,
        batch_id: int,
        worker_id: str,
    ) -> tuple[CloseoutRun, CloseoutBatch, CloseoutWorker, CloseoutShard]:
        run = self._require_run_cursor(cursor, run_id)
        batch = self._require_batch_cursor(cursor, run_id, batch_id)
        worker = self._require_worker_cursor(cursor, run_id, worker_id)
        shard = self._require_shard_cursor(cursor, run_id, batch.shard_id)
        return run, batch, worker, shard

    def _require_batch_cursor(
        self,
        cursor,
        run_id: str,
        batch_id: int,
    ) -> CloseoutBatch:
        cursor.execute(
            f"select record from {self.batch_table} where run_id = %s and batch_id = %s for update",
            (run_id, batch_id),
        )
        row = cursor.fetchone()
        if row is None:
            raise ValueError(f"closeout batch not found: {run_id}/{batch_id}")
        return CloseoutBatch.from_dict(_coerce_json_payload(row[0]))

    def _get_worker_cursor(
        self,
        cursor,
        run_id: str,
        worker_id: str,
    ) -> CloseoutWorker | None:
        cursor.execute(
            f"select record from {self.worker_table} where run_id = %s and worker_id = %s for update",
            (run_id, worker_id),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return CloseoutWorker.from_dict(_coerce_json_payload(row[0]))

    def _require_worker_cursor(
        self,
        cursor,
        run_id: str,
        worker_id: str,
    ) -> CloseoutWorker:
        worker = self._get_worker_cursor(cursor, run_id, worker_id)
        if worker is None:
            raise ValueError(f"closeout worker not found: {run_id}/{worker_id}")
        return worker

    def _active_worker_count_cursor(self, cursor, run_id: str) -> int:
        cursor.execute(
            (
                f"select count(*) from {self.worker_table} "
                "where run_id = %s and coalesce(active_batch_count, 0) > 0"
            ),
            (run_id,),
        )
        row = cursor.fetchone()
        return int(row[0]) if row else 0

    def _fetchone(self, query: str, params: tuple[object, ...]) -> tuple[object, ...] | None:
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, params)
                row = cursor.fetchone()
        return tuple(row) if row is not None else None

    def _fetchall(self, query: str, params: tuple[object, ...]) -> tuple[tuple[object, ...], ...]:
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
                cursor.execute(query, params)
                rows = cursor.fetchall()
        return tuple(tuple(row) for row in rows)

    def _upsert_by_primary_key_cursor(
        self,
        *,
        cursor,
        table_name: str,
        key_columns: tuple[str, ...],
        row: dict[str, Any],
    ) -> None:
        columns = tuple(row.keys())
        placeholders: list[str] = []
        values: list[object] = []
        for column in columns:
            if column == "record":
                placeholders.append("%s::jsonb")
                values.append(json.dumps(row[column], ensure_ascii=False))
            else:
                placeholders.append("%s")
                values.append(row[column])
        update_columns = tuple(column for column in columns if column not in key_columns)
        assignments = ", ".join(f"{column} = excluded.{column}" for column in update_columns)
        cursor.execute(
            (
                f"insert into {table_name} ({', '.join(columns)}) "
                f"values ({', '.join(placeholders)}) "
                f"on conflict ({', '.join(key_columns)}) do update set {assignments}"
            ),
            tuple(values),
        )

    def _upsert_many_by_primary_key_cursor(
        self,
        *,
        cursor,
        table_name: str,
        key_columns: tuple[str, ...],
        column_types: dict[str, str],
        rows: Sequence[dict[str, Any]],
    ) -> None:
        if not rows:
            return
        columns = tuple(rows[0].keys())
        for row in rows[1:]:
            if tuple(row.keys()) != columns:
                raise ValueError("bulk upsert rows must use the same column order")
        unknown_columns = [column for column in columns if column not in column_types]
        if unknown_columns:
            raise ValueError(
                f"bulk upsert column types missing for: {', '.join(sorted(unknown_columns))}"
            )
        update_columns = tuple(column for column in columns if column not in key_columns)
        assignments = ", ".join(f"{column} = excluded.{column}" for column in update_columns)
        recordset_columns = ", ".join(f"{column} {column_types[column]}" for column in columns)
        statement = (
            f"with rows as ("
            f"select {', '.join(f'item.{column}' for column in columns)} "
            f"from jsonb_to_recordset(%s::jsonb) as item({recordset_columns})"
            f") "
            f"insert into {table_name} ({', '.join(columns)}) "
            f"select {', '.join(columns)} from rows "
            f"on conflict ({', '.join(key_columns)}) do update set {assignments}"
        )
        payload: list[dict[str, Any]] = []
        for row in rows:
            serialized: dict[str, Any] = {}
            for column in columns:
                value = row[column]
                if column == "updated_at" and value is not None and not isinstance(value, str):
                    value = value.isoformat()
                serialized[column] = value
            payload.append(serialized)
        cursor.execute(
            statement,
            (json.dumps(payload, ensure_ascii=False),),
        )
