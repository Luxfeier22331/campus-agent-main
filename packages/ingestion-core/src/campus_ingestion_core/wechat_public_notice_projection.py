from __future__ import annotations

import os
from collections.abc import Mapping, Sequence

from campus_ingestion_core.notice_consumption_projection import (
    NoticeConsumptionProjectionEntry,
    NoticeConsumptionProjectionStore,
)
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.wechat_public_notice_projection_constants import (
    WECHAT_PUBLIC_NOTICE_SOURCE_CHANNEL,
    WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION,
    WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS,
    WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY,
    WECHAT_PUBLIC_NOTICE_SOURCE_LABEL,
)
from campus_ingestion_core.wechat_public_notice_projection_dedupe import (
    _build_reference_signal_map,
    _find_duplicate_reference,
)
from campus_ingestion_core.wechat_public_notice_projection_entries import (
    _build_capture_pending_reference_entry,
    _build_retained_notice_entry,
    _build_suppressed_duplicate_entry,
    _is_query_admitted_article,
)
from campus_ingestion_core.wechat_public_notice_projection_models import (
    WeChatArticleSourceTruth,
    WeChatPublicNoticeProjectionBuildReport,
    WeChatPublicNoticeProjectionObjectStore,
    WeChatPublicNoticeProjectionRequest,
    WeChatReadModelEvidenceEntry,
    WeChatSourceTruthArtifactRefs,
)
from campus_ingestion_core.wechat_public_notice_projection_read_model import (
    build_wechat_public_notice_read_model_entries,
    build_wechat_public_notice_read_model_evidence_entries,
    materialize_wechat_public_notice_read_model,
)
from campus_ingestion_core.wechat_public_notice_projection_runtime import (
    _build_projection_store,
    _build_source_object_store,
    _load_reference_projection_entries,
)
from campus_ingestion_core.wechat_public_notice_projection_selection import (
    parse_wechat_projection_selection_path,
)
from campus_ingestion_core.wechat_public_notice_projection_source_truth import (
    _load_wechat_article_source_truth,
)


def rebuild_wechat_public_notice_projection(
    *,
    request: WeChatPublicNoticeProjectionRequest,
    env: Mapping[str, str] | None = None,
    object_store: WeChatPublicNoticeProjectionObjectStore | None = None,
    projection_store: NoticeConsumptionProjectionStore | None = None,
    dry_run: bool = False,
) -> WeChatPublicNoticeProjectionBuildReport:
    source = dict(env if env is not None else os.environ)
    runtime_store = projection_store or _build_projection_store(source, dry_run=dry_run)
    runtime_object_store = object_store or _build_source_object_store(source)
    source_bucket = request.source_bucket.strip()
    if not source_bucket and any(not ref.bucket.strip() for ref in request.artifact_refs):
        source_bucket = ObjectStoreSettings.from_env(source).bucket_source
    normalized_refs = tuple(
        ref.normalized(default_bucket=source_bucket) for ref in request.artifact_refs
    )
    if not normalized_refs:
        raise ValueError("at least one source-truth artifact reference is required")

    articles = tuple(
        _load_wechat_article_source_truth(runtime_object_store, ref) for ref in normalized_refs
    )
    reference_entries = _load_reference_projection_entries(
        projection_store=runtime_store,
        source_corpus=request.source_corpus,
        source_collection=request.source_collection,
        reference_scopes=request.reference_scopes,
    )
    build_report = build_wechat_public_notice_projection_entries(
        articles=articles,
        source_corpus=request.source_corpus,
        source_collection=request.source_collection,
        reference_entries=reference_entries,
        consumer_admission_batch_id=request.consumer_admission_batch_id,
    )
    if dry_run:
        return build_report

    selected_notice_ids = tuple(
        sorted(
            {
                entry.source_notice_id
                for entry in build_report.projection_entries
                if entry.source_notice_id.strip()
            }
        )
    )
    runtime_store.replace_notices(
        request.source_corpus,
        request.source_collection,
        notice_ids=selected_notice_ids,
        records=build_report.projection_entries,
    )
    stored = runtime_store.list_by_scope(
        request.source_corpus,
        request.source_collection,
        notice_ids=selected_notice_ids,
    )
    return WeChatPublicNoticeProjectionBuildReport(
        projection_entries=stored,
        total_article_count=build_report.total_article_count,
        retained_count=build_report.retained_count,
        duplicate_suppressed_count=build_report.duplicate_suppressed_count,
        duplicate_source_family_counts=build_report.duplicate_source_family_counts,
    )


def build_wechat_public_notice_projection_entries(
    *,
    articles: Sequence[WeChatArticleSourceTruth],
    source_corpus: str,
    source_collection: str,
    reference_entries: Sequence[NoticeConsumptionProjectionEntry],
    consumer_admission_batch_id: str = "",
) -> WeChatPublicNoticeProjectionBuildReport:
    reference_signals = _build_reference_signal_map(reference_entries)
    retained_entries: list[NoticeConsumptionProjectionEntry] = []
    output_entries: list[NoticeConsumptionProjectionEntry] = []
    duplicate_source_family_counts: dict[str, int] = {}
    duplicate_suppressed_count = 0
    retained_count = 0

    for article in articles:
        duplicate_hit = _find_duplicate_reference(
            article=article,
            reference_signals=reference_signals,
            local_entries=tuple(retained_entries),
        )
        if duplicate_hit is None:
            if _is_query_admitted_article(article):
                entry = _build_retained_notice_entry(
                    article=article,
                    source_corpus=source_corpus,
                    source_collection=source_collection,
                    consumer_admission_batch_id=consumer_admission_batch_id,
                )
                retained_count += 1
            else:
                entry = _build_capture_pending_reference_entry(
                    article=article,
                    source_corpus=source_corpus,
                    source_collection=source_collection,
                    consumer_admission_batch_id=consumer_admission_batch_id,
                )
            output_entries.append(entry)
            retained_entries.append(entry)
            continue

        duplicate_suppressed_count += 1
        duplicate_family = duplicate_hit.source_family.strip() or "unknown"
        duplicate_source_family_counts[duplicate_family] = (
            duplicate_source_family_counts.get(duplicate_family, 0) + 1
        )
        output_entries.append(
            _build_suppressed_duplicate_entry(
                article=article,
                duplicate_hit=duplicate_hit,
                source_corpus=source_corpus,
                source_collection=source_collection,
                consumer_admission_batch_id=consumer_admission_batch_id,
            )
        )

    return WeChatPublicNoticeProjectionBuildReport(
        projection_entries=tuple(sorted(output_entries, key=lambda item: item.unit_id)),
        total_article_count=len(articles),
        retained_count=retained_count,
        duplicate_suppressed_count=duplicate_suppressed_count,
        duplicate_source_family_counts=dict(sorted(duplicate_source_family_counts.items())),
    )


__all__ = [
    "WECHAT_PUBLIC_NOTICE_SOURCE_CHANNEL",
    "WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION",
    "WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS",
    "WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY",
    "WECHAT_PUBLIC_NOTICE_SOURCE_LABEL",
    "WeChatArticleSourceTruth",
    "WeChatPublicNoticeProjectionBuildReport",
    "WeChatPublicNoticeProjectionObjectStore",
    "WeChatPublicNoticeProjectionRequest",
    "WeChatReadModelEvidenceEntry",
    "WeChatSourceTruthArtifactRefs",
    "build_wechat_public_notice_projection_entries",
    "build_wechat_public_notice_read_model_entries",
    "build_wechat_public_notice_read_model_evidence_entries",
    "materialize_wechat_public_notice_read_model",
    "parse_wechat_projection_selection_path",
    "rebuild_wechat_public_notice_projection",
]
