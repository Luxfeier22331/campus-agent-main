from __future__ import annotations

import asyncio
from collections.abc import Callable, Sequence
from typing import Any

from campus_ingestion_core.authenticated_notice_closeout_artifacts import (
    CloseoutArtifactManager,
)
from campus_ingestion_core.authenticated_notice_closeout_models import (
    CloseoutPromotionBatch,
    CloseoutPromotionBatchState,
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


DEFAULT_PROMOTION_ID = "promotion-0001"
DEFAULT_PROMOTION_COPY_BATCH_SIZE = 128


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
        copy_batch_size: int = DEFAULT_PROMOTION_COPY_BATCH_SIZE,
    ) -> None:
        self.closeout_store = closeout_store
        self.artifacts = artifacts
        self.object_store_settings = object_store_settings
        self.document_registry = document_registry
        self.raw_asset_registry = raw_asset_registry
        self.build_run_summary = build_run_summary
        self.copy_batch_size = max(1, int(copy_batch_size))

    def promote_run(
        self,
        *,
        run: CloseoutRun,
        request: AuthenticatedNoticeImportRequest,
    ) -> dict[str, Any]:
        documents = self.closeout_store.get_staged_documents(run.run_id)
        raw_assets = self.closeout_store.get_staged_raw_assets(run.run_id)
        promotion = self._initialize_promotion(
            run=run,
            documents=documents,
            raw_assets=raw_assets,
        )
        self._persist_progress(run=run, request=request, promotion=promotion)
        try:
            raw_upsert_count = self._sync_raw_assets(request=request, raw_assets=raw_assets)
            promotion = self._merge_promotion(
                promotion,
                phase="copying",
                raw_asset_upsert_count=raw_upsert_count,
                raw_asset_synced_count=len(raw_assets),
            )
            self._persist_progress(run=run, request=request, promotion=promotion)

            copy_batches = self._ensure_copy_batches(
                run_id=run.run_id,
                promotion_id=str(promotion["promotion_id"]),
                documents=documents,
            )
            promotion = self._copy_pending_batches(
                run=run,
                request=request,
                promotion=promotion,
                documents=documents,
                copy_batches=copy_batches,
            )

            promotion = self._merge_promotion(promotion, phase="registry_replace")
            self._persist_progress(run=run, request=request, promotion=promotion)
            registry_records = self._build_registry_records(documents)
            self.document_registry.replace_scope(
                request.corpus,
                request.collection,
                registry_records,
            )

            completed_promotion = self._merge_promotion(
                promotion,
                state="done",
                phase="done",
                replaced_scope_record_count=len(registry_records),
                finished_at=utc_now(),
            )
            completed_run = self.closeout_store.get_run(run.run_id) or run
            self.closeout_store.save_run(completed_run.complete(completed_promotion))
            self.closeout_store.record_promotion(run.run_id, completed_promotion)
            self.closeout_store.record_milestone(run.run_id, "promoted", completed_promotion)
            self.artifacts.write_json_artifact(
                request=request,
                run_id=run.run_id,
                filename="promoted.json",
                payload=completed_promotion,
                segments=("milestones",),
            )
            self.artifacts.write_json_artifact(
                request=request,
                run_id=run.run_id,
                filename=f"{completed_promotion['promotion_id']}.json",
                payload=completed_promotion,
                segments=("promotions",),
            )
            self.artifacts.write_json_artifact(
                request=request,
                run_id=run.run_id,
                filename="progress.json",
                payload=completed_promotion,
                segments=("promotions", str(completed_promotion["promotion_id"])),
            )
            return self.build_run_summary(run.run_id)
        except Exception as exc:
            failed_promotion = self._merge_promotion(
                self._latest_promotion(run.run_id, fallback=promotion),
                last_error=str(exc),
            )
            self._persist_progress(run=run, request=request, promotion=failed_promotion)
            raise

    def _initialize_promotion(
        self,
        *,
        run: CloseoutRun,
        documents: tuple[dict[str, Any], ...],
        raw_assets: tuple[dict[str, Any], ...],
    ) -> dict[str, Any]:
        existing = dict(run.promotion)
        promotion_id = str(existing.get("promotion_id") or DEFAULT_PROMOTION_ID)
        return self._merge_promotion(
            existing,
            promotion_id=promotion_id,
            state="running",
            phase=str(existing.get("phase") or "raw_asset_sync"),
            started_at=str(existing.get("started_at") or utc_now()),
            last_error=None,
            raw_asset_total_count=len(raw_assets),
            raw_asset_synced_count=int(existing.get("raw_asset_synced_count") or 0),
            raw_asset_upsert_count=int(existing.get("raw_asset_upsert_count") or 0),
            copy_batch_count=int(existing.get("copy_batch_count") or 0),
            copy_completed_batch_count=int(existing.get("copy_completed_batch_count") or 0),
            copy_running_batch_count=int(existing.get("copy_running_batch_count") or 0),
            copy_failed_batch_count=int(existing.get("copy_failed_batch_count") or 0),
            copied_document_count=int(existing.get("copied_document_count") or 0),
            copied_object_count=int(existing.get("copied_object_count") or 0),
            replaced_scope_record_count=int(existing.get("replaced_scope_record_count") or 0),
            expected_document_count=len(documents),
        )

    def _sync_raw_assets(
        self,
        *,
        request: AuthenticatedNoticeImportRequest,
        raw_assets: tuple[dict[str, Any], ...],
    ) -> int:
        del request
        records = tuple(
            _raw_record_from_payload(staged_raw["raw_record"])
            for staged_raw in raw_assets
        )
        if records:
            self.raw_asset_registry.upsert_many(records)
        return len(records)

    def _ensure_copy_batches(
        self,
        *,
        run_id: str,
        promotion_id: str,
        documents: tuple[dict[str, Any], ...],
    ) -> tuple[CloseoutPromotionBatch, ...]:
        existing = self.closeout_store.list_promotion_batches(run_id, promotion_id)
        if existing:
            return existing
        batches: list[CloseoutPromotionBatch] = []
        for offset, chunk in enumerate(_chunked(documents, self.copy_batch_size), start=1):
            batch = CloseoutPromotionBatch(
                promotion_id=promotion_id,
                batch_id=offset,
                document_refs=tuple(_document_ref(item) for item in chunk),
            )
            self.closeout_store.save_promotion_batch(run_id, batch)
            batches.append(batch)
        return tuple(batches)

    def _copy_pending_batches(
        self,
        *,
        run: CloseoutRun,
        request: AuthenticatedNoticeImportRequest,
        promotion: dict[str, Any],
        documents: tuple[dict[str, Any], ...],
        copy_batches: tuple[CloseoutPromotionBatch, ...],
    ) -> dict[str, Any]:
        documents_by_ref = {_document_ref(item): item for item in documents}
        latest = dict(promotion)
        for batch in copy_batches:
            if batch.state == CloseoutPromotionBatchState.DONE:
                continue
            running_batch = batch.mark_running()
            self.closeout_store.save_promotion_batch(run.run_id, running_batch)
            latest = self._refresh_copy_progress(
                run_id=run.run_id,
                promotion=latest,
                promotion_id=running_batch.promotion_id,
            )
            self._persist_progress(run=run, request=request, promotion=latest)
            batch_documents = tuple(
                documents_by_ref[document_ref] for document_ref in running_batch.document_refs
            )
            try:
                copied_object_count = self._copy_document_batch(
                    staged_documents=batch_documents,
                    copy_concurrency=max(1, run.object_store_concurrency),
                )
            except Exception as exc:
                self.closeout_store.save_promotion_batch(
                    run.run_id,
                    running_batch.fail(str(exc)),
                )
                latest = self._refresh_copy_progress(
                    run_id=run.run_id,
                    promotion=self._merge_promotion(latest, last_error=str(exc)),
                    promotion_id=running_batch.promotion_id,
                )
                self._persist_progress(run=run, request=request, promotion=latest)
                raise
            self.closeout_store.save_promotion_batch(
                run.run_id,
                running_batch.complete(
                    copied_document_count=len(batch_documents),
                    copied_object_count=copied_object_count,
                ),
            )
            latest = self._refresh_copy_progress(
                run_id=run.run_id,
                promotion=self._merge_promotion(latest, last_error=None),
                promotion_id=running_batch.promotion_id,
            )
            self._persist_progress(run=run, request=request, promotion=latest)
        return latest

    def _copy_document_batch(
        self,
        *,
        staged_documents: Sequence[dict[str, Any]],
        copy_concurrency: int,
    ) -> int:
        return asyncio.run(
            self._copy_document_batch_async(
                staged_documents=tuple(staged_documents),
                copy_concurrency=copy_concurrency,
            )
        )

    async def _copy_document_batch_async(
        self,
        *,
        staged_documents: tuple[dict[str, Any], ...],
        copy_concurrency: int,
    ) -> int:
        semaphore = asyncio.Semaphore(copy_concurrency)
        copied_counts = await asyncio.gather(
            *[
                asyncio.create_task(
                    self._copy_document_objects(
                        staged_document=staged_document,
                        semaphore=semaphore,
                    )
                )
                for staged_document in staged_documents
            ]
        )
        return sum(int(item) for item in copied_counts)

    async def _copy_document_objects(
        self,
        *,
        staged_document: dict[str, Any],
        semaphore: asyncio.Semaphore,
    ) -> int:
        staged_object_keys = dict(staged_document["staged_object_keys"])
        final_object_keys = dict(staged_document["final_object_keys"])
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
        return len(copy_tasks)

    def _build_registry_records(
        self,
        documents: tuple[dict[str, Any], ...],
    ) -> tuple[Any, ...]:
        return tuple(
            _registry_record_from_staged_document(staged_document)
            for staged_document in documents
        )

    def _refresh_copy_progress(
        self,
        *,
        run_id: str,
        promotion: dict[str, Any],
        promotion_id: str,
    ) -> dict[str, Any]:
        batches = self.closeout_store.list_promotion_batches(run_id, promotion_id)
        return self._merge_promotion(
            promotion,
            phase="copying",
            copy_batch_count=len(batches),
            copy_completed_batch_count=sum(
                1 for batch in batches if batch.state == CloseoutPromotionBatchState.DONE
            ),
            copy_running_batch_count=sum(
                1 for batch in batches if batch.state == CloseoutPromotionBatchState.RUNNING
            ),
            copy_failed_batch_count=sum(
                1 for batch in batches if batch.state == CloseoutPromotionBatchState.FAILED
            ),
            copied_document_count=sum(int(batch.copied_document_count) for batch in batches),
            copied_object_count=sum(int(batch.copied_object_count) for batch in batches),
        )

    def _persist_progress(
        self,
        *,
        run: CloseoutRun,
        request: AuthenticatedNoticeImportRequest,
        promotion: dict[str, Any],
    ) -> None:
        current_run = self.closeout_store.get_run(run.run_id) or run
        self.closeout_store.save_run(current_run.mark_promoting(promotion))
        self.closeout_store.record_promotion(run.run_id, promotion)
        self.closeout_store.record_milestone(run.run_id, "promoting", promotion)
        self.artifacts.write_json_artifact(
            request=request,
            run_id=run.run_id,
            filename="promoting.json",
            payload=promotion,
            segments=("milestones",),
        )
        self.artifacts.write_json_artifact(
            request=request,
            run_id=run.run_id,
            filename="progress.json",
            payload=promotion,
            segments=("promotions", str(promotion["promotion_id"])),
        )

    def _latest_promotion(self, run_id: str, *, fallback: dict[str, Any]) -> dict[str, Any]:
        run = self.closeout_store.get_run(run_id)
        if run is None or not run.promotion:
            return dict(fallback)
        return dict(run.promotion)

    @staticmethod
    def _merge_promotion(base: dict[str, Any], /, **updates: Any) -> dict[str, Any]:
        merged = dict(base)
        for key, value in updates.items():
            if value is None:
                merged.pop(key, None)
            else:
                merged[key] = value
        merged["updated_at"] = utc_now()
        return merged


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


def _registry_record_from_staged_document(staged_document: dict[str, Any]):
    document_payload = dict(staged_document["document"])
    final_object_keys = dict(staged_document["final_object_keys"])
    document_stub = _document_import_from_stage_payload(document_payload)
    return _build_registry_record(
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
        layout_elements_key=final_object_keys.get("layout_elements") or document_stub.layout_elements_object_key,
        canonical_markdown_key=final_object_keys.get("canonical_markdown"),
        processed_object_keys=tuple(
            str(item) for item in document_payload.get("processed_object_keys") or ()
        ),
        timestamp=utc_now(),
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
        layout_elements_object_key=(
            None
            if payload.get("layout_elements_object_key") is None
            else str(payload["layout_elements_object_key"])
        ),
        additional_processed_object_keys=tuple(
            str(item) for item in payload.get("additional_processed_object_keys") or ()
        ),
        title=None if payload.get("title") is None else str(payload["title"]),
        year=None if payload.get("year") is None else str(payload["year"]),
    )


def _document_ref(staged_document: dict[str, Any]) -> tuple[str, str, str]:
    payload = dict(staged_document["document"])
    return (
        str(payload["document_id"]),
        str(payload["revision_track"]),
        str(payload["version_id"]),
    )


def _chunked(
    values: Sequence[dict[str, Any]],
    chunk_size: int,
) -> tuple[tuple[dict[str, Any], ...], ...]:
    chunks: list[tuple[dict[str, Any], ...]] = []
    start = 0
    normalized_chunk_size = max(1, int(chunk_size))
    while start < len(values):
        chunks.append(tuple(values[start : start + normalized_chunk_size]))
        start += normalized_chunk_size
    return tuple(chunks)


__all__ = [
    "CloseoutPromotionCoordinator",
    "DEFAULT_PROMOTION_COPY_BATCH_SIZE",
    "DEFAULT_PROMOTION_ID",
]
