from __future__ import annotations

import json
from collections.abc import Callable
from importlib import import_module
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_closeout_artifacts import (
    CloseoutArtifactManager,
)
from campus_ingestion_core.authenticated_notice_closeout_models import (
    DEFAULT_CLOSEOUT_INPUT_KIND,
    DEFAULT_CLOSEOUT_LEASE_SECONDS,
    DEFAULT_CLOSEOUT_MAX_CONCURRENCY,
    DEFAULT_CLOSEOUT_NOTICE_CONCURRENCY,
    DEFAULT_CLOSEOUT_OBJECT_STORE_CONCURRENCY,
    DEFAULT_CLOSEOUT_OPERATION,
    CloseoutRun,
    attach_batches_to_shards,
)
from campus_ingestion_core.authenticated_notice_closeout_planning_freeze import (
    freeze_bundle_batch_inputs,
    freeze_source_truth_batch_inputs,
    write_batch_manifests,
)
from campus_ingestion_core.authenticated_notice_closeout_planning_planner import (
    CloseoutPlanner,
)
from campus_ingestion_core.authenticated_notice_closeout_store import CloseoutStore
from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
    load_authenticated_notice_bundle_payload,
    load_authenticated_notice_export_manifest,
)
from campus_ingestion_core.authenticated_notice_source_projections import (
    DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_IMPORT_SOURCE,
    DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_PARSER_VERSION,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.authenticated_notice_source_truth_replay import (
    SOURCE_TRUTH_REPLAY_INPUT_KIND,
    AuthenticatedNoticeSourceTruthReplayRequest,
    build_authenticated_notice_source_truth_replay_inventory_payload,
)
from campus_ingestion_core.object_store import build_operations_artifact_key
from campus_ingestion_core.registry import DocumentRegistry, RawAssetRegistry


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

    def _load_source_truth_inventory_from_store(
        self,
        *,
        request: AuthenticatedNoticeSourceTruthReplayRequest,
    ):
        planning_module = import_module(
            "campus_ingestion_core.authenticated_notice_closeout_planning"
        )
        return planning_module.load_authenticated_notice_source_truth_replay_inventory_from_store(
            request=request,
            source_truth_inventory_store=self.source_truth_inventory_store,
        )

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
            batches = freeze_bundle_batch_inputs(
                artifacts=self.artifacts,
                closeout_store=self.closeout_store,
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
            write_batch_manifests(
                artifacts=self.artifacts,
                closeout_store=self.closeout_store,
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
            inventory = self._load_source_truth_inventory_from_store(request=request)
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
            parent_by_notice_id = {str(parent["notice_id"]): parent for parent in inventory.parents}
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
            batches = freeze_source_truth_batch_inputs(
                artifacts=self.artifacts,
                closeout_store=self.closeout_store,
                corpus=request.corpus,
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
                    build_authenticated_notice_source_truth_replay_inventory_payload(
                        run_id=run_id,
                        inventory=inventory,
                    ),
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
            write_batch_manifests(
                artifacts=self.artifacts,
                closeout_store=self.closeout_store,
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
