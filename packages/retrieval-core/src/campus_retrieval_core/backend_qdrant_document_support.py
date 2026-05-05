from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace

from campus_contracts import EvidenceSource
from campus_ingestion_core.corpus_profiles import (
    CollectionRuntimeProfile,
    is_official_web_stable_reference_like_profile,
)
from qdrant_client.http import models as qdrant_models

from campus_retrieval_core.backend_qdrant_embeddings import get_dense_query_embedding
from campus_retrieval_core.backend_qdrant_evidence import (
    build_evidence_sources,
    build_evidence_sources_from_records,
)
from campus_retrieval_core.backend_qdrant_filters import (
    _build_qdrant_filter,
    _build_source_scoped_qdrant_filter,
)
from campus_retrieval_core.backend_qdrant_official_web_policy import (
    _OFFICIAL_WEB_STABLE_REFERENCE_QUERY_TERMS,
    _normalize_low_signal_query,
    _official_web_source_chunk_ordinal,
)
from campus_retrieval_core.backend_qdrant_query import (
    _build_document_support_query_text,
    _build_rrf_query,
    _curriculum_support_section_key,
    _merge_evidence_sources,
)
from campus_retrieval_core.backend_qdrant_runtime import (
    _build_hybrid_prefetch,
    _RetrievalDeadline,
    _retry_qdrant_read,
)
from campus_retrieval_core.backend_qdrant_source_metadata import (
    _is_curriculum_course_list_table_source,
)
from campus_retrieval_core.curriculum_query_resolution import (
    filter_curriculum_query_sources,
    interpret_curriculum_query,
)
from campus_retrieval_core.evidence_ranking import query_targets_source_title
from campus_retrieval_core.models import RetrievalRequest

_SAME_DOC_SCROLL_BATCH_LIMIT = 64
_SAME_DOC_SCROLL_MAX_RECORDS = 256


def _resolve_initial_query_limit(
    *,
    request: RetrievalRequest,
    profile: CollectionRuntimeProfile,
) -> int:
    if _should_use_targeted_document_overfetch(request=request, profile=profile):
        return max(request.top_k, profile.document_support_limit)
    return request.top_k


def _should_expand_named_document_support(
    *,
    request: RetrievalRequest,
    profile: CollectionRuntimeProfile,
    sources: Sequence[EvidenceSource],
) -> bool:
    if not _should_use_targeted_document_overfetch(request=request, profile=profile):
        return True
    return _should_expand_narrow_curriculum_targeted_support(
        request=request,
        sources=sources,
    )


def _should_use_targeted_document_overfetch(
    *,
    request: RetrievalRequest,
    profile: CollectionRuntimeProfile,
) -> bool:
    if profile.document_support_strategy != "targeted_overfetch":
        return False
    return bool(request.target_document_ids) and len(frozenset(request.target_document_ids)) == 1


def _should_expand_narrow_curriculum_targeted_support(
    *,
    request: RetrievalRequest,
    sources: Sequence[EvidenceSource],
) -> bool:
    if request.corpus != "curriculum" or request.collection != "curriculum_plan":
        return False
    target_source = next(
        (
            source
            for source in sources
            if query_targets_source_title(query_text=request.query_text, source=source)
        ),
        None,
    )
    if target_source is None:
        return False
    support_query_text = _build_document_support_query_text(
        query_text=request.query_text,
        source=target_source,
    )
    if _normalize_low_signal_query(support_query_text) == _normalize_low_signal_query(
        request.query_text
    ):
        return False
    section_keys = {
        _curriculum_support_section_key(source)
        for source in sources
        if source.doc_id == target_source.doc_id
    }
    return len(section_keys) < 2


def _expand_named_document_support(
    backend: object,
    *,
    request: RetrievalRequest,
    profile: CollectionRuntimeProfile,
    qdrant_collection_name: str,
    sources: Sequence[EvidenceSource],
    deadline: _RetrievalDeadline,
) -> tuple[EvidenceSource, ...]:
    if deadline.is_expired():
        return tuple(sources)
    target_source = next(
        (
            source
            for source in sources
            if query_targets_source_title(query_text=request.query_text, source=source)
        ),
        None,
    )
    if target_source is None:
        return tuple(sources)
    support_query_text = _build_document_support_query_text(
        query_text=request.query_text,
        source=target_source,
    )
    source_scoped_filter = _build_source_scoped_qdrant_filter(
        request=request,
        profile=profile,
        source=target_source,
    )
    if _normalize_low_signal_query(support_query_text) == _normalize_low_signal_query(
        request.query_text
    ):
        scrolled_sources = _scroll_same_document_sources(
            backend,
            qdrant_collection_name=qdrant_collection_name,
            scroll_filter=source_scoped_filter,
            default_score=target_source.score,
            deadline=deadline,
        )
        merged_sources = _merge_evidence_sources(
            preferred=sources,
            additional=scrolled_sources,
        )
        return _recover_official_web_lead_chunk_support(
            backend,
            request=request,
            profile=profile,
            qdrant_collection_name=qdrant_collection_name,
            target_source=target_source,
            sources=merged_sources,
            deadline=deadline,
        )
    support_request = replace(request, query_text=support_query_text)
    try:
        support_dense_query_embedding = get_dense_query_embedding(
            backend,
            support_request.query_text,
            profile=profile,
        )
        response = _retry_qdrant_read(
            lambda: backend.qdrant_client.query_points(
                collection_name=qdrant_collection_name,
                prefetch=_build_hybrid_prefetch(
                    request=support_request,
                    profile=profile,
                    embedding_model=backend.embedding_model,
                    sparse_embedding_model=backend.sparse_embedding_model,
                    dense_query_embedding=support_dense_query_embedding,
                    query_filter=source_scoped_filter,
                    build_qdrant_filter_fn=_build_qdrant_filter,
                ),
                query=_build_rrf_query(profile),
                limit=max(support_request.top_k, profile.document_support_limit),
                with_payload=True,
                with_vectors=False,
                timeout=deadline.qdrant_timeout_seconds(),
            ),
            deadline=deadline,
        )
    except Exception:
        return tuple(sources)
    if deadline.is_expired():
        return tuple(sources)
    additional_sources = build_evidence_sources(backend, response.points or ())
    curriculum_semester_sources = _supplement_curriculum_same_doc_semester_sources(
        backend,
        request=request,
        qdrant_collection_name=qdrant_collection_name,
        source_scoped_filter=source_scoped_filter,
        default_score=target_source.score,
        deadline=deadline,
    )
    merged_sources = _merge_evidence_sources(
        preferred=sources,
        additional=_merge_evidence_sources(
            preferred=additional_sources,
            additional=curriculum_semester_sources,
        ),
    )
    return _recover_official_web_lead_chunk_support(
        backend,
        request=request,
        profile=profile,
        qdrant_collection_name=qdrant_collection_name,
        target_source=target_source,
        sources=merged_sources,
        deadline=deadline,
    )


def _supplement_curriculum_same_doc_semester_sources(
    backend: object,
    *,
    request: RetrievalRequest,
    qdrant_collection_name: str,
    source_scoped_filter: qdrant_models.Filter,
    default_score: float,
    deadline: _RetrievalDeadline,
) -> tuple[EvidenceSource, ...]:
    if deadline.is_expired():
        return ()
    if request.corpus != "curriculum" or request.collection != "curriculum_plan":
        return ()
    interpretation = interpret_curriculum_query(request.query_text)
    if interpretation.intent_kind != "course_list" or not interpretation.semester_labels:
        return ()

    offset: int | str | None = None
    records: list[qdrant_models.Record] = []
    while len(records) < _SAME_DOC_SCROLL_MAX_RECORDS:
        if deadline.is_expired():
            return ()
        remaining = _SAME_DOC_SCROLL_MAX_RECORDS - len(records)
        limit = min(_SAME_DOC_SCROLL_BATCH_LIMIT, remaining)
        try:
            batch, offset = _retry_qdrant_read(
                lambda limit=limit, offset=offset: backend.qdrant_client.scroll(
                    collection_name=qdrant_collection_name,
                    scroll_filter=source_scoped_filter,
                    limit=limit,
                    offset=offset,
                    with_payload=True,
                    with_vectors=False,
                    timeout=deadline.qdrant_timeout_seconds(),
                ),
                deadline=deadline,
            )
        except Exception:
            return ()
        if not batch:
            break
        records.extend(batch)
        if offset is None:
            break

    same_doc_sources = build_evidence_sources_from_records(
        backend,
        records,
        default_score=default_score,
    )
    scoped_sources, scope_applied = filter_curriculum_query_sources(
        query_text=request.query_text,
        sources=same_doc_sources,
    )
    if not scope_applied:
        return ()
    course_list_sources = tuple(
        source for source in scoped_sources if _is_curriculum_course_list_table_source(source)
    )
    selected_sources = course_list_sources or scoped_sources
    boosted_score = max(default_score, 1.0)
    return tuple(
        replace(source, score=max(source.score, boosted_score)) for source in selected_sources
    )


def _supplement_target_document_scroll_fallback(
    backend: object,
    *,
    request: RetrievalRequest,
    profile: CollectionRuntimeProfile,
    qdrant_collection_name: str,
    sources: Sequence[EvidenceSource],
    deadline: _RetrievalDeadline,
) -> tuple[EvidenceSource, ...]:
    if deadline.is_expired():
        return tuple(sources)
    if not request.target_document_ids:
        return tuple(sources)
    if _has_grounding_source(sources):
        return tuple(sources)

    default_score = max((source.score for source in sources), default=1.0)
    supplemental_sources: tuple[EvidenceSource, ...] = ()
    for document_id in request.target_document_ids:
        if deadline.is_expired():
            break
        scroll_filter = _build_target_document_scroll_filter(
            request=request,
            profile=profile,
            document_id=document_id,
        )
        supplemental_sources = _merge_evidence_sources(
            preferred=supplemental_sources,
            additional=_scroll_same_document_sources(
                backend,
                qdrant_collection_name=qdrant_collection_name,
                scroll_filter=scroll_filter,
                default_score=default_score,
                deadline=deadline,
            ),
        )
    return _merge_evidence_sources(preferred=sources, additional=supplemental_sources)


def _build_target_document_scroll_filter(
    *,
    request: RetrievalRequest,
    profile: CollectionRuntimeProfile,
    document_id: str,
) -> qdrant_models.Filter:
    base_filter = _build_qdrant_filter(
        replace(request, target_document_ids=()),
        profile=profile,
    )
    return qdrant_models.Filter(
        must=[
            *(base_filter.must or ()),
            qdrant_models.FieldCondition(
                key="document_id",
                match=qdrant_models.MatchValue(value=document_id),
            ),
        ],
        should=base_filter.should,
        must_not=base_filter.must_not,
        min_should=base_filter.min_should,
    )


def _scroll_same_document_sources(
    backend: object,
    *,
    qdrant_collection_name: str,
    scroll_filter: qdrant_models.Filter,
    default_score: float,
    deadline: _RetrievalDeadline,
) -> tuple[EvidenceSource, ...]:
    offset: int | str | None = None
    records: list[qdrant_models.Record] = []
    while len(records) < _SAME_DOC_SCROLL_MAX_RECORDS:
        if deadline.is_expired():
            return ()
        remaining = _SAME_DOC_SCROLL_MAX_RECORDS - len(records)
        limit = min(_SAME_DOC_SCROLL_BATCH_LIMIT, remaining)
        try:
            batch, offset = _retry_qdrant_read(
                lambda limit=limit, offset=offset: backend.qdrant_client.scroll(
                    collection_name=qdrant_collection_name,
                    scroll_filter=scroll_filter,
                    limit=limit,
                    offset=offset,
                    with_payload=True,
                    with_vectors=False,
                    timeout=deadline.qdrant_timeout_seconds(),
                ),
                deadline=deadline,
            )
        except Exception:
            return ()
        if not batch:
            break
        records.extend(batch)
        if offset is None:
            break
    if not records:
        return ()
    return build_evidence_sources_from_records(
        backend,
        records,
        default_score=default_score,
    )


def _has_grounding_source(sources: Sequence[EvidenceSource]) -> bool:
    negative_roles = {
        "appendix",
        "background",
        "closing_provision",
        "navigation",
        "source_attribution",
        "boilerplate",
        "media_caption",
    }
    return any(
        source.is_answer_bearing or source.content_role not in negative_roles for source in sources
    )


def _recover_official_web_lead_chunk_support(
    backend: object,
    *,
    request: RetrievalRequest,
    profile: CollectionRuntimeProfile,
    qdrant_collection_name: str,
    target_source: EvidenceSource,
    sources: tuple[EvidenceSource, ...],
    deadline: _RetrievalDeadline,
) -> tuple[EvidenceSource, ...]:
    if deadline.is_expired():
        return sources
    if not is_official_web_stable_reference_like_profile(profile):
        return sources
    normalized_query = _normalize_low_signal_query(request.query_text)
    if not any(term in normalized_query for term in _OFFICIAL_WEB_STABLE_REFERENCE_QUERY_TERMS):
        return sources
    doc_sources = tuple(source for source in sources if source.doc_id == target_source.doc_id)
    if len(doc_sources) >= 2 and any(
        _official_web_source_chunk_ordinal(source) == 1 for source in doc_sources
    ):
        return sources
    try:
        scrolled_records, _ = _retry_qdrant_read(
            lambda: backend.qdrant_client.scroll(
                collection_name=qdrant_collection_name,
                scroll_filter=_build_source_scoped_qdrant_filter(
                    request=request,
                    profile=profile,
                    source=target_source,
                ),
                limit=max(profile.document_support_limit, 8),
                with_payload=True,
                with_vectors=False,
                timeout=deadline.qdrant_timeout_seconds(),
            ),
            deadline=deadline,
        )
    except Exception:
        return sources
    if not scrolled_records:
        return sources
    lead_sources = tuple(
        sorted(
            build_evidence_sources(
                backend,
                tuple(
                    qdrant_models.ScoredPoint(
                        id=record.id,
                        version=getattr(record, "version", 0) or 0,
                        score=float(getattr(record, "score", 0.0) or 0.0),
                        payload=record.payload,
                        vector=None,
                        shard_key=getattr(record, "shard_key", None),
                        order_value=getattr(record, "order_value", None),
                    )
                    for record in scrolled_records
                ),
            ),
            key=lambda source: (
                _official_web_source_chunk_ordinal(source) or 10_000,
                -source.score,
            ),
        )
    )
    if not lead_sources:
        return sources
    return _merge_evidence_sources(preferred=sources, additional=lead_sources)
