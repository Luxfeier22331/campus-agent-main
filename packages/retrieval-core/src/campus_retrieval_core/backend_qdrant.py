from __future__ import annotations

from dataclasses import dataclass
import math
import re
from typing import Iterable, Sequence

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.embed import EmbeddingSettings, build_embedding_model
from campus_ingestion_core.registry import (
    DocumentRegistry,
    build_document_registry_from_env,
)
from llama_index.core.schema import MetadataMode, TextNode
from llama_index.core.vector_stores import FilterCondition, FilterOperator, MetadataFilter, MetadataFilters
from llama_index.core.vector_stores.types import VectorStoreQuery
from llama_index.vector_stores.qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models

from campus_retrieval_core.models import RetrievalRequest
from campus_retrieval_core.settings import RetrievalSettings

DEFAULT_LATEST_REVISION_TRACKS = ("current-effective", "editorial", "source-faithful")
DEFAULT_HYBRID_CANDIDATE_MULTIPLIER = 4
DEFAULT_RRF_K = 60
_LEXICAL_TOKEN_RE = re.compile(r"[\w\u4e00-\u9fff]+", re.UNICODE)


class RetrievalBackendError(RuntimeError):
    pass


class CorpusQueryDisabledError(RetrievalBackendError):
    pass


@dataclass(frozen=True, slots=True)
class RetrievalCandidate:
    node: TextNode
    score: float
    retrieval_mode: str


@dataclass
class QdrantRetrievalBackend:
    settings: RetrievalSettings
    registry: DocumentRegistry | None = None
    qdrant_client: QdrantClient | None = None
    embedding_model: object | None = None

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
        self._vector_store = QdrantVectorStore(
            collection_name=self.settings.qdrant_collection,
            client=self.qdrant_client,
        )
        if self.qdrant_client.collection_exists(self.settings.qdrant_collection):
            self._vector_store._detect_vector_format(self.settings.qdrant_collection)

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
            dense_candidates = self._retrieve_dense_candidates(request)
            sparse_candidates = self._retrieve_sparse_candidates(request)
            fused_candidates = self._fuse_candidates_rrf(
                dense_candidates=dense_candidates,
                sparse_candidates=sparse_candidates,
                top_k=request.top_k,
            )
        except Exception as exc:  # pragma: no cover - exercised by error mapping test
            raise RetrievalBackendError("qdrant retrieval failed") from exc

        return EvidenceBundle(
            query_text=request.query_text,
            corpus=request.corpus,
            collection=request.collection,
            sources=self._build_evidence_sources(fused_candidates),
        )

    def _retrieve_dense_candidates(self, request: RetrievalRequest) -> tuple[RetrievalCandidate, ...]:
        if self._vector_store._legacy_vector_format is None:
            self._vector_store._detect_vector_format(self.settings.qdrant_collection)

        query_embedding = self.embedding_model.get_query_embedding(request.query_text.strip())
        query = VectorStoreQuery(
            query_embedding=query_embedding,
            query_str=request.query_text,
            similarity_top_k=_candidate_limit(request.top_k),
            filters=_build_metadata_filters(request),
        )
        result = self._vector_store.query(query)
        nodes = result.nodes or ()
        similarities = result.similarities or [1.0] * len(nodes)
        return tuple(
            RetrievalCandidate(
                node=node,
                score=float(similarity),
                retrieval_mode="dense",
            )
            for node, similarity in zip(nodes, similarities)
        )

    def _retrieve_sparse_candidates(self, request: RetrievalRequest) -> tuple[RetrievalCandidate, ...]:
        query_tokens = _tokenize_lexical_query(request.query_text)
        if not query_tokens:
            return ()

        try:
            records, _ = self.qdrant_client.scroll(
                collection_name=self.settings.qdrant_collection,
                scroll_filter=_build_qdrant_filter(request),
                limit=max(_candidate_limit(request.top_k) * 8, 32),
                with_payload=True,
                with_vectors=False,
            )
        except ValueError:
            return ()

        candidates: list[RetrievalCandidate] = []
        for record in records:
            payload = dict(record.payload or {})
            node = _record_to_text_node(record.id, payload)
            if node is None:
                continue
            score = _lexical_score(query_tokens=query_tokens, node=node)
            if score <= 0:
                continue
            candidates.append(
                RetrievalCandidate(
                    node=node,
                    score=score,
                    retrieval_mode="sparse",
                )
            )

        candidates.sort(key=lambda candidate: candidate.score, reverse=True)
        return tuple(candidates[: _candidate_limit(request.top_k)])

    def _fuse_candidates_rrf(
        self,
        *,
        dense_candidates: Sequence[RetrievalCandidate],
        sparse_candidates: Sequence[RetrievalCandidate],
        top_k: int,
    ) -> tuple[RetrievalCandidate, ...]:
        ranked_lists = [dense_candidates, sparse_candidates]
        fused_scores: dict[str, float] = {}
        chosen_candidates: dict[str, RetrievalCandidate] = {}

        for ranked in ranked_lists:
            for rank, candidate in enumerate(ranked, start=1):
                candidate_id = _candidate_identity(candidate)
                fused_scores[candidate_id] = fused_scores.get(candidate_id, 0.0) + 1.0 / (DEFAULT_RRF_K + rank)
                existing = chosen_candidates.get(candidate_id)
                if existing is None or candidate.score > existing.score:
                    chosen_candidates[candidate_id] = candidate

        ordered = sorted(
            chosen_candidates.items(),
            key=lambda item: (
                fused_scores[item[0]],
                item[1].score,
            ),
            reverse=True,
        )
        return tuple(candidate for _, candidate in ordered[:top_k])

    def _build_evidence_sources(self, candidates: Sequence[RetrievalCandidate]) -> tuple[EvidenceSource, ...]:
        sources: list[EvidenceSource] = []
        for candidate in candidates:
            metadata = dict(candidate.node.metadata)
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
                    chunk_id=str(metadata.get("chunk_id") or candidate.node.node_id),
                    anchor=_coerce_dict(metadata.get("anchor")),
                    acl_level=str(metadata.get("acl_level") or "public"),
                    canonical_url=record.source_uri,
                    latest_url=(latest_record.source_uri if latest_record is not None else record.source_uri),
                    source_channel=str(metadata.get("source_channel") or record.source_channel),
                    collection=str(metadata.get("collection") or record.collection),
                    is_current=bool(metadata.get("is_current", record.is_current)),
                    snippet=candidate.node.get_content(metadata_mode=MetadataMode.NONE),
                    score=float(candidate.score),
                )
            )
        return tuple(sources)


def _candidate_limit(top_k: int) -> int:
    return max(top_k * DEFAULT_HYBRID_CANDIDATE_MULTIPLIER, top_k)


def _candidate_identity(candidate: RetrievalCandidate) -> str:
    metadata = dict(candidate.node.metadata)
    chunk_id = str(metadata.get("chunk_id") or "")
    if chunk_id:
        return chunk_id
    document_id = str(metadata.get("document_id") or candidate.node.node_id)
    version_id = str(metadata.get("version_id") or "")
    return f"{document_id}:{version_id}:{candidate.node.node_id}"


def _tokenize_lexical_query(text: str) -> tuple[str, ...]:
    return tuple(token.lower() for token in _LEXICAL_TOKEN_RE.findall(text))


def _lexical_score(*, query_tokens: Sequence[str], node: TextNode) -> float:
    content = node.get_content(metadata_mode=MetadataMode.NONE).lower()
    score = 0.0
    for token in query_tokens:
        count = content.count(token)
        if count:
            score += 1.0 + math.log1p(count)
    return score


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
