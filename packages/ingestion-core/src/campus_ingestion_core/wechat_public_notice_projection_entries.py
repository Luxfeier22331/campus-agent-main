from __future__ import annotations

import hashlib

from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
    NOTICE_ANSWERABILITY_REFERENCE_ONLY,
    NOTICE_COMPLETENESS_COMPLETE,
    NOTICE_COMPLETENESS_REFERENCE_ONLY,
    NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_DEFAULT_AGENT_NOTICE,
    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    NOTICE_TEMPORAL_POLICY_ANNOUNCEMENT_WINDOW,
    NoticeConsumptionProjectionEntry,
)
from campus_ingestion_core.wechat_public_notice_projection_constants import (
    WECHAT_PUBLIC_NOTICE_PRIMARY_ROLE,
    WECHAT_PUBLIC_NOTICE_SEMANTIC_OWNER,
    WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY,
)
from campus_ingestion_core.wechat_public_notice_projection_metadata import (
    _build_article_role_metadata,
)
from campus_ingestion_core.wechat_public_notice_projection_models import (
    WeChatArticleSourceTruth,
    _DuplicateReferenceHit,
)
from campus_ingestion_core.wechat_public_notice_projection_multimodal_status import (
    _aggregate_multimodal_summary,
    _aggregate_multimodal_text,
    _has_pending_inline_image_outcome,
    _has_terminal_inline_image_failure,
)


def _is_query_admitted_article(article: WeChatArticleSourceTruth) -> bool:
    if article.body_state != "captured":
        return False
    if not article.inline_image_outcomes:
        return bool(article.body_paragraphs)
    if _has_pending_inline_image_outcome(article):
        return False
    if _has_terminal_inline_image_failure(article):
        return False
    return bool(article.body_paragraphs) or bool(
        _aggregate_multimodal_text(article) or _aggregate_multimodal_summary(article)
    )


def _build_retained_notice_entry(
    *,
    article: WeChatArticleSourceTruth,
    source_corpus: str,
    source_collection: str,
    consumer_admission_batch_id: str = "",
) -> NoticeConsumptionProjectionEntry:
    metadata = _build_article_role_metadata(
        article,
        consumer_admission_batch_id=consumer_admission_batch_id,
    )
    notice_document_id = f"wechat_notice:{article.account_slug}:{article.article_stable_id}"
    unit_digest = hashlib.sha256(
        "\n".join(
            (article.article_stable_id, article.raw_version_id, WECHAT_PUBLIC_NOTICE_PRIMARY_ROLE)
        ).encode("utf-8")
    ).hexdigest()[:16]
    return NoticeConsumptionProjectionEntry(
        source_family=WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY,
        source_corpus=source_corpus,
        source_collection=source_collection,
        source_notice_id=article.article_stable_id,
        unit_id=f"notice_unit:wechat:{article.article_stable_id}:{unit_digest}",
        primary_role=WECHAT_PUBLIC_NOTICE_PRIMARY_ROLE,
        semantic_owner=WECHAT_PUBLIC_NOTICE_SEMANTIC_OWNER,
        default_agent=NOTICE_DEFAULT_AGENT_NOTICE,
        target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
        temporal_policy=NOTICE_TEMPORAL_POLICY_ANNOUNCEMENT_WINDOW,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
        source_notice_document_id=notice_document_id,
        source_document_id=notice_document_id,
        source_attachment_ref_ids=tuple(item.media_ref_id for item in article.inline_image_refs),
        source_notice_release_time=article.publish_time or None,
        role_metadata={**metadata, "dedupe_status": "unique"},
    )


def _build_suppressed_duplicate_entry(
    *,
    article: WeChatArticleSourceTruth,
    duplicate_hit: _DuplicateReferenceHit,
    source_corpus: str,
    source_collection: str,
    consumer_admission_batch_id: str = "",
) -> NoticeConsumptionProjectionEntry:
    retained_entry = _build_retained_notice_entry(
        article=article,
        source_corpus=source_corpus,
        source_collection=source_collection,
        consumer_admission_batch_id=consumer_admission_batch_id,
    )
    metadata = dict(retained_entry.role_metadata)
    metadata.update(
        {
            "dedupe_status": "suppressed_duplicate",
            "dedupe_basis": duplicate_hit.dedupe_basis,
            "duplicate_of_source_family": duplicate_hit.source_family,
            "duplicate_of_notice_id": duplicate_hit.source_notice_id,
            "canonical_source_family": duplicate_hit.source_family,
            "canonical_notice_id": duplicate_hit.source_notice_id,
        }
    )
    return NoticeConsumptionProjectionEntry(
        source_family=retained_entry.source_family,
        source_corpus=retained_entry.source_corpus,
        source_collection=retained_entry.source_collection,
        source_notice_id=retained_entry.source_notice_id,
        unit_id=retained_entry.unit_id,
        primary_role=retained_entry.primary_role,
        semantic_owner=retained_entry.semantic_owner,
        default_agent=retained_entry.default_agent,
        target_surface=NOTICE_TARGET_SURFACE_UNSUPPORTED,
        temporal_policy=retained_entry.temporal_policy,
        completeness_status=retained_entry.completeness_status,
        answerability=retained_entry.answerability,
        consumption_status=NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
        source_notice_document_id=retained_entry.source_notice_document_id,
        source_document_id=retained_entry.source_document_id,
        source_attachment_ref_ids=retained_entry.source_attachment_ref_ids,
        source_notice_release_time=retained_entry.source_notice_release_time,
        role_metadata=metadata,
    )


def _build_capture_pending_reference_entry(
    *,
    article: WeChatArticleSourceTruth,
    source_corpus: str,
    source_collection: str,
    consumer_admission_batch_id: str = "",
) -> NoticeConsumptionProjectionEntry:
    retained_entry = _build_retained_notice_entry(
        article=article,
        source_corpus=source_corpus,
        source_collection=source_collection,
        consumer_admission_batch_id=consumer_admission_batch_id,
    )
    metadata = dict(retained_entry.role_metadata)
    metadata.update({"dedupe_status": "capture_pending"})
    target_surface = NOTICE_TARGET_SURFACE_UNSUPPORTED
    completeness_status = NOTICE_COMPLETENESS_REFERENCE_ONLY
    answerability = NOTICE_ANSWERABILITY_REFERENCE_ONLY
    consumption_status = NOTICE_CONSUMPTION_STATUS_NO_ADOPTION
    if (
        article.body_state == "captured"
        and article.inline_image_outcomes
        and not _has_terminal_inline_image_failure(article)
        and _has_pending_inline_image_outcome(article)
    ):
        target_surface = NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE
        completeness_status = NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING
        consumption_status = NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING
    return NoticeConsumptionProjectionEntry(
        source_family=retained_entry.source_family,
        source_corpus=retained_entry.source_corpus,
        source_collection=retained_entry.source_collection,
        source_notice_id=retained_entry.source_notice_id,
        unit_id=retained_entry.unit_id,
        primary_role=retained_entry.primary_role,
        semantic_owner=retained_entry.semantic_owner,
        default_agent=retained_entry.default_agent,
        target_surface=target_surface,
        temporal_policy=retained_entry.temporal_policy,
        completeness_status=completeness_status,
        answerability=answerability,
        consumption_status=consumption_status,
        source_notice_document_id=retained_entry.source_notice_document_id,
        source_document_id=retained_entry.source_document_id,
        source_attachment_ref_ids=retained_entry.source_attachment_ref_ids,
        source_notice_release_time=retained_entry.source_notice_release_time,
        role_metadata=metadata,
    )
