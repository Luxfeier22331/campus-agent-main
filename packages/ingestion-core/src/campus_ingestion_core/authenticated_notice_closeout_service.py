from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import json
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
    SOURCE_TRUTH_REPLAY_INPUT_KIND,
    AuthenticatedNoticeSourceTruthReplayRequest,
    _load_parent_source_truth_from_snapshot,
)
from campus_ingestion_core.authenticated_notice_source_projections import (
    build_authenticated_notice_attachment_projection_plans,
    load_authenticated_notice_source_projections_config,
    read_authenticated_notice_source_projections_config_path,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    HIGH_RISK_NOTICE_LABELS,
    AuthenticatedNoticeSourceTruthInventoryStore,
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
    _aggregate_notice_risk_counts,
    _derive_notice_risk_label,
    build_authenticated_notice_source_truth_inventory_store_from_env,
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
        source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
        planner: CloseoutPlanner | None = None,
        verifier: CloseoutVerifier | None = None,
        ocr_client: OnlineOcrClient | None = None,
    ) -> None:
        self.closeout_store = closeout_store
        self.object_store = object_store
        self.object_store_settings = object_store_settings
        self.document_registry = document_registry
        self.raw_asset_registry = raw_asset_registry
        self.source_truth_inventory_store = (
            source_truth_inventory_store
            if source_truth_inventory_store is not None
            else InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        )
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
            source_truth_inventory_store=self.source_truth_inventory_store,
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
            closeout_store=build_authenticated_notice_closeout_store_from_env(
                source,
                prefer_management=True,
            ),
            object_store=CloseoutS3ObjectStore(settings),
            object_store_settings=settings,
            document_registry=build_document_registry_from_env(
                source,
                prefer_management=True,
            ),
            raw_asset_registry=build_raw_asset_registry_from_env(
                source,
                prefer_management=True,
            ),
            source_truth_inventory_store=build_authenticated_notice_source_truth_inventory_store_from_env(
                source,
                prefer_management=True,
            ),
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

    def run_workers(
        self,
        *,
        run_id: str,
        worker_count: int,
        worker_id_prefix: str,
        max_batches: int | None = None,
        poll_interval: float | None = None,
    ) -> dict[str, Any]:
        if worker_count <= 0:
            raise ValueError("worker_count must be positive")
        prefix = worker_id_prefix.strip()
        if not prefix:
            raise ValueError("worker_id_prefix is required")
        run = self.closeout_store.get_run(run_id)
        if run is None:
            raise ValueError(f"closeout run not found: {run_id}")
        request = self._request_from_run(run)
        worker_ids = tuple(f"{prefix}-{index + 1:02d}" for index in range(worker_count))
        failures: list[tuple[str, Exception]] = []
        with ThreadPoolExecutor(
            max_workers=worker_count,
            thread_name_prefix="closeout-worker",
        ) as executor:
            future_by_worker = {
                executor.submit(
                    self.execution.run_worker,
                    run=run,
                    request=request,
                    worker_id=worker_id,
                    max_batches=max_batches,
                    poll_interval=poll_interval,
                ): worker_id
                for worker_id in worker_ids
            }
            for future, worker_id in future_by_worker.items():
                try:
                    future.result()
                except Exception as exc:
                    failures.append((worker_id, exc))
        if failures:
            worker_id, exc = failures[0]
            raise RuntimeError(f"closeout worker failed: {worker_id}: {exc}") from exc
        return self._build_run_summary(run_id)

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
        if run.input_kind == SOURCE_TRUTH_REPLAY_INPUT_KIND:
            run = self._refresh_source_truth_replay_frozen_inventory(run)
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
            "selected_notice_ids": list(run.selected_notice_ids),
            "notice_risk_counts": dict(run.notice_risk_counts),
            "high_risk_notice_count": run.high_risk_notice_count,
            "expected_notice_count": run.expected_notice_count,
            "expected_document_count": (
                run.expected_document_count or run.expected_notice_count
            ),
            "expected_attachment_document_count": run.expected_attachment_document_count,
            "expected_ocr_candidate_count": run.expected_ocr_candidate_count,
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

    def _refresh_source_truth_replay_frozen_inventory(self, run):
        inventory_key = str(run.source_truth_inventory_object_key or "").strip()
        if not inventory_key:
            raise ValueError(
                f"source-truth replay run missing frozen inventory artifact: {run.run_id}"
            )
        payload = json.loads(
            self.object_store.get_bytes(
                bucket=self.object_store_settings.bucket_derived,
                key=inventory_key,
            ).decode("utf-8")
        )
        if str(payload.get("run_id") or "") != run.run_id:
            raise ValueError(
                f"source-truth replay frozen inventory run mismatch: {run.run_id}"
            )
        config_path = (
            Path(run.source_projections_path)
            if run.source_projections_path
            else read_authenticated_notice_source_projections_config_path(dict(os.environ))
        )
        config = load_authenticated_notice_source_projections_config(config_path)
        parents = []
        required_attachment_document_count = 0
        ocr_candidate_count = 0
        notice_risk_counts: dict[str, int] = {}
        for parent in tuple(payload.get("parents") or ()):
            preserve_attachment_content_sha256 = any(
                "attachment_content_sha256" in item
                for item in tuple(parent.get("attachment_projection_plans") or ())
                if isinstance(item, dict)
            )
            parent_source_truth = _load_parent_source_truth_from_snapshot(
                parent_snapshot=dict(parent),
                object_store=self.object_store,
                object_store_settings=self.object_store_settings,
            )
            attachment_projection_plans = [
                dict(item)
                for item in build_authenticated_notice_attachment_projection_plans(
                    parent_document_id=parent_source_truth.record.document_id,
                    attachment_refs=parent_source_truth.attachment_refs,
                    config=config,
                    object_store=self.object_store,
                    object_store_settings=self.object_store_settings,
                    parent_record=parent_source_truth.record,
                )
            ]
            if not preserve_attachment_content_sha256:
                attachment_projection_plans = [
                    {
                        key: value
                        for key, value in plan.items()
                        if key != "attachment_content_sha256"
                    }
                    for plan in attachment_projection_plans
                ]
            required_documents = [
                dict(plan)
                for plan in attachment_projection_plans
                if str(plan.get("materialization_policy") or "") == "required_document"
            ]
            text_extractable_count = sum(
                1
                for plan in attachment_projection_plans
                if str(plan.get("classification") or "") == "text_extractable"
            )
            parent_ocr_candidate_count = sum(
                1
                for plan in attachment_projection_plans
                if str(plan.get("materialization_policy") or "")
                == "conditional_on_extracted_text"
            )
            manual_review_required_count = sum(
                1
                for plan in attachment_projection_plans
                if str(plan.get("materialization_policy") or "") == "manual_review"
            )
            required_attachment_document_count += len(required_documents)
            ocr_candidate_count += parent_ocr_candidate_count
            parent_payload = dict(parent)
            parent_payload["attachment_projection_plans"] = attachment_projection_plans
            parent_payload["expected_attachment_documents"] = required_documents
            parent_payload["attachment_document_count"] = len(required_documents)
            parent_payload["text_extractable_count"] = text_extractable_count
            parent_payload["ocr_required_count"] = parent_ocr_candidate_count
            parent_payload["manual_review_required_count"] = manual_review_required_count
            parent_payload["reference_only_count"] = max(
                len(parent_source_truth.attachment_refs)
                - text_extractable_count
                - parent_ocr_candidate_count
                - manual_review_required_count,
                0,
            )
            parent_payload["attachment_ref_count"] = len(parent_source_truth.attachment_refs)
            parent_payload["has_text_table_attachment"] = (
                text_extractable_count > 0 or parent_ocr_candidate_count > 0
            )
            parent_payload["has_spatial_attachment"] = manual_review_required_count > 0
            parent_payload["has_reference_only_attachment"] = (
                parent_payload["reference_only_count"] > 0
            )
            attachment_lane_count = sum(
                1
                for count in (
                    text_extractable_count,
                    parent_ocr_candidate_count,
                    manual_review_required_count,
                    int(parent_payload["reference_only_count"]),
                )
                if count > 0
            )
            parent_payload["attachment_mix_score"] = int(
                parent_payload["attachment_ref_count"]
            ) + max(0, attachment_lane_count - 1)
            notice_risk_label = _derive_notice_risk_label(
                attachment_ref_count=int(parent_payload["attachment_ref_count"]),
                has_text_table_attachment=bool(parent_payload["has_text_table_attachment"]),
                has_spatial_attachment=bool(parent_payload["has_spatial_attachment"]),
                has_reference_only_attachment=bool(
                    parent_payload["has_reference_only_attachment"]
                ),
            )
            parent_payload["notice_risk_label"] = notice_risk_label
            notice_risk_counts[notice_risk_label] = (
                notice_risk_counts.get(notice_risk_label, 0) + 1
            )
            parents.append(parent_payload)
        notice_count = len(parents)
        aggregated_notice_risk_counts = _aggregate_notice_risk_counts(
            label for label, count in notice_risk_counts.items() for _ in range(count)
        )
        high_risk_notice_count = sum(
            count
            for label, count in aggregated_notice_risk_counts.items()
            if label in HIGH_RISK_NOTICE_LABELS
        )
        self.object_store.put_bytes(
            bucket=self.object_store_settings.bucket_derived,
            key=inventory_key,
            data=json.dumps(
                {
                    "run_id": run.run_id,
                    "input_kind": SOURCE_TRUTH_REPLAY_INPUT_KIND,
                    "selected_notice_ids": list(
                        payload.get("selected_notice_ids")
                        or [str(parent["notice_id"]) for parent in parents]
                    ),
                    "notice_risk_counts": aggregated_notice_risk_counts,
                    "high_risk_notice_count": high_risk_notice_count,
                    "site_id": payload["site_id"],
                    "source_home_url": payload["source_home_url"],
                    "embedding_model": payload["embedding_model"],
                    "expected_notice_count": notice_count,
                    "expected_document_count": notice_count + required_attachment_document_count,
                    "expected_attachment_document_count": required_attachment_document_count,
                    "expected_ocr_candidate_count": ocr_candidate_count,
                    "expected_raw_asset_count": int(payload.get("expected_raw_asset_count") or run.expected_raw_asset_count),
                    "parents": parents,
                },
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
            ).encode("utf-8"),
            content_type="application/json",
        )
        refreshed_run = replace(
            run,
            notice_risk_counts=aggregated_notice_risk_counts,
            high_risk_notice_count=high_risk_notice_count,
            expected_document_count=notice_count + required_attachment_document_count,
            expected_attachment_document_count=required_attachment_document_count,
            expected_ocr_candidate_count=ocr_candidate_count,
            expected_raw_asset_count=int(payload.get("expected_raw_asset_count") or run.expected_raw_asset_count),
        )
        self.closeout_store.save_run(refreshed_run)
        self.closeout_store.record_milestone(
            run.run_id,
            "inventory_refreshed",
            {
                "run_id": run.run_id,
                "input_kind": SOURCE_TRUTH_REPLAY_INPUT_KIND,
                "notice_risk_counts": aggregated_notice_risk_counts,
                "high_risk_notice_count": high_risk_notice_count,
                "expected_notice_count": notice_count,
                "expected_document_count": notice_count + required_attachment_document_count,
                "expected_attachment_document_count": required_attachment_document_count,
                "expected_ocr_candidate_count": ocr_candidate_count,
                "expected_raw_asset_count": int(payload.get("expected_raw_asset_count") or run.expected_raw_asset_count),
            },
        )
        return refreshed_run


__all__ = [
    "AuthenticatedNoticeCloseoutService",
    "CloseoutObjectStore",
    "CloseoutPlanner",
    "CloseoutS3ObjectStore",
    "CloseoutVerifier",
]
