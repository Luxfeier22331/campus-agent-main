from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict
import hashlib
import json
import math
from typing import Any, Sequence

from campus_ingestion_core.authenticated_notice_closeout_artifacts import (
    CloseoutArtifactManager,
)
from campus_ingestion_core.authenticated_notice_closeout_models import (
    DEFAULT_CLOSEOUT_BATCH_SIZE,
    DEFAULT_CLOSEOUT_LEASE_SECONDS,
    DEFAULT_CLOSEOUT_MAX_CONCURRENCY,
    DEFAULT_CLOSEOUT_NOTICE_CONCURRENCY,
    DEFAULT_CLOSEOUT_OBJECT_STORE_CONCURRENCY,
    DEFAULT_CLOSEOUT_OPERATION,
    DEFAULT_CLOSEOUT_SHARD_SIZE,
    CloseoutBatch,
    CloseoutRun,
    CloseoutShard,
    attach_batches_to_shards,
    batch_segment,
)
from campus_ingestion_core.authenticated_notice_closeout_store import CloseoutStore
from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
    AuthenticatedNoticePreparedImport,
    load_authenticated_notice_bundle_payload,
    load_authenticated_notice_export_manifest,
)
from campus_ingestion_core.object_store import build_operations_artifact_key


class CloseoutPlanner:
    def __init__(
        self,
        *,
        shard_size: int = DEFAULT_CLOSEOUT_SHARD_SIZE,
        batch_size: int = DEFAULT_CLOSEOUT_BATCH_SIZE,
        max_shards: int | None = None,
    ) -> None:
        if shard_size <= 0:
            raise ValueError("shard_size must be positive")
        if batch_size <= 0:
            raise ValueError("batch_size must be positive")
        if max_shards is not None and max_shards <= 0:
            raise ValueError("max_shards must be positive when set")
        self.shard_size = shard_size
        self.batch_size = batch_size
        self.max_shards = max_shards

    def plan_shards(
        self,
        notices: Sequence[dict[str, Any] | AuthenticatedNoticePreparedImport],
    ) -> tuple[CloseoutShard, ...]:
        if not notices:
            return ()
        sorted_notice_ids = tuple(sorted(_extract_notice_id(item) for item in notices))
        shard_count = math.ceil(len(sorted_notice_ids) / self.shard_size)
        if self.max_shards is not None:
            shard_count = min(shard_count, self.max_shards)
        target_shard_size = math.ceil(len(sorted_notice_ids) / shard_count)
        planned: list[CloseoutShard] = []
        for offset in range(0, len(sorted_notice_ids), target_shard_size):
            planned.append(
                CloseoutShard(
                    shard_id=len(planned) + 1,
                    notice_ids=sorted_notice_ids[offset : offset + target_shard_size],
                )
            )
        return tuple(planned)

    def plan_batches(self, shards: Sequence[CloseoutShard]) -> tuple[CloseoutBatch, ...]:
        planned: list[CloseoutBatch] = []
        for shard in shards:
            for offset in range(0, len(shard.notice_ids), self.batch_size):
                planned.append(
                    CloseoutBatch(
                        batch_id=len(planned) + 1,
                        shard_id=shard.shard_id,
                        notice_ids=tuple(shard.notice_ids[offset : offset + self.batch_size]),
                    )
                )
        return tuple(planned)


class CloseoutPlanningCoordinator:
    def __init__(
        self,
        *,
        closeout_store: CloseoutStore,
        planner: CloseoutPlanner,
        artifacts: CloseoutArtifactManager,
        build_run_summary: Callable[[str], dict[str, Any]],
    ) -> None:
        self.closeout_store = closeout_store
        self.planner = planner
        self.artifacts = artifacts
        self.build_run_summary = build_run_summary

    def plan_run(
        self,
        *,
        request: AuthenticatedNoticeImportRequest,
        run_id: str,
        max_concurrency: int = DEFAULT_CLOSEOUT_MAX_CONCURRENCY,
        notice_concurrency: int = DEFAULT_CLOSEOUT_NOTICE_CONCURRENCY,
        object_store_concurrency: int = DEFAULT_CLOSEOUT_OBJECT_STORE_CONCURRENCY,
        lease_seconds: int = DEFAULT_CLOSEOUT_LEASE_SECONDS,
    ) -> dict[str, Any]:
        if self.closeout_store.get_run(run_id) is not None:
            raise ValueError(f"closeout run already exists: {run_id}")
        if max_concurrency <= 0:
            raise ValueError("max_concurrency must be positive")
        if notice_concurrency <= 0:
            raise ValueError("notice_concurrency must be positive")
        if object_store_concurrency <= 0:
            raise ValueError("object_store_concurrency must be positive")
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be positive")

        operations_prefix = build_operations_artifact_key(
            corpus=request.corpus,
            operation=DEFAULT_CLOSEOUT_OPERATION,
            run_id=run_id,
            filename="placeholder.json",
        ).rsplit("/", 1)[0]
        planning_run = CloseoutRun(
            run_id=run_id,
            bundle_path=str(request.bundle_path),
            manifest_path=(
                str(request.export_manifest_path)
                if request.export_manifest_path is not None
                else None
            ),
            expected_notice_count=0,
            operations_prefix=operations_prefix,
            corpus=request.corpus,
            collection=request.collection,
            site_id=request.site_id,
            source_home_url=request.source_home_url,
            default_entitlement_groups=request.default_entitlement_groups,
            visibility_scope=request.visibility_scope,
            parser_version=request.parser_version,
            embedding_model=request.embedding_model,
            import_source=request.import_source,
            shard_size=self.planner.shard_size,
            batch_size=self.planner.batch_size,
            max_concurrency=max_concurrency,
            notice_concurrency=notice_concurrency,
            object_store_concurrency=object_store_concurrency,
            lease_seconds=lease_seconds,
        )
        self.closeout_store.save_run(planning_run)
        try:
            bundle_payload = load_authenticated_notice_bundle_payload(request.bundle_path)
            export_manifest = load_authenticated_notice_export_manifest(
                request.export_manifest_path
            )
            export_manifest_object_key = None
            if export_manifest is not None:
                export_manifest_object_key = build_operations_artifact_key(
                    corpus=request.corpus,
                    operation=DEFAULT_CLOSEOUT_OPERATION,
                    run_id=run_id,
                    filename="export-manifest.json",
                    segments=("inputs",),
                )
                self.artifacts.object_store.put_bytes(
                    bucket=self.artifacts.object_store_settings.bucket_derived,
                    key=export_manifest_object_key,
                    data=json.dumps(
                        export_manifest,
                        ensure_ascii=False,
                        indent=2,
                        sort_keys=True,
                    ).encode("utf-8"),
                    content_type="application/json",
                )

            notice_by_id = {str(item["notice_id"]): item for item in bundle_payload}
            planned_shards = self.planner.plan_shards(bundle_payload)
            planned_batches = self.planner.plan_batches(planned_shards)
            batches = self._freeze_batch_inputs(
                request=request,
                run_id=run_id,
                planned_batches=planned_batches,
                notice_by_id=notice_by_id,
            )
            shards = attach_batches_to_shards(planned_shards, batches)

            run = CloseoutRun(
                run_id=run_id,
                bundle_path=str(request.bundle_path),
                manifest_path=(
                    str(request.export_manifest_path)
                    if request.export_manifest_path is not None
                    else None
                ),
                expected_notice_count=len(bundle_payload),
                operations_prefix=operations_prefix,
                corpus=request.corpus,
                collection=request.collection,
                site_id=request.site_id,
                source_home_url=request.source_home_url,
                default_entitlement_groups=request.default_entitlement_groups,
                visibility_scope=request.visibility_scope,
                parser_version=request.parser_version,
                embedding_model=request.embedding_model,
                import_source=request.import_source,
                export_manifest_object_key=export_manifest_object_key,
                shard_size=self.planner.shard_size,
                batch_size=self.planner.batch_size,
                max_concurrency=max_concurrency,
                notice_concurrency=notice_concurrency,
                object_store_concurrency=object_store_concurrency,
                lease_seconds=lease_seconds,
                shard_count=len(shards),
                batch_count=len(batches),
                pending_batch_count=len(batches),
            ).mark_planned()
            self.closeout_store.save_run(run)
            for shard in shards:
                self.closeout_store.save_shard(run_id, shard)
            for batch in batches:
                self.closeout_store.save_batch(run_id, batch)

            self.artifacts.write_json_artifact(
                request=request,
                run_id=run_id,
                filename="run-manifest.json",
                payload={
                    "run_id": run_id,
                    "bundle_path": str(request.bundle_path),
                    "manifest_path": (
                        str(request.export_manifest_path)
                        if request.export_manifest_path is not None
                        else None
                    ),
                    "export_manifest_object_key": export_manifest_object_key,
                    "expected_notice_count": len(bundle_payload),
                    "shard_size": self.planner.shard_size,
                    "batch_size": self.planner.batch_size,
                    "max_shards": self.planner.max_shards,
                    "max_concurrency": max_concurrency,
                    "notice_concurrency": notice_concurrency,
                    "object_store_concurrency": object_store_concurrency,
                    "lease_seconds": lease_seconds,
                    "operations_prefix": operations_prefix,
                    "corpus": request.corpus,
                    "collection": request.collection,
                    "site_id": request.site_id,
                    "source_home_url": request.source_home_url,
                    "default_entitlement_groups": list(request.default_entitlement_groups),
                    "visibility_scope": request.visibility_scope,
                    "parser_version": request.parser_version,
                    "embedding_model": request.embedding_model,
                    "import_source": request.import_source,
                },
            )
            self.artifacts.write_json_artifact(
                request=request,
                run_id=run_id,
                filename="shard-plan.json",
                payload={
                    "run_id": run_id,
                    "shards": [
                        {
                            "shard_id": shard.shard_id,
                            "notice_ids": list(shard.notice_ids),
                            "batch_ids": list(shard.batch_ids),
                        }
                        for shard in shards
                    ],
                },
            )
            self.artifacts.write_json_artifact(
                request=request,
                run_id=run_id,
                filename="batch-plan.json",
                payload={
                    "run_id": run_id,
                    "batches": [
                        {
                            "batch_id": batch.batch_id,
                            "shard_id": batch.shard_id,
                            "notice_ids": list(batch.notice_ids),
                            "input_object_key": batch.input_object_key,
                            "input_sha256": batch.input_sha256,
                        }
                        for batch in batches
                    ],
                },
            )
            for batch in batches:
                self.artifacts.write_json_artifact(
                    request=request,
                    run_id=run_id,
                    filename="manifest.json",
                    payload=asdict(batch),
                    segments=("batches", batch_segment(batch.batch_id)),
                )
            planned_summary = self.build_run_summary(run_id)
            self.closeout_store.record_milestone(run_id, "planned", planned_summary)
            self.artifacts.write_json_artifact(
                request=request,
                run_id=run_id,
                filename="planned.json",
                payload=planned_summary,
                segments=("milestones",),
            )
            return planned_summary
        except Exception as exc:
            self.closeout_store.mark_run_failed(run_id, str(exc))
            self.closeout_store.record_milestone(
                run_id,
                "failed",
                {"run_id": run_id, "error": str(exc)},
            )
            raise

    def _freeze_batch_inputs(
        self,
        *,
        request: AuthenticatedNoticeImportRequest,
        run_id: str,
        planned_batches: Sequence[CloseoutBatch],
        notice_by_id: dict[str, dict[str, Any]],
    ) -> tuple[CloseoutBatch, ...]:
        frozen_batches: list[CloseoutBatch] = []
        for batch in planned_batches:
            batch_payload = {
                "run_id": run_id,
                "batch_id": batch.batch_id,
                "shard_id": batch.shard_id,
                "notice_ids": list(batch.notice_ids),
                "bundle_records": [notice_by_id[notice_id] for notice_id in batch.notice_ids],
            }
            batch_bytes = json.dumps(
                batch_payload,
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            ).encode("utf-8")
            batch_sha256 = hashlib.sha256(batch_bytes).hexdigest()
            input_key = build_operations_artifact_key(
                corpus=request.corpus,
                operation=DEFAULT_CLOSEOUT_OPERATION,
                run_id=run_id,
                filename="input.json",
                segments=("batches", batch_segment(batch.batch_id)),
            )
            self.artifacts.object_store.put_bytes(
                bucket=self.artifacts.object_store_settings.bucket_derived,
                key=input_key,
                data=batch_bytes,
                content_type="application/json",
                metadata={"sha256": batch_sha256},
            )
            frozen_batches.append(
                CloseoutBatch(
                    batch_id=batch.batch_id,
                    shard_id=batch.shard_id,
                    notice_ids=batch.notice_ids,
                    input_object_key=input_key,
                    input_sha256=batch_sha256,
                )
            )
        return tuple(frozen_batches)


def _extract_notice_id(item: dict[str, Any] | AuthenticatedNoticePreparedImport) -> str:
    if isinstance(item, AuthenticatedNoticePreparedImport):
        return item.notice_id
    return str(item["notice_id"])


__all__ = [
    "CloseoutPlanner",
    "CloseoutPlanningCoordinator",
]
