from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from campus_ingestion_core.authenticated_notice_closeout_models import (
    CloseoutBatch,
    CloseoutBatchState,
    CloseoutPromotionBatch,
    CloseoutRun,
    CloseoutRunState,
    CloseoutShard,
    CloseoutShardState,
    CloseoutWorker,
    utc_now_dt,
)
from campus_ingestion_core.authenticated_notice_closeout_store_postgres_helpers import (
    _PostgresAuthenticatedNoticeCloseoutStoreCursorHelpers,
)
from campus_ingestion_core.authenticated_notice_closeout_store_shared import (
    DEFAULT_BATCH_TABLE,
    DEFAULT_DOCUMENT_STAGE_TABLE,
    DEFAULT_MILESTONE_TABLE,
    DEFAULT_NOTICE_STAGE_TABLE,
    DEFAULT_PROMOTION_BATCH_TABLE,
    DEFAULT_PROMOTION_TABLE,
    DEFAULT_RAW_ASSET_STAGE_TABLE,
    DEFAULT_RUN_TABLE,
    DEFAULT_SHARD_TABLE,
    DEFAULT_WORKER_TABLE,
    _documents_from_stage,
    _notice_stage_from_record,
)
from campus_ingestion_core.postgres_runtime import normalize_postgres_connection_url
from campus_ingestion_core.registry import _coerce_json_payload, _postgres_connection


class PostgresAuthenticatedNoticeCloseoutStore(
    _PostgresAuthenticatedNoticeCloseoutStoreCursorHelpers
):
    def __init__(
        self,
        database_url: str,
        *,
        run_table: str = DEFAULT_RUN_TABLE,
        shard_table: str = DEFAULT_SHARD_TABLE,
        batch_table: str = DEFAULT_BATCH_TABLE,
        worker_table: str = DEFAULT_WORKER_TABLE,
        notice_stage_table: str = DEFAULT_NOTICE_STAGE_TABLE,
        raw_asset_stage_table: str = DEFAULT_RAW_ASSET_STAGE_TABLE,
        document_stage_table: str = DEFAULT_DOCUMENT_STAGE_TABLE,
        milestone_table: str = DEFAULT_MILESTONE_TABLE,
        promotion_table: str = DEFAULT_PROMOTION_TABLE,
        promotion_batch_table: str = DEFAULT_PROMOTION_BATCH_TABLE,
    ) -> None:
        self.database_url = normalize_postgres_connection_url(database_url)
        if not self.database_url:
            raise ValueError("authenticated notice closeout database url is required")
        self.run_table = run_table
        self.shard_table = shard_table
        self.batch_table = batch_table
        self.worker_table = worker_table
        self.notice_stage_table = notice_stage_table
        self.raw_asset_stage_table = raw_asset_stage_table
        self.document_stage_table = document_stage_table
        self.milestone_table = milestone_table
        self.promotion_table = promotion_table
        self.promotion_batch_table = promotion_batch_table
        self._ensure_schema()

    def save_run(self, run: CloseoutRun) -> None:
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            self._save_run_cursor(cursor, run)

    def save_plan(
        self,
        run: CloseoutRun,
        shards: Sequence[CloseoutShard],
        batches: Sequence[CloseoutBatch],
    ) -> None:
        with _postgres_connection(self.database_url, autocommit=False) as conn, conn.cursor() as cursor:
            self._save_run_cursor(cursor, run)
            for shard in shards:
                self._save_shard_cursor(cursor, run.run_id, shard)
            for batch in batches:
                self._save_batch_cursor(cursor, run.run_id, batch)

    def get_run(self, run_id: str) -> CloseoutRun | None:
        row = self._fetchone(
            f"select record from {self.run_table} where run_id = %s",
            (run_id,),
        )
        if row is None:
            return None
        return CloseoutRun.from_dict(_coerce_json_payload(row[0]))

    def save_shard(self, run_id: str, shard: CloseoutShard) -> None:
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            self._save_shard_cursor(cursor, run_id, shard)

    def get_shard(self, run_id: str, shard_id: int) -> CloseoutShard | None:
        row = self._fetchone(
            f"select record from {self.shard_table} where run_id = %s and shard_id = %s",
            (run_id, shard_id),
        )
        if row is None:
            return None
        return CloseoutShard.from_dict(_coerce_json_payload(row[0]))

    def list_shards(self, run_id: str) -> tuple[CloseoutShard, ...]:
        rows = self._fetchall(
            f"select record from {self.shard_table} where run_id = %s order by shard_id asc",
            (run_id,),
        )
        return tuple(CloseoutShard.from_dict(_coerce_json_payload(row[0])) for row in rows)

    def save_batch(self, run_id: str, batch: CloseoutBatch) -> None:
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            self._save_batch_cursor(cursor, run_id, batch)

    def get_batch(self, run_id: str, batch_id: int) -> CloseoutBatch | None:
        row = self._fetchone(
            f"select record from {self.batch_table} where run_id = %s and batch_id = %s",
            (run_id, batch_id),
        )
        if row is None:
            return None
        return CloseoutBatch.from_dict(_coerce_json_payload(row[0]))

    def list_batches(self, run_id: str) -> tuple[CloseoutBatch, ...]:
        rows = self._fetchall(
            f"select record from {self.batch_table} where run_id = %s order by batch_id asc",
            (run_id,),
        )
        return tuple(CloseoutBatch.from_dict(_coerce_json_payload(row[0])) for row in rows)

    def save_worker(self, run_id: str, worker: CloseoutWorker) -> None:
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            self._save_worker_cursor(cursor, run_id, worker)

    def get_worker(self, run_id: str, worker_id: str) -> CloseoutWorker | None:
        row = self._fetchone(
            f"select record from {self.worker_table} where run_id = %s and worker_id = %s",
            (run_id, worker_id),
        )
        if row is None:
            return None
        return CloseoutWorker.from_dict(_coerce_json_payload(row[0]))

    def list_workers(self, run_id: str) -> tuple[CloseoutWorker, ...]:
        rows = self._fetchall(
            f"select record from {self.worker_table} where run_id = %s order by worker_id asc",
            (run_id,),
        )
        return tuple(CloseoutWorker.from_dict(_coerce_json_payload(row[0])) for row in rows)

    def claim_next_batch(
        self,
        run_id: str,
        *,
        worker_id: str,
        lease_seconds: int,
    ) -> CloseoutBatch | None:
        with _postgres_connection(self.database_url, autocommit=False) as conn, conn.cursor() as cursor:
            run = self._require_run_cursor(cursor, run_id)
            if run.state not in (CloseoutRunState.PLANNED, CloseoutRunState.RUNNING):
                return None
            cursor.execute(
                (
                    f"select record from {self.batch_table} "
                    "where run_id = %s and (state = %s or (state = %s and "
                    "coalesce(lease_expires_at, '-infinity'::timestamptz) < now())) "
                    "order by batch_id asc limit 1 for update skip locked"
                ),
                (
                    run_id,
                    CloseoutBatchState.PENDING.value,
                    CloseoutBatchState.RUNNING.value,
                ),
            )
            row = cursor.fetchone()
            if row is None:
                return None
            batch = CloseoutBatch.from_dict(_coerce_json_payload(row[0]))
            claimed = batch.claim(worker_id=worker_id, lease_seconds=lease_seconds)
            self._save_batch_cursor(cursor, run_id, claimed)
            worker = self._get_worker_cursor(cursor, run_id, worker_id)
            if worker is None:
                worker = CloseoutWorker(worker_id=worker_id)
            worker = worker.claim_batch(claimed.batch_id)
            self._save_worker_cursor(cursor, run_id, worker)
            shard = self._require_shard_cursor(cursor, run_id, claimed.shard_id).mark_running()
            self._save_shard_cursor(cursor, run_id, shard)
            updated_run = run.mark_running().with_progress(
                running_batch_delta=1,
                pending_batch_delta=-1,
                active_worker_count=self._active_worker_count_cursor(cursor, run_id),
            )
            self._save_run_cursor(cursor, updated_run)
            return claimed

    def commit_batch_stage(
        self,
        *,
        run_id: str,
        worker_id: str,
        batch_id: int,
        stages: Sequence[dict[str, Any]],
    ) -> CloseoutBatch:
        with _postgres_connection(self.database_url, autocommit=False) as conn, conn.cursor() as cursor:
            run, batch, worker, shard = self._lock_batch_worker_context_cursor(
                cursor=cursor,
                run_id=run_id,
                batch_id=batch_id,
                worker_id=worker_id,
            )
            staged_notice_ids: set[str] = set()
            staged_raw_asset_keys: set[tuple[str, str]] = set()
            staged_document_keys: set[tuple[str, str, str]] = set()
            notice_rows: list[dict[str, Any]] = []
            raw_asset_rows: list[dict[str, Any]] = []
            document_rows: list[dict[str, Any]] = []
            for stage in stages:
                notice_id = str(stage["notice"]["notice_id"])
                staged_notice_ids.add(notice_id)
                notice_rows.append(
                    {
                        "run_id": run_id,
                        "notice_id": notice_id,
                        "shard_id": batch.shard_id,
                        "batch_id": batch.batch_id,
                        "updated_at": utc_now_dt(),
                        "record": {
                            "run_id": run_id,
                            "shard_id": batch.shard_id,
                            "batch_id": batch.batch_id,
                            "notice": dict(stage["notice"]),
                            "artifact_keys": list(stage["artifact_keys"]),
                        },
                    }
                )
                raw_asset_key = (
                    str(stage["raw_record"]["raw_asset_id"]),
                    str(stage["raw_record"]["raw_version_id"]),
                )
                staged_raw_asset_keys.add(raw_asset_key)
                raw_asset_rows.append(
                    {
                        "run_id": run_id,
                        "raw_asset_id": raw_asset_key[0],
                        "raw_version_id": raw_asset_key[1],
                        "shard_id": batch.shard_id,
                        "batch_id": batch.batch_id,
                        "updated_at": utc_now_dt(),
                        "record": {
                            "run_id": run_id,
                            "shard_id": batch.shard_id,
                            "batch_id": batch.batch_id,
                            "raw_record": dict(stage["raw_record"]),
                            "source_artifact_keys": dict(stage["source_artifact_keys"]),
                        },
                    }
                )
                for document_stage in _documents_from_stage(stage):
                    document_key = (
                        str(document_stage["document"]["document_id"]),
                        str(document_stage["document"]["revision_track"]),
                        str(document_stage["document"]["version_id"]),
                    )
                    staged_document_keys.add(document_key)
                    document_rows.append(
                        {
                            "run_id": run_id,
                            "document_id": document_key[0],
                            "revision_track": document_key[1],
                            "version_id": document_key[2],
                            "shard_id": batch.shard_id,
                            "batch_id": batch.batch_id,
                            "updated_at": utc_now_dt(),
                            "record": {
                                "run_id": run_id,
                                "shard_id": batch.shard_id,
                                "batch_id": batch.batch_id,
                                "document": dict(document_stage["document"]),
                                "staged_object_keys": dict(document_stage["staged_object_keys"]),
                                "final_object_keys": dict(document_stage["final_object_keys"]),
                                "content_hash": document_stage["content_hash"],
                                "staged_object_metadata": dict(
                                    document_stage.get("staged_object_metadata") or {}
                                ),
                            },
                        }
                    )
            self._stage_notices_cursor(cursor=cursor, rows=notice_rows)
            self._stage_raw_assets_cursor(cursor=cursor, rows=raw_asset_rows)
            self._stage_documents_cursor(cursor=cursor, rows=document_rows)
            completed_batch = batch.complete(
                staged_notice_count=len(staged_notice_ids),
                staged_raw_asset_count=len(staged_raw_asset_keys),
                staged_document_count=len(staged_document_keys),
            )
            self._save_batch_cursor(cursor, run_id, completed_batch)
            previous_shard_state = shard.state
            completed_shard = shard.complete_batch(
                processed_notice_count=len(staged_notice_ids),
                staged_notice_count=len(staged_notice_ids),
            )
            self._save_shard_cursor(cursor, run_id, completed_shard)
            completed_worker = worker.complete_batch(batch_id)
            self._save_worker_cursor(cursor, run_id, completed_worker)
            updated_run = run.with_progress(
                staged_notice_delta=len(staged_notice_ids),
                staged_raw_asset_delta=len(staged_raw_asset_keys),
                staged_document_delta=len(staged_document_keys),
                completed_batch_delta=1,
                running_batch_delta=-1,
                processed_notice_delta=len(staged_notice_ids),
                completed_shard_delta=(
                    1
                    if previous_shard_state != CloseoutShardState.DONE
                    and completed_shard.state == CloseoutShardState.DONE
                    else 0
                ),
                active_worker_count=self._active_worker_count_cursor(cursor, run_id),
            )
            self._save_run_cursor(cursor, updated_run)
            return completed_batch

    def fail_batch(
        self,
        *,
        run_id: str,
        worker_id: str,
        batch_id: int,
        error: str,
    ) -> CloseoutBatch:
        with _postgres_connection(self.database_url, autocommit=False) as conn, conn.cursor() as cursor:
            run, batch, worker, shard = self._lock_batch_worker_context_cursor(
                cursor=cursor,
                run_id=run_id,
                batch_id=batch_id,
                worker_id=worker_id,
            )
            failed_batch = batch.fail(error)
            self._save_batch_cursor(cursor, run_id, failed_batch)
            previous_shard_state = shard.state
            self._save_shard_cursor(cursor, run_id, shard.fail(error))
            self._save_worker_cursor(cursor, run_id, worker.fail_batch(batch_id, error))
            updated_run = run.with_progress(
                running_batch_delta=-1,
                failed_shard_delta=1 if previous_shard_state != CloseoutShardState.FAILED else 0,
                active_worker_count=self._active_worker_count_cursor(cursor, run_id),
            ).fail(error)
            self._save_run_cursor(cursor, updated_run)
            return failed_batch

    def finish_worker(self, run_id: str, worker_id: str) -> CloseoutWorker:
        with _postgres_connection(self.database_url, autocommit=False) as conn, conn.cursor() as cursor:
            run = self._require_run_cursor(cursor, run_id)
            worker = self._get_worker_cursor(cursor, run_id, worker_id)
            if worker is None:
                worker = CloseoutWorker(worker_id=worker_id)
            worker = worker.finish()
            self._save_worker_cursor(cursor, run_id, worker)
            self._save_run_cursor(
                cursor,
                run.with_progress(active_worker_count=self._active_worker_count_cursor(cursor, run_id)),
            )
            return worker

    def try_begin_verification(self, run_id: str) -> bool:
        with _postgres_connection(self.database_url, autocommit=False) as conn, conn.cursor() as cursor:
            run = self._require_run_cursor(cursor, run_id)
            if run.state not in (CloseoutRunState.PLANNED, CloseoutRunState.RUNNING):
                return False
            cursor.execute(
                (
                    f"select state, count(*) from {self.batch_table} "
                    "where run_id = %s group by state"
                ),
                (run_id,),
            )
            counts = {str(state): int(count) for state, count in cursor.fetchall()}
            total_batch_rows = sum(counts.values())
            if total_batch_rows != run.batch_count:
                return False
            if run.completed_batch_count < run.batch_count:
                return False
            if run.pending_batch_count > 0:
                return False
            if run.running_batch_count > 0:
                return False
            if counts.get(CloseoutBatchState.PENDING.value, 0) > 0:
                return False
            if counts.get(CloseoutBatchState.RUNNING.value, 0) > 0:
                return False
            if counts.get(CloseoutBatchState.FAILED.value, 0) > 0:
                self._save_run_cursor(
                    cursor,
                    run.fail("closeout batch failure prevents verification"),
                )
                return False
            self._save_run_cursor(cursor, run.mark_verifying())
            return True

    def mark_run_verified(
        self,
        run_id: str,
        verification: dict[str, Any],
    ) -> CloseoutRun:
        with _postgres_connection(self.database_url, autocommit=False) as conn, conn.cursor() as cursor:
            run = self._require_run_cursor(cursor, run_id).mark_verified(verification)
            self._save_run_cursor(cursor, run)
            return run

    def mark_run_failed(self, run_id: str, reason: str) -> CloseoutRun:
        with _postgres_connection(self.database_url, autocommit=False) as conn, conn.cursor() as cursor:
            run = self._require_run_cursor(cursor, run_id).fail(reason)
            self._save_run_cursor(cursor, run)
            return run

    def get_staged_notices(
        self,
        run_id: str,
        shard_id: int | None = None,
        batch_id: int | None = None,
    ) -> tuple[dict[str, Any], ...]:
        clauses = ["run_id = %s"]
        params: list[object] = [run_id]
        if shard_id is not None:
            clauses.append("shard_id = %s")
            params.append(shard_id)
        if batch_id is not None:
            clauses.append("batch_id = %s")
            params.append(batch_id)
        rows = self._fetchall(
            f"select record from {self.notice_stage_table} where {' and '.join(clauses)} order by notice_id asc",
            tuple(params),
        )
        return tuple(_notice_stage_from_record(_coerce_json_payload(row[0])) for row in rows)

    def get_staged_raw_assets(self, run_id: str) -> tuple[dict[str, Any], ...]:
        rows = self._fetchall(
            (
                f"select record from {self.raw_asset_stage_table} "
                "where run_id = %s order by raw_asset_id asc, raw_version_id asc"
            ),
            (run_id,),
        )
        return tuple(_coerce_json_payload(row[0]) for row in rows)

    def get_staged_documents(self, run_id: str) -> tuple[dict[str, Any], ...]:
        rows = self._fetchall(
            (
                f"select record from {self.document_stage_table} "
                "where run_id = %s order by document_id asc, revision_track asc, version_id asc"
            ),
            (run_id,),
        )
        return tuple(_coerce_json_payload(row[0]) for row in rows)

    def clear_batch_stage(self, run_id: str, batch_id: int) -> None:
        with _postgres_connection(self.database_url, autocommit=False) as conn, conn.cursor() as cursor:
            cursor.execute(
                f"delete from {self.notice_stage_table} where run_id = %s and batch_id = %s",
                (run_id, batch_id),
            )
            cursor.execute(
                f"delete from {self.raw_asset_stage_table} where run_id = %s and batch_id = %s",
                (run_id, batch_id),
            )
            cursor.execute(
                f"delete from {self.document_stage_table} where run_id = %s and batch_id = %s",
                (run_id, batch_id),
            )

    def record_milestone(self, run_id: str, name: str, payload: dict[str, Any]) -> None:
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            self._upsert_by_primary_key_cursor(
                cursor=cursor,
                table_name=self.milestone_table,
                key_columns=("run_id", "milestone_name"),
                row={
                    "run_id": run_id,
                    "milestone_name": name,
                    "updated_at": utc_now_dt(),
                    "record": {"name": name, "payload": dict(payload)},
                },
            )

    def get_milestones(self, run_id: str) -> tuple[dict[str, Any], ...]:
        rows = self._fetchall(
            f"select record from {self.milestone_table} where run_id = %s order by milestone_name asc",
            (run_id,),
        )
        return tuple(_coerce_json_payload(row[0]) for row in rows)

    def record_promotion(self, run_id: str, payload: dict[str, Any]) -> None:
        promotion_id = str(payload.get("promotion_id") or "promotion-0001")
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            self._upsert_by_primary_key_cursor(
                cursor=cursor,
                table_name=self.promotion_table,
                key_columns=("run_id", "promotion_id"),
                row={
                    "run_id": run_id,
                    "promotion_id": promotion_id,
                    "updated_at": utc_now_dt(),
                    "record": dict(payload),
                },
            )

    def save_promotion_batch(
        self,
        run_id: str,
        batch: CloseoutPromotionBatch,
    ) -> None:
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            self._save_promotion_batch_cursor(cursor, run_id, batch)

    def list_promotion_batches(
        self,
        run_id: str,
        promotion_id: str,
    ) -> tuple[CloseoutPromotionBatch, ...]:
        rows = self._fetchall(
            (
                f"select record from {self.promotion_batch_table} "
                "where run_id = %s and promotion_id = %s order by batch_id asc"
            ),
            (run_id, promotion_id),
        )
        return tuple(CloseoutPromotionBatch.from_dict(_coerce_json_payload(row[0])) for row in rows)
