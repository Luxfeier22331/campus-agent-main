from __future__ import annotations

from dataclasses import asdict
import json
import os
from threading import RLock
from typing import Any, Protocol, Sequence

from campus_ingestion_core.authenticated_notice_closeout_models import (
    CloseoutBatch,
    CloseoutBatchState,
    CloseoutPromotionBatch,
    CloseoutPromotionBatchState,
    CloseoutRun,
    CloseoutRunState,
    CloseoutShard,
    CloseoutShardState,
    CloseoutWorker,
    batch_lease_expired,
    parse_optional_timestamp,
    utc_now_dt,
)
from campus_ingestion_core.registry import (
    DOCUMENT_REGISTRY_ENV_KEY,
    DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
    DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY,
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
    SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
    _coerce_json_payload,
    _ensure_table_schema,
    _postgres_connection,
    _qualified_table_sql,
    _table_index_suffix,
)
from campus_ingestion_core.postgres_runtime import (
    build_operator_postgres_connection_url,
    normalize_postgres_connection_url,
)


DEFAULT_CLOSEOUT_SCHEMA = "ingestion_closeout"
DEFAULT_CLOSEOUT_STORE_ENV_KEY = "AUTHENTICATED_NOTICE_CLOSEOUT_DATABASE_URL"
DEFAULT_CLOSEOUT_STORE_OPERATOR_ENV_KEY = (
    "AUTHENTICATED_NOTICE_CLOSEOUT_OPERATOR_DATABASE_URL"
)
DEFAULT_CLOSEOUT_STORE_MANAGEMENT_ENV_KEY = (
    "AUTHENTICATED_NOTICE_CLOSEOUT_MANAGEMENT_DATABASE_URL"
)
DEFAULT_RUN_TABLE = f"{DEFAULT_CLOSEOUT_SCHEMA}.closeout_runs"
DEFAULT_SHARD_TABLE = f"{DEFAULT_CLOSEOUT_SCHEMA}.closeout_shards"
DEFAULT_BATCH_TABLE = f"{DEFAULT_CLOSEOUT_SCHEMA}.closeout_batches"
DEFAULT_WORKER_TABLE = f"{DEFAULT_CLOSEOUT_SCHEMA}.closeout_workers"
DEFAULT_NOTICE_STAGE_TABLE = f"{DEFAULT_CLOSEOUT_SCHEMA}.closeout_notice_stage"
DEFAULT_RAW_ASSET_STAGE_TABLE = f"{DEFAULT_CLOSEOUT_SCHEMA}.closeout_raw_asset_stage"
DEFAULT_DOCUMENT_STAGE_TABLE = f"{DEFAULT_CLOSEOUT_SCHEMA}.closeout_document_stage"
DEFAULT_MILESTONE_TABLE = f"{DEFAULT_CLOSEOUT_SCHEMA}.closeout_milestones"
DEFAULT_PROMOTION_TABLE = f"{DEFAULT_CLOSEOUT_SCHEMA}.closeout_promotions"
DEFAULT_PROMOTION_BATCH_TABLE = f"{DEFAULT_CLOSEOUT_SCHEMA}.closeout_promotion_batches"


class CloseoutStore(Protocol):
    def save_run(self, run: CloseoutRun) -> None: ...

    def save_plan(
        self,
        run: CloseoutRun,
        shards: Sequence[CloseoutShard],
        batches: Sequence[CloseoutBatch],
    ) -> None: ...

    def get_run(self, run_id: str) -> CloseoutRun | None: ...

    def save_shard(self, run_id: str, shard: CloseoutShard) -> None: ...

    def get_shard(self, run_id: str, shard_id: int) -> CloseoutShard | None: ...

    def list_shards(self, run_id: str) -> tuple[CloseoutShard, ...]: ...

    def save_batch(self, run_id: str, batch: CloseoutBatch) -> None: ...

    def get_batch(self, run_id: str, batch_id: int) -> CloseoutBatch | None: ...

    def list_batches(self, run_id: str) -> tuple[CloseoutBatch, ...]: ...

    def save_worker(self, run_id: str, worker: CloseoutWorker) -> None: ...

    def get_worker(self, run_id: str, worker_id: str) -> CloseoutWorker | None: ...

    def list_workers(self, run_id: str) -> tuple[CloseoutWorker, ...]: ...

    def claim_next_batch(
        self,
        run_id: str,
        *,
        worker_id: str,
        lease_seconds: int,
    ) -> CloseoutBatch | None: ...

    def commit_batch_stage(
        self,
        *,
        run_id: str,
        worker_id: str,
        batch_id: int,
        stages: Sequence[dict[str, Any]],
    ) -> CloseoutBatch: ...

    def fail_batch(
        self,
        *,
        run_id: str,
        worker_id: str,
        batch_id: int,
        error: str,
    ) -> CloseoutBatch: ...

    def finish_worker(self, run_id: str, worker_id: str) -> CloseoutWorker: ...

    def try_begin_verification(self, run_id: str) -> bool: ...

    def mark_run_verified(
        self,
        run_id: str,
        verification: dict[str, Any],
    ) -> CloseoutRun: ...

    def mark_run_failed(self, run_id: str, reason: str) -> CloseoutRun: ...

    def get_staged_notices(
        self,
        run_id: str,
        shard_id: int | None = None,
        batch_id: int | None = None,
    ) -> tuple[dict[str, Any], ...]: ...

    def get_staged_raw_assets(self, run_id: str) -> tuple[dict[str, Any], ...]: ...

    def get_staged_documents(self, run_id: str) -> tuple[dict[str, Any], ...]: ...

    def clear_batch_stage(self, run_id: str, batch_id: int) -> None: ...

    def record_milestone(self, run_id: str, name: str, payload: dict[str, Any]) -> None: ...

    def get_milestones(self, run_id: str) -> tuple[dict[str, Any], ...]: ...

    def record_promotion(self, run_id: str, payload: dict[str, Any]) -> None: ...

    def save_promotion_batch(
        self,
        run_id: str,
        batch: CloseoutPromotionBatch,
    ) -> None: ...

    def list_promotion_batches(
        self,
        run_id: str,
        promotion_id: str,
    ) -> tuple[CloseoutPromotionBatch, ...]: ...


def build_authenticated_notice_closeout_store_from_env(
    env: dict[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> PostgresAuthenticatedNoticeCloseoutStore:
    source = env if env is not None else dict(os.environ)
    if prefer_operator:
        operator_database_url = (
            source.get(DEFAULT_CLOSEOUT_STORE_OPERATOR_ENV_KEY)
            or source.get(DEFAULT_CLOSEOUT_STORE_MANAGEMENT_ENV_KEY)
            or source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY)
            or source.get(SHARED_POSTGRES_MANAGEMENT_ENV_KEY)
            or source.get(DOCUMENT_REGISTRY_OPERATOR_ENV_KEY)
            or source.get(DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY)
            or ""
        ).strip()
        if not operator_database_url:
            raise ValueError(
                f"{DEFAULT_CLOSEOUT_STORE_OPERATOR_ENV_KEY} or "
                f"{DEFAULT_CLOSEOUT_STORE_MANAGEMENT_ENV_KEY} or "
                f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} or "
                f"{SHARED_POSTGRES_MANAGEMENT_ENV_KEY} or "
                f"{DOCUMENT_REGISTRY_OPERATOR_ENV_KEY} or "
                f"{DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY} is required when "
                "prefer_operator=True"
            )
        return PostgresAuthenticatedNoticeCloseoutStore(
            build_operator_postgres_connection_url(operator_database_url)
        )
    database_url = (
        source.get(DEFAULT_CLOSEOUT_STORE_ENV_KEY)
        or source.get(SHARED_POSTGRES_ENV_KEY)
        or source.get(DOCUMENT_REGISTRY_ENV_KEY)
        or ""
    ).strip()
    if not database_url:
        raise ValueError(
            f"{DEFAULT_CLOSEOUT_STORE_ENV_KEY} or {SHARED_POSTGRES_ENV_KEY} is required"
        )
    return PostgresAuthenticatedNoticeCloseoutStore(database_url)


def _documents_from_stage(stage: dict[str, Any]) -> tuple[dict[str, Any], ...]:
    documents = stage.get("documents")
    if documents is not None:
        return tuple(dict(item) for item in documents)
    return (
        {
            "document": dict(stage["document"]),
            "staged_object_keys": dict(stage["staged_object_keys"]),
            "final_object_keys": dict(stage["final_object_keys"]),
            "content_hash": str(stage["content_hash"]),
            "staged_object_metadata": dict(stage.get("staged_object_metadata") or {}),
        },
    )


class InMemoryCloseoutStore:
    def __init__(self) -> None:
        self._runs: dict[str, CloseoutRun] = {}
        self._shards: dict[str, dict[int, CloseoutShard]] = {}
        self._batches: dict[str, dict[int, CloseoutBatch]] = {}
        self._workers: dict[str, dict[str, CloseoutWorker]] = {}
        self._notices: dict[str, dict[str, dict[str, Any]]] = {}
        self._raw_assets: dict[str, dict[tuple[str, str], dict[str, Any]]] = {}
        self._documents: dict[str, dict[tuple[str, str, str], dict[str, Any]]] = {}
        self._milestones: dict[str, dict[str, dict[str, Any]]] = {}
        self._promotions: dict[str, list[dict[str, Any]]] = {}
        self._promotion_batches: dict[str, dict[str, dict[int, CloseoutPromotionBatch]]] = {}
        self._lock = RLock()

    def make_shard(
        self,
        *,
        shard_id: int,
        notice_ids: Sequence[str],
        batch_ids: Sequence[int] = (),
    ) -> CloseoutShard:
        return CloseoutShard(
            shard_id=shard_id,
            notice_ids=tuple(str(item) for item in notice_ids),
        ).with_batches(batch_ids)

    def make_batch(
        self,
        *,
        batch_id: int,
        shard_id: int,
        notice_ids: Sequence[str],
        input_object_key: str | None = None,
        input_sha256: str | None = None,
    ) -> CloseoutBatch:
        return CloseoutBatch(
            batch_id=batch_id,
            shard_id=shard_id,
            notice_ids=tuple(str(item) for item in notice_ids),
            input_object_key=input_object_key,
            input_sha256=input_sha256,
        )

    def save_run(self, run: CloseoutRun) -> None:
        with self._lock:
            self._runs[run.run_id] = run

    def save_plan(
        self,
        run: CloseoutRun,
        shards: Sequence[CloseoutShard],
        batches: Sequence[CloseoutBatch],
    ) -> None:
        with self._lock:
            self._runs[run.run_id] = run
            self._shards[run.run_id] = {shard.shard_id: shard for shard in shards}
            self._batches[run.run_id] = {batch.batch_id: batch for batch in batches}

    def get_run(self, run_id: str) -> CloseoutRun | None:
        with self._lock:
            return self._runs.get(run_id)

    def save_shard(self, run_id: str, shard: CloseoutShard) -> None:
        with self._lock:
            self._shards.setdefault(run_id, {})[shard.shard_id] = shard

    def get_shard(self, run_id: str, shard_id: int) -> CloseoutShard | None:
        with self._lock:
            return self._shards.get(run_id, {}).get(shard_id)

    def list_shards(self, run_id: str) -> tuple[CloseoutShard, ...]:
        with self._lock:
            shards = self._shards.get(run_id, {})
            return tuple(shards[shard_id] for shard_id in sorted(shards))

    def save_batch(self, run_id: str, batch: CloseoutBatch) -> None:
        with self._lock:
            self._batches.setdefault(run_id, {})[batch.batch_id] = batch

    def get_batch(self, run_id: str, batch_id: int) -> CloseoutBatch | None:
        with self._lock:
            return self._batches.get(run_id, {}).get(batch_id)

    def list_batches(self, run_id: str) -> tuple[CloseoutBatch, ...]:
        with self._lock:
            batches = self._batches.get(run_id, {})
            return tuple(batches[batch_id] for batch_id in sorted(batches))

    def save_worker(self, run_id: str, worker: CloseoutWorker) -> None:
        with self._lock:
            self._workers.setdefault(run_id, {})[worker.worker_id] = worker

    def get_worker(self, run_id: str, worker_id: str) -> CloseoutWorker | None:
        with self._lock:
            return self._workers.get(run_id, {}).get(worker_id)

    def list_workers(self, run_id: str) -> tuple[CloseoutWorker, ...]:
        with self._lock:
            workers = self._workers.get(run_id, {})
            return tuple(workers[worker_id] for worker_id in sorted(workers))

    def claim_next_batch(
        self,
        run_id: str,
        *,
        worker_id: str,
        lease_seconds: int,
    ) -> CloseoutBatch | None:
        with self._lock:
            run = self._require_run_unlocked(run_id)
            if run.state not in (CloseoutRunState.PLANNED, CloseoutRunState.RUNNING):
                return None
            batches = self._batches.get(run_id, {})
            for batch_id in sorted(batches):
                batch = batches[batch_id]
                if not (
                    batch.state == CloseoutBatchState.PENDING or batch_lease_expired(batch)
                ):
                    continue
                claimed = batch.claim(worker_id=worker_id, lease_seconds=lease_seconds)
                batches[batch_id] = claimed
                worker = self._workers.setdefault(run_id, {}).get(worker_id)
                if worker is None:
                    worker = CloseoutWorker(worker_id=worker_id)
                worker = worker.claim_batch(claimed.batch_id)
                self._workers[run_id][worker_id] = worker
                shard = self._require_shard_unlocked(run_id, claimed.shard_id).mark_running()
                self._shards.setdefault(run_id, {})[claimed.shard_id] = shard
                updated_run = run.mark_running().with_progress(
                    running_batch_delta=1,
                    pending_batch_delta=-1,
                    active_worker_count=self._active_worker_count_unlocked(run_id),
                )
                self._runs[run_id] = updated_run
                return claimed
            return None

    def commit_batch_stage(
        self,
        *,
        run_id: str,
        worker_id: str,
        batch_id: int,
        stages: Sequence[dict[str, Any]],
    ) -> CloseoutBatch:
        with self._lock:
            batch = self._require_batch_unlocked(run_id, batch_id)
            shard = self._require_shard_unlocked(run_id, batch.shard_id)
            worker = self._require_worker_unlocked(run_id, worker_id)
            run = self._require_run_unlocked(run_id)
            staged_notice_ids: set[str] = set()
            staged_raw_asset_keys: set[tuple[str, str]] = set()
            staged_document_keys: set[tuple[str, str, str]] = set()
            for stage in stages:
                staged_notice_ids.add(str(stage["notice"]["notice_id"]))
                self._stage_notice_unlocked(
                    run_id=run_id,
                    shard_id=batch.shard_id,
                    batch_id=batch.batch_id,
                    notice=stage["notice"],
                    artifact_keys=stage["artifact_keys"],
                )
                raw_asset_key = (
                    str(stage["raw_record"]["raw_asset_id"]),
                    str(stage["raw_record"]["raw_version_id"]),
                )
                staged_raw_asset_keys.add(raw_asset_key)
                self._stage_raw_unlocked(
                    run_id=run_id,
                    shard_id=batch.shard_id,
                    batch_id=batch.batch_id,
                    raw_record=stage["raw_record"],
                    source_artifact_keys=stage["source_artifact_keys"],
                )
                for document_stage in _documents_from_stage(stage):
                    document_key = (
                        str(document_stage["document"]["document_id"]),
                        str(document_stage["document"]["revision_track"]),
                        str(document_stage["document"]["version_id"]),
                    )
                    staged_document_keys.add(document_key)
                    self._stage_document_unlocked(
                        run_id=run_id,
                        shard_id=batch.shard_id,
                        batch_id=batch.batch_id,
                        document=document_stage["document"],
                        staged_object_keys=document_stage["staged_object_keys"],
                        final_object_keys=document_stage["final_object_keys"],
                        content_hash=document_stage["content_hash"],
                        staged_object_metadata=document_stage.get("staged_object_metadata") or {},
                    )

            completed_batch = batch.complete(
                staged_notice_count=len(staged_notice_ids),
                staged_raw_asset_count=len(staged_raw_asset_keys),
                staged_document_count=len(staged_document_keys),
            )
            self._batches[run_id][batch_id] = completed_batch
            previous_shard_state = shard.state
            completed_shard = shard.complete_batch(
                processed_notice_count=len(staged_notice_ids),
                staged_notice_count=len(staged_notice_ids),
            )
            self._shards[run_id][batch.shard_id] = completed_shard
            completed_worker = worker.complete_batch(batch_id)
            self._workers[run_id][worker_id] = completed_worker
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
                active_worker_count=self._active_worker_count_unlocked(run_id),
            )
            self._runs[run_id] = updated_run
            return completed_batch

    def fail_batch(
        self,
        *,
        run_id: str,
        worker_id: str,
        batch_id: int,
        error: str,
    ) -> CloseoutBatch:
        with self._lock:
            batch = self._require_batch_unlocked(run_id, batch_id)
            shard = self._require_shard_unlocked(run_id, batch.shard_id)
            worker = self._require_worker_unlocked(run_id, worker_id)
            run = self._require_run_unlocked(run_id)
            failed_batch = batch.fail(error)
            self._batches[run_id][batch_id] = failed_batch
            previous_shard_state = shard.state
            self._shards[run_id][batch.shard_id] = shard.fail(error)
            self._workers[run_id][worker_id] = worker.fail_batch(batch_id, error)
            self._runs[run_id] = run.with_progress(
                running_batch_delta=-1,
                failed_shard_delta=(
                    1 if previous_shard_state != CloseoutShardState.FAILED else 0
                ),
                active_worker_count=self._active_worker_count_unlocked(run_id),
            ).fail(error)
            return failed_batch

    def finish_worker(self, run_id: str, worker_id: str) -> CloseoutWorker:
        with self._lock:
            worker = self._workers.setdefault(run_id, {}).get(worker_id)
            if worker is None:
                worker = CloseoutWorker(worker_id=worker_id)
            worker = worker.finish()
            self._workers[run_id][worker_id] = worker
            run = self._runs.get(run_id)
            if run is not None:
                self._runs[run_id] = run.with_progress(
                        active_worker_count=self._active_worker_count_unlocked(run_id)
                    )
            return worker

    def try_begin_verification(self, run_id: str) -> bool:
        with self._lock:
            run = self._require_run_unlocked(run_id)
            if run.state not in (CloseoutRunState.PLANNED, CloseoutRunState.RUNNING):
                return False
            batches = tuple(self._batches.get(run_id, {}).values())
            if len(batches) != run.batch_count:
                return False
            if run.completed_batch_count < run.batch_count:
                return False
            if run.pending_batch_count > 0:
                return False
            if run.running_batch_count > 0:
                return False
            if any(
                batch.state in (CloseoutBatchState.PENDING, CloseoutBatchState.RUNNING)
                for batch in batches
            ):
                return False
            if any(batch.state == CloseoutBatchState.FAILED for batch in batches):
                self._runs[run_id] = run.fail("closeout batch failure prevents verification")
                return False
            self._runs[run_id] = run.mark_verifying()
            return True

    def mark_run_verified(
        self,
        run_id: str,
        verification: dict[str, Any],
    ) -> CloseoutRun:
        with self._lock:
            run = self._require_run_unlocked(run_id).mark_verified(verification)
            self._runs[run_id] = run
            return run

    def mark_run_failed(self, run_id: str, reason: str) -> CloseoutRun:
        with self._lock:
            run = self._require_run_unlocked(run_id).fail(reason)
            self._runs[run_id] = run
            return run

    def get_staged_notices(
        self,
        run_id: str,
        shard_id: int | None = None,
        batch_id: int | None = None,
    ) -> tuple[dict[str, Any], ...]:
        with self._lock:
            staged = list(self._notices.get(run_id, {}).values())
        if shard_id is not None:
            staged = [item for item in staged if int(item["shard_id"]) == shard_id]
        if batch_id is not None:
            staged = [item for item in staged if item.get("batch_id") == batch_id]
        return tuple(sorted(staged, key=lambda item: str(item["notice_id"])))

    def get_staged_raw_assets(self, run_id: str) -> tuple[dict[str, Any], ...]:
        with self._lock:
            return tuple(
                payload
                for _, payload in sorted(
                    self._raw_assets.get(run_id, {}).items(),
                    key=lambda item: item[0],
                )
            )

    def get_staged_documents(self, run_id: str) -> tuple[dict[str, Any], ...]:
        with self._lock:
            return tuple(
                payload
                for _, payload in sorted(
                    self._documents.get(run_id, {}).items(),
                    key=lambda item: item[0],
                )
            )

    def clear_batch_stage(self, run_id: str, batch_id: int) -> None:
        with self._lock:
            self._notices[run_id] = {
                notice_id: payload
                for notice_id, payload in self._notices.get(run_id, {}).items()
                if int(payload.get("batch_id") or 0) != int(batch_id)
            }
            self._raw_assets[run_id] = {
                key: payload
                for key, payload in self._raw_assets.get(run_id, {}).items()
                if int(payload.get("batch_id") or 0) != int(batch_id)
            }
            self._documents[run_id] = {
                key: payload
                for key, payload in self._documents.get(run_id, {}).items()
                if int(payload.get("batch_id") or 0) != int(batch_id)
            }

    def record_milestone(self, run_id: str, name: str, payload: dict[str, Any]) -> None:
        with self._lock:
            self._milestones.setdefault(run_id, {})[name] = {
                "name": name,
                "payload": dict(payload),
            }

    def get_milestones(self, run_id: str) -> tuple[dict[str, Any], ...]:
        with self._lock:
            milestones = self._milestones.get(run_id, {})
            return tuple(milestones[name] for name in sorted(milestones))

    def record_promotion(self, run_id: str, payload: dict[str, Any]) -> None:
        with self._lock:
            self._promotions.setdefault(run_id, []).append(dict(payload))

    def save_promotion_batch(
        self,
        run_id: str,
        batch: CloseoutPromotionBatch,
    ) -> None:
        with self._lock:
            self._promotion_batches.setdefault(run_id, {}).setdefault(batch.promotion_id, {})[
                batch.batch_id
            ] = batch

    def list_promotion_batches(
        self,
        run_id: str,
        promotion_id: str,
    ) -> tuple[CloseoutPromotionBatch, ...]:
        with self._lock:
            batches = self._promotion_batches.get(run_id, {}).get(promotion_id, {})
            return tuple(batches[batch_id] for batch_id in sorted(batches))

    def _active_worker_count_unlocked(self, run_id: str) -> int:
        workers = self._workers.get(run_id, {})
        return sum(1 for worker in workers.values() if worker.active_batch_count > 0)

    def _stage_notice_unlocked(
        self,
        *,
        run_id: str,
        shard_id: int,
        batch_id: int,
        notice: dict[str, Any],
        artifact_keys: Sequence[str],
    ) -> None:
        payload = dict(notice)
        payload["artifact_keys"] = tuple(str(item) for item in artifact_keys)
        payload["shard_id"] = shard_id
        payload["batch_id"] = batch_id
        self._notices.setdefault(run_id, {})[str(payload["notice_id"])] = payload

    def _stage_raw_unlocked(
        self,
        *,
        run_id: str,
        shard_id: int,
        batch_id: int,
        raw_record: dict[str, Any],
        source_artifact_keys: dict[str, str],
    ) -> None:
        payload = {
            "run_id": run_id,
            "shard_id": shard_id,
            "batch_id": batch_id,
            "raw_record": dict(raw_record),
            "source_artifact_keys": dict(source_artifact_keys),
        }
        key = (str(raw_record["raw_asset_id"]), str(raw_record["raw_version_id"]))
        self._raw_assets.setdefault(run_id, {})[key] = payload

    def _stage_document_unlocked(
        self,
        *,
        run_id: str,
        shard_id: int,
        batch_id: int,
        document: dict[str, Any],
        staged_object_keys: dict[str, str],
        final_object_keys: dict[str, str],
        content_hash: str,
        staged_object_metadata: dict[str, dict[str, Any]],
    ) -> None:
        payload = {
            "run_id": run_id,
            "shard_id": shard_id,
            "batch_id": batch_id,
            "document": dict(document),
            "staged_object_keys": dict(staged_object_keys),
            "final_object_keys": dict(final_object_keys),
            "content_hash": content_hash,
            "staged_object_metadata": dict(staged_object_metadata),
        }
        document_key = (
            str(document["document_id"]),
            str(document["revision_track"]),
            str(document["version_id"]),
        )
        self._documents.setdefault(run_id, {})[document_key] = payload

    def _require_run_unlocked(self, run_id: str) -> CloseoutRun:
        run = self._runs.get(run_id)
        if run is None:
            raise ValueError(f"closeout run not found: {run_id}")
        return run

    def _require_shard_unlocked(self, run_id: str, shard_id: int) -> CloseoutShard:
        shard = self._shards.get(run_id, {}).get(shard_id)
        if shard is None:
            raise ValueError(f"closeout shard not found: {run_id}/{shard_id}")
        return shard

    def _require_batch_unlocked(self, run_id: str, batch_id: int) -> CloseoutBatch:
        batch = self._batches.get(run_id, {}).get(batch_id)
        if batch is None:
            raise ValueError(f"closeout batch not found: {run_id}/{batch_id}")
        return batch

    def _require_worker_unlocked(self, run_id: str, worker_id: str) -> CloseoutWorker:
        worker = self._workers.get(run_id, {}).get(worker_id)
        if worker is None:
            raise ValueError(f"closeout worker not found: {run_id}/{worker_id}")
        return worker


class PostgresAuthenticatedNoticeCloseoutStore:
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
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
                self._save_run_cursor(cursor, run)

    def save_plan(
        self,
        run: CloseoutRun,
        shards: Sequence[CloseoutShard],
        batches: Sequence[CloseoutBatch],
    ) -> None:
        with _postgres_connection(self.database_url, autocommit=False) as conn:
            with conn.cursor() as cursor:
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
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
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
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
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
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
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
        with _postgres_connection(self.database_url, autocommit=False) as conn:
            with conn.cursor() as cursor:
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
        with _postgres_connection(self.database_url, autocommit=False) as conn:
            with conn.cursor() as cursor:
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
                                    "staged_object_keys": dict(
                                        document_stage["staged_object_keys"]
                                    ),
                                    "final_object_keys": dict(
                                        document_stage["final_object_keys"]
                                    ),
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
        with _postgres_connection(self.database_url, autocommit=False) as conn:
            with conn.cursor() as cursor:
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
                    failed_shard_delta=(
                        1 if previous_shard_state != CloseoutShardState.FAILED else 0
                    ),
                    active_worker_count=self._active_worker_count_cursor(cursor, run_id),
                ).fail(error)
                self._save_run_cursor(cursor, updated_run)
                return failed_batch

    def finish_worker(self, run_id: str, worker_id: str) -> CloseoutWorker:
        with _postgres_connection(self.database_url, autocommit=False) as conn:
            with conn.cursor() as cursor:
                run = self._require_run_cursor(cursor, run_id)
                worker = self._get_worker_cursor(cursor, run_id, worker_id)
                if worker is None:
                    worker = CloseoutWorker(worker_id=worker_id)
                worker = worker.finish()
                self._save_worker_cursor(cursor, run_id, worker)
                self._save_run_cursor(
                    cursor,
                    run.with_progress(
                        active_worker_count=self._active_worker_count_cursor(cursor, run_id)
                    ),
                )
                return worker

    def try_begin_verification(self, run_id: str) -> bool:
        with _postgres_connection(self.database_url, autocommit=False) as conn:
            with conn.cursor() as cursor:
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
        with _postgres_connection(self.database_url, autocommit=False) as conn:
            with conn.cursor() as cursor:
                run = self._require_run_cursor(cursor, run_id).mark_verified(verification)
                self._save_run_cursor(cursor, run)
                return run

    def mark_run_failed(self, run_id: str, reason: str) -> CloseoutRun:
        with _postgres_connection(self.database_url, autocommit=False) as conn:
            with conn.cursor() as cursor:
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
        with _postgres_connection(self.database_url, autocommit=False) as conn:
            with conn.cursor() as cursor:
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
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
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
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
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
        with _postgres_connection(self.database_url) as conn:
            with conn.cursor() as cursor:
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
        return tuple(
            CloseoutPromotionBatch.from_dict(_coerce_json_payload(row[0])) for row in rows
        )

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
        recordset_columns = ", ".join(
            f"{column} {column_types[column]}" for column in columns
        )
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


def _notice_stage_from_record(payload: dict[str, Any]) -> dict[str, Any]:
    notice = dict(payload.get("notice") or {})
    notice["artifact_keys"] = tuple(payload.get("artifact_keys") or ())
    notice["shard_id"] = payload.get("shard_id")
    notice["batch_id"] = payload.get("batch_id")
    return notice


__all__ = [
    "CloseoutStore",
    "DEFAULT_BATCH_TABLE",
    "DEFAULT_CLOSEOUT_SCHEMA",
    "DEFAULT_CLOSEOUT_STORE_ENV_KEY",
    "DEFAULT_DOCUMENT_STAGE_TABLE",
    "DEFAULT_MILESTONE_TABLE",
    "DEFAULT_NOTICE_STAGE_TABLE",
    "DEFAULT_PROMOTION_BATCH_TABLE",
    "DEFAULT_PROMOTION_TABLE",
    "DEFAULT_RAW_ASSET_STAGE_TABLE",
    "DEFAULT_RUN_TABLE",
    "DEFAULT_SHARD_TABLE",
    "DEFAULT_WORKER_TABLE",
    "InMemoryCloseoutStore",
    "PostgresAuthenticatedNoticeCloseoutStore",
    "build_authenticated_notice_closeout_store_from_env",
]
