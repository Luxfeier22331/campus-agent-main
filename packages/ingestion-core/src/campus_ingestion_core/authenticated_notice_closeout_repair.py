from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
import hashlib
import json
from typing import Any

from campus_ingestion_core.authenticated_notice_closeout_artifacts import (
    CloseoutArtifactManager,
)
from campus_ingestion_core.authenticated_notice_closeout_models import (
    DEFAULT_CLOSEOUT_OPERATION,
    CloseoutBatch,
    CloseoutBatchState,
    CloseoutRun,
    CloseoutRunState,
    CloseoutShard,
    CloseoutShardState,
    CloseoutWorker,
)
from campus_ingestion_core.authenticated_notice_closeout_store import CloseoutStore
from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
)
from campus_ingestion_core.object_store import build_operations_artifact_key
from campus_ingestion_core.settings import ObjectStoreSettings


class CloseoutRepairCoordinator:
    def __init__(
        self,
        *,
        closeout_store: CloseoutStore,
        artifacts: CloseoutArtifactManager,
        object_store_settings: ObjectStoreSettings,
        build_run_summary: Callable[[str], dict[str, Any]],
    ) -> None:
        self.closeout_store = closeout_store
        self.artifacts = artifacts
        self.object_store_settings = object_store_settings
        self.build_run_summary = build_run_summary

    def repair_run(
        self,
        *,
        run: CloseoutRun,
        request: AuthenticatedNoticeImportRequest,
    ) -> dict[str, Any]:
        if run.state in (CloseoutRunState.DONE, CloseoutRunState.PROMOTING):
            raise ValueError(
                f"closeout run cannot be repaired once promotion has started: {run.state.value}"
            )
        shards = self.closeout_store.list_shards(run.run_id)
        if len(shards) != run.shard_count:
            raise ValueError(
                f"closeout shard plan is incomplete for repair: expected {run.shard_count}, found {len(shards)}"
            )
        batches = self.closeout_store.list_batches(run.run_id)
        persisted_batch_ids = {batch.batch_id for batch in batches}
        expected_batch_ids = sorted(
            int(batch_id) for shard in shards for batch_id in shard.batch_ids
        )
        missing_batch_ids = [
            batch_id for batch_id in expected_batch_ids if batch_id not in persisted_batch_ids
        ]
        for batch in batches:
            if batch.state == CloseoutBatchState.FAILED:
                raise ValueError(
                    f"closeout run has failed batch rows; repair only supports missing batch recovery: {batch.batch_id}"
                )
        for batch_id in missing_batch_ids:
            self.closeout_store.save_batch(run.run_id, self._load_frozen_batch(run, batch_id))

        repaired_run = self._rebuild_run(
            run=self.closeout_store.get_run(run.run_id) or run,
            shards=shards,
            batches=self.closeout_store.list_batches(run.run_id),
            workers=self.closeout_store.list_workers(run.run_id),
        )
        self.closeout_store.save_run(repaired_run)
        repair_payload = {
            "run_id": run.run_id,
            "state": repaired_run.state.value,
            "restored_batch_count": len(missing_batch_ids),
            "restored_batch_ids_sample": missing_batch_ids[:20],
            "batch_count": repaired_run.batch_count,
            "completed_batch_count": repaired_run.completed_batch_count,
            "running_batch_count": repaired_run.running_batch_count,
            "pending_batch_count": repaired_run.pending_batch_count,
            "staged_notice_count": repaired_run.staged_notice_count,
            "staged_document_count": repaired_run.staged_document_count,
            "staged_raw_asset_count": repaired_run.staged_raw_asset_count,
            "processed_notice_count": repaired_run.processed_notice_count,
        }
        self.closeout_store.record_milestone(run.run_id, "repaired", repair_payload)
        self.artifacts.write_json_artifact(
            request=request,
            run_id=run.run_id,
            filename="repaired.json",
            payload=repair_payload,
            segments=("milestones",),
        )
        return self.build_run_summary(run.run_id)

    def _load_frozen_batch(self, run: CloseoutRun, batch_id: int) -> CloseoutBatch:
        key = build_operations_artifact_key(
            corpus=run.corpus,
            operation=DEFAULT_CLOSEOUT_OPERATION,
            run_id=run.run_id,
            filename="input.json",
            segments=("batches", f"{int(batch_id):06d}"),
        )
        payload_bytes = self.artifacts.object_store.get_bytes(
            bucket=self.object_store_settings.bucket_derived,
            key=key,
        )
        payload = json.loads(payload_bytes.decode("utf-8"))
        if str(payload.get("run_id")) != run.run_id:
            raise ValueError(f"closeout repair batch run mismatch for {batch_id}")
        if int(payload.get("batch_id") or 0) != int(batch_id):
            raise ValueError(f"closeout repair batch id mismatch for {batch_id}")
        notice_ids = tuple(str(item) for item in payload.get("notice_ids") or ())
        if not notice_ids:
            raise ValueError(f"closeout repair batch missing notice ids for {batch_id}")
        return CloseoutBatch(
            batch_id=batch_id,
            shard_id=int(payload["shard_id"]),
            notice_ids=notice_ids,
            input_object_key=key,
            input_sha256=hashlib.sha256(payload_bytes).hexdigest(),
        )

    def _rebuild_run(
        self,
        *,
        run: CloseoutRun,
        shards: tuple[CloseoutShard, ...],
        batches: tuple[CloseoutBatch, ...],
        workers: tuple[CloseoutWorker, ...],
    ) -> CloseoutRun:
        completed_batch_count = sum(
            1 for batch in batches if batch.state == CloseoutBatchState.DONE
        )
        running_batch_count = sum(
            1 for batch in batches if batch.state == CloseoutBatchState.RUNNING
        )
        pending_batch_count = sum(
            1 for batch in batches if batch.state == CloseoutBatchState.PENDING
        )
        completed_shard_count = sum(
            1 for shard in shards if shard.state == CloseoutShardState.DONE
        )
        failed_shard_count = sum(
            1 for shard in shards if shard.state == CloseoutShardState.FAILED
        )
        active_worker_count = sum(
            1 for worker in workers if int(worker.active_batch_count) > 0
        )
        completed_notice_count = sum(
            int(batch.processed_notice_count)
            for batch in batches
            if batch.state == CloseoutBatchState.DONE
        )
        staged_notice_count = max(int(run.staged_notice_count), completed_notice_count)
        staged_raw_asset_count = max(int(run.staged_raw_asset_count), completed_notice_count)
        staged_document_count = max(int(run.staged_document_count), completed_notice_count)
        next_state = (
            CloseoutRunState.RUNNING
            if pending_batch_count > 0 or running_batch_count > 0 or completed_batch_count > 0
            else CloseoutRunState.PLANNED
        )
        return replace(
            run,
            state=next_state,
            verification={},
            promotion={},
            failure_reason=None,
            finished_at=None,
            shard_count=len(shards),
            batch_count=len(batches),
            completed_shard_count=completed_shard_count,
            failed_shard_count=failed_shard_count,
            completed_batch_count=completed_batch_count,
            running_batch_count=running_batch_count,
            pending_batch_count=pending_batch_count,
            active_worker_count=active_worker_count,
            processed_notice_count=max(int(run.processed_notice_count), completed_notice_count),
            staged_notice_count=staged_notice_count,
            staged_raw_asset_count=staged_raw_asset_count,
            staged_document_count=staged_document_count,
        )


__all__ = ["CloseoutRepairCoordinator"]
