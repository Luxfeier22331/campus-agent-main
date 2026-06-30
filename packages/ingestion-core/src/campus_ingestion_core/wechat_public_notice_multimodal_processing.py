from __future__ import annotations

from collections.abc import Sequence

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.wechat_public_notice_multimodal_artifacts import (
    build_wechat_public_notice_inline_image_artifact_keys,
    list_wechat_public_notice_inline_image_refs,
    load_wechat_public_notice_inline_image_outcome,
    write_wechat_public_notice_inline_image_ocr_manifest,
    write_wechat_public_notice_inline_image_provider_artifacts,
)
from campus_ingestion_core.wechat_public_notice_multimodal_attempts import (
    _classify_provider_result,
    _next_attempt_number,
    _record_attempt,
)
from campus_ingestion_core.wechat_public_notice_multimodal_child_docs import (
    build_wechat_public_notice_inline_image_child_document,
    write_wechat_public_notice_inline_image_child_document_artifacts,
)
from campus_ingestion_core.wechat_public_notice_multimodal_constants import (
    WECHAT_PUBLIC_NOTICE_MULTIMODAL_OCR_MANIFEST_SCHEMA,
)
from campus_ingestion_core.wechat_public_notice_multimodal_images import _load_inline_image_object
from campus_ingestion_core.wechat_public_notice_multimodal_manifests import _build_ocr_manifest
from campus_ingestion_core.wechat_public_notice_multimodal_models import (
    WeChatPublicNoticeDocumentRegistry,
    WeChatPublicNoticeMultimodalAttemptStore,
    WeChatPublicNoticeMultimodalItemReport,
    WeChatPublicNoticeMultimodalObjectStore,
    WeChatPublicNoticeMultimodalProcessingReport,
    WeChatPublicNoticeMultimodalProvider,
    WeChatPublicNoticeMultimodalProviderRequest,
)
from campus_ingestion_core.wechat_public_notice_multimodal_registry import (
    build_wechat_public_notice_inline_image_registry_record,
    upsert_wechat_public_notice_inline_image_registry_record,
)
from campus_ingestion_core.wechat_public_notice_multimodal_scalars import (
    _load_media_rows,
    _required_text,
    _resolve_notice_title,
)
from campus_ingestion_core.wechat_public_notice_multimodal_selection import (
    _is_pending_multimodal_entry,
)


def process_wechat_public_notice_pending_multimodal_entries(
    *,
    source_corpus: str,
    source_collection: str,
    notice_ids: Sequence[str],
    projection_store,
    object_store: WeChatPublicNoticeMultimodalObjectStore,
    registry: WeChatPublicNoticeDocumentRegistry,
    source_bucket: str,
    derived_bucket: str,
    provider: WeChatPublicNoticeMultimodalProvider,
    attempt_store: WeChatPublicNoticeMultimodalAttemptStore | None = None,
    max_attempts: int = 3,
    admission_batch_id: str = "",
) -> WeChatPublicNoticeMultimodalProcessingReport:
    normalized_notice_ids = tuple(
        sorted({str(item).strip() for item in notice_ids if str(item).strip()})
    )
    if not normalized_notice_ids:
        raise ValueError("selected notice_ids are required for wechat multimodal processing")
    if max_attempts <= 0:
        raise ValueError("max_attempts must be greater than zero")
    entries = projection_store.list_by_scope(
        source_corpus,
        source_collection,
        notice_ids=normalized_notice_ids,
    )
    pending_entries = tuple(entry for entry in entries if _is_pending_multimodal_entry(entry))
    item_reports: list[WeChatPublicNoticeMultimodalItemReport] = []
    scanned_image_count = 0
    attempted_image_count = 0
    admitted_count = 0
    no_extractable_text_count = 0
    terminal_failure_count = 0
    still_pending_count = 0
    for entry in pending_entries:
        metadata = dict(entry.role_metadata or {})
        source_truth_bucket = str(metadata.get("source_bucket") or source_bucket).strip()
        if not source_truth_bucket:
            raise ValueError("source bucket is required for wechat multimodal processing")
        media_refs_key = _required_text(metadata.get("media_refs_key"), label="media_refs_key")
        media_rows = _load_media_rows(
            object_store.get_bytes(bucket=source_truth_bucket, key=media_refs_key)
        )
        inline_refs = list_wechat_public_notice_inline_image_refs(media_rows)
        scanned_image_count += len(inline_refs)
        for inline_ref in inline_refs:
            outcome = load_wechat_public_notice_inline_image_outcome(
                object_store=object_store,
                bucket=source_truth_bucket,
                media_refs_key=media_refs_key,
                inline_ref=inline_ref,
            )
            if outcome.status in {"admitted", "no_extractable_text", "fetch_failed", "ocr_failed"}:
                item_reports.append(
                    WeChatPublicNoticeMultimodalItemReport(
                        source_notice_id=entry.source_notice_id,
                        media_ref_id=inline_ref.media_ref_id,
                        status=outcome.status,
                        attempt_number=len(
                            attempt_store.list_by_image(
                                source_corpus=entry.source_corpus,
                                source_collection=entry.source_collection,
                                source_notice_id=entry.source_notice_id,
                                media_ref_id=inline_ref.media_ref_id,
                            )
                        )
                        if attempt_store is not None
                        else 0,
                        reason="existing_terminal_outcome",
                    )
                )
                if outcome.status == "admitted":
                    admitted_count += 1
                elif outcome.status == "no_extractable_text":
                    no_extractable_text_count += 1
                else:
                    terminal_failure_count += 1
                continue

            attempt_number = _next_attempt_number(
                attempt_store=attempt_store,
                source_corpus=entry.source_corpus,
                source_collection=entry.source_collection,
                source_notice_id=entry.source_notice_id,
                media_ref_id=inline_ref.media_ref_id,
            )
            attempted_image_count += 1
            try:
                fetched = _load_inline_image_object(
                    object_store=object_store,
                    bucket=source_truth_bucket,
                    inline_ref=inline_ref,
                )
            except Exception as exc:
                terminal = attempt_number >= max_attempts
                if terminal:
                    write_wechat_public_notice_inline_image_ocr_manifest(
                        object_store=object_store,
                        bucket=source_truth_bucket,
                        media_refs_key=media_refs_key,
                        inline_ref=inline_ref,
                        payload={
                            "schema_version": WECHAT_PUBLIC_NOTICE_MULTIMODAL_OCR_MANIFEST_SCHEMA,
                            "source_notice_id": entry.source_notice_id,
                            "source_collection": entry.source_collection,
                            "media_ref_id": inline_ref.media_ref_id,
                            "status": "fetch_failed",
                            "provider": "",
                            "model": "",
                            "confidence": "",
                            "summary": "",
                            "extracted_text": "",
                            "provider_response_key": "",
                            "layout_elements_key": "",
                            "child_document_id": "",
                            "child_canonical_markdown_key": "",
                            "child_document_units_key": "",
                            "processed_at": utc_now(),
                            "image_object_key": inline_ref.object_key,
                            "error": str(exc),
                        },
                    )
                    terminal_failure_count += 1
                else:
                    still_pending_count += 1
                _record_attempt(
                    attempt_store=attempt_store,
                    entry=entry,
                    media_ref_id=inline_ref.media_ref_id,
                    attempt_number=attempt_number,
                    admission_batch_id=admission_batch_id,
                    status="fetch_failed",
                    provider="",
                    model="",
                    fetch_manifest_key="",
                    ocr_manifest_key=build_wechat_public_notice_inline_image_artifact_keys(
                        media_refs_key=media_refs_key,
                        media_ref_id=inline_ref.media_ref_id,
                    ).ocr_manifest_key,
                    provider_response_key="",
                    layout_elements_key="",
                    error=str(exc),
                )
                item_reports.append(
                    WeChatPublicNoticeMultimodalItemReport(
                        source_notice_id=entry.source_notice_id,
                        media_ref_id=inline_ref.media_ref_id,
                        status="fetch_failed" if terminal else "pending",
                        attempt_number=attempt_number,
                        reason=str(exc),
                    )
                )
                continue

            provider_response_key = ""
            layout_elements_key = ""
            try:
                result = provider.process(
                    WeChatPublicNoticeMultimodalProviderRequest(
                        source_notice_id=entry.source_notice_id,
                        notice_title=_resolve_notice_title(entry),
                        article_source_url=str(metadata.get("source_url") or ""),
                        publish_time=str(metadata.get("publish_time") or ""),
                        media_ref_id=inline_ref.media_ref_id,
                        image_url=inline_ref.normalized_source_url or inline_ref.source_url,
                        image_bytes=fetched.image_bytes,
                    )
                )
                status = _classify_provider_result(result)
                if status == "admitted":
                    artifact_report = write_wechat_public_notice_inline_image_provider_artifacts(
                        object_store=object_store,
                        bucket=source_truth_bucket,
                        media_refs_key=media_refs_key,
                        inline_ref=inline_ref,
                        result=result,
                    )
                    provider_response_key = artifact_report["provider_response_key"]
                    layout_elements_key = artifact_report["layout_elements_key"]
                    child_document = build_wechat_public_notice_inline_image_child_document(
                        entry=entry,
                        inline_ref=inline_ref,
                        result=result,
                    )
                    child_artifacts = (
                        write_wechat_public_notice_inline_image_child_document_artifacts(
                            object_store=object_store,
                            bucket=derived_bucket,
                            entry=entry,
                            inline_ref=inline_ref,
                            document=child_document,
                        )
                    )
                    registry_record = build_wechat_public_notice_inline_image_registry_record(
                        entry=entry,
                        inline_ref=inline_ref,
                        document=child_document,
                        artifact_report=child_artifacts,
                        result=result,
                    )
                    upsert_wechat_public_notice_inline_image_registry_record(
                        registry=registry,
                        record=registry_record,
                    )
                    write_wechat_public_notice_inline_image_ocr_manifest(
                        object_store=object_store,
                        bucket=source_truth_bucket,
                        media_refs_key=media_refs_key,
                        inline_ref=inline_ref,
                        payload=_build_ocr_manifest(
                            entry=entry,
                            inline_ref=inline_ref,
                            result=result,
                            status="admitted",
                            image_object_key=inline_ref.object_key,
                            provider_response_key=provider_response_key,
                            layout_elements_key=layout_elements_key,
                            child_document_id=child_document.document_id,
                            child_canonical_markdown_key=child_artifacts["canonical_markdown_key"],
                            child_document_units_key=child_artifacts["document_units_key"],
                            error="",
                        ),
                    )
                    admitted_count += 1
                elif status == "no_extractable_text":
                    artifact_report = write_wechat_public_notice_inline_image_provider_artifacts(
                        object_store=object_store,
                        bucket=source_truth_bucket,
                        media_refs_key=media_refs_key,
                        inline_ref=inline_ref,
                        result=result,
                    )
                    provider_response_key = artifact_report["provider_response_key"]
                    layout_elements_key = artifact_report["layout_elements_key"]
                    write_wechat_public_notice_inline_image_ocr_manifest(
                        object_store=object_store,
                        bucket=source_truth_bucket,
                        media_refs_key=media_refs_key,
                        inline_ref=inline_ref,
                        payload=_build_ocr_manifest(
                            entry=entry,
                            inline_ref=inline_ref,
                            result=result,
                            status="no_extractable_text",
                            image_object_key=inline_ref.object_key,
                            provider_response_key=provider_response_key,
                            layout_elements_key=layout_elements_key,
                            child_document_id="",
                            child_canonical_markdown_key="",
                            child_document_units_key="",
                            error="",
                        ),
                    )
                    no_extractable_text_count += 1
                else:
                    raise ValueError("unreachable multimodal status")
                _record_attempt(
                    attempt_store=attempt_store,
                    entry=entry,
                    media_ref_id=inline_ref.media_ref_id,
                    attempt_number=attempt_number,
                    admission_batch_id=admission_batch_id,
                    status=status,
                    provider=result.provider,
                    model=result.model,
                    fetch_manifest_key="",
                    ocr_manifest_key=build_wechat_public_notice_inline_image_artifact_keys(
                        media_refs_key=media_refs_key,
                        media_ref_id=inline_ref.media_ref_id,
                    ).ocr_manifest_key,
                    provider_response_key=provider_response_key,
                    layout_elements_key=layout_elements_key,
                    error="",
                )
                item_reports.append(
                    WeChatPublicNoticeMultimodalItemReport(
                        source_notice_id=entry.source_notice_id,
                        media_ref_id=inline_ref.media_ref_id,
                        status=status,
                        attempt_number=attempt_number,
                    )
                )
            except Exception as exc:
                terminal = attempt_number >= max_attempts
                if terminal:
                    write_wechat_public_notice_inline_image_ocr_manifest(
                        object_store=object_store,
                        bucket=source_truth_bucket,
                        media_refs_key=media_refs_key,
                        inline_ref=inline_ref,
                        payload={
                            "schema_version": WECHAT_PUBLIC_NOTICE_MULTIMODAL_OCR_MANIFEST_SCHEMA,
                            "source_notice_id": entry.source_notice_id,
                            "source_collection": entry.source_collection,
                            "media_ref_id": inline_ref.media_ref_id,
                            "status": "ocr_failed",
                            "provider": "",
                            "model": "",
                            "confidence": "",
                            "summary": "",
                            "extracted_text": "",
                            "provider_response_key": provider_response_key,
                            "layout_elements_key": layout_elements_key,
                            "child_document_id": "",
                            "child_canonical_markdown_key": "",
                            "child_document_units_key": "",
                            "processed_at": utc_now(),
                            "image_object_key": inline_ref.object_key,
                            "error": str(exc),
                        },
                    )
                    terminal_failure_count += 1
                else:
                    still_pending_count += 1
                _record_attempt(
                    attempt_store=attempt_store,
                    entry=entry,
                    media_ref_id=inline_ref.media_ref_id,
                    attempt_number=attempt_number,
                    admission_batch_id=admission_batch_id,
                    status="ocr_failed",
                    provider="",
                    model="",
                    fetch_manifest_key="",
                    ocr_manifest_key=build_wechat_public_notice_inline_image_artifact_keys(
                        media_refs_key=media_refs_key,
                        media_ref_id=inline_ref.media_ref_id,
                    ).ocr_manifest_key,
                    provider_response_key=provider_response_key,
                    layout_elements_key=layout_elements_key,
                    error=str(exc),
                )
                item_reports.append(
                    WeChatPublicNoticeMultimodalItemReport(
                        source_notice_id=entry.source_notice_id,
                        media_ref_id=inline_ref.media_ref_id,
                        status="ocr_failed" if terminal else "pending",
                        attempt_number=attempt_number,
                        reason=str(exc),
                    )
                )
    return WeChatPublicNoticeMultimodalProcessingReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        selected_notice_ids=normalized_notice_ids,
        pending_notice_ids=tuple(
            sorted(
                {
                    entry.source_notice_id
                    for entry in pending_entries
                    if str(entry.source_notice_id).strip()
                }
            )
        ),
        projection_entry_count=len(entries),
        pending_entry_count=len(pending_entries),
        scanned_image_count=scanned_image_count,
        attempted_image_count=attempted_image_count,
        admitted_count=admitted_count,
        no_extractable_text_count=no_extractable_text_count,
        terminal_failure_count=terminal_failure_count,
        still_pending_count=still_pending_count,
        item_reports=tuple(item_reports),
    )
