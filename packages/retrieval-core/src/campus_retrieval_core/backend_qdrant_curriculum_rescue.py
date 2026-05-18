from __future__ import annotations

from collections.abc import Sequence

from campus_contracts import EvidenceSource
from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile
from qdrant_client.http import models as qdrant_models

from campus_retrieval_core.backend_qdrant_errors import RetrievalBackendError
from campus_retrieval_core.backend_qdrant_evidence import build_evidence_sources_from_records
from campus_retrieval_core.backend_qdrant_filters import _build_qdrant_filter
from campus_retrieval_core.curriculum_query_resolution import interpret_curriculum_query

_CURRICULUM_TITLE_RESCUE_SCROLL_LIMIT = 64


def rescue_curriculum_title_sources(
    backend,
    *,
    request,
    profile: CollectionRuntimeProfile,
    qdrant_collection_name: str,
    sources: Sequence[EvidenceSource],
    timeout_seconds: int | float | None,
    default_score: float = 1.0,
) -> tuple[EvidenceSource, ...]:
    if request.corpus != "curriculum" or request.collection != "curriculum_plan":
        return tuple(sources)
    if request.target_document_ids or request.target_version_ids:
        return tuple(sources)
    interpretation = interpret_curriculum_query(request.query_text)
    if not interpretation.program_compact_key:
        return tuple(sources)
    scoped_doc_ids = {
        source.doc_id
        for source in sources
        if _curriculum_doc_matches_query(
            source=source,
            program_compact_key=interpretation.program_compact_key,
        )
    }
    if len(scoped_doc_ids) == 1:
        return tuple(sources)

    rescued_sources = _scroll_curriculum_exact_document_sources(
        backend,
        request=request,
        profile=profile,
        qdrant_collection_name=qdrant_collection_name,
        document_id=f"curriculum:{interpretation.program_query_fragment}",
        timeout_seconds=timeout_seconds,
        default_score=default_score,
    )
    if rescued_sources:
        return _merge_rescued_sources(sources=sources, rescued_sources=rescued_sources)
    return tuple(sources)


def _scroll_curriculum_exact_document_sources(
    backend,
    *,
    request,
    profile: CollectionRuntimeProfile,
    qdrant_collection_name: str,
    document_id: str,
    timeout_seconds: int | float | None,
    default_score: float,
) -> tuple[EvidenceSource, ...]:
    if not document_id.strip():
        return ()
    base_filter = _build_qdrant_filter(request, profile=profile)
    rescue_filter = qdrant_models.Filter(
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
    try:
        records, _ = backend.qdrant_client.scroll(
            collection_name=qdrant_collection_name,
            scroll_filter=rescue_filter,
            limit=_CURRICULUM_TITLE_RESCUE_SCROLL_LIMIT,
            with_payload=True,
            with_vectors=False,
            timeout=timeout_seconds,
        )
    except Exception as exc:
        raise RetrievalBackendError("qdrant curriculum title rescue scroll failed") from exc
    if not records:
        return ()
    return build_evidence_sources_from_records(
        backend,
        records,
        default_score=default_score,
    )


def _merge_rescued_sources(
    *,
    sources: Sequence[EvidenceSource],
    rescued_sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    rescued_chunk_ids = {source.chunk_id for source in rescued_sources}
    return (
        *tuple(rescued_sources),
        *(source for source in sources if source.chunk_id not in rescued_chunk_ids),
    )


def _curriculum_doc_matches_query(
    *,
    source: EvidenceSource,
    program_compact_key: str,
) -> bool:
    return source.doc_id == f"curriculum:{program_compact_key}" or any(
        program_compact_key == _compact_title(candidate)
        for candidate in (
            source.source_title,
            source.doc_id.split(":", 1)[-1],
            *(source.structural_path[:1]),
        )
    )


def _compact_title(text: str) -> str:
    interpretation = interpret_curriculum_query(text)
    return interpretation.program_compact_key


__all__ = ["rescue_curriculum_title_sources"]
