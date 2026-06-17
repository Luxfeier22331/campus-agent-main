from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from campus_ingestion_core.artifacts import LAYOUT_ELEMENTS_FILENAME, PROVIDER_RESPONSE_FILENAME
from campus_ingestion_core.authenticated_notice_closeout_artifacts import (
    CloseoutArtifactManager,
)
from campus_ingestion_core.authenticated_notice_closeout_models import (
    DEFAULT_CLOSEOUT_INPUT_KIND,
    DEFAULT_CLOSEOUT_OPERATION,
    CloseoutBatch,
    CloseoutRun,
    CloseoutWorker,
    batch_segment,
    document_stage_slug,
)
from campus_ingestion_core.authenticated_notice_closeout_store import CloseoutStore
from campus_ingestion_core.authenticated_notice_closeout_verification import (
    CloseoutRunVerifier,
)
from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
    AuthenticatedNoticePreparedImport,
    prepare_authenticated_notice_bundle_records,
)
from campus_ingestion_core.authenticated_notice_source_projections import (
    AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_NO_EXTRACTABLE_TEXT,
)
from campus_ingestion_core.authenticated_notice_source_truth_replay import (
    SOURCE_TRUTH_REPLAY_INPUT_KIND,
    AuthenticatedNoticeSourceTruthReplayRequest,
    build_authenticated_notice_source_truth_replay_documents,
)
from campus_ingestion_core.campusrag_ingestion_artifacts import (
    build_document_processed_object_keys,
    resolve_document_artifact_keys,
    serialize_document_import_stub,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.object_store import (
    build_operations_artifact_key,
    is_source_object_key,
)
from campus_ingestion_core.raw_ingestion_online_ocr import OnlineOcrClient
from campus_ingestion_core.settings import ObjectStoreSettings


@dataclass(frozen=True, slots=True)
class _PreparedDocumentStage:
    document: dict[str, Any]
    staged_object_keys: dict[str, str]
    final_object_keys: dict[str, str]
    content_hash: str
    staged_object_metadata: dict[str, dict[str, Any]]


@dataclass(frozen=True, slots=True)
class _PreparedNoticeStage:
    notice: dict[str, Any]
    raw_record: dict[str, Any]
    source_artifact_keys: dict[str, str]
    artifact_keys: tuple[str, ...]
    documents: tuple[_PreparedDocumentStage, ...]


class CloseoutExecutionCoordinator:
    def __init__(
        self,
        *,
        closeout_store: CloseoutStore,
        artifacts: CloseoutArtifactManager,
        object_store_settings: ObjectStoreSettings,
        run_verifier: CloseoutRunVerifier,
        build_run_summary: Callable[[str], dict[str, Any]],
        ocr_client: OnlineOcrClient | None = None,
    ) -> None:
        self.closeout_store = closeout_store
        self.artifacts = artifacts
        self.object_store_settings = object_store_settings
        self.run_verifier = run_verifier
        self.build_run_summary = build_run_summary
        self.ocr_client = ocr_client

    def run_worker(
        self,
        *,
        run: CloseoutRun,
        request: AuthenticatedNoticeImportRequest,
        worker_id: str,
        max_batches: int | None = None,
        poll_interval: float | None = None,
    ) -> dict[str, Any]:
        del poll_interval
        worker = self.closeout_store.get_worker(run.run_id, worker_id)
        if worker is None:
            worker = CloseoutWorker(worker_id=worker_id)
            self.closeout_store.save_worker(run.run_id, worker)
            self.artifacts.write_worker_artifact(
                request=request,
                run_id=run.run_id,
                worker=worker,
            )

        processed_batches = 0
        while True:
            batch = self.closeout_store.claim_next_batch(
                run.run_id,
                worker_id=worker_id,
                lease_seconds=run.lease_seconds,
            )
            if batch is None:
                if self.closeout_store.try_begin_verification(run.run_id):
                    staged_summary = self.build_run_summary(run.run_id)
                    self.closeout_store.record_milestone(run.run_id, "staged", staged_summary)
                    self.artifacts.write_json_artifact(
                        request=request,
                        run_id=run.run_id,
                        filename="staged.json",
                        payload=staged_summary,
                        segments=("milestones",),
                    )
                    verification = self.run_verifier.verify_run(run.run_id)
                    self.closeout_store.mark_run_verified(run.run_id, verification)
                    self.closeout_store.record_milestone(run.run_id, "verified", verification)
                    self.artifacts.write_json_artifact(
                        request=request,
                        run_id=run.run_id,
                        filename="verified.json",
                        payload=verification,
                        segments=("milestones",),
                    )
                    self.artifacts.write_json_artifact(
                        request=request,
                        run_id=run.run_id,
                        filename="verification.json",
                        payload=verification,
                        segments=("reconciliation",),
                    )
                finished_worker = self.closeout_store.finish_worker(run.run_id, worker_id)
                self.artifacts.write_worker_artifact(
                    request=request,
                    run_id=run.run_id,
                    worker=finished_worker,
                )
                return self.build_run_summary(run.run_id)

            claimed_worker = self.closeout_store.get_worker(run.run_id, worker_id)
            if claimed_worker is not None:
                self.artifacts.write_worker_artifact(
                    request=request,
                    run_id=run.run_id,
                    worker=claimed_worker,
                )
            try:
                stages = asyncio.run(self._process_batch(run=run, batch=batch))
                completed_batch = self.closeout_store.commit_batch_stage(
                    run_id=run.run_id,
                    worker_id=worker_id,
                    batch_id=batch.batch_id,
                    stages=stages,
                )
                self.artifacts.write_json_artifact(
                    request=request,
                    run_id=run.run_id,
                    filename="manifest.json",
                    payload=asdict(completed_batch),
                    segments=("batches", batch_segment(batch.batch_id)),
                )
                committed_worker = self.closeout_store.get_worker(run.run_id, worker_id)
                if committed_worker is not None:
                    self.artifacts.write_worker_artifact(
                        request=request,
                        run_id=run.run_id,
                        worker=committed_worker,
                    )
                processed_batches += 1
                if max_batches is not None and processed_batches >= max_batches:
                    finished_worker = self.closeout_store.finish_worker(run.run_id, worker_id)
                    self.artifacts.write_worker_artifact(
                        request=request,
                        run_id=run.run_id,
                        worker=finished_worker,
                    )
                    return self.build_run_summary(run.run_id)
            except Exception as exc:
                failed_batch = self.closeout_store.fail_batch(
                    run_id=run.run_id,
                    worker_id=worker_id,
                    batch_id=batch.batch_id,
                    error=str(exc),
                )
                self.closeout_store.record_milestone(
                    run.run_id,
                    "failed",
                    {"run_id": run.run_id, "error": str(exc)},
                )
                self.artifacts.write_json_artifact(
                    request=request,
                    run_id=run.run_id,
                    filename="manifest.json",
                    payload=asdict(failed_batch),
                    segments=("batches", batch_segment(batch.batch_id)),
                )
                failed_worker = self.closeout_store.get_worker(run.run_id, worker_id)
                if failed_worker is not None:
                    self.artifacts.write_worker_artifact(
                        request=request,
                        run_id=run.run_id,
                        worker=failed_worker,
                    )
                raise

    async def _process_batch(
        self,
        *,
        run: CloseoutRun,
        batch: CloseoutBatch,
    ) -> tuple[dict[str, Any], ...]:
        if batch.input_object_key is None:
            raise ValueError(f"closeout batch {batch.batch_id} missing input_object_key")
        payload = json.loads(
            self.artifacts.object_store.get_bytes(
                bucket=self.object_store_settings.bucket_derived,
                key=batch.input_object_key,
            ).decode("utf-8")
        )
        if str(payload.get("run_id")) != run.run_id:
            raise ValueError(f"batch input run mismatch for {batch.batch_id}")
        input_kind = str(payload.get("input_kind") or run.input_kind or DEFAULT_CLOSEOUT_INPUT_KIND)
        prepared_bundle = (
            prepare_authenticated_notice_bundle_records(
                request=_request_from_run(run),
                bundle_records=tuple(payload.get("bundle_records") or ()),
                export_manifest=self.artifacts.load_export_manifest(run),
            )
            if input_kind == DEFAULT_CLOSEOUT_INPUT_KIND
            else None
        )
        cleaning_policy_version = load_runtime_profile(
            run.corpus,
            run.collection,
        ).cleaning_policy_version
        notice_semaphore = asyncio.Semaphore(max(1, run.notice_concurrency))
        object_store_semaphore = asyncio.Semaphore(max(1, run.object_store_concurrency))
        if input_kind == SOURCE_TRUTH_REPLAY_INPUT_KIND:
            request = _source_truth_request_from_run(run)
            artifact_request = _request_from_run(run)
            parent_by_notice_id = {
                str(parent["notice_id"]): parent
                for parent in tuple(payload.get("source_truth_parents") or ())
            }
            stages = await asyncio.gather(
                *[
                    asyncio.create_task(
                        self._prepare_source_truth_notice_stage(
                            request=request,
                            artifact_request=artifact_request,
                            run_id=run.run_id,
                            batch=batch,
                            parent_snapshot=parent_by_notice_id[notice_id],
                            notice_semaphore=notice_semaphore,
                            object_store_semaphore=object_store_semaphore,
                            cleaning_policy_version=cleaning_policy_version,
                        )
                    )
                    for notice_id in batch.notice_ids
                ]
            )
        else:
            if prepared_bundle is None:
                raise ValueError(f"closeout batch {batch.batch_id} missing bundle input")
            request = _request_from_run(run)
            by_notice_id = {
                prepared.notice_id: prepared for prepared in prepared_bundle.notice_imports
            }
            stages = await asyncio.gather(
                *[
                    asyncio.create_task(
                        self._prepare_bundle_notice_stage(
                            request=request,
                            run_id=run.run_id,
                            batch=batch,
                            prepared=by_notice_id[notice_id],
                            notice_semaphore=notice_semaphore,
                            object_store_semaphore=object_store_semaphore,
                            cleaning_policy_version=cleaning_policy_version,
                        )
                    )
                    for notice_id in batch.notice_ids
                ]
            )
        return tuple(
            sorted(
                (self._serialize_notice_stage(stage) for stage in stages),
                key=lambda item: str(item["notice"]["notice_id"]),
            )
        )

    def _serialize_notice_stage(self, stage: _PreparedNoticeStage) -> dict[str, Any]:
        return {
            "notice": dict(stage.notice),
            "raw_record": dict(stage.raw_record),
            "source_artifact_keys": dict(stage.source_artifact_keys),
            "artifact_keys": tuple(stage.artifact_keys),
            "documents": tuple(asdict(document) for document in stage.documents),
        }

    async def _prepare_bundle_notice_stage(
        self,
        *,
        request: AuthenticatedNoticeImportRequest,
        run_id: str,
        batch: CloseoutBatch,
        prepared: AuthenticatedNoticePreparedImport,
        notice_semaphore: asyncio.Semaphore,
        object_store_semaphore: asyncio.Semaphore,
        cleaning_policy_version: str,
    ) -> _PreparedNoticeStage:
        async with notice_semaphore:
            translated_document = prepared.document_import
            await asyncio.gather(
                *[
                    asyncio.create_task(
                        self.artifacts.put_bytes_limited(
                            semaphore=object_store_semaphore,
                            bucket=self.object_store_settings.bucket_source,
                            key=prepared.source_artifact_keys[relative_path],
                            data=payload,
                            content_type=_content_type_for_key(
                                prepared.source_artifact_keys[relative_path]
                            ),
                        )
                    )
                    for relative_path, payload in (
                        list(prepared.capture_artifacts.items())
                        + list(prepared.provider_artifacts.items())
                        + list(prepared.source_truth_artifacts.items())
                    )
                ]
            )
            documents = await self._stage_translated_documents(
                request=request,
                run_id=run_id,
                batch=batch,
                translated_documents=(translated_document,),
                object_store_semaphore=object_store_semaphore,
                cleaning_policy_version=cleaning_policy_version,
            )
            return _PreparedNoticeStage(
                notice={
                    "notice_id": prepared.notice_id,
                    "raw_asset_id": prepared.raw_asset_id,
                    "raw_version_id": prepared.raw_version_id,
                    "document_id": str(translated_document.metadata["document_id"]),
                },
                raw_record=asdict(prepared.raw_record),
                source_artifact_keys=dict(prepared.source_artifact_keys),
                artifact_keys=tuple(prepared.source_artifact_keys.values()),
                documents=documents,
            )

    async def _prepare_source_truth_notice_stage(
        self,
        *,
        request: AuthenticatedNoticeSourceTruthReplayRequest,
        artifact_request: AuthenticatedNoticeImportRequest,
        run_id: str,
        batch: CloseoutBatch,
        parent_snapshot: dict[str, Any],
        notice_semaphore: asyncio.Semaphore,
        object_store_semaphore: asyncio.Semaphore,
        cleaning_policy_version: str,
    ) -> _PreparedNoticeStage:
        async with notice_semaphore:
            projected_notice = await asyncio.to_thread(
                build_authenticated_notice_source_truth_replay_documents,
                parent_snapshot=parent_snapshot,
                request=request,
                object_store=self.artifacts.object_store,
                object_store_settings=self.object_store_settings,
                ocr_client=self.ocr_client,
            )
            documents = await self._stage_translated_documents(
                request=artifact_request,
                run_id=run_id,
                batch=batch,
                translated_documents=projected_notice.documents,
                object_store_semaphore=object_store_semaphore,
                cleaning_policy_version=cleaning_policy_version,
            )
            attachment_outcomes, attachment_artifact_keys = await self._prepare_attachment_outcomes(
                request=artifact_request,
                run_id=run_id,
                batch=batch,
                attachment_outcomes=projected_notice.attachment_outcomes,
                object_store_semaphore=object_store_semaphore,
            )
            parent_document = projected_notice.documents[0]
            artifact_keys = tuple(
                str(item)
                for item in (
                    *tuple(parent_snapshot.get("source_artifact_keys") or ()),
                    *attachment_artifact_keys,
                )
            )
            return _PreparedNoticeStage(
                notice={
                    "notice_id": str(parent_snapshot["notice_id"]),
                    "raw_asset_id": str(parent_snapshot["raw_record"]["raw_asset_id"]),
                    "raw_version_id": str(parent_snapshot["raw_record"]["raw_version_id"]),
                    "document_id": str(parent_document.metadata["document_id"]),
                    "attachment_outcomes": list(attachment_outcomes),
                },
                raw_record=dict(parent_snapshot["raw_record"]),
                source_artifact_keys={
                    "source-truth/notice-manifest.json": str(
                        parent_snapshot["notice_manifest_key"]
                    ),
                    "source-truth/content-blocks.jsonl": str(parent_snapshot["content_blocks_key"]),
                    "source-truth/attachment-refs.jsonl": str(
                        parent_snapshot["attachment_refs_key"]
                    ),
                },
                artifact_keys=artifact_keys,
                documents=documents,
            )

    async def _prepare_attachment_outcomes(
        self,
        *,
        request: AuthenticatedNoticeImportRequest,
        run_id: str,
        batch: CloseoutBatch,
        attachment_outcomes,
        object_store_semaphore: asyncio.Semaphore,
    ) -> tuple[tuple[dict[str, Any], ...], tuple[str, ...]]:
        batch_key_segment = batch_segment(batch.batch_id)
        serialized: list[dict[str, Any]] = []
        artifact_keys: list[str] = []
        upload_tasks: list[asyncio.Task[None]] = []
        for outcome in attachment_outcomes:
            payload = {
                "attachment_ref_id": outcome.attachment_ref_id,
                "classification": outcome.classification,
                "materialization_policy": outcome.materialization_policy,
                "outcome": outcome.outcome,
                "document_id": outcome.document_id,
                "attachment_object_key": outcome.attachment_object_key,
                "attachment_content_sha256": outcome.attachment_content_sha256,
            }
            if outcome.review_reason is not None:
                payload["review_reason"] = outcome.review_reason
            if (
                outcome.outcome == AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_NO_EXTRACTABLE_TEXT
                and outcome.provider_response_bytes is not None
            ):
                attachment_slug = document_stage_slug(outcome.document_id)
                staged_provider_key = build_operations_artifact_key(
                    corpus=request.corpus,
                    operation=DEFAULT_CLOSEOUT_OPERATION,
                    run_id=run_id,
                    filename=PROVIDER_RESPONSE_FILENAME,
                    segments=(
                        "staging",
                        "batches",
                        batch_key_segment,
                        "attachments",
                        attachment_slug,
                    ),
                )
                provider_hash = hashlib.sha256(outcome.provider_response_bytes).hexdigest()
                payload["provider_response_staged_object_key"] = staged_provider_key
                payload["provider_response_sha256"] = provider_hash
                payload["provider_response_content_length"] = len(outcome.provider_response_bytes)
                artifact_keys.append(staged_provider_key)
                upload_tasks.append(
                    asyncio.create_task(
                        self.artifacts.put_bytes_limited(
                            semaphore=object_store_semaphore,
                            bucket=self.object_store_settings.bucket_derived,
                            key=staged_provider_key,
                            data=outcome.provider_response_bytes,
                            content_type="application/json",
                            metadata={"sha256": provider_hash},
                        )
                    )
                )
            serialized.append(payload)
        if upload_tasks:
            await asyncio.gather(*upload_tasks)
        return tuple(serialized), tuple(artifact_keys)

    async def _stage_translated_documents(
        self,
        *,
        request: AuthenticatedNoticeImportRequest,
        run_id: str,
        batch: CloseoutBatch,
        translated_documents: tuple[Any, ...],
        object_store_semaphore: asyncio.Semaphore,
        cleaning_policy_version: str,
    ) -> tuple[_PreparedDocumentStage, ...]:
        return tuple(
            await asyncio.gather(
                *[
                    asyncio.create_task(
                        self._prepare_document_stage(
                            request=request,
                            run_id=run_id,
                            batch=batch,
                            translated_document=translated_document,
                            object_store_semaphore=object_store_semaphore,
                            cleaning_policy_version=cleaning_policy_version,
                        )
                    )
                    for translated_document in translated_documents
                ]
            )
        )

    async def _prepare_document_stage(
        self,
        *,
        request: AuthenticatedNoticeImportRequest,
        run_id: str,
        batch: CloseoutBatch,
        translated_document,
        object_store_semaphore: asyncio.Semaphore,
        cleaning_policy_version: str,
    ) -> _PreparedDocumentStage:
        document_id = str(translated_document.metadata["document_id"])
        version_id = str(translated_document.metadata["version_id"])
        content_hash = hashlib.sha256(translated_document.document_units_bytes).hexdigest()
        batch_key_segment = batch_segment(batch.batch_id)
        document_slug = document_stage_slug(document_id)
        staged_document_units_key = build_operations_artifact_key(
            corpus=request.corpus,
            operation=DEFAULT_CLOSEOUT_OPERATION,
            run_id=run_id,
            filename="document-units.jsonl",
            segments=("staging", "batches", batch_key_segment, "documents", document_slug),
        )
        staged_object_keys = {"document_units": staged_document_units_key}
        resolved_artifact_keys = resolve_document_artifact_keys(
            document=translated_document,
            document_id=document_id,
            version_id=version_id,
            title=translated_document.title,
            year=translated_document.year,
            corpus=request.corpus,
            collection=request.collection,
        )
        final_object_keys = {"document_units": resolved_artifact_keys.document_units_key}
        staged_object_metadata = {
            "document_units": {
                "sha256": content_hash,
                "content_length": len(translated_document.document_units_bytes),
            }
        }
        provider_response_object_key = resolved_artifact_keys.provider_response_key
        layout_elements_object_key = resolved_artifact_keys.layout_elements_key
        upload_tasks = [
            asyncio.create_task(
                self.artifacts.put_bytes_limited(
                    semaphore=object_store_semaphore,
                    bucket=self.object_store_settings.bucket_derived,
                    key=staged_document_units_key,
                    data=translated_document.document_units_bytes,
                    content_type="application/x-ndjson",
                    metadata={"sha256": content_hash},
                )
            )
        ]
        if translated_document.provider_response_bytes is not None:
            if provider_response_object_key is not None and is_source_object_key(
                str(provider_response_object_key)
            ):
                raise ValueError(
                    f"closeout staging does not accept source-level provider response writes: {document_id}"
                )
            provider_hash = hashlib.sha256(translated_document.provider_response_bytes).hexdigest()
            staged_provider_key = build_operations_artifact_key(
                corpus=request.corpus,
                operation=DEFAULT_CLOSEOUT_OPERATION,
                run_id=run_id,
                filename=PROVIDER_RESPONSE_FILENAME,
                segments=("staging", "batches", batch_key_segment, "documents", document_slug),
            )
            staged_object_keys["provider_response"] = staged_provider_key
            final_object_keys["provider_response"] = provider_response_object_key
            staged_object_metadata["provider_response"] = {
                "sha256": provider_hash,
                "content_length": len(translated_document.provider_response_bytes),
            }
            upload_tasks.append(
                asyncio.create_task(
                    self.artifacts.put_bytes_limited(
                        semaphore=object_store_semaphore,
                        bucket=self.object_store_settings.bucket_derived,
                        key=staged_provider_key,
                        data=translated_document.provider_response_bytes,
                        content_type="application/x-ndjson",
                        metadata={"sha256": provider_hash},
                    )
                )
            )
        if translated_document.layout_elements_bytes is not None:
            if layout_elements_object_key is not None and is_source_object_key(
                str(layout_elements_object_key)
            ):
                raise ValueError(
                    f"closeout staging does not accept source-level layout elements writes: {document_id}"
                )
            layout_elements_hash = hashlib.sha256(
                translated_document.layout_elements_bytes
            ).hexdigest()
            staged_layout_elements_key = build_operations_artifact_key(
                corpus=request.corpus,
                operation=DEFAULT_CLOSEOUT_OPERATION,
                run_id=run_id,
                filename=LAYOUT_ELEMENTS_FILENAME,
                segments=("staging", "batches", batch_key_segment, "documents", document_slug),
            )
            staged_object_keys["layout_elements"] = staged_layout_elements_key
            final_object_keys["layout_elements"] = layout_elements_object_key
            staged_object_metadata["layout_elements"] = {
                "sha256": layout_elements_hash,
                "content_length": len(translated_document.layout_elements_bytes),
            }
            upload_tasks.append(
                asyncio.create_task(
                    self.artifacts.put_bytes_limited(
                        semaphore=object_store_semaphore,
                        bucket=self.object_store_settings.bucket_derived,
                        key=staged_layout_elements_key,
                        data=translated_document.layout_elements_bytes,
                        content_type="application/x-ndjson",
                        metadata={"sha256": layout_elements_hash},
                    )
                )
            )
        final_markdown_key = resolved_artifact_keys.canonical_markdown_key
        if translated_document.canonical_markdown_bytes is not None:
            markdown_hash = hashlib.sha256(translated_document.canonical_markdown_bytes).hexdigest()
            staged_markdown_key = build_operations_artifact_key(
                corpus=request.corpus,
                operation=DEFAULT_CLOSEOUT_OPERATION,
                run_id=run_id,
                filename="canonical.md",
                segments=("staging", "batches", batch_key_segment, "documents", document_slug),
            )
            staged_object_keys["canonical_markdown"] = staged_markdown_key
            final_object_keys["canonical_markdown"] = final_markdown_key
            staged_object_metadata["canonical_markdown"] = {
                "sha256": markdown_hash,
                "content_length": len(translated_document.canonical_markdown_bytes),
            }
            upload_tasks.append(
                asyncio.create_task(
                    self.artifacts.put_bytes_limited(
                        semaphore=object_store_semaphore,
                        bucket=self.object_store_settings.bucket_derived,
                        key=staged_markdown_key,
                        data=translated_document.canonical_markdown_bytes,
                        content_type="text/markdown; charset=utf-8",
                        metadata={"sha256": markdown_hash},
                    )
                )
            )
        await asyncio.gather(*upload_tasks)

        processed_object_keys = build_document_processed_object_keys(
            document_units_key=resolved_artifact_keys.document_units_key,
            provider_response_key=provider_response_object_key,
            layout_elements_key=layout_elements_object_key,
            canonical_markdown_key=final_markdown_key,
            additional_keys=translated_document.additional_processed_object_keys,
        )
        document_payload = serialize_document_import_stub(translated_document)
        document_payload.update(
            {
                "document_id": document_id,
                "revision_track": translated_document.revision_track,
                "version_id": version_id,
                "provider_response_object_key": provider_response_object_key,
                "layout_elements_object_key": layout_elements_object_key,
                "processed_object_keys": list(processed_object_keys),
                "parser_version": request.parser_version,
                "embedding_model": request.embedding_model,
                "cleaning_policy_version": cleaning_policy_version,
            }
        )
        return _PreparedDocumentStage(
            document=document_payload,
            staged_object_keys=staged_object_keys,
            final_object_keys=final_object_keys,
            content_hash=content_hash,
            staged_object_metadata=staged_object_metadata,
        )


def _content_type_for_key(key: str) -> str:
    if key.endswith(".jsonl"):
        return "application/x-ndjson"
    if key.endswith(".json"):
        return "application/json"
    if key.endswith(".md"):
        return "text/markdown; charset=utf-8"
    return "application/octet-stream"


def _request_from_run(run: CloseoutRun) -> AuthenticatedNoticeImportRequest:
    return AuthenticatedNoticeImportRequest(
        bundle_path=Path(run.bundle_path or "."),
        export_manifest_path=Path(run.manifest_path) if run.manifest_path else None,
        site_id=run.site_id,
        source_home_url=run.source_home_url,
        allow_local_fixture_import=True,
        corpus=run.corpus,
        collection=run.collection,
        default_entitlement_groups=run.default_entitlement_groups,
        visibility_scope=run.visibility_scope,
        parser_version=run.parser_version,
        embedding_model=run.embedding_model,
        import_source=run.import_source,
    )


def _source_truth_request_from_run(
    run: CloseoutRun,
) -> AuthenticatedNoticeSourceTruthReplayRequest:
    return AuthenticatedNoticeSourceTruthReplayRequest(
        corpus=run.corpus,
        collection=run.collection,
        source_projections_path=(
            Path(run.source_projections_path) if run.source_projections_path else None
        ),
        default_visibility_scope=run.visibility_scope,
    )


__all__ = ["CloseoutExecutionCoordinator"]
