from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.embed import EmbeddingSettings, build_embedding_model
from campus_ingestion_core.registry import (
    DocumentRegistry,
    build_document_registry_from_env,
)
from llama_index.core.schema import MetadataMode
from llama_index.core.vector_stores import FilterCondition, FilterOperator, MetadataFilter, MetadataFilters
from llama_index.core.vector_stores.types import VectorStoreQuery
from llama_index.vector_stores.qdrant import QdrantVectorStore
from qdrant_client import QdrantClient

from campus_retrieval_core.models import RetrievalRequest
from campus_retrieval_core.settings import RetrievalSettings

DEFAULT_LATEST_REVISION_TRACKS = ("current-effective", "editorial", "source-faithful")


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
            if self._vector_store._legacy_vector_format is None:
                self._vector_store._detect_vector_format(self.settings.qdrant_collection)
            query_embedding = self.embedding_model.get_query_embedding(query_text)
            query = VectorStoreQuery(
                query_embedding=query_embedding,
                query_str=query_text,
                similarity_top_k=request.top_k,
                filters=_build_metadata_filters(request),
            )
            result = self._vector_store.query(query)
        except Exception as exc:  # pragma: no cover - exercised by error mapping test
            raise RetrievalBackendError("qdrant retrieval failed") from exc

        sources: list[EvidenceSource] = []
        nodes = result.nodes or ()
        similarities = result.similarities or [1.0] * len(nodes)
        for node, similarity in zip(nodes, similarities):
            metadata = dict(node.metadata)
            document_id = str(metadata.get("document_id") or "")
            revision_track = str(metadata.get("revision_track") or "")
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
                    score=float(similarity),
                )
            )
        return EvidenceBundle(
            query_text=request.query_text,
            corpus=request.corpus,
            collection=request.collection,
            sources=tuple(sources),
        )


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


def _coerce_dict(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}
