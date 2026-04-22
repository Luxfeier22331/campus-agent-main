from __future__ import annotations

import asyncio
import hashlib
import json
import math
import sys
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from typing import Any

from campus_ingestion_core.authenticated_notice_closeout_artifacts import (
    CloseoutArtifactManager,
)
from campus_ingestion_core.authenticated_notice_closeout_models import (
    DEFAULT_CLOSEOUT_OPERATION,
    CloseoutBatch,
    batch_segment,
)
from campus_ingestion_core.authenticated_notice_closeout_store import CloseoutStore
from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
)
from campus_ingestion_core.authenticated_notice_source_truth_replay import (
    SOURCE_TRUTH_REPLAY_INPUT_KIND,
    build_authenticated_notice_source_truth_replay_batch_input_payload,
)
from campus_ingestion_core.object_store import build_operations_artifact_key


def freeze_bundle_batch_inputs(
    *,
    artifacts: CloseoutArtifactManager,
    closeout_store: CloseoutStore,
    request: AuthenticatedNoticeImportRequest,
    run_id: str,
    planned_batches: Sequence[CloseoutBatch],
    notice_by_id: dict[str, dict[str, Any]],
    object_store_concurrency: int,
    input_kind: str,
) -> tuple[CloseoutBatch, ...]:
    return asyncio.run(
        _freeze_batches_async(
            artifacts=artifacts,
            closeout_store=closeout_store,
            corpus=request.corpus,
            run_id=run_id,
            planned_batches=planned_batches,
            object_store_concurrency=object_store_concurrency,
            input_kind=input_kind,
            build_payload=lambda batch: {
                "run_id": run_id,
                "batch_id": batch.batch_id,
                "shard_id": batch.shard_id,
                "input_kind": input_kind,
                "notice_ids": list(batch.notice_ids),
                "bundle_records": [notice_by_id[notice_id] for notice_id in batch.notice_ids],
            },
        )
    )


def freeze_source_truth_batch_inputs(
    *,
    artifacts: CloseoutArtifactManager,
    closeout_store: CloseoutStore,
    corpus: str,
    run_id: str,
    planned_batches: Sequence[CloseoutBatch],
    parent_by_notice_id: dict[str, dict[str, Any]],
    object_store_concurrency: int,
) -> tuple[CloseoutBatch, ...]:
    return asyncio.run(
        _freeze_batches_async(
            artifacts=artifacts,
            closeout_store=closeout_store,
            corpus=corpus,
            run_id=run_id,
            planned_batches=planned_batches,
            object_store_concurrency=object_store_concurrency,
            input_kind=SOURCE_TRUTH_REPLAY_INPUT_KIND,
            build_payload=lambda batch: (
                build_authenticated_notice_source_truth_replay_batch_input_payload(
                    run_id=run_id,
                    batch_id=batch.batch_id,
                    shard_id=batch.shard_id,
                    notice_ids=batch.notice_ids,
                    parent_by_notice_id=parent_by_notice_id,
                )
            ),
        )
    )


def write_batch_manifests(
    *,
    artifacts: CloseoutArtifactManager,
    closeout_store: CloseoutStore,
    request: AuthenticatedNoticeImportRequest,
    run_id: str,
    batches: Sequence[CloseoutBatch],
    object_store_concurrency: int,
    input_kind: str,
) -> None:
    asyncio.run(
        _write_batch_manifests_async(
            artifacts=artifacts,
            closeout_store=closeout_store,
            request=request,
            run_id=run_id,
            batches=batches,
            object_store_concurrency=object_store_concurrency,
            input_kind=input_kind,
        )
    )


async def _freeze_batches_async(
    *,
    artifacts: CloseoutArtifactManager,
    closeout_store: CloseoutStore,
    corpus: str,
    run_id: str,
    planned_batches: Sequence[CloseoutBatch],
    object_store_concurrency: int,
    input_kind: str,
    build_payload: Callable[[CloseoutBatch], dict[str, Any]],
) -> tuple[CloseoutBatch, ...]:
    if not planned_batches:
        return ()
    total_batches = len(planned_batches)
    frozen_batches: list[CloseoutBatch | None] = [None] * total_batches
    progress = {"completed": 0}
    progress_lock = asyncio.Lock()
    progress_step = _progress_step(total_batches)
    semaphore = asyncio.Semaphore(max(1, object_store_concurrency))

    async def freeze_one(index: int, batch: CloseoutBatch) -> None:
        batch_payload = build_payload(batch)
        batch_bytes = json.dumps(
            batch_payload,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        ).encode("utf-8")
        batch_sha256 = hashlib.sha256(batch_bytes).hexdigest()
        input_key = build_operations_artifact_key(
            corpus=corpus,
            operation=DEFAULT_CLOSEOUT_OPERATION,
            run_id=run_id,
            filename="input.json",
            segments=("batches", batch_segment(batch.batch_id)),
        )
        await artifacts.put_bytes_limited(
            semaphore=semaphore,
            bucket=artifacts.object_store_settings.bucket_derived,
            key=input_key,
            data=batch_bytes,
            content_type="application/json",
            metadata={"sha256": batch_sha256},
            executor=executor,
        )
        frozen_batches[index] = CloseoutBatch(
            batch_id=batch.batch_id,
            shard_id=batch.shard_id,
            notice_ids=batch.notice_ids,
            input_object_key=input_key,
            input_sha256=batch_sha256,
        )
        await _record_planning_progress(
            closeout_store=closeout_store,
            run_id=run_id,
            milestone_name="batch_inputs_progress",
            input_kind=input_kind,
            total_batches=total_batches,
            completed=progress,
            progress_lock=progress_lock,
            progress_step=progress_step,
        )

    with ThreadPoolExecutor(
        max_workers=max(1, object_store_concurrency),
        thread_name_prefix="closeout-plan-put",
    ) as executor:
        async with asyncio.TaskGroup() as task_group:
            for index, batch in enumerate(planned_batches):
                task_group.create_task(freeze_one(index, batch))
    return tuple(batch for batch in frozen_batches if batch is not None)


async def _write_batch_manifests_async(
    *,
    artifacts: CloseoutArtifactManager,
    closeout_store: CloseoutStore,
    request: AuthenticatedNoticeImportRequest,
    run_id: str,
    batches: Sequence[CloseoutBatch],
    object_store_concurrency: int,
    input_kind: str,
) -> None:
    if not batches:
        return
    total_batches = len(batches)
    progress = {"completed": 0}
    progress_lock = asyncio.Lock()
    progress_step = _progress_step(total_batches)
    semaphore = asyncio.Semaphore(max(1, object_store_concurrency))

    async def write_one(batch: CloseoutBatch) -> None:
        await artifacts.write_json_artifact_limited(
            semaphore=semaphore,
            request=request,
            run_id=run_id,
            filename="manifest.json",
            payload=asdict(batch),
            segments=("batches", batch_segment(batch.batch_id)),
            executor=executor,
        )
        await _record_planning_progress(
            closeout_store=closeout_store,
            run_id=run_id,
            milestone_name="batch_manifests_progress",
            input_kind=input_kind,
            total_batches=total_batches,
            completed=progress,
            progress_lock=progress_lock,
            progress_step=progress_step,
        )

    with ThreadPoolExecutor(
        max_workers=max(1, object_store_concurrency),
        thread_name_prefix="closeout-manifest-put",
    ) as executor:
        async with asyncio.TaskGroup() as task_group:
            for batch in batches:
                task_group.create_task(write_one(batch))


async def _record_planning_progress(
    *,
    closeout_store: CloseoutStore,
    run_id: str,
    milestone_name: str,
    input_kind: str,
    total_batches: int,
    completed: dict[str, int],
    progress_lock: asyncio.Lock,
    progress_step: int,
) -> None:
    payload: dict[str, Any] | None = None
    async with progress_lock:
        completed["completed"] += 1
        completed_count = completed["completed"]
        if completed_count == total_batches or completed_count % progress_step == 0:
            payload = {
                "run_id": run_id,
                "input_kind": input_kind,
                "completed_batch_count": completed_count,
                "total_batch_count": total_batches,
            }
    if payload is None:
        return
    closeout_store.record_milestone(run_id, milestone_name, payload)
    print(
        json.dumps(
            {"event": milestone_name, **payload},
            ensure_ascii=False,
            sort_keys=True,
        ),
        file=sys.stderr,
        flush=True,
    )


def _progress_step(total_batches: int) -> int:
    return max(1, min(32, math.ceil(total_batches / 8)))
