from __future__ import annotations

from collections import OrderedDict
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from threading import RLock

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_ingestion_core.corpus_profiles import (
    CollectionRuntimeProfile,
    is_official_web_stable_reference_like_profile,
    load_runtime_profile,
)
from campus_ingestion_core.embed import EmbeddingSettings, build_embedding_model
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.registry import (
    DocumentRegistry,
    build_document_registry_from_env,
)
from campus_ingestion_core.sparse import (
    SparseEmbeddingModel,
    SparseEmbeddingSettings,
    build_sparse_embedding_model,
)
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

from campus_retrieval_core.backend_qdrant_embeddings import get_dense_query_embedding
from campus_retrieval_core.backend_qdrant_errors import (
    CorpusQueryDisabledError,
    RestrictedDocumentAccessDeniedError,
    RetrievalBackendError,
)
from campus_retrieval_core.backend_qdrant_evidence import (
    build_evidence_sources,
    build_evidence_sources_from_records,
)
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
    _build_document_support_query_text,
    _build_rrf_query,
    _curriculum_support_section_key,
    _merge_evidence_sources,
    _prefer_curriculum_semester_course_list_sources,
)
from campus_retrieval_core.backend_qdrant_registry import get_current_registry_version
from campus_retrieval_core.backend_qdrant_runtime import (
    DEFAULT_DENSE_QUERY_CACHE_MAX_ENTRIES,
    DEFAULT_DENSE_QUERY_CACHE_TTL_SECONDS,
    DEFAULT_REGISTRY_LOOKUP_CACHE_MAX_ENTRIES,
    DEFAULT_REGISTRY_LOOKUP_CACHE_TTL_SECONDS,
    _build_hybrid_prefetch,
    _build_qdrant_client,
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
from campus_retrieval_core.evidence_ranking import (
    prioritize_evidence_sources,
    query_targets_source_title,
)
from campus_retrieval_core.models import RetrievalRequest
from campus_retrieval_core.settings import RetrievalSettings

__all__ = ("_build_metadata_filters",)
DEFAULT_LATEST_REVISION_TRACKS = ("current-effective", "editorial", "source-faithful")
_SCORE_TIE_EPSILON = 1e-6
_SAME_DOC_SCROLL_BATCH_LIMIT = 64
_SAME_DOC_SCROLL_MAX_RECORDS = 256


@dataclass
class QdrantRetrievalBackend:
    settings: RetrievalSettings
    registry: DocumentRegistry | None = None
    qdrant_client: QdrantClient | None = None
    embedding_model: object | None = None
    sparse_embedding_model: SparseEmbeddingModel | None = None
    dense_query_cache_ttl_seconds: float = DEFAULT_DENSE_QUERY_CACHE_TTL_SECONDS
    dense_query_cache_max_entries: int = DEFAULT_DENSE_QUERY_CACHE_MAX_ENTRIES
    registry_lookup_cache_ttl_seconds: float = DEFAULT_REGISTRY_LOOKUP_CACHE_TTL_SECONDS
    registry_lookup_cache_max_entries: int = DEFAULT_REGISTRY_LOOKUP_CACHE_MAX_ENTRIES
    _dense_query_cache: OrderedDict[str, tuple[float, tuple[float, ...]]] = field(
        default_factory=OrderedDict, init=False
    )
    _dense_query_cache_lock: RLock = field(default_factory=RLock, init=False, repr=False)
    _registry_record_cache: OrderedDict[
        tuple[str, str, str], tuple[float, DocumentRegistryRecord | None]
    ] = field(default_factory=OrderedDict, init=False)
    _registry_current_version_cache: OrderedDict[
        tuple[str, tuple[str, ...]], tuple[float, DocumentRegistryRecord | None]
    ] = field(default_factory=OrderedDict, init=False)
    _registry_cache_lock: RLock = field(default_factory=RLock, init=False, repr=False)
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
        deadline = _RetrievalDeadline.from_timeout_ms(request.timeout_ms)
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
                    lambda: self.qdrant_client.collection_exists(qdrant_collection_name),
                    deadline=deadline,
                ):
                    return EvidenceBundle(
                        query_text=request.query_text,
                        corpus=request.corpus,
                        collection=request.collection,
                    )
                self._known_collection_names.add(qdrant_collection_name)
            dense_query_embedding = get_dense_query_embedding(self, query_text, profile=profile)
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
                    timeout=deadline.qdrant_timeout_seconds(),
                ),
                deadline=deadline,
            )
        except Exception as exc:  # pragma: no cover - exercised by error mapping test
            raise RetrievalBackendError("qdrant retrieval failed") from exc

        initial_sources = _apply_no_hit_policy(
            profile=profile,
            query_text=query_text,
            sources=build_evidence_sources(self, response.points or ()),
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
                deadline=deadline,
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
            record = get_current_registry_version(
                self,
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
        support_request = replace(request, query_text=support_query_text)
        try:
            support_dense_query_embedding = get_dense_query_embedding(
                self,
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
                    timeout=deadline.qdrant_timeout_seconds(),
                ),
                deadline=deadline,
            )
        except Exception:
            return tuple(sources)
        if deadline.is_expired():
            return tuple(sources)
        additional_sources = build_evidence_sources(self, response.points or ())
        curriculum_semester_sources = self._supplement_curriculum_same_doc_semester_sources(
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
        return self._recover_official_web_lead_chunk_support(
            request=request,
            profile=profile,
            qdrant_collection_name=qdrant_collection_name,
            target_source=target_source,
            sources=merged_sources,
            deadline=deadline,
        )

    def _supplement_curriculum_same_doc_semester_sources(
        self,
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
                    lambda limit=limit, offset=offset: self.qdrant_client.scroll(
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
            self,
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
                lambda: self.qdrant_client.scroll(
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
                    self,
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
