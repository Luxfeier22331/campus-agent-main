from __future__ import annotations

from dataclasses import dataclass, field, replace
import re
import time
import unicodedata
from typing import Callable, Iterable, Sequence, TypeVar

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
from qdrant_client.http.exceptions import ResponseHandlingException
from qdrant_client.http import models as qdrant_models

from campus_retrieval_core.curriculum_query_resolution import (
    build_curriculum_document_support_query_text,
    interpret_curriculum_query,
)
from campus_retrieval_core.evidence_ranking import prioritize_evidence_sources, query_targets_source_title
from campus_retrieval_core.models import RetrievalRequest
from campus_retrieval_core.settings import RetrievalSettings

DEFAULT_LATEST_REVISION_TRACKS = ("current-effective", "editorial", "source-faithful")
DEFAULT_SERVING_STATUS = "active"
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
_LOW_SIGNAL_CJK_PHRASES = (
    "本科第二学士学位人才培养方案",
    "本科专业第二学位人才培养方案",
    "本科第二学位人才培养方案",
    "第二学士学位人才培养方案",
    "第二学位人才培养方案",
    "本科人才培养方案",
    "人才培养方案",
    "课程教学计划",
    "教学计划",
    "课程地图",
)
_DOCUMENT_SUPPORT_QUERY_SUFFIXES = (
    "怎么安排",
    "如何安排",
    "怎么修读",
    "如何修读",
    "怎么办理",
    "如何办理",
    "是多少",
    "有多少",
    "一共多少",
    "怎么授予",
    "如何授予",
    "什么要求",
    "几年",
    "多少",
    "怎么",
    "如何",
)
_QDRANT_READ_RETRY_ATTEMPTS = 3
_QDRANT_READ_RETRY_BACKOFF_SECONDS = 0.5
_QDRANT_TRANSIENT_ERROR_TEXT = ("timed out", "timeout", "temporarily unavailable", "connection reset", "handshake")
_RetryResult = TypeVar("_RetryResult")


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
    _dense_query_cache: dict[str, tuple[float, tuple[float, ...]]] = field(default_factory=dict, init=False)
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
            response = self.qdrant_client.query_points(
                collection_name=qdrant_collection_name,
                prefetch=_build_hybrid_prefetch(
                    request=request,
                    profile=profile,
                    embedding_model=self.embedding_model,
                    sparse_embedding_model=self.sparse_embedding_model,
                    dense_query_embedding=dense_query_embedding,
                ),
                query=_build_rrf_query(profile),
                limit=request.top_k,
                with_payload=True,
                with_vectors=False,
            )
        except Exception as exc:  # pragma: no cover - exercised by error mapping test
            raise RetrievalBackendError("qdrant retrieval failed") from exc

        initial_sources = _apply_no_hit_policy(
            profile=profile,
            query_text=query_text,
            sources=self._build_evidence_sources(response.points or ()),
        )
        ranked_sources = prioritize_evidence_sources(
            query_text=query_text,
            sources=initial_sources,
        )
        ranked_sources = _apply_preferred_document_bias(
            sources=ranked_sources,
            preferred_document_ids=request.preferred_document_ids,
        )
        expanded_sources = self._expand_named_document_support(
            request=request,
            profile=profile,
            qdrant_collection_name=qdrant_collection_name,
            dense_query_embedding=dense_query_embedding,
            sources=ranked_sources,
        )
        return EvidenceBundle(
            query_text=request.query_text,
            corpus=request.corpus,
            collection=request.collection,
            sources=_apply_preferred_document_bias(
                sources=prioritize_evidence_sources(
                    query_text=query_text,
                    sources=expanded_sources,
                )[: request.top_k],
                preferred_document_ids=request.preferred_document_ids,
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
            anchor = _coerce_dict(metadata.get("anchor"))
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
                    anchor=anchor,
                    canonical_url=canonical_url,
                    latest_url=latest_url,
                    source_channel=source_channel,
                    collection=collection,
                    is_current=is_current,
                    snippet=node.get_content(metadata_mode=MetadataMode.NONE),
                    score=float(point.score),
                    source_title=_resolve_source_title(metadata, document_id=document_id, anchor=anchor),
                    structural_path=_coerce_structural_path(anchor.get("section_path")),
                    content_kind=_resolve_content_kind(metadata),
                    content_role=_resolve_content_role(metadata, anchor=anchor),
                    detail_label=_resolve_detail_label(metadata, anchor=anchor),
                    is_answer_bearing=_resolve_is_answer_bearing(metadata, anchor=anchor),
                )
            )
        return tuple(sources)

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
                preferred_revision_tracks=profile.serving_revision_tracks or DEFAULT_LATEST_REVISION_TRACKS,
            )
            if record is None:
                continue
            if request.allows_document_access(
                visibility_level=record.visibility_level,
                entitlement_groups=record.entitlement_groups,
                visibility_scope=record.visibility_scope,
            ):
                return
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
        embedding = tuple(float(item) for item in self.embedding_model.get_query_embedding(normalized_query))
        self._dense_query_cache[normalized_query] = (now + self.dense_query_cache_ttl_seconds, embedding)
        return embedding

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
            response = self.qdrant_client.query_points(
                collection_name=qdrant_collection_name,
                prefetch=_build_hybrid_prefetch(
                    request=support_request,
                    profile=profile,
                    embedding_model=self.embedding_model,
                    sparse_embedding_model=self.sparse_embedding_model,
                    dense_query_embedding=support_dense_query_embedding,
                    query_filter=_build_source_scoped_qdrant_filter(
                        request=support_request,
                        profile=profile,
                        source=target_source,
                    ),
                ),
                query=_build_rrf_query(profile),
                limit=max(support_request.top_k, profile.document_support_limit),
                with_payload=True,
                with_vectors=False,
            )
        except Exception:
            return tuple(sources)
        return _merge_evidence_sources(
            preferred=sources,
            additional=self._build_evidence_sources(response.points or ()),
        )


def _build_hybrid_prefetch(
    *,
    request: RetrievalRequest,
    profile: CollectionRuntimeProfile,
    embedding_model: object,
    sparse_embedding_model: SparseEmbeddingModel,
    dense_query_embedding: Sequence[float] | None = None,
    query_filter: qdrant_models.Filter | None = None,
) -> list[qdrant_models.Prefetch]:
    runtime_query_filter = query_filter or _build_qdrant_filter(request, profile=profile)
    query_text = request.query_text.strip()
    dense_limit = max(request.top_k, profile.dense_prefetch_limit)
    sparse_limit = max(request.top_k, profile.sparse_prefetch_limit)
    dense_query_text = _build_dense_query_text(
        query_text=query_text,
        instruction=profile.embedding_query_instruction,
    )
    prefetch = [
        qdrant_models.Prefetch(
            query=list(dense_query_embedding or embedding_model.get_query_embedding(dense_query_text)),
            using=profile.qdrant_index_binding.dense_vector_name,
            filter=runtime_query_filter,
            limit=dense_limit,
        )
    ]
    sparse_query = sparse_embedding_model.build_query(query_text)
    if sparse_query is not None:
        prefetch.append(
            qdrant_models.Prefetch(
                query=sparse_query,
                using=profile.qdrant_index_binding.sparse_vector_name,
                filter=runtime_query_filter,
                limit=sparse_limit,
            )
        )
    return prefetch


def _build_dense_query_text(*, query_text: str, instruction: str) -> str:
    normalized_query = query_text.strip()
    normalized_instruction = instruction.strip()
    if not normalized_instruction:
        return normalized_query
    return f"Instruct: {normalized_instruction}\nQuery: {normalized_query}"


def _build_document_support_query_text(*, query_text: str, source: EvidenceSource) -> str:
    normalized_query = query_text.strip()
    if not normalized_query:
        return normalized_query
    if source.collection == "curriculum_plan" or source.doc_id.startswith("curriculum:"):
        focused_query = build_curriculum_document_support_query_text(
            query_text=normalized_query,
            source=source,
        )
        if focused_query != normalized_query:
            return _strip_document_support_query_noise(focused_query)
    for candidate in _document_support_query_candidates(source):
        if candidate and candidate in normalized_query:
            focused_query = _strip_document_support_query_noise(
                normalized_query.replace(candidate, "", 1)
            )
            if focused_query:
                return focused_query
    return normalized_query


def _document_support_query_candidates(source: EvidenceSource) -> tuple[str, ...]:
    candidates: list[str] = []
    explicit_title = source.source_title.strip()
    if explicit_title:
        candidates.append(explicit_title)
    doc_label = source.doc_id.split(":", 1)[-1].strip()
    if doc_label:
        candidates.append(doc_label)
    if source.structural_path:
        candidates.append(source.structural_path[0].strip())
    return tuple(dict.fromkeys(candidate for candidate in candidates if candidate))


def _strip_document_support_query_noise(text: str) -> str:
    focused_query = text.strip().strip(" \t\r\n,，.。;；:：()（）[]【】《》\"'")
    focused_query = focused_query.rstrip("？?").strip()
    changed = True
    while focused_query and changed:
        changed = False
        for suffix in _DOCUMENT_SUPPORT_QUERY_SUFFIXES:
            if focused_query.endswith(suffix):
                focused_query = focused_query[: -len(suffix)].rstrip(" \t\r\n,，.。;；:：")
                focused_query = focused_query.rstrip("？?").strip()
                changed = True
                break
    return focused_query


def _build_rrf_query(profile: CollectionRuntimeProfile) -> qdrant_models.RrfQuery:
    return qdrant_models.RrfQuery(
        rrf=qdrant_models.Rrf(
            k=profile.rrf_k,
            weights=[profile.rrf_dense_weight, profile.rrf_sparse_weight],
        )
    )


def _merge_evidence_sources(
    *,
    preferred: Sequence[EvidenceSource],
    additional: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    merged: dict[str, EvidenceSource] = {source.chunk_id: source for source in preferred}
    for source in additional:
        existing = merged.get(source.chunk_id)
        if existing is None or source.score > existing.score:
            merged[source.chunk_id] = source
    return tuple(merged.values())


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
        check_compatibility=False,
        trust_env=False,
    )


def _retry_qdrant_read(operation: Callable[[], _RetryResult]) -> _RetryResult:
    last_error: ResponseHandlingException | None = None
    for attempt in range(1, _QDRANT_READ_RETRY_ATTEMPTS + 1):
        try:
            return operation()
        except ResponseHandlingException as exc:
            if not _looks_like_transient_qdrant_error(exc) or attempt >= _QDRANT_READ_RETRY_ATTEMPTS:
                raise
            last_error = exc
            time.sleep(_QDRANT_READ_RETRY_BACKOFF_SECONDS * attempt)
    if last_error is not None:
        raise last_error
    raise RuntimeError("retry helper exhausted without result")


def _looks_like_transient_qdrant_error(error: ResponseHandlingException) -> bool:
    normalized = str(error).strip().lower()
    return any(fragment in normalized for fragment in _QDRANT_TRANSIENT_ERROR_TEXT)


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
    if runtime_profile.serving_revision_tracks:
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
    if request.target_document_ids:
        must.append(
            qdrant_models.FieldCondition(
                key="document_id",
                match=qdrant_models.MatchAny(any=list(request.target_document_ids)),
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


def _build_visibility_scope_metadata_filter(visibility_scope: str | None) -> MetadataFilter | MetadataFilters:
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


def _coerce_dict(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, dict) else {}


def _coerce_structural_path(value: object) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    normalized: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        text = item.strip()
        if text:
            normalized.append(text)
    return tuple(normalized)


def _resolve_source_title(
    metadata: dict[str, object],
    *,
    document_id: str,
    anchor: dict[str, object],
) -> str:
    for key in ("source_title", "title", "document_title"):
        value = _optional_text(metadata.get(key))
        if value is not None:
            return value
    structural_path = _coerce_structural_path(anchor.get("section_path"))
    if structural_path:
        first_segment = structural_path[0]
        if ":" not in first_segment:
            return first_segment
    return document_id.split(":", 1)[-1].strip()


def _resolve_content_kind(metadata: dict[str, object]) -> str:
    return str(metadata.get("unit_type") or "").strip()


def _resolve_content_role(
    metadata: dict[str, object],
    *,
    anchor: dict[str, object],
) -> str:
    explicit_role = _optional_text(metadata.get("content_role"))
    if explicit_role is not None:
        return explicit_role
    structural_path = _coerce_structural_path(anchor.get("section_path"))
    if any(segment.endswith("附则") or segment == "附则" for segment in structural_path):
        return "closing_provision"
    content_kind = _resolve_content_kind(metadata)
    if content_kind == "table_unit":
        return "table_fact"
    return ""


def _resolve_detail_label(
    metadata: dict[str, object],
    *,
    anchor: dict[str, object],
) -> str:
    explicit_label = _optional_text(metadata.get("detail_label"))
    if explicit_label is not None:
        return explicit_label
    for key in ("article_label", "provision_label", "table_context"):
        value = _optional_text(anchor.get(key))
        if value is not None:
            return value
    return ""


def _resolve_is_answer_bearing(
    metadata: dict[str, object],
    *,
    anchor: dict[str, object],
) -> bool:
    explicit_value = _optional_bool(metadata.get("is_answer_bearing"))
    if explicit_value is not None:
        return explicit_value
    content_role = _resolve_content_role(metadata, anchor=anchor)
    if content_role == "closing_provision":
        return False
    detail_label = _resolve_detail_label(metadata, anchor=anchor)
    content_kind = _resolve_content_kind(metadata)
    return bool(detail_label) and content_kind in {"article_body", "policy_page", "section_text", "table_unit"}


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
    if _has_query_lexical_support(
        query_text=query_text,
        snippets=tuple(source.snippet for source in sources),
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
    for segment in _query_support_segments(normalized_query):
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


def _query_support_segments(normalized_query: str) -> tuple[str, ...]:
    stripped_query = normalized_query
    for phrase in _LOW_SIGNAL_CJK_PHRASES:
        stripped_query = stripped_query.replace(phrase, " ")
    stripped_segments = _cjk_segments(stripped_query)
    return stripped_segments or _cjk_segments(normalized_query)


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
