from __future__ import annotations

from collections.abc import Sequence
from threading import RLock
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
    batch_lease_expired,
)
from campus_ingestion_core.authenticated_notice_closeout_store_shared import (
    _documents_from_stage,
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
                if not (batch.state == CloseoutBatchState.PENDING or batch_lease_expired(batch)):
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
                failed_shard_delta=(1 if previous_shard_state != CloseoutShardState.FAILED else 0),
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
