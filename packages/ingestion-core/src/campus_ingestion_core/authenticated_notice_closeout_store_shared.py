from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Protocol

from campus_ingestion_core.authenticated_notice_closeout_models import (
    CloseoutBatch,
    CloseoutPromotionBatch,
    CloseoutRun,
    CloseoutShard,
    CloseoutWorker,
)

DEFAULT_CLOSEOUT_SCHEMA = "ingestion_closeout"
DEFAULT_CLOSEOUT_STORE_ENV_KEY = "AUTHENTICATED_NOTICE_CLOSEOUT_DATABASE_URL"
DEFAULT_CLOSEOUT_STORE_OPERATOR_ENV_KEY = "AUTHENTICATED_NOTICE_CLOSEOUT_OPERATOR_DATABASE_URL"
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


def _notice_stage_from_record(payload: dict[str, Any]) -> dict[str, Any]:
    notice = dict(payload.get("notice") or {})
    notice["artifact_keys"] = tuple(payload.get("artifact_keys") or ())
    notice["shard_id"] = payload.get("shard_id")
    notice["batch_id"] = payload.get("batch_id")
    return notice
