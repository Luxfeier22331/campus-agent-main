from __future__ import annotations

from dataclasses import dataclass, field
import re
import time
import unicodedata
from typing import Iterable, Sequence

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile, load_runtime_profile
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
DEFAULT_SERVING_STATUS = "active"
DEFAULT_HYBRID_CANDIDATE_MULTIPLIER = 4
DEFAULT_DENSE_QUERY_CACHE_TTL_SECONDS = 300.0
_SCORE_TIE_EPSILON = 1e-6
_ASCII_QUERY_TOKEN_RE = re.compile(r"[a-z0-9]{3,}")
_WEAK_CJK_QUERY_TOKENS = frozenset(
    {
        "办理",
        "校内",
        "学校",
        "学生",
        "规定",
        "办法",
        "管理",
        "申请",
        "条件",
        "流程",
        "程序",
        "手续",
        "处理",
        "服务",
        "问题",
    }
)


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
                f"{request.corpus}/{request.collection} retrieval is disabled by runtime profile"
            )
        query_text = request.query_text.strip()
        if not query_text:
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
            )
        qdrant_collection_name = profile.qdrant_index_binding.collection_name
        if not self.qdrant_client.collection_exists(qdrant_collection_name):
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
            )

        try:
            dense_query_embedding = self._get_dense_query_embedding(query_text)
            response = self.qdrant_client.query_points(
                collection_name=qdrant_collection_name,
                prefetch=_build_hybrid_prefetch(
                    request=request,
                    profile=profile,
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
            sources=_apply_no_hit_policy(
                profile=profile,
                query_text=query_text,
                sources=self._build_evidence_sources(response.points or ()),
            ),
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
            revision_track = str(metadata.get("revision_track") or "")
            version_id = str(metadata.get("version_id") or "")
            if not document_id or not revision_track or not version_id:
                continue
            canonical_url = _optional_text(metadata.get("canonical_url")) or _optional_text(metadata.get("source_uri"))
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
                    preferred_revision_tracks=runtime_profile.serving_revision_tracks or DEFAULT_LATEST_REVISION_TRACKS,
                )
                canonical_url = canonical_url or record.source_uri
                latest_url = latest_url or (latest_record.source_uri if latest_record is not None else record.source_uri)
                source_channel = source_channel or record.source_channel
                collection = collection or record.collection
                if is_current is None:
                    is_current = record.is_current
            sources.append(
                EvidenceSource(
                    doc_id=document_id,
                    revision_track=revision_track,
                    version_id=version_id,
                    chunk_id=str(metadata.get("chunk_id") or node.node_id),
                    anchor=_coerce_dict(metadata.get("anchor")),
                    acl_level=str(metadata.get("acl_level") or "public"),
                    canonical_url=canonical_url,
                    latest_url=latest_url,
                    source_channel=source_channel,
                    collection=collection,
                    is_current=is_current,
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
    profile: CollectionRuntimeProfile,
    embedding_model: object,
    sparse_embedding_model: SparseEmbeddingModel,
    dense_query_embedding: Sequence[float] | None = None,
) -> list[qdrant_models.Prefetch]:
    limit = _candidate_limit(request.top_k)
    query_filter = _build_qdrant_filter(request, profile=profile)
    query_text = request.query_text.strip()
    prefetch = [
        qdrant_models.Prefetch(
            query=list(dense_query_embedding or embedding_model.get_query_embedding(query_text)),
            using=profile.qdrant_index_binding.dense_vector_name,
            filter=query_filter,
            limit=limit,
        )
    ]
    sparse_query = sparse_embedding_model.build_query(query_text)
    if sparse_query is not None:
        prefetch.append(
            qdrant_models.Prefetch(
                query=sparse_query,
                using=profile.qdrant_index_binding.sparse_vector_name,
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
        cloud_inference=True,
    )


def _build_metadata_filters(
    request: RetrievalRequest,
    *,
    profile: CollectionRuntimeProfile | None = None,
) -> MetadataFilters:
    runtime_profile = profile or load_runtime_profile(request.corpus, request.collection)
    filters: list[MetadataFilter | MetadataFilters] = [
        MetadataFilter(key="corpus", value=request.corpus),
        MetadataFilter(key="collection", value=request.collection),
    ]
    if runtime_profile.serving_revision_tracks:
        filters.append(
            MetadataFilter(
                key="revision_track",
                value=list(runtime_profile.serving_revision_tracks),
                operator=FilterOperator.IN,
            )
        )
    filters.append(MetadataFilter(key="status", value=DEFAULT_SERVING_STATUS))
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


def _build_qdrant_filter(
    request: RetrievalRequest,
    *,
    profile: CollectionRuntimeProfile | None = None,
) -> qdrant_models.Filter:
    runtime_profile = profile or load_runtime_profile(request.corpus, request.collection)
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
    if runtime_profile.serving_revision_tracks:
        must.append(
            qdrant_models.FieldCondition(
                key="revision_track",
                match=qdrant_models.MatchAny(any=list(runtime_profile.serving_revision_tracks)),
            )
        )
    if runtime_profile.current_only:
        must.append(
            qdrant_models.FieldCondition(
                key="is_current",
                match=qdrant_models.MatchValue(value=True),
            )
        )
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


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _optional_bool(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    return None


def _apply_no_hit_policy(
    *,
    profile: CollectionRuntimeProfile,
    query_text: str,
    sources: tuple[EvidenceSource, ...],
) -> tuple[EvidenceSource, ...]:
    if not sources:
        return ()
    if profile.no_hit_min_top_score is None or profile.no_hit_min_score_gap is None:
        return sources
    top_source = sources[0]
    if top_source.score >= profile.no_hit_min_top_score:
        return sources
    runner_up_score = sources[1].score if len(sources) > 1 else top_source.score
    if (top_source.score - runner_up_score) >= profile.no_hit_min_score_gap:
        return sources
    top_tier_sources = tuple(source for source in sources if abs(source.score - top_source.score) <= _SCORE_TIE_EPSILON)
    if _has_query_lexical_support(
        query_text=query_text,
        snippets=tuple(source.snippet for source in top_tier_sources),
    ):
        return sources
    return ()


def _has_query_lexical_support(*, query_text: str, snippets: str | Sequence[str]) -> bool:
    normalized_query = unicodedata.normalize("NFKC", query_text).lower()
    normalized_snippets = _normalize_snippets(snippets)
    if not normalized_query or not normalized_snippets:
        return False
    for token in _ASCII_QUERY_TOKEN_RE.findall(normalized_query):
        if any(token in normalized_snippet for normalized_snippet in normalized_snippets):
            return True
    for segment in _cjk_segments(normalized_query):
        if _segment_has_strong_lexical_support(segment=segment, normalized_snippets=normalized_snippets):
            return True
    return False


def _normalize_snippets(snippets: str | Sequence[str]) -> tuple[str, ...]:
    values = (snippets,) if isinstance(snippets, str) else tuple(snippets)
    return tuple(
        normalized
        for normalized in (unicodedata.normalize("NFKC", value).lower() for value in values)
        if normalized
    )


def _segment_has_strong_lexical_support(*, segment: str, normalized_snippets: Sequence[str]) -> bool:
    if len(segment) >= 4 and any(segment in snippet for snippet in normalized_snippets):
        return True
    trigrams = tuple(token for token in _cjk_query_tokens(segment, token_size=3) if token not in _WEAK_CJK_QUERY_TOKENS)
    if any(token in snippet for token in trigrams for snippet in normalized_snippets):
        return True
    matched_bigrams = {
        token
        for token in _cjk_query_tokens(segment, token_size=2)
        if token not in _WEAK_CJK_QUERY_TOKENS
        if any(token in snippet for snippet in normalized_snippets)
    }
    return len(matched_bigrams) >= 2


def _cjk_segments(text: str) -> tuple[str, ...]:
    segments: list[str] = []
    current: list[str] = []
    for char in text:
        if _is_cjk_char(char):
            current.append(char)
            continue
        if current:
            segments.append("".join(current))
            current = []
    if current:
        segments.append("".join(current))
    return tuple(segments)


def _cjk_query_tokens(segment: str, *, token_size: int) -> tuple[str, ...]:
    if token_size <= 0 or len(segment) < token_size:
        return ()
    return tuple(
        dict.fromkeys(
            token
            for token in (segment[index : index + token_size] for index in range(len(segment) - token_size + 1))
            if token.strip()
        )
    )


def _is_cjk_char(char: str) -> bool:
    code_point = ord(char)
    return (
        0x3400 <= code_point <= 0x4DBF
        or 0x4E00 <= code_point <= 0x9FFF
        or 0xF900 <= code_point <= 0xFAFF
    )
