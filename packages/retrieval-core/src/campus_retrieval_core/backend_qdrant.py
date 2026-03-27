from __future__ import annotations

from dataclasses import dataclass, field
import time
from typing import Iterable, Sequence

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_ingestion_core.corpus_profiles import load_runtime_profile
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
from llama_index.core.schema import MetadataMode, TextNode
from llama_index.core.vector_stores import FilterCondition, FilterOperator, MetadataFilter, MetadataFilters
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

from campus_retrieval_core.models import RetrievalRequest
from campus_retrieval_core.settings import RetrievalSettings

DEFAULT_LATEST_REVISION_TRACKS = ("current-effective", "editorial", "source-faithful")
DEFAULT_HYBRID_CANDIDATE_MULTIPLIER = 4
DEFAULT_DENSE_QUERY_CACHE_TTL_SECONDS = 300.0


class RetrievalBackendError(RuntimeError):
    pass


class CorpusQueryDisabledError(RetrievalBackendError):
    pass


@dataclass
class QdrantRetrievalBackend:
    settings: RetrievalSettings
    registry: DocumentRegistry | None = None
    qdrant_client: QdrantClient | None = None
    embedding_model: object | None = None
    sparse_embedding_model: SparseEmbeddingModel | None = None
    dense_query_cache_ttl_seconds: float = DEFAULT_DENSE_QUERY_CACHE_TTL_SECONDS
    _dense_query_cache: dict[str, tuple[float, tuple[float, ...]]] = field(default_factory=dict, init=False)

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
                f"{request.corpus}/{request.collection} retrieval is disabled in phase-1"
            )
        query_text = request.query_text.strip()
        if not query_text:
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
            )
        if not self.qdrant_client.collection_exists(self.settings.qdrant_collection):
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
            )

        try:
            dense_query_embedding = self._get_dense_query_embedding(query_text)
            response = self.qdrant_client.query_points(
                collection_name=self.settings.qdrant_collection,
                prefetch=_build_hybrid_prefetch(
                    request=request,
                    embedding_model=self.embedding_model,
                    sparse_embedding_model=self.sparse_embedding_model,
                    dense_query_embedding=dense_query_embedding,
                ),
                query=qdrant_models.FusionQuery(fusion=qdrant_models.Fusion.RRF),
                limit=request.top_k,
                with_payload=True,
                with_vectors=False,
            )
        except Exception as exc:  # pragma: no cover - exercised by error mapping test
            raise RetrievalBackendError("qdrant retrieval failed") from exc

        return EvidenceBundle(
            query_text=request.query_text,
            corpus=request.corpus,
            collection=request.collection,
            sources=self._build_evidence_sources(response.points or ()),
        )

    def _build_evidence_sources(self, points: Sequence[qdrant_models.ScoredPoint]) -> tuple[EvidenceSource, ...]:
        sources: list[EvidenceSource] = []
        for point in points:
            payload = dict(point.payload or {})
            node = _record_to_text_node(point.id, payload)
            if node is None:
                continue
            metadata = dict(node.metadata)
            document_id = str(metadata.get("document_id") or "")
            revision_track = str(metadata.get("revision_track") or metadata.get("representation") or "")
            version_id = str(metadata.get("version_id") or "")
            if not document_id or not revision_track or not version_id:
                continue
            record = self.registry.get(document_id, revision_track, version_id)
            if record is None:
                continue
            latest_record = self.registry.current_version(
                document_id,
                preferred_revision_tracks=DEFAULT_LATEST_REVISION_TRACKS,
            )
            sources.append(
                EvidenceSource(
                    doc_id=document_id,
                    revision_track=revision_track,
                    version_id=version_id,
                    chunk_id=str(metadata.get("chunk_id") or node.node_id),
                    anchor=_coerce_dict(metadata.get("anchor")),
                    acl_level=str(metadata.get("acl_level") or "public"),
                    canonical_url=record.source_uri,
                    latest_url=(latest_record.source_uri if latest_record is not None else record.source_uri),
                    source_channel=str(metadata.get("source_channel") or record.source_channel),
                    collection=str(metadata.get("collection") or record.collection),
                    is_current=bool(metadata.get("is_current", record.is_current)),
                    snippet=node.get_content(metadata_mode=MetadataMode.NONE),
                    score=float(point.score),
                )
            )
        return tuple(sources)

    def _get_dense_query_embedding(self, query_text: str) -> tuple[float, ...]:
        normalized_query = query_text.strip()
        now = time.monotonic()
        cached = self._dense_query_cache.get(normalized_query)
        if cached is not None:
            expires_at, embedding = cached
            if expires_at > now:
                return embedding
        embedding = tuple(float(item) for item in self.embedding_model.get_query_embedding(normalized_query))
        self._dense_query_cache[normalized_query] = (now + self.dense_query_cache_ttl_seconds, embedding)
        return embedding


def _candidate_limit(top_k: int) -> int:
    return max(top_k * DEFAULT_HYBRID_CANDIDATE_MULTIPLIER, top_k)


def _build_hybrid_prefetch(
    *,
    request: RetrievalRequest,
    embedding_model: object,
    sparse_embedding_model: SparseEmbeddingModel,
    dense_query_embedding: Sequence[float] | None = None,
) -> list[qdrant_models.Prefetch]:
    limit = _candidate_limit(request.top_k)
    query_filter = _build_qdrant_filter(request)
    prefetch = [
        qdrant_models.Prefetch(
            query=list(dense_query_embedding or embedding_model.get_query_embedding(request.query_text.strip())),
            using="dense",
            filter=query_filter,
            limit=limit,
        )
    ]
    sparse_query = sparse_embedding_model.get_query_embedding(request.query_text.strip()).to_qdrant()
    if sparse_query.indices:
        prefetch.append(
            qdrant_models.Prefetch(
                query=sparse_query,
                using="sparse",
                filter=query_filter,
                limit=limit,
            )
        )
    return prefetch


def _record_to_text_node(point_id: object, payload: dict[str, object]) -> TextNode | None:
    node_content = payload.get("_node_content")
    if isinstance(node_content, str):
        parsed = TextNode.model_validate_json(node_content)
        if parsed.metadata:
            return parsed

    text = _coerce_text_payload(payload)
    if not text:
        return None
    return TextNode(
        id_=str(point_id),
        text=text,
        metadata=payload,
    )


def _coerce_text_payload(payload: dict[str, object]) -> str:
    for key in ("text", "display_text", "snippet"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return ""


def _build_qdrant_client(settings: RetrievalSettings) -> QdrantClient:
    if settings.qdrant_url == ":memory:":
        return QdrantClient(location=":memory:")
    return QdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key,
        timeout=settings.qdrant_timeout_seconds,
    )


def _build_metadata_filters(request: RetrievalRequest) -> MetadataFilters:
    filters: list[MetadataFilter | MetadataFilters] = [
        MetadataFilter(key="corpus", value=request.corpus),
        MetadataFilter(key="collection", value=request.collection),
    ]
    filters.append(
        MetadataFilters(
            filters=[
                MetadataFilter(key="acl_level", value="public"),
                MetadataFilter(
                    key="acl_groups",
                    value=list(request.acl_groups),
                    operator=FilterOperator.IN,
                ),
            ],
            condition=FilterCondition.OR,
        )
    )
    if request.campus_scope is not None:
        filters.append(
            MetadataFilters(
                filters=[
                    MetadataFilter(key="campus_scope", value=None, operator=FilterOperator.IS_EMPTY),
                    MetadataFilter(key="campus_scope", value=request.campus_scope),
                ],
                condition=FilterCondition.OR,
            )
        )
    return MetadataFilters(filters=filters, condition=FilterCondition.AND)


def _build_qdrant_filter(request: RetrievalRequest) -> qdrant_models.Filter:
    must: list[qdrant_models.Condition] = [
        qdrant_models.FieldCondition(
            key="corpus",
            match=qdrant_models.MatchValue(value=request.corpus),
        ),
        qdrant_models.FieldCondition(
            key="collection",
            match=qdrant_models.MatchValue(value=request.collection),
        ),
        qdrant_models.Filter(
            should=[
                qdrant_models.FieldCondition(
                    key="acl_level",
                    match=qdrant_models.MatchValue(value="public"),
                ),
                qdrant_models.FieldCondition(
                    key="acl_groups",
                    match=qdrant_models.MatchAny(any=list(request.acl_groups)),
                ),
            ]
        ),
    ]
    if request.campus_scope is not None:
        must.append(
            qdrant_models.Filter(
                should=[
                    qdrant_models.IsEmptyCondition(is_empty=qdrant_models.PayloadField(key="campus_scope")),
                    qdrant_models.FieldCondition(
                        key="campus_scope",
                        match=qdrant_models.MatchValue(value=request.campus_scope),
                    ),
                ]
            )
        )
    return qdrant_models.Filter(must=must)


def _coerce_dict(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}
