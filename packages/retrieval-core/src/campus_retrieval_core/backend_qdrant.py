from __future__ import annotations

import time
from dataclasses import dataclass, field, replace
from typing import Callable, Sequence, TypeVar

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_ingestion_core.corpus_profiles import (
    CollectionRuntimeProfile,
    is_official_web_stable_reference_like_profile,
    load_runtime_profile,
)
from campus_ingestion_core.embed import EmbeddingSettings, build_embedding_model
from campus_ingestion_core.registry import (
    DocumentRegistry,
    build_document_registry_from_env,
)
from campus_ingestion_core.sparse import (
    SparseEmbeddingModel,
    SparseEmbeddingSettings,
    build_sparse_embedding_model,
)
from llama_index.core.schema import MetadataMode
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models
from qdrant_client.http.exceptions import ResponseHandlingException

from campus_retrieval_core.backend_qdrant_filters import (
    _apply_preferred_document_bias,
    _build_metadata_filters,
    _build_qdrant_filter,
    _build_source_scoped_qdrant_filter,
    _record_has_restricted_visibility,
)
from campus_retrieval_core.backend_qdrant_policies import (
    _OFFICIAL_WEB_STABLE_REFERENCE_QUERY_TERMS,
    _apply_document_diversity_policy,
    _apply_no_hit_policy,
    _apply_official_web_low_signal_policy,
    _normalize_low_signal_query,
    _official_web_source_chunk_ordinal,
)
from campus_retrieval_core.backend_qdrant_query import (
    _build_dense_query_text,
    _build_document_support_query_text,
    _build_rrf_query,
    _curriculum_support_section_key,
    _merge_evidence_sources,
    _prefer_curriculum_semester_course_list_sources,
)
from campus_retrieval_core.backend_qdrant_query import (
    _build_hybrid_prefetch as _build_hybrid_prefetch_impl,
)
from campus_retrieval_core.backend_qdrant_source_metadata import (
    _coerce_dict,
    _coerce_structural_path,
    _is_curriculum_course_list_table_source,
    _optional_bool,
    _optional_text,
    _record_to_text_node,
    _resolve_canonical_source_id,
    _resolve_canonical_source_title,
    _resolve_content_kind,
    _resolve_content_role,
    _resolve_detail_label,
    _resolve_is_answer_bearing,
    _resolve_source_title,
    _resolve_source_unit_key,
    _resolve_source_unit_kind,
)
from campus_retrieval_core.curriculum_query_resolution import (
    filter_curriculum_query_sources,
    interpret_curriculum_query,
)
from campus_retrieval_core.evidence_ranking import (
    prioritize_evidence_sources,
    query_targets_source_title,
)
from campus_retrieval_core.models import RetrievalRequest
from campus_retrieval_core.settings import RetrievalSettings

__all__ = ("_build_metadata_filters",)

DEFAULT_LATEST_REVISION_TRACKS = ("current-effective", "editorial", "source-faithful")
DEFAULT_DENSE_QUERY_CACHE_TTL_SECONDS = 300.0
_SCORE_TIE_EPSILON = 1e-6
_QDRANT_READ_RETRY_ATTEMPTS = 3
_QDRANT_READ_RETRY_BACKOFF_SECONDS = 0.5
_QDRANT_TRANSIENT_ERROR_TEXT = (
    "timed out",
    "timeout",
    "temporarily unavailable",
    "connection reset",
    "handshake",
)
_SAME_DOC_SCROLL_BATCH_LIMIT = 64
_SAME_DOC_SCROLL_MAX_RECORDS = 256
_RetryResult = TypeVar("_RetryResult")


def _build_hybrid_prefetch(
    *,
    request: RetrievalRequest,
    profile: CollectionRuntimeProfile,
    embedding_model: object,
    sparse_embedding_model: SparseEmbeddingModel,
    dense_query_embedding: Sequence[float] | None = None,
    query_filter: qdrant_models.Filter | None = None,
    build_qdrant_filter_fn=_build_qdrant_filter,
) -> list[qdrant_models.Prefetch]:
    return _build_hybrid_prefetch_impl(
        request=request,
        profile=profile,
        embedding_model=embedding_model,
        sparse_embedding_model=sparse_embedding_model,
        dense_query_embedding=dense_query_embedding,
        query_filter=query_filter,
        build_qdrant_filter_fn=build_qdrant_filter_fn,
    )


class RetrievalBackendError(RuntimeError):
    pass


class CorpusQueryDisabledError(RetrievalBackendError):
    pass


class RestrictedDocumentAccessDeniedError(RetrievalBackendError):
    pass


@dataclass
class QdrantRetrievalBackend:
    settings: RetrievalSettings
    registry: DocumentRegistry | None = None
    qdrant_client: QdrantClient | None = None
    embedding_model: object | None = None
    sparse_embedding_model: SparseEmbeddingModel | None = None
    dense_query_cache_ttl_seconds: float = DEFAULT_DENSE_QUERY_CACHE_TTL_SECONDS
    _dense_query_cache: dict[str, tuple[float, tuple[float, ...]]] = field(
        default_factory=dict, init=False
    )
    _known_collection_names: set[str] = field(default_factory=set, init=False)

    def __post_init__(self) -> None:
        self.registry = self.registry or build_document_registry_from_env(
            {"DOCUMENT_REGISTRY_DATABASE_URL": self.settings.document_registry_database_url}
        )
        self.qdrant_client = self.qdrant_client or _build_qdrant_client(self.settings)
        self.embedding_model = self.embedding_model or build_embedding_model(
            EmbeddingSettings(
                provider=self.settings.embedding_provider,
                model=self.settings.embedding_model,
                api_key=self.settings.embedding_api_key,
                api_base=self.settings.embedding_base_url,
                dimensions=self.settings.embedding_dimensions,
            )
        )
        self.sparse_embedding_model = self.sparse_embedding_model or build_sparse_embedding_model(
            SparseEmbeddingSettings(
                provider=self.settings.sparse_provider,
                model=self.settings.sparse_model,
                tokenizer=self.settings.sparse_tokenizer,
                language=self.settings.sparse_language,
            )
        )

    def retrieve(self, request: RetrievalRequest) -> EvidenceBundle:
        profile = load_runtime_profile(request.corpus, request.collection)
        if not profile.retrieval_enabled:
            raise CorpusQueryDisabledError(
                f"{request.corpus}/{request.collection} retrieval is disabled by runtime profile"
            )
        query_text = request.query_text.strip()
        if request.corpus == "curriculum" and request.collection == "curriculum_plan":
            query_text = interpret_curriculum_query(query_text).normalized_query_text
        if not query_text:
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
            )
        self._fail_closed_on_denied_target_documents(request=request, profile=profile)
        qdrant_collection_name = profile.qdrant_index_binding.alias_name
        try:
            if qdrant_collection_name not in self._known_collection_names:
                if not _retry_qdrant_read(
                    lambda: self.qdrant_client.collection_exists(qdrant_collection_name)
                ):
                    return EvidenceBundle(
                        query_text=request.query_text,
                        corpus=request.corpus,
                        collection=request.collection,
                    )
                self._known_collection_names.add(qdrant_collection_name)
            dense_query_embedding = self._get_dense_query_embedding(query_text, profile=profile)
            initial_query_limit = self._resolve_initial_query_limit(
                request=request, profile=profile
            )
            response = _retry_qdrant_read(
                lambda: self.qdrant_client.query_points(
                    collection_name=qdrant_collection_name,
                    prefetch=_build_hybrid_prefetch(
                        request=request,
                        profile=profile,
                        embedding_model=self.embedding_model,
                        sparse_embedding_model=self.sparse_embedding_model,
                        dense_query_embedding=dense_query_embedding,
                        build_qdrant_filter_fn=_build_qdrant_filter,
                    ),
                    query=_build_rrf_query(profile),
                    limit=initial_query_limit,
                    with_payload=True,
                    with_vectors=False,
                )
            )
        except Exception as exc:  # pragma: no cover - exercised by error mapping test
            raise RetrievalBackendError("qdrant retrieval failed") from exc

        initial_sources = _apply_no_hit_policy(
            profile=profile,
            query_text=query_text,
            sources=self._build_evidence_sources(response.points or ()),
        )
        initial_sources = _apply_official_web_low_signal_policy(
            profile=profile,
            query_text=query_text,
            sources=initial_sources,
        )
        ranked_sources = prioritize_evidence_sources(
            query_text=query_text,
            sources=initial_sources,
        )
        ranked_sources = _apply_preferred_document_bias(
            sources=ranked_sources,
            preferred_document_ids=request.preferred_document_ids,
        )
        expanded_sources = (
            tuple(ranked_sources)
            if not self._should_expand_named_document_support(
                request=request,
                profile=profile,
                sources=ranked_sources,
            )
            else self._expand_named_document_support(
                request=request,
                profile=profile,
                qdrant_collection_name=qdrant_collection_name,
                dense_query_embedding=dense_query_embedding,
                sources=ranked_sources,
            )
        )
        ranked_final_sources = prioritize_evidence_sources(
            query_text=query_text,
            sources=expanded_sources,
        )
        ranked_final_sources = _apply_preferred_document_bias(
            sources=ranked_final_sources,
            preferred_document_ids=request.preferred_document_ids,
        )
        ranked_final_sources = _prefer_curriculum_semester_course_list_sources(
            query_text=request.query_text,
            sources=ranked_final_sources,
        )
        return EvidenceBundle(
            query_text=request.query_text,
            corpus=request.corpus,
            collection=request.collection,
            sources=_apply_document_diversity_policy(
                profile=profile,
                query_text=query_text,
                sources=ranked_final_sources,
            )[: request.top_k],
        )

    def _build_evidence_sources(
        self, points: Sequence[qdrant_models.ScoredPoint]
    ) -> tuple[EvidenceSource, ...]:
        sources: list[EvidenceSource] = []
        for point in points:
            payload = dict(point.payload or {})
            node = _record_to_text_node(point.id, payload)
            if node is None:
                continue
            metadata = dict(node.metadata)
            document_id = str(metadata.get("document_id") or "")
            revision_track = str(metadata.get("revision_track") or "")
            version_id = str(metadata.get("version_id") or "")
            if not document_id or not revision_track or not version_id:
                continue
            anchor = _coerce_dict(metadata.get("anchor"))
            canonical_url = _optional_text(metadata.get("canonical_url")) or _optional_text(
                metadata.get("source_uri")
            )
            latest_url = _optional_text(metadata.get("latest_url")) or canonical_url
            source_channel = _optional_text(metadata.get("source_channel"))
            collection = _optional_text(metadata.get("collection"))
            is_current = _optional_bool(metadata.get("is_current"))
            if (
                canonical_url is None
                or latest_url is None
                or source_channel is None
                or collection is None
                or is_current is None
            ):
                record = self.registry.get(document_id, revision_track, version_id)
                if record is None:
                    continue
                runtime_profile = load_runtime_profile(record.corpus, record.collection)
                latest_record = self.registry.current_version(
                    document_id,
                    preferred_revision_tracks=runtime_profile.serving_revision_tracks
                    or DEFAULT_LATEST_REVISION_TRACKS,
                )
                canonical_url = canonical_url or record.source_uri
                latest_url = latest_url or (
                    latest_record.source_uri if latest_record is not None else record.source_uri
                )
                source_channel = source_channel or record.source_channel
                collection = collection or record.collection
                if is_current is None:
                    is_current = record.is_current
            source_title = _resolve_source_title(metadata, document_id=document_id, anchor=anchor)
            sources.append(
                EvidenceSource(
                    doc_id=document_id,
                    revision_track=revision_track,
                    version_id=version_id,
                    chunk_id=str(metadata.get("chunk_id") or node.node_id),
                    anchor=anchor,
                    canonical_url=canonical_url,
                    latest_url=latest_url,
                    source_channel=source_channel,
                    collection=collection,
                    is_current=is_current,
                    snippet=node.get_content(metadata_mode=MetadataMode.NONE),
                    score=float(point.score),
                    source_title=source_title,
                    structural_path=_coerce_structural_path(anchor.get("section_path")),
                    content_kind=_resolve_content_kind(
                        metadata,
                        collection=collection,
                        snippet=node.get_content(metadata_mode=MetadataMode.NONE),
                        anchor=anchor,
                    ),
                    content_role=_resolve_content_role(
                        metadata,
                        collection=collection,
                        snippet=node.get_content(metadata_mode=MetadataMode.NONE),
                        anchor=anchor,
                    ),
                    detail_label=_resolve_detail_label(metadata, anchor=anchor),
                    is_answer_bearing=_resolve_is_answer_bearing(
                        metadata,
                        collection=collection,
                        snippet=node.get_content(metadata_mode=MetadataMode.NONE),
                        anchor=anchor,
                    ),
                    canonical_source_id=_resolve_canonical_source_id(metadata),
                    canonical_source_title=_resolve_canonical_source_title(metadata),
                    source_unit_kind=_resolve_source_unit_kind(
                        metadata,
                        collection=collection,
                        anchor=anchor,
                    ),
                    source_unit_key=_resolve_source_unit_key(
                        metadata,
                        collection=collection,
                    ),
                )
            )
        return tuple(sources)

    def _build_evidence_sources_from_records(
        self,
        records: Sequence[qdrant_models.Record],
        *,
        default_score: float,
    ) -> tuple[EvidenceSource, ...]:
        return self._build_evidence_sources(
            tuple(
                qdrant_models.ScoredPoint(
                    id=record.id,
                    version=0,
                    score=default_score,
                    payload=record.payload,
                    vector=record.vector,
                    shard_key=record.shard_key,
                    order_value=record.order_value,
                )
                for record in records
            )
        )

    def _fail_closed_on_denied_target_documents(
        self,
        *,
        request: RetrievalRequest,
        profile: CollectionRuntimeProfile,
    ) -> None:
        if not request.target_document_ids:
            return

        denied_target_found = False
        for document_id in request.target_document_ids:
            record = self.registry.current_version(
                document_id,
                preferred_revision_tracks=profile.serving_revision_tracks
                or DEFAULT_LATEST_REVISION_TRACKS,
            )
            if record is None:
                continue
            if request.allows_document_access(
                visibility_level=record.visibility_level,
                entitlement_groups=record.entitlement_groups,
                visibility_scope=record.visibility_scope,
            ):
                continue
            if _record_has_restricted_visibility(record):
                denied_target_found = True

        if denied_target_found:
            raise RestrictedDocumentAccessDeniedError("restricted document access denied")

    def _get_dense_query_embedding(
        self,
        query_text: str,
        *,
        profile: CollectionRuntimeProfile,
    ) -> tuple[float, ...]:
        normalized_query = _build_dense_query_text(
            query_text=query_text,
            instruction=profile.embedding_query_instruction,
        )
        now = time.monotonic()
        cached = self._dense_query_cache.get(normalized_query)
        if cached is not None:
            expires_at, embedding = cached
            if expires_at > now:
                return embedding
        embedding = tuple(
            float(item) for item in self.embedding_model.get_query_embedding(normalized_query)
        )
        self._dense_query_cache[normalized_query] = (
            now + self.dense_query_cache_ttl_seconds,
            embedding,
        )
        return embedding

    def _resolve_initial_query_limit(
        self,
        *,
        request: RetrievalRequest,
        profile: CollectionRuntimeProfile,
    ) -> int:
        if self._should_use_targeted_document_overfetch(request=request, profile=profile):
            return max(request.top_k, profile.document_support_limit)
        return request.top_k

    def _should_expand_named_document_support(
        self,
        *,
        request: RetrievalRequest,
        profile: CollectionRuntimeProfile,
        sources: Sequence[EvidenceSource],
    ) -> bool:
        if not self._should_use_targeted_document_overfetch(request=request, profile=profile):
            return True
        return self._should_expand_narrow_curriculum_targeted_support(
            request=request,
            sources=sources,
        )

    def _should_use_targeted_document_overfetch(
        self,
        *,
        request: RetrievalRequest,
        profile: CollectionRuntimeProfile,
    ) -> bool:
        if profile.document_support_strategy != "targeted_overfetch":
            return False
        return (
            bool(request.target_document_ids) and len(frozenset(request.target_document_ids)) == 1
        )

    def _should_expand_narrow_curriculum_targeted_support(
        self,
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
        self,
        *,
        request: RetrievalRequest,
        profile: CollectionRuntimeProfile,
        qdrant_collection_name: str,
        dense_query_embedding: Sequence[float],
        sources: Sequence[EvidenceSource],
    ) -> tuple[EvidenceSource, ...]:
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
        support_request = replace(request, query_text=support_query_text)
        try:
            support_dense_query_embedding = self._get_dense_query_embedding(
                support_request.query_text,
                profile=profile,
            )
            source_scoped_filter = _build_source_scoped_qdrant_filter(
                request=support_request,
                profile=profile,
                source=target_source,
            )
            response = _retry_qdrant_read(
                lambda: self.qdrant_client.query_points(
                    collection_name=qdrant_collection_name,
                    prefetch=_build_hybrid_prefetch(
                        request=support_request,
                        profile=profile,
                        embedding_model=self.embedding_model,
                        sparse_embedding_model=self.sparse_embedding_model,
                        dense_query_embedding=support_dense_query_embedding,
                        query_filter=source_scoped_filter,
                        build_qdrant_filter_fn=_build_qdrant_filter,
                    ),
                    query=_build_rrf_query(profile),
                    limit=max(support_request.top_k, profile.document_support_limit),
                    with_payload=True,
                    with_vectors=False,
                )
            )
        except Exception:
            return tuple(sources)
        additional_sources = self._build_evidence_sources(response.points or ())
        curriculum_semester_sources = self._supplement_curriculum_same_doc_semester_sources(
            request=request,
            qdrant_collection_name=qdrant_collection_name,
            source_scoped_filter=source_scoped_filter,
            default_score=target_source.score,
        )
        merged_sources = _merge_evidence_sources(
            preferred=sources,
            additional=_merge_evidence_sources(
                preferred=additional_sources,
                additional=curriculum_semester_sources,
            ),
        )
        return self._recover_official_web_lead_chunk_support(
            request=request,
            profile=profile,
            qdrant_collection_name=qdrant_collection_name,
            target_source=target_source,
            sources=merged_sources,
        )

    def _supplement_curriculum_same_doc_semester_sources(
        self,
        *,
        request: RetrievalRequest,
        qdrant_collection_name: str,
        source_scoped_filter: qdrant_models.Filter,
        default_score: float,
    ) -> tuple[EvidenceSource, ...]:
        if request.corpus != "curriculum" or request.collection != "curriculum_plan":
            return ()
        interpretation = interpret_curriculum_query(request.query_text)
        if interpretation.intent_kind != "course_list" or not interpretation.semester_labels:
            return ()

        offset: int | str | None = None
        records: list[qdrant_models.Record] = []
        while len(records) < _SAME_DOC_SCROLL_MAX_RECORDS:
            remaining = _SAME_DOC_SCROLL_MAX_RECORDS - len(records)
            limit = min(_SAME_DOC_SCROLL_BATCH_LIMIT, remaining)
            try:
                batch, offset = _retry_qdrant_read(
                    lambda: self.qdrant_client.scroll(
                        collection_name=qdrant_collection_name,
                        scroll_filter=source_scoped_filter,
                        limit=limit,
                        offset=offset,
                        with_payload=True,
                        with_vectors=False,
                    )
                )
            except Exception:
                return ()
            if not batch:
                break
            records.extend(batch)
            if offset is None:
                break

        same_doc_sources = self._build_evidence_sources_from_records(
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

    def _recover_official_web_lead_chunk_support(
        self,
        *,
        request: RetrievalRequest,
        profile: CollectionRuntimeProfile,
        qdrant_collection_name: str,
        target_source: EvidenceSource,
        sources: tuple[EvidenceSource, ...],
    ) -> tuple[EvidenceSource, ...]:
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
            scrolled_records, _ = self.qdrant_client.scroll(
                collection_name=qdrant_collection_name,
                scroll_filter=_build_source_scoped_qdrant_filter(
                    request=request,
                    profile=profile,
                    source=target_source,
                ),
                limit=max(profile.document_support_limit, 8),
                with_payload=True,
                with_vectors=False,
            )
        except Exception:
            return sources
        if not scrolled_records:
            return sources
        lead_sources = tuple(
            sorted(
                self._build_evidence_sources(
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
                    )
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


def _build_qdrant_client(settings: RetrievalSettings) -> QdrantClient:
    if settings.qdrant_url == ":memory:":
        return QdrantClient(location=":memory:")
    return QdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key,
        timeout=settings.qdrant_timeout_seconds,
        cloud_inference=True,
        check_compatibility=False,
        trust_env=False,
    )


def _retry_qdrant_read(operation: Callable[[], _RetryResult]) -> _RetryResult:
    last_error: ResponseHandlingException | None = None
    for attempt in range(1, _QDRANT_READ_RETRY_ATTEMPTS + 1):
        try:
            return operation()
        except ResponseHandlingException as exc:
            if (
                not _looks_like_transient_qdrant_error(exc)
                or attempt >= _QDRANT_READ_RETRY_ATTEMPTS
            ):
                raise
            last_error = exc
            time.sleep(_QDRANT_READ_RETRY_BACKOFF_SECONDS * attempt)
    if last_error is not None:
        raise last_error
    raise RuntimeError("retry helper exhausted without result")


def _looks_like_transient_qdrant_error(error: ResponseHandlingException) -> bool:
    normalized = str(error).strip().lower()
    return any(fragment in normalized for fragment in _QDRANT_TRANSIENT_ERROR_TEXT)
