from __future__ import annotations

import asyncio
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
import hashlib
import json
import math
from pathlib import Path
import sys
from typing import Any, Sequence

from campus_ingestion_core.authenticated_notice_closeout_artifacts import (
    CloseoutArtifactManager,
)
from campus_ingestion_core.authenticated_notice_closeout_models import (
    DEFAULT_CLOSEOUT_BATCH_SIZE,
    DEFAULT_CLOSEOUT_INPUT_KIND,
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
from campus_ingestion_core.authenticated_notice_source_projections import (
    DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_IMPORT_SOURCE,
    DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_PARSER_VERSION,
)
from campus_ingestion_core.authenticated_notice_source_truth_replay import (
    SOURCE_TRUTH_REPLAY_INPUT_KIND,
    AuthenticatedNoticeSourceTruthReplayRequest,
    load_authenticated_notice_source_truth_replay_inventory_from_store,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.object_store import build_operations_artifact_key
from campus_ingestion_core.registry import DocumentRegistry, RawAssetRegistry


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

    def plan_weighted_shards(
        self,
        notices: Sequence[dict[str, Any]],
        *,
        weight_by_notice_id: dict[str, int],
    ) -> tuple[CloseoutShard, ...]:
        notice_ids = tuple(sorted(_extract_notice_id(item) for item in notices))
        groups = self._plan_weighted_groups(
            notice_ids=notice_ids,
            item_limit=self.shard_size,
            max_groups=self.max_shards,
            weight_by_notice_id=weight_by_notice_id,
        )
        return tuple(
            CloseoutShard(shard_id=index + 1, notice_ids=group)
            for index, group in enumerate(groups)
        )

    def plan_weighted_batches(
        self,
        shards: Sequence[CloseoutShard],
        *,
        weight_by_notice_id: dict[str, int],
    ) -> tuple[CloseoutBatch, ...]:
        planned: list[CloseoutBatch] = []
        for shard in shards:
            groups = self._plan_weighted_groups(
                notice_ids=shard.notice_ids,
                item_limit=self.batch_size,
                max_groups=None,
                weight_by_notice_id=weight_by_notice_id,
            )
            for notice_ids in groups:
                planned.append(
                    CloseoutBatch(
                        batch_id=len(planned) + 1,
                        shard_id=shard.shard_id,
                        notice_ids=notice_ids,
                    )
                )
        return tuple(planned)

    def _plan_weighted_groups(
        self,
        *,
        notice_ids: Sequence[str],
        item_limit: int,
        max_groups: int | None,
        weight_by_notice_id: dict[str, int],
    ) -> tuple[tuple[str, ...], ...]:
        if not notice_ids:
            return ()
        group_count = math.ceil(len(notice_ids) / item_limit)
        if max_groups is not None:
            group_count = min(group_count, max_groups)
        group_count = max(1, group_count)
        target_group_size = math.ceil(len(notice_ids) / group_count)
        groups: list[list[str]] = [[] for _ in range(group_count)]
        weights = [0 for _ in range(group_count)]
        ordered = sorted(
            notice_ids,
            key=lambda notice_id: (-max(1, int(weight_by_notice_id.get(notice_id, 1))), notice_id),
        )
        for notice_id in ordered:
            candidate_indexes = [
                index for index, group in enumerate(groups) if len(group) < target_group_size
            ] or list(range(group_count))
            target_index = min(
                candidate_indexes,
                key=lambda index: (weights[index], len(groups[index]), index),
            )
            groups[target_index].append(notice_id)
            weights[target_index] += max(1, int(weight_by_notice_id.get(notice_id, 1)))
        return tuple(
            tuple(sorted(group))
            for group in groups
            if group
        )


class CloseoutPlanningCoordinator:
    def __init__(
        self,
        *,
        closeout_store: CloseoutStore,
        planner: CloseoutPlanner,
        artifacts: CloseoutArtifactManager,
        document_registry: DocumentRegistry,
        raw_asset_registry: RawAssetRegistry,
        source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore,
        build_run_summary: Callable[[str], dict[str, Any]],
    ) -> None:
        self.closeout_store = closeout_store
        self.planner = planner
        self.artifacts = artifacts
        self.document_registry = document_registry
        self.raw_asset_registry = raw_asset_registry
        self.source_truth_inventory_store = source_truth_inventory_store
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
        self._validate_plan_request(
            run_id=run_id,
            max_concurrency=max_concurrency,
            notice_concurrency=notice_concurrency,
            object_store_concurrency=object_store_concurrency,
            lease_seconds=lease_seconds,
        )

        operations_prefix = self._build_operations_prefix(request.corpus, run_id)
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
            input_kind=DEFAULT_CLOSEOUT_INPUT_KIND,
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
        self.closeout_store.record_milestone(
            run_id,
            "planning_started",
            {
                "run_id": run_id,
                "input_kind": DEFAULT_CLOSEOUT_INPUT_KIND,
                "bundle_path": str(request.bundle_path),
                "corpus": request.corpus,
                "collection": request.collection,
            },
        )
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
                object_store_concurrency=object_store_concurrency,
                input_kind=DEFAULT_CLOSEOUT_INPUT_KIND,
            )
            shards = attach_batches_to_shards(planned_shards, batches)
            self.closeout_store.record_milestone(
                run_id,
                "batches_frozen",
                {
                    "run_id": run_id,
                    "shard_count": len(shards),
                    "batch_count": len(batches),
                    "expected_notice_count": len(bundle_payload),
                },
            )

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
                input_kind=DEFAULT_CLOSEOUT_INPUT_KIND,
                expected_document_count=len(bundle_payload),
                expected_attachment_document_count=0,
                expected_raw_asset_count=len(bundle_payload),
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
            self.closeout_store.save_plan(run, shards, batches)

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
                    "input_kind": DEFAULT_CLOSEOUT_INPUT_KIND,
                    "export_manifest_object_key": export_manifest_object_key,
                    "expected_notice_count": len(bundle_payload),
                    "expected_document_count": len(bundle_payload),
                    "expected_attachment_document_count": 0,
                    "expected_raw_asset_count": len(bundle_payload),
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
            self._write_batch_manifests(
                request=request,
                run_id=run_id,
                batches=batches,
                object_store_concurrency=object_store_concurrency,
                input_kind=DEFAULT_CLOSEOUT_INPUT_KIND,
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
            if self.closeout_store.get_run(run_id) is not None:
                self.closeout_store.mark_run_failed(run_id, str(exc))
                self.closeout_store.record_milestone(
                    run_id,
                    "failed",
                    {"run_id": run_id, "error": str(exc)},
                )
            raise

    def plan_source_truth_replay_run(
        self,
        *,
        request: AuthenticatedNoticeSourceTruthReplayRequest,
        run_id: str,
        max_concurrency: int = DEFAULT_CLOSEOUT_MAX_CONCURRENCY,
        notice_concurrency: int = DEFAULT_CLOSEOUT_NOTICE_CONCURRENCY,
        object_store_concurrency: int = DEFAULT_CLOSEOUT_OBJECT_STORE_CONCURRENCY,
        lease_seconds: int = DEFAULT_CLOSEOUT_LEASE_SECONDS,
    ) -> dict[str, Any]:
        self._validate_plan_request(
            run_id=run_id,
            max_concurrency=max_concurrency,
            notice_concurrency=notice_concurrency,
            object_store_concurrency=object_store_concurrency,
            lease_seconds=lease_seconds,
        )
        operations_prefix = self._build_operations_prefix(request.corpus, run_id)
        planning_run = CloseoutRun(
            run_id=run_id,
            bundle_path="",
            manifest_path=None,
            expected_notice_count=0,
            operations_prefix=operations_prefix,
            selected_notice_ids=request.notice_ids,
            input_kind=SOURCE_TRUTH_REPLAY_INPUT_KIND,
            corpus=request.corpus,
            collection=request.collection,
            site_id="",
            source_home_url="",
            visibility_scope=request.default_visibility_scope,
            parser_version=DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_PARSER_VERSION,
            embedding_model="",
            import_source=DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_IMPORT_SOURCE,
            source_projections_path=(
                str(request.source_projections_path)
                if request.source_projections_path is not None
                else None
            ),
            shard_size=self.planner.shard_size,
            batch_size=self.planner.batch_size,
            max_concurrency=max_concurrency,
            notice_concurrency=notice_concurrency,
            object_store_concurrency=object_store_concurrency,
            lease_seconds=lease_seconds,
        )
        self.closeout_store.save_run(planning_run)
        self.closeout_store.record_milestone(
            run_id,
            "planning_started",
            {
                "run_id": run_id,
                "input_kind": SOURCE_TRUTH_REPLAY_INPUT_KIND,
                "corpus": request.corpus,
                "collection": request.collection,
                "selected_notice_ids": list(request.notice_ids),
            },
        )
        try:
            inventory = load_authenticated_notice_source_truth_replay_inventory_from_store(
                request=request,
                source_truth_inventory_store=self.source_truth_inventory_store,
            )
            self.closeout_store.record_milestone(
                run_id,
                "inventory_loaded",
                {
                    "run_id": run_id,
                    "input_kind": SOURCE_TRUTH_REPLAY_INPUT_KIND,
                    "selected_notice_ids": list(inventory.selected_notice_ids),
                    "notice_risk_counts": dict(inventory.notice_risk_counts),
                    "high_risk_notice_count": inventory.high_risk_notice_count,
                    "expected_notice_count": inventory.expected_notice_count,
                    "expected_document_count": inventory.expected_document_count,
                    "expected_attachment_document_count": inventory.expected_attachment_document_count,
                    "expected_ocr_candidate_count": inventory.expected_ocr_candidate_count,
                    "expected_raw_asset_count": inventory.expected_raw_asset_count,
                },
            )
            parent_by_notice_id = {
                str(parent["notice_id"]): parent for parent in inventory.parents
            }
            weight_by_notice_id = {
                str(parent["notice_id"]): max(1, int(parent.get("planning_weight") or 1))
                for parent in inventory.parents
            }
            planned_shards = self.planner.plan_weighted_shards(
                inventory.parents,
                weight_by_notice_id=weight_by_notice_id,
            )
            planned_batches = self.planner.plan_weighted_batches(
                planned_shards,
                weight_by_notice_id=weight_by_notice_id,
            )
            batches = self._freeze_source_truth_batch_inputs(
                request=request,
                run_id=run_id,
                planned_batches=planned_batches,
                parent_by_notice_id=parent_by_notice_id,
                object_store_concurrency=object_store_concurrency,
            )
            shards = attach_batches_to_shards(planned_shards, batches)
            inventory_key = build_operations_artifact_key(
                corpus=request.corpus,
                operation=DEFAULT_CLOSEOUT_OPERATION,
                run_id=run_id,
                filename="ingestion_projection.json",
                segments=("inputs",),
            )
            self.closeout_store.record_milestone(
                run_id,
                "batches_frozen",
                {
                    "run_id": run_id,
                    "shard_count": len(shards),
                    "batch_count": len(batches),
                    "expected_notice_count": inventory.expected_notice_count,
                },
            )
            run = CloseoutRun(
                run_id=run_id,
                bundle_path="",
                manifest_path=None,
                expected_notice_count=inventory.expected_notice_count,
                operations_prefix=operations_prefix,
                selected_notice_ids=inventory.selected_notice_ids,
                input_kind=SOURCE_TRUTH_REPLAY_INPUT_KIND,
                notice_risk_counts=dict(inventory.notice_risk_counts),
                high_risk_notice_count=inventory.high_risk_notice_count,
                expected_document_count=inventory.expected_document_count,
                expected_attachment_document_count=inventory.expected_attachment_document_count,
                expected_ocr_candidate_count=inventory.expected_ocr_candidate_count,
                expected_raw_asset_count=inventory.expected_raw_asset_count,
                corpus=request.corpus,
                collection=request.collection,
                site_id=inventory.site_id,
                source_home_url=inventory.source_home_url,
                visibility_scope=request.default_visibility_scope,
                parser_version=DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_PARSER_VERSION,
                embedding_model=inventory.embedding_model,
                import_source=DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_IMPORT_SOURCE,
                source_truth_inventory_object_key=inventory_key,
                source_projections_path=(
                    str(request.source_projections_path)
                    if request.source_projections_path is not None
                    else None
                ),
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
            self.artifacts.object_store.put_bytes(
                bucket=self.artifacts.object_store_settings.bucket_derived,
                key=inventory_key,
                data=json.dumps(
                    {
                        "run_id": run_id,
                        "input_kind": SOURCE_TRUTH_REPLAY_INPUT_KIND,
                        "selected_notice_ids": list(inventory.selected_notice_ids),
                        "notice_risk_counts": dict(inventory.notice_risk_counts),
                        "high_risk_notice_count": inventory.high_risk_notice_count,
                        "site_id": inventory.site_id,
                        "source_home_url": inventory.source_home_url,
                        "embedding_model": inventory.embedding_model,
                        "expected_notice_count": inventory.expected_notice_count,
                        "expected_document_count": inventory.expected_document_count,
                        "expected_attachment_document_count": inventory.expected_attachment_document_count,
                        "expected_ocr_candidate_count": inventory.expected_ocr_candidate_count,
                        "expected_raw_asset_count": inventory.expected_raw_asset_count,
                        "parents": list(inventory.parents),
                    },
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                ).encode("utf-8"),
                content_type="application/json",
            )
            self.closeout_store.save_plan(run, shards, batches)

            artifact_request = self._build_artifact_request(
                corpus=request.corpus,
                collection=request.collection,
                site_id=inventory.site_id,
                source_home_url=inventory.source_home_url,
                visibility_scope=request.default_visibility_scope,
                parser_version=DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_PARSER_VERSION,
                embedding_model=inventory.embedding_model,
                import_source=DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_IMPORT_SOURCE,
            )
            self.artifacts.write_json_artifact(
                request=artifact_request,
                run_id=run_id,
                filename="run-manifest.json",
                payload={
                    "run_id": run_id,
                    "bundle_path": None,
                    "manifest_path": None,
                    "input_kind": SOURCE_TRUTH_REPLAY_INPUT_KIND,
                    "selected_notice_ids": list(inventory.selected_notice_ids),
                    "notice_risk_counts": dict(inventory.notice_risk_counts),
                    "high_risk_notice_count": inventory.high_risk_notice_count,
                    "source_truth_inventory_object_key": inventory_key,
                    "expected_notice_count": inventory.expected_notice_count,
                    "expected_document_count": inventory.expected_document_count,
                    "expected_attachment_document_count": inventory.expected_attachment_document_count,
                    "expected_ocr_candidate_count": inventory.expected_ocr_candidate_count,
                    "expected_raw_asset_count": inventory.expected_raw_asset_count,
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
                    "site_id": inventory.site_id,
                    "source_home_url": inventory.source_home_url,
                    "visibility_scope": request.default_visibility_scope,
                    "parser_version": DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_PARSER_VERSION,
                    "embedding_model": inventory.embedding_model,
                    "import_source": DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_IMPORT_SOURCE,
                    "source_projections_path": (
                        str(request.source_projections_path)
                        if request.source_projections_path is not None
                        else None
                    ),
                },
            )
            self.artifacts.write_json_artifact(
                request=artifact_request,
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
                request=artifact_request,
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
            self._write_batch_manifests(
                request=artifact_request,
                run_id=run_id,
                batches=batches,
                object_store_concurrency=object_store_concurrency,
                input_kind=SOURCE_TRUTH_REPLAY_INPUT_KIND,
            )
            planned_summary = self.build_run_summary(run_id)
            self.closeout_store.record_milestone(run_id, "planned", planned_summary)
            self.artifacts.write_json_artifact(
                request=artifact_request,
                run_id=run_id,
                filename="planned.json",
                payload=planned_summary,
                segments=("milestones",),
            )
            return planned_summary
        except Exception as exc:
            if self.closeout_store.get_run(run_id) is not None:
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
        object_store_concurrency: int,
        input_kind: str,
    ) -> tuple[CloseoutBatch, ...]:
        return asyncio.run(
            self._freeze_batches_async(
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
                    "bundle_records": [
                        notice_by_id[notice_id] for notice_id in batch.notice_ids
                    ],
                },
            )
        )

    def _freeze_source_truth_batch_inputs(
        self,
        *,
        request: AuthenticatedNoticeSourceTruthReplayRequest,
        run_id: str,
        planned_batches: Sequence[CloseoutBatch],
        parent_by_notice_id: dict[str, dict[str, Any]],
        object_store_concurrency: int,
    ) -> tuple[CloseoutBatch, ...]:
        return asyncio.run(
            self._freeze_batches_async(
                corpus=request.corpus,
                run_id=run_id,
                planned_batches=planned_batches,
                object_store_concurrency=object_store_concurrency,
                input_kind=SOURCE_TRUTH_REPLAY_INPUT_KIND,
                build_payload=lambda batch: {
                    "run_id": run_id,
                    "batch_id": batch.batch_id,
                    "shard_id": batch.shard_id,
                    "input_kind": SOURCE_TRUTH_REPLAY_INPUT_KIND,
                    "notice_ids": list(batch.notice_ids),
                    "source_truth_parents": [
                        parent_by_notice_id[notice_id] for notice_id in batch.notice_ids
                    ],
                },
            )
        )

    async def _freeze_batches_async(
        self,
        *,
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
        progress_step = self._progress_step(total_batches)
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
            await self.artifacts.put_bytes_limited(
                semaphore=semaphore,
                bucket=self.artifacts.object_store_settings.bucket_derived,
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
            await self._record_planning_progress(
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

    def _write_batch_manifests(
        self,
        *,
        request: AuthenticatedNoticeImportRequest,
        run_id: str,
        batches: Sequence[CloseoutBatch],
        object_store_concurrency: int,
        input_kind: str,
    ) -> None:
        asyncio.run(
            self._write_batch_manifests_async(
                request=request,
                run_id=run_id,
                batches=batches,
                object_store_concurrency=object_store_concurrency,
                input_kind=input_kind,
            )
        )

    async def _write_batch_manifests_async(
        self,
        *,
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
        progress_step = self._progress_step(total_batches)
        semaphore = asyncio.Semaphore(max(1, object_store_concurrency))

        async def write_one(batch: CloseoutBatch) -> None:
            await self.artifacts.write_json_artifact_limited(
                semaphore=semaphore,
                request=request,
                run_id=run_id,
                filename="manifest.json",
                payload=asdict(batch),
                segments=("batches", batch_segment(batch.batch_id)),
                executor=executor,
            )
            await self._record_planning_progress(
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
        self,
        *,
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
            if (
                completed_count == total_batches
                or completed_count % progress_step == 0
            ):
                payload = {
                    "run_id": run_id,
                    "input_kind": input_kind,
                    "completed_batch_count": completed_count,
                    "total_batch_count": total_batches,
                }
        if payload is None:
            return
        self.closeout_store.record_milestone(run_id, milestone_name, payload)
        print(
            json.dumps(
                {"event": milestone_name, **payload},
                ensure_ascii=False,
                sort_keys=True,
            ),
            file=sys.stderr,
            flush=True,
        )

    def _progress_step(self, total_batches: int) -> int:
        return max(1, min(32, math.ceil(total_batches / 8)))

    def _validate_plan_request(
        self,
        *,
        run_id: str,
        max_concurrency: int,
        notice_concurrency: int,
        object_store_concurrency: int,
        lease_seconds: int,
    ) -> None:
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

    def _build_operations_prefix(self, corpus: str, run_id: str) -> str:
        return build_operations_artifact_key(
            corpus=corpus,
            operation=DEFAULT_CLOSEOUT_OPERATION,
            run_id=run_id,
            filename="placeholder.json",
        ).rsplit("/", 1)[0]

    def _build_artifact_request(
        self,
        *,
        corpus: str,
        collection: str,
        site_id: str,
        source_home_url: str,
        visibility_scope: str | None,
        parser_version: str,
        embedding_model: str,
        import_source: str,
    ) -> AuthenticatedNoticeImportRequest:
        return AuthenticatedNoticeImportRequest(
            bundle_path=Path("."),
            export_manifest_path=None,
            site_id=site_id,
            source_home_url=source_home_url,
            corpus=corpus,
            collection=collection,
            visibility_scope=visibility_scope,
            parser_version=parser_version,
            embedding_model=embedding_model,
            import_source=import_source,
        )


def _extract_notice_id(item: dict[str, Any] | AuthenticatedNoticePreparedImport) -> str:
    if isinstance(item, AuthenticatedNoticePreparedImport):
        return item.notice_id
    return str(item["notice_id"])


__all__ = [
    "CloseoutPlanner",
    "CloseoutPlanningCoordinator",
]
