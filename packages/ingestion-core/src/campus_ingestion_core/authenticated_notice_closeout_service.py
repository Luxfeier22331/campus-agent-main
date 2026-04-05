from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_closeout_artifacts import (
    CloseoutArtifactManager,
    CloseoutObjectStore,
    CloseoutS3ObjectStore,
)
from campus_ingestion_core.authenticated_notice_closeout_planning import (
    CloseoutPlanner,
    CloseoutPlanningCoordinator,
)
from campus_ingestion_core.authenticated_notice_closeout_promotion import (
    CloseoutPromotionCoordinator,
)
from campus_ingestion_core.authenticated_notice_closeout_repair import (
    CloseoutRepairCoordinator,
)
from campus_ingestion_core.authenticated_notice_closeout_store import (
    CloseoutStore,
    build_authenticated_notice_closeout_store_from_env,
)
from campus_ingestion_core.authenticated_notice_closeout_verification import (
    CloseoutRunVerifier,
    CloseoutVerifier,
)
from campus_ingestion_core.authenticated_notice_closeout_execution import (
    CloseoutExecutionCoordinator,
)
from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
)
from campus_ingestion_core.authenticated_notice_source_truth_replay import (
    AuthenticatedNoticeSourceTruthReplayRequest,
)
from campus_ingestion_core.registry import (
    DocumentRegistry,
    RawAssetRegistry,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.raw_ingestion import OnlineOcrClient
from campus_ingestion_core.settings import ObjectStoreSettings


class AuthenticatedNoticeCloseoutService:
    def __init__(
        self,
        *,
        closeout_store: CloseoutStore,
        object_store: CloseoutObjectStore,
        object_store_settings: ObjectStoreSettings,
        document_registry: DocumentRegistry,
        raw_asset_registry: RawAssetRegistry,
        planner: CloseoutPlanner | None = None,
        verifier: CloseoutVerifier | None = None,
        ocr_client: OnlineOcrClient | None = None,
    ) -> None:
        self.closeout_store = closeout_store
        self.object_store = object_store
        self.object_store_settings = object_store_settings
        self.document_registry = document_registry
        self.raw_asset_registry = raw_asset_registry
        self.planner = planner or CloseoutPlanner()
        self.verifier = verifier or CloseoutVerifier()
        self.artifacts = CloseoutArtifactManager(
            object_store=object_store,
            object_store_settings=object_store_settings,
        )
        self.run_verifier = CloseoutRunVerifier(
            closeout_store=closeout_store,
            artifacts=self.artifacts,
            object_store_settings=object_store_settings,
            verifier=self.verifier,
        )
        self.planning = CloseoutPlanningCoordinator(
            closeout_store=closeout_store,
            planner=self.planner,
            artifacts=self.artifacts,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            build_run_summary=self._build_run_summary,
        )
        self.execution = CloseoutExecutionCoordinator(
            closeout_store=closeout_store,
            artifacts=self.artifacts,
            object_store_settings=object_store_settings,
            run_verifier=self.run_verifier,
            build_run_summary=self._build_run_summary,
            ocr_client=ocr_client,
        )
        self.repair = CloseoutRepairCoordinator(
            closeout_store=closeout_store,
            artifacts=self.artifacts,
            object_store_settings=object_store_settings,
            build_run_summary=self._build_run_summary,
        )
        self.promotion = CloseoutPromotionCoordinator(
            closeout_store=closeout_store,
            artifacts=self.artifacts,
            object_store_settings=object_store_settings,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            build_run_summary=self._build_run_summary,
        )

    @classmethod
    def from_env(
        cls,
        env: dict[str, str] | None = None,
        *,
        planner: CloseoutPlanner | None = None,
    ) -> AuthenticatedNoticeCloseoutService:
        source = env if env is not None else dict(os.environ)
        settings = ObjectStoreSettings.from_env(source)
        return cls(
            closeout_store=build_authenticated_notice_closeout_store_from_env(source),
            object_store=CloseoutS3ObjectStore(settings),
            object_store_settings=settings,
            document_registry=build_document_registry_from_env(source),
            raw_asset_registry=build_raw_asset_registry_from_env(source),
            planner=planner,
        )

    def plan_run(
        self,
        *,
        request: AuthenticatedNoticeImportRequest,
        run_id: str,
        max_concurrency: int = 8,
        notice_concurrency: int = 8,
        object_store_concurrency: int = 64,
        lease_seconds: int = 300,
    ) -> dict[str, Any]:
        return self.planning.plan_run(
            request=request,
            run_id=run_id,
            max_concurrency=max_concurrency,
            notice_concurrency=notice_concurrency,
            object_store_concurrency=object_store_concurrency,
            lease_seconds=lease_seconds,
        )

    def run_worker(
        self,
        *,
        run_id: str,
        worker_id: str,
        max_batches: int | None = None,
        poll_interval: float | None = None,
    ) -> dict[str, Any]:
        run = self.closeout_store.get_run(run_id)
        if run is None:
            raise ValueError(f"closeout run not found: {run_id}")
        return self.execution.run_worker(
            run=run,
            request=self._request_from_run(run),
            worker_id=worker_id,
            max_batches=max_batches,
            poll_interval=poll_interval,
        )

    def plan_source_truth_replay_run(
        self,
        *,
        request: AuthenticatedNoticeSourceTruthReplayRequest,
        run_id: str,
        max_concurrency: int = 8,
        notice_concurrency: int = 8,
        object_store_concurrency: int = 64,
        lease_seconds: int = 300,
    ) -> dict[str, Any]:
        return self.planning.plan_source_truth_replay_run(
            request=request,
            run_id=run_id,
            max_concurrency=max_concurrency,
            notice_concurrency=notice_concurrency,
            object_store_concurrency=object_store_concurrency,
            lease_seconds=lease_seconds,
        )

    def promote_run(self, run_id: str) -> dict[str, Any]:
        run = self.closeout_store.get_run(run_id)
        if run is None:
            raise ValueError(f"closeout run not found: {run_id}")
        if run.state.value == "done":
            return self._build_run_summary(run_id)
        if run.state.value not in ("verified", "promoting"):
            raise ValueError(
                f"closeout run must be verified before promotion: {run.state.value}"
            )
        return self.promotion.promote_run(
            run=run,
            request=self._request_from_run(run),
        )

    def repair_run(self, run_id: str) -> dict[str, Any]:
        run = self.closeout_store.get_run(run_id)
        if run is None:
            raise ValueError(f"closeout run not found: {run_id}")
        return self.repair.repair_run(
            run=run,
            request=self._request_from_run(run),
        )

    def show_run(self, run_id: str) -> dict[str, Any]:
        return self._build_run_summary(run_id)

    def _build_run_summary(self, run_id: str) -> dict[str, Any]:
        run = self.closeout_store.get_run(run_id)
        if run is None:
            raise ValueError(f"closeout run not found: {run_id}")
        shards = self.closeout_store.list_shards(run_id)
        batches = self.closeout_store.list_batches(run_id)
        workers = self.closeout_store.list_workers(run_id)
        promotion = dict(run.promotion)
        promotion_id = str(promotion.get("promotion_id") or "")
        if promotion_id:
            promotion_batches = self.closeout_store.list_promotion_batches(run_id, promotion_id)
            if promotion_batches:
                promotion["copy_batch_count"] = len(promotion_batches)
                promotion["copy_completed_batch_count"] = sum(
                    1 for batch in promotion_batches if batch.state.value == "done"
                )
                promotion["copy_running_batch_count"] = sum(
                    1 for batch in promotion_batches if batch.state.value == "running"
                )
                promotion["copy_failed_batch_count"] = sum(
                    1 for batch in promotion_batches if batch.state.value == "failed"
                )
                promotion["copied_document_count"] = sum(
                    int(batch.copied_document_count) for batch in promotion_batches
                )
                promotion["copied_object_count"] = sum(
                    int(batch.copied_object_count) for batch in promotion_batches
                )
        summary = {
            "run_id": run.run_id,
            "state": run.state.value,
            "input_kind": run.input_kind,
            "expected_notice_count": run.expected_notice_count,
            "expected_document_count": (
                run.expected_document_count or run.expected_notice_count
            ),
            "expected_attachment_document_count": run.expected_attachment_document_count,
            "expected_raw_asset_count": (
                run.expected_raw_asset_count or run.expected_notice_count
            ),
            "source_projections_path": run.source_projections_path,
            "operations_prefix": run.operations_prefix,
            "shard_count": run.shard_count or len(shards),
            "completed_shard_count": run.completed_shard_count,
            "failed_shard_count": run.failed_shard_count,
            "batch_count": run.batch_count or len(batches),
            "completed_batch_count": run.completed_batch_count,
            "running_batch_count": run.running_batch_count,
            "pending_batch_count": run.pending_batch_count,
            "active_worker_count": sum(
                1 for worker in workers if worker.active_batch_count > 0
            ),
            "staged_notice_count": run.staged_notice_count,
            "staged_raw_asset_count": run.staged_raw_asset_count,
            "staged_document_count": run.staged_document_count,
            "processed_notice_count": run.processed_notice_count,
            "planned_at": run.planned_at,
            "started_at": run.started_at,
            "finished_at": run.finished_at,
            "failure_reason": run.failure_reason,
            "verification": dict(run.verification),
            "promotion": promotion,
        }
        if "state" in promotion:
            summary["promotion_state"] = promotion["state"]
        if "phase" in promotion:
            summary["promotion_phase"] = promotion["phase"]
        reserved_promotion_keys = {"state", "phase", "started_at", "finished_at", "updated_at"}
        for key, value in promotion.items():
            if key in {"state", "phase"}:
                continue
            if key in summary or key in reserved_promotion_keys:
                summary[f"promotion_{key}"] = value
                continue
            summary[key] = value
        return summary

    def _request_from_run(self, run) -> AuthenticatedNoticeImportRequest:
        return AuthenticatedNoticeImportRequest(
            bundle_path=Path(run.bundle_path or "."),
            export_manifest_path=Path(run.manifest_path) if run.manifest_path else None,
            site_id=run.site_id,
            source_home_url=run.source_home_url,
            corpus=run.corpus,
            collection=run.collection,
            default_entitlement_groups=run.default_entitlement_groups,
            visibility_scope=run.visibility_scope,
            parser_version=run.parser_version,
            embedding_model=run.embedding_model,
            import_source=run.import_source,
        )


__all__ = [
    "AuthenticatedNoticeCloseoutService",
    "CloseoutObjectStore",
    "CloseoutPlanner",
    "CloseoutS3ObjectStore",
    "CloseoutVerifier",
]
