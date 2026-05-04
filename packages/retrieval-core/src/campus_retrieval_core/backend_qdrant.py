from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass, field
from threading import RLock

from campus_contracts import EvidenceBundle
from campus_ingestion_core.corpus_profiles import load_runtime_profile
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

from campus_retrieval_core.backend_qdrant_access import _fail_closed_on_denied_target_documents
from campus_retrieval_core.backend_qdrant_curriculum_rescue import (
    rescue_curriculum_title_sources,
)
from campus_retrieval_core.backend_qdrant_document_support import (
    _expand_named_document_support,
    _resolve_initial_query_limit,
    _should_expand_named_document_support,
)
from campus_retrieval_core.backend_qdrant_embeddings import get_dense_query_embedding
from campus_retrieval_core.backend_qdrant_errors import (
    CorpusQueryDisabledError,
    RestrictedDocumentAccessDeniedError,
    RetrievalBackendError,
)
from campus_retrieval_core.backend_qdrant_evidence import (
    build_evidence_sources,
)
from campus_retrieval_core.backend_qdrant_filters import (
    _apply_preferred_document_bias,
    _build_metadata_filters,
    _build_qdrant_filter,
)
from campus_retrieval_core.backend_qdrant_policies import (
    _apply_document_diversity_policy,
    _apply_no_hit_policy,
    _apply_official_web_low_signal_policy,
    finalize_retrieval_sources,
)
from campus_retrieval_core.backend_qdrant_query import (
    _build_document_support_query_text,
    _build_rrf_query,
    _prefer_curriculum_semester_course_list_sources,
)
from campus_retrieval_core.backend_qdrant_release_guard import validate_alias_release_metadata
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
from campus_retrieval_core.curriculum_query_resolution import interpret_curriculum_query
from campus_retrieval_core.evidence_ranking import (
    prioritize_evidence_sources,
)
from campus_retrieval_core.models import RetrievalRequest
from campus_retrieval_core.settings import RetrievalSettings

__all__ = (
    "CorpusQueryDisabledError",
    "QdrantRetrievalBackend",
    "RestrictedDocumentAccessDeniedError",
    "RetrievalBackendError",
    "_apply_document_diversity_policy",
    "_apply_no_hit_policy",
    "_apply_official_web_low_signal_policy",
    "_apply_preferred_document_bias",
    "_build_document_support_query_text",
    "_build_hybrid_prefetch",
    "_build_metadata_filters",
    "_build_qdrant_client",
    "_build_qdrant_filter",
    "_build_rrf_query",
    "_prefer_curriculum_semester_course_list_sources",
)


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
    release_drift_guard_cache_ttl_seconds: float = 60.0
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
    _release_drift_guard_cache: OrderedDict[str, tuple[float, str, str, str]] = field(
        default_factory=OrderedDict, init=False
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
        _fail_closed_on_denied_target_documents(self, request=request, profile=profile)
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
            validate_alias_release_metadata(
                self,
                collection_name=qdrant_collection_name,
                profile=profile,
                settings=self.settings,
                timeout_seconds=deadline.qdrant_timeout_seconds(),
            )
            dense_query_embedding = get_dense_query_embedding(self, query_text, profile=profile)
            initial_query_limit = _resolve_initial_query_limit(request=request, profile=profile)
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
        except RetrievalBackendError:
            raise
        except Exception as exc:  # pragma: no cover - exercised by error mapping test
            raise RetrievalBackendError("qdrant retrieval failed") from exc

        raw_sources = build_evidence_sources(self, response.points or ())
        rescued_sources = rescue_curriculum_title_sources(
            self,
            request=request,
            profile=profile,
            qdrant_collection_name=qdrant_collection_name,
            sources=raw_sources,
            timeout_seconds=deadline.qdrant_timeout_seconds(),
        )
        initial_sources = _apply_no_hit_policy(
            profile=profile,
            query_text=query_text,
            sources=rescued_sources,
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
            if not _should_expand_named_document_support(
                request=request,
                profile=profile,
                sources=ranked_sources,
            )
            else _expand_named_document_support(
                self,
                request=request,
                profile=profile,
                qdrant_collection_name=qdrant_collection_name,
                sources=ranked_sources,
                deadline=deadline,
            )
        )
        ranked_final_sources = finalize_retrieval_sources(
            profile=profile,
            query_text=query_text,
            sources=expanded_sources,
            preferred_document_ids=request.preferred_document_ids,
        )
        return EvidenceBundle(
            query_text=request.query_text,
            corpus=request.corpus,
            collection=request.collection,
            sources=ranked_final_sources[: request.top_k],
        )
