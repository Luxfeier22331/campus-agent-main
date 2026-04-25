from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from dataclasses import replace
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
    CloseoutWorkerState,
)
from campus_ingestion_core.authenticated_notice_closeout_store import CloseoutStore
from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
)
from campus_ingestion_core.authenticated_notice_source_projections import (
    AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MATERIALIZED_DOCUMENT,
    AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MULTIMODAL_PROCESSING_REQUIRED,
    AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_NO_EXTRACTABLE_TEXT,
    AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_CONDITIONAL_ON_EXTRACTED_TEXT,
    AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_MULTIMODAL_PROCESSING,
    AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_REQUIRED_DOCUMENT,
)
from campus_ingestion_core.authenticated_notice_source_truth_replay import (
    SOURCE_TRUTH_REPLAY_INPUT_KIND,
    _attachment_projection_plans_from_parent,
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
        failed_batches = tuple(
            batch for batch in batches if batch.state == CloseoutBatchState.FAILED
        )
        stale_completed_batches = self._find_stale_completed_batches(
            run=run,
            batches=batches,
        )
        for batch_id in missing_batch_ids:
            self.closeout_store.save_batch(run.run_id, self._load_frozen_batch(run, batch_id))
        for batch in failed_batches:
            self.closeout_store.save_batch(run.run_id, self._reset_failed_batch(batch))
        for batch in stale_completed_batches:
            self.closeout_store.clear_batch_stage(run.run_id, batch.batch_id)
            self.closeout_store.save_batch(run.run_id, self._reset_completed_batch(batch))

        repaired_batches = self.closeout_store.list_batches(run.run_id)
        repaired_shards = tuple(
            self._rebuild_shard(
                shard=shard,
                batches=tuple(
                    batch
                    for batch in repaired_batches
                    if int(batch.shard_id) == int(shard.shard_id)
                ),
            )
            for shard in shards
        )
        for shard in repaired_shards:
            self.closeout_store.save_shard(run.run_id, shard)

        repaired_workers = tuple(
            self._repair_worker(worker) for worker in self.closeout_store.list_workers(run.run_id)
        )
        for worker in repaired_workers:
            self.closeout_store.save_worker(run.run_id, worker)

        repaired_run = self._rebuild_run(
            run=self.closeout_store.get_run(run.run_id) or run,
            shards=repaired_shards,
            batches=repaired_batches,
            workers=repaired_workers,
        )
        self.closeout_store.save_run(repaired_run)
        repair_payload = {
            "run_id": run.run_id,
            "state": repaired_run.state.value,
            "restored_batch_count": len(missing_batch_ids),
            "restored_batch_ids_sample": missing_batch_ids[:20],
            "reset_failed_batch_count": len(failed_batches),
            "reset_failed_batch_ids_sample": [batch.batch_id for batch in failed_batches[:20]],
            "reset_stale_completed_batch_count": len(stale_completed_batches),
            "reset_stale_completed_batch_ids_sample": [
                batch.batch_id for batch in stale_completed_batches[:20]
            ],
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

    def _reset_failed_batch(self, batch: CloseoutBatch) -> CloseoutBatch:
        return replace(
            batch,
            state=CloseoutBatchState.PENDING,
            worker_id=None,
            heartbeat_at=None,
            lease_expires_at=None,
            finished_at=None,
            error=None,
        )

    def _reset_completed_batch(self, batch: CloseoutBatch) -> CloseoutBatch:
        return replace(
            batch,
            state=CloseoutBatchState.PENDING,
            worker_id=None,
            processed_notice_count=0,
            staged_notice_count=0,
            staged_raw_asset_count=0,
            staged_document_count=0,
            heartbeat_at=None,
            lease_expires_at=None,
            finished_at=None,
            error=None,
        )

    def _find_stale_completed_batches(
        self,
        *,
        run: CloseoutRun,
        batches: tuple[CloseoutBatch, ...],
    ) -> tuple[CloseoutBatch, ...]:
        if run.input_kind != SOURCE_TRUTH_REPLAY_INPUT_KIND:
            return ()
        inventory_key = str(run.source_truth_inventory_object_key or "").strip()
        if not inventory_key:
            raise ValueError(
                f"source-truth replay run missing frozen inventory artifact: {run.run_id}"
            )
        payload = json.loads(
            self.artifacts.object_store.get_bytes(
                bucket=self.object_store_settings.bucket_derived,
                key=inventory_key,
            ).decode("utf-8")
        )
        parents_by_notice_id = {
            str(parent["notice_id"]): dict(parent) for parent in tuple(payload.get("parents") or ())
        }
        staged_notices = {
            str(item["notice_id"]): dict(item)
            for item in self.closeout_store.get_staged_notices(run.run_id)
        }
        staged_document_ids_by_batch: dict[int, set[str]] = {}
        for item in self.closeout_store.get_staged_documents(run.run_id):
            batch_id = int(item.get("batch_id") or 0)
            staged_document_ids_by_batch.setdefault(batch_id, set()).add(
                str(item["document"]["document_id"])
            )

        stale_batch_ids: set[int] = set()
        for batch in batches:
            if batch.state != CloseoutBatchState.DONE:
                continue
            if self._batch_has_stale_source_truth_stage(
                batch=batch,
                parents_by_notice_id=parents_by_notice_id,
                staged_notices=staged_notices,
                staged_document_ids=staged_document_ids_by_batch.get(batch.batch_id, set()),
            ):
                stale_batch_ids.add(batch.batch_id)
        return tuple(batch for batch in batches if batch.batch_id in stale_batch_ids)

    def _batch_has_stale_source_truth_stage(
        self,
        *,
        batch: CloseoutBatch,
        parents_by_notice_id: dict[str, dict[str, Any]],
        staged_notices: dict[str, dict[str, Any]],
        staged_document_ids: set[str],
    ) -> bool:
        expected_document_ids: set[str] = set()
        for notice_id in batch.notice_ids:
            parent = parents_by_notice_id.get(str(notice_id))
            if parent is None:
                return True
            expected_document_ids.add(str(parent["document_id"]))
            staged_notice = staged_notices.get(str(notice_id))
            if staged_notice is None:
                return True
            plans = _attachment_projection_plans_from_parent(parent)
            if not plans:
                continue
            observed_outcomes = {
                str(item.get("attachment_ref_id") or ""): dict(item)
                for item in tuple(staged_notice.get("attachment_outcomes") or ())
                if str(item.get("attachment_ref_id") or "").strip()
            }
            expected_attachment_ids = {str(plan["attachment_ref_id"]): dict(plan) for plan in plans}
            if set(observed_outcomes) - set(expected_attachment_ids):
                return True
            for attachment_ref_id, plan in expected_attachment_ids.items():
                outcome = observed_outcomes.get(attachment_ref_id)
                if outcome is None:
                    return True
                if (
                    str(outcome.get("classification") or "") != str(plan["classification"])
                    or str(outcome.get("document_id") or "") != str(plan["document_id"])
                    or str(outcome.get("materialization_policy") or "")
                    != str(plan["materialization_policy"])
                ):
                    return True
                document_id = str(plan["document_id"])
                materialization_policy = str(plan["materialization_policy"])
                outcome_name = str(outcome.get("outcome") or "")
                if (
                    materialization_policy
                    == AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_REQUIRED_DOCUMENT
                ):
                    expected_document_ids.add(document_id)
                    if (
                        outcome_name
                        != AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MATERIALIZED_DOCUMENT
                        or document_id not in staged_document_ids
                    ):
                        return True
                    continue
                if (
                    materialization_policy
                    == AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_MULTIMODAL_PROCESSING
                ):
                    if (
                        outcome_name
                        != AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MULTIMODAL_PROCESSING_REQUIRED
                    ):
                        return True
                    if document_id in staged_document_ids:
                        return True
                    continue
                if (
                    materialization_policy
                    != AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_CONDITIONAL_ON_EXTRACTED_TEXT
                ):
                    return True
                if outcome_name == AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MATERIALIZED_DOCUMENT:
                    expected_document_ids.add(document_id)
                    if document_id not in staged_document_ids:
                        return True
                    continue
                if outcome_name == AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_NO_EXTRACTABLE_TEXT:
                    if document_id in staged_document_ids:
                        return True
                    continue
                return True
        return staged_document_ids != expected_document_ids

    def _rebuild_shard(
        self,
        *,
        shard: CloseoutShard,
        batches: tuple[CloseoutBatch, ...],
    ) -> CloseoutShard:
        completed_batches = tuple(
            batch for batch in batches if batch.state == CloseoutBatchState.DONE
        )
        completed_batch_count = len(completed_batches)
        if completed_batch_count >= shard.batch_count:
            state = CloseoutShardState.DONE
        elif completed_batch_count > 0:
            state = CloseoutShardState.RUNNING
        else:
            state = CloseoutShardState.PENDING
        finished_at = (
            max(
                (str(batch.finished_at) for batch in completed_batches if batch.finished_at),
                default=None,
            )
            if state == CloseoutShardState.DONE
            else None
        )
        return replace(
            shard,
            state=state,
            processed_notice_count=sum(
                int(batch.processed_notice_count) for batch in completed_batches
            ),
            staged_notice_count=sum(int(batch.staged_notice_count) for batch in completed_batches),
            completed_batch_count=completed_batch_count,
            heartbeat_at=finished_at,
            finished_at=finished_at,
            error=None,
        )

    def _repair_worker(self, worker: CloseoutWorker) -> CloseoutWorker:
        if worker.active_batch_count > 0 or worker.current_batch_ids:
            return replace(
                worker,
                state=CloseoutWorkerState.IDLE,
                active_batch_count=0,
                current_batch_ids=(),
                error=None,
            )
        if worker.state == CloseoutWorkerState.FAILED:
            return replace(worker, state=CloseoutWorkerState.IDLE, error=None)
        return worker

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
        completed_shard_count = sum(1 for shard in shards if shard.state == CloseoutShardState.DONE)
        failed_shard_count = sum(1 for shard in shards if shard.state == CloseoutShardState.FAILED)
        active_worker_count = sum(1 for worker in workers if int(worker.active_batch_count) > 0)
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
            if running_batch_count > 0 or completed_batch_count > 0
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
