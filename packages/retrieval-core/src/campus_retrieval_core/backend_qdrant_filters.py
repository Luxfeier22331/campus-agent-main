from __future__ import annotations

from typing import Sequence

from campus_contracts import EvidenceSource
from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile, load_runtime_profile
from campus_ingestion_core.models import DocumentRegistryRecord
from llama_index.core.vector_stores import (
    FilterCondition,
    FilterOperator,
    MetadataFilter,
    MetadataFilters,
)
from qdrant_client.http import models as qdrant_models

from campus_retrieval_core.models import RetrievalRequest

DEFAULT_SERVING_STATUS = "active"


def _build_metadata_filters(
    request: RetrievalRequest,
    *,
    profile: CollectionRuntimeProfile | None = None,
) -> MetadataFilters:
    runtime_profile = profile or load_runtime_profile(request.corpus, request.collection)
    effective_entitlement_groups = request.effective_entitlement_groups()
    effective_visibility_scope = request.effective_visibility_scope()
    filters: list[MetadataFilter | MetadataFilters] = [
        MetadataFilter(key="corpus", value=request.corpus),
        MetadataFilter(key="collection", value=request.collection),
    ]
    if request.target_revision_track:
        filters.append(MetadataFilter(key="revision_track", value=request.target_revision_track))
    elif runtime_profile.serving_revision_tracks:
        filters.append(
            MetadataFilter(
                key="revision_track",
                value=list(runtime_profile.serving_revision_tracks),
                operator=FilterOperator.IN,
            )
        )
    filters.append(MetadataFilter(key="status", value=DEFAULT_SERVING_STATUS))
    if request.target_document_ids:
        filters.append(
            MetadataFilter(
                key="document_id",
                value=list(request.target_document_ids),
                operator=FilterOperator.IN,
            )
        )
    if request.target_version_ids:
        filters.append(
            MetadataFilter(
                key="version_id",
                value=list(request.target_version_ids),
                operator=FilterOperator.IN,
            )
        )
    if request.canonical_course_ids:
        filters.append(
            MetadataFilter(
                key="canonical_course_id",
                value=list(request.canonical_course_ids),
                operator=FilterOperator.IN,
            )
        )
    if request.canonical_course_family_ids:
        filters.append(
            MetadataFilter(
                key="canonical_course_family_id",
                value=list(request.canonical_course_family_ids),
                operator=FilterOperator.IN,
            )
        )
    if request.canonical_program_family_ids:
        filters.append(
            MetadataFilter(
                key="canonical_program_family_id",
                value=list(request.canonical_program_family_ids),
                operator=FilterOperator.IN,
            )
        )
    filters.append(
        _build_authorization_metadata_filter(
            entitlement_groups=effective_entitlement_groups,
            visibility_scope=effective_visibility_scope,
        )
    )
    return MetadataFilters(filters=filters, condition=FilterCondition.AND)


def _build_qdrant_filter(
    request: RetrievalRequest,
    *,
    profile: CollectionRuntimeProfile | None = None,
) -> qdrant_models.Filter:
    runtime_profile = profile or load_runtime_profile(request.corpus, request.collection)
    effective_entitlement_groups = request.effective_entitlement_groups()
    must: list[qdrant_models.Condition] = [
        qdrant_models.FieldCondition(
            key="corpus",
            match=qdrant_models.MatchValue(value=request.corpus),
        ),
        qdrant_models.FieldCondition(
            key="collection",
            match=qdrant_models.MatchValue(value=request.collection),
        ),
        qdrant_models.FieldCondition(
            key="status",
            match=qdrant_models.MatchValue(value=DEFAULT_SERVING_STATUS),
        ),
        _build_authorization_qdrant_filter(
            entitlement_groups=effective_entitlement_groups,
            visibility_scope=request.effective_visibility_scope(),
        ),
    ]
    if request.target_revision_track:
        must.append(
            qdrant_models.FieldCondition(
                key="revision_track",
                match=qdrant_models.MatchValue(value=request.target_revision_track),
            )
        )
    elif runtime_profile.serving_revision_tracks:
        must.append(
            qdrant_models.FieldCondition(
                key="revision_track",
                match=qdrant_models.MatchAny(any=list(runtime_profile.serving_revision_tracks)),
            )
        )
    if runtime_profile.current_only and not request.target_version_ids:
        must.append(
            qdrant_models.FieldCondition(
                key="is_current",
                match=qdrant_models.MatchValue(value=True),
            )
        )
    if request.target_document_ids:
        must.append(
            qdrant_models.FieldCondition(
                key="document_id",
                match=qdrant_models.MatchAny(any=list(request.target_document_ids)),
            )
        )
    if request.target_version_ids:
        must.append(
            qdrant_models.FieldCondition(
                key="version_id",
                match=qdrant_models.MatchAny(any=list(request.target_version_ids)),
            )
        )
    if request.canonical_course_ids:
        must.append(
            qdrant_models.FieldCondition(
                key="canonical_course_id",
                match=qdrant_models.MatchAny(any=list(request.canonical_course_ids)),
            )
        )
    if request.canonical_course_family_ids:
        must.append(
            qdrant_models.FieldCondition(
                key="canonical_course_family_id",
                match=qdrant_models.MatchAny(any=list(request.canonical_course_family_ids)),
            )
        )
    if request.canonical_program_family_ids:
        must.append(
            qdrant_models.FieldCondition(
                key="canonical_program_family_id",
                match=qdrant_models.MatchAny(any=list(request.canonical_program_family_ids)),
            )
        )
    return qdrant_models.Filter(must=must)


def _apply_preferred_document_bias(
    *,
    sources: Sequence[EvidenceSource],
    preferred_document_ids: tuple[str, ...],
) -> tuple[EvidenceSource, ...]:
    if not preferred_document_ids:
        return tuple(sources)
    preferred_set = {doc_id for doc_id in preferred_document_ids if doc_id}
    if not preferred_set:
        return tuple(sources)
    return tuple(
        sorted(
            sources,
            key=lambda source: (1 if source.doc_id in preferred_set else 0, source.score),
            reverse=True,
        )
    )


def _build_authorization_metadata_filter(
    *,
    entitlement_groups: tuple[str, ...],
    visibility_scope: str | None,
) -> MetadataFilters:
    filters: list[MetadataFilter | MetadataFilters] = [
        MetadataFilters(
            filters=[
                MetadataFilter(key="visibility_level", value="public"),
                _build_visibility_scope_metadata_filter(visibility_scope),
            ],
            condition=FilterCondition.AND,
        ),
    ]
    if entitlement_groups:
        filters.append(
            MetadataFilters(
                filters=[
                    MetadataFilter(key="visibility_level", value="restricted"),
                    MetadataFilter(
                        key="entitlement_groups",
                        value=list(entitlement_groups),
                        operator=FilterOperator.IN,
                    ),
                    _build_visibility_scope_metadata_filter(visibility_scope),
                ],
                condition=FilterCondition.AND,
            )
        )
    return MetadataFilters(filters=filters, condition=FilterCondition.OR)


def _build_visibility_scope_metadata_filter(
    visibility_scope: str | None,
) -> MetadataFilter | MetadataFilters:
    if visibility_scope is None:
        return MetadataFilter(key="visibility_scope", value=None, operator=FilterOperator.IS_EMPTY)
    return MetadataFilters(
        filters=[
            MetadataFilter(key="visibility_scope", value=None, operator=FilterOperator.IS_EMPTY),
            MetadataFilter(key="visibility_scope", value=visibility_scope),
        ],
        condition=FilterCondition.OR,
    )


def _build_authorization_qdrant_filter(
    *,
    entitlement_groups: tuple[str, ...],
    visibility_scope: str | None,
) -> qdrant_models.Filter:
    should: list[qdrant_models.Condition] = [
        qdrant_models.Filter(
            must=[
                qdrant_models.FieldCondition(
                    key="visibility_level",
                    match=qdrant_models.MatchValue(value="public"),
                ),
                _build_visibility_scope_qdrant_filter(visibility_scope),
            ]
        ),
    ]
    if entitlement_groups:
        should.append(
            qdrant_models.Filter(
                must=[
                    qdrant_models.FieldCondition(
                        key="visibility_level",
                        match=qdrant_models.MatchValue(value="restricted"),
                    ),
                    qdrant_models.FieldCondition(
                        key="entitlement_groups",
                        match=qdrant_models.MatchAny(any=list(entitlement_groups)),
                    ),
                    _build_visibility_scope_qdrant_filter(visibility_scope),
                ]
            )
        )
    return qdrant_models.Filter(should=should)


def _build_visibility_scope_qdrant_filter(visibility_scope: str | None) -> qdrant_models.Condition:
    if visibility_scope is None:
        return qdrant_models.IsEmptyCondition(
            is_empty=qdrant_models.PayloadField(key="visibility_scope")
        )
    return qdrant_models.Filter(
        should=[
            qdrant_models.IsEmptyCondition(
                is_empty=qdrant_models.PayloadField(key="visibility_scope")
            ),
            qdrant_models.FieldCondition(
                key="visibility_scope",
                match=qdrant_models.MatchValue(value=visibility_scope),
            ),
        ]
    )


def _record_has_restricted_visibility(record: DocumentRegistryRecord) -> bool:
    return (
        record.visibility_level == "restricted"
        or bool(record.entitlement_groups)
        or record.visibility_scope is not None
    )


def _build_source_scoped_qdrant_filter(
    *,
    request: RetrievalRequest,
    profile: CollectionRuntimeProfile,
    source: EvidenceSource,
) -> qdrant_models.Filter:
    base_filter = _build_qdrant_filter(request, profile=profile)
    return qdrant_models.Filter(
        must=[
            *(base_filter.must or []),
            qdrant_models.FieldCondition(
                key="document_id",
                match=qdrant_models.MatchValue(value=source.doc_id),
            ),
            qdrant_models.FieldCondition(
                key="revision_track",
                match=qdrant_models.MatchValue(value=source.revision_track),
            ),
            qdrant_models.FieldCondition(
                key="version_id",
                match=qdrant_models.MatchValue(value=source.version_id),
            ),
        ],
        should=base_filter.should,
        must_not=base_filter.must_not,
        min_should=base_filter.min_should,
    )
