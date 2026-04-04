from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any

from campus_ingestion_core.authenticated_notice_closeout_artifacts import (
    CloseoutArtifactManager,
)
from campus_ingestion_core.authenticated_notice_closeout_models import (
    CloseoutRun,
    utc_now,
)
from campus_ingestion_core.authenticated_notice_closeout_store import CloseoutStore
from campus_ingestion_core.authenticated_notice_import import AuthenticatedNoticeImportRequest
from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    _build_registry_record,
)
from campus_ingestion_core.registry import DocumentRegistry, RawAssetRegistry
from campus_ingestion_core.settings import ObjectStoreSettings


class CloseoutPromotionCoordinator:
    def __init__(
        self,
        *,
        closeout_store: CloseoutStore,
        artifacts: CloseoutArtifactManager,
        object_store_settings: ObjectStoreSettings,
        document_registry: DocumentRegistry,
        raw_asset_registry: RawAssetRegistry,
        build_run_summary: Callable[[str], dict[str, Any]],
    ) -> None:
        self.closeout_store = closeout_store
        self.artifacts = artifacts
        self.object_store_settings = object_store_settings
        self.document_registry = document_registry
        self.raw_asset_registry = raw_asset_registry
        self.build_run_summary = build_run_summary

    def promote_run(
        self,
        *,
        run: CloseoutRun,
        request: AuthenticatedNoticeImportRequest,
    ) -> dict[str, Any]:
        promoting_run = run.mark_promoting()
        self.closeout_store.save_run(promoting_run)
        documents = self.closeout_store.get_staged_documents(run.run_id)
        raw_assets = self.closeout_store.get_staged_raw_assets(run.run_id)

        raw_upserts = 0
        for staged_raw in raw_assets:
            raw_record_payload = staged_raw["raw_record"]
            existing = self.raw_asset_registry.get(
                str(raw_record_payload["raw_asset_id"]),
                str(raw_record_payload["raw_version_id"]),
            )
            if existing is None:
                self.raw_asset_registry.upsert(_raw_record_from_payload(raw_record_payload))
                raw_upserts += 1

        registry_records, copied_object_count = asyncio.run(
            self._promote_documents(
                documents=documents,
                copy_concurrency=max(1, promoting_run.object_store_concurrency),
            )
        )
        self.document_registry.replace_scope(
            request.corpus,
            request.collection,
            registry_records,
        )
        promotion = {
            "promotion_id": "promotion-0001",
            "state": "done",
            "raw_asset_upsert_count": raw_upserts,
            "replaced_scope_record_count": len(registry_records),
            "copied_object_count": copied_object_count,
        }
        self.closeout_store.save_run(promoting_run.complete(promotion))
        self.closeout_store.record_promotion(run.run_id, promotion)
        self.closeout_store.record_milestone(run.run_id, "promoted", promotion)
        self.artifacts.write_json_artifact(
            request=request,
            run_id=run.run_id,
            filename="promoted.json",
            payload=promotion,
            segments=("milestones",),
        )
        self.artifacts.write_json_artifact(
            request=request,
            run_id=run.run_id,
            filename="promotion-0001.json",
            payload=promotion,
            segments=("promotions",),
        )
        return self.build_run_summary(run.run_id)

    async def _promote_documents(
        self,
        *,
        documents: tuple[dict[str, Any], ...],
        copy_concurrency: int,
    ) -> tuple[tuple[Any, ...], int]:
        semaphore = asyncio.Semaphore(copy_concurrency)
        results = await asyncio.gather(
            *[
                asyncio.create_task(
                    self._promote_document(
                        staged_document=staged_document,
                        semaphore=semaphore,
                    )
                )
                for staged_document in documents
            ]
        )
        records = tuple(item[0] for item in results)
        copied_object_count = sum(int(item[1]) for item in results)
        return records, copied_object_count

    async def _promote_document(
        self,
        *,
        staged_document: dict[str, Any],
        semaphore: asyncio.Semaphore,
    ) -> tuple[Any, int]:
        document_payload = dict(staged_document["document"])
        staged_object_keys = dict(staged_document["staged_object_keys"])
        final_object_keys = dict(staged_document["final_object_keys"])
        document_stub = _document_import_from_stage_payload(document_payload)
        copy_tasks = []
        for object_name, stage_key in staged_object_keys.items():
            final_key = final_object_keys.get(object_name)
            if final_key is None:
                continue
            copy_tasks.append(
                asyncio.create_task(
                    self.artifacts.copy_object_limited(
                        semaphore=semaphore,
                        source_bucket=self.object_store_settings.bucket_derived,
                        source_key=str(stage_key),
                        target_bucket=self.object_store_settings.bucket_derived,
                        target_key=str(final_key),
                    )
                )
            )
        if copy_tasks:
            await asyncio.gather(*copy_tasks)
        record = _build_registry_record(
            document_id=str(document_payload["document_id"]),
            version_id=str(document_payload["version_id"]),
            metadata=dict(document_stub.metadata),
            content_hash=str(staged_document["content_hash"]),
            document=document_stub,
            default_visibility_scope=document_stub.visibility_scope,
            parser_version=str(document_payload["parser_version"]),
            embedding_model=str(document_payload["embedding_model"]),
            cleaning_policy_version=str(document_payload["cleaning_policy_version"]),
            raw_asset=None,
            document_units_key=str(final_object_keys["document_units"]),
            provider_response_key=document_stub.provider_response_object_key,
            canonical_markdown_key=final_object_keys.get("canonical_markdown"),
            processed_object_keys=tuple(
                str(item) for item in document_payload.get("processed_object_keys") or ()
            ),
            timestamp=utc_now(),
        )
        return record, len(copy_tasks)


def _raw_record_from_payload(payload: dict[str, Any]):
    from campus_ingestion_core.models import RawAssetRecord

    return RawAssetRecord(
        raw_asset_id=str(payload["raw_asset_id"]),
        raw_version_id=str(payload["raw_version_id"]),
        corpus=str(payload["corpus"]),
        collection=str(payload["collection"]),
        raw_source_uri=str(payload["raw_source_uri"]),
        content_hash=str(payload["content_hash"]),
        source_filename=str(payload["source_filename"]),
        object_key=str(payload["object_key"]),
        ingestion_timestamp=str(payload["ingestion_timestamp"]),
        import_source=str(payload["import_source"]),
    )


def _document_import_from_stage_payload(payload: dict[str, Any]) -> DocumentImportInput:
    return DocumentImportInput(
        source_label=str(payload["source_label"]),
        document_units_bytes=b"",
        provider_response_bytes=None,
        canonical_markdown_bytes=None,
        metadata=dict(payload["metadata"]),
        import_source=str(payload["import_source"]),
        revision_track=str(payload["revision_track"]),
        source_channel=str(payload["source_channel"]),
        is_current=bool(payload.get("is_current", False)),
        corpus=str(payload["corpus"]),
        collection=str(payload["collection"]),
        visibility_scope=(
            None if payload.get("visibility_scope") is None else str(payload["visibility_scope"])
        ),
        status=str(payload.get("status") or "active"),
        raw_source_uri=(
            None if payload.get("raw_source_uri") is None else str(payload["raw_source_uri"])
        ),
        raw_asset_id=(
            None if payload.get("raw_asset_id") is None else str(payload["raw_asset_id"])
        ),
        raw_version_id=(
            None if payload.get("raw_version_id") is None else str(payload["raw_version_id"])
        ),
        provider_response_object_key=(
            None
            if payload.get("provider_response_object_key") is None
            else str(payload["provider_response_object_key"])
        ),
        additional_processed_object_keys=tuple(
            str(item) for item in payload.get("additional_processed_object_keys") or ()
        ),
        title=None if payload.get("title") is None else str(payload["title"]),
        year=None if payload.get("year") is None else str(payload["year"]),
    )


__all__ = ["CloseoutPromotionCoordinator"]
