from __future__ import annotations

from dataclasses import dataclass, field, replace
import re
import time
import unicodedata
from typing import Callable, Iterable, Sequence, TypeVar

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_ingestion_core.corpus_profiles import (
    CollectionRuntimeProfile,
    is_official_web_stable_reference_like_collection,
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
from llama_index.core.schema import MetadataMode, TextNode
from llama_index.core.vector_stores import FilterCondition, FilterOperator, MetadataFilter, MetadataFilters
from qdrant_client import QdrantClient
from qdrant_client.http.exceptions import ResponseHandlingException
from qdrant_client.http import models as qdrant_models

from campus_retrieval_core.curriculum_query_resolution import (
    build_curriculum_document_support_query_text,
    filter_curriculum_query_sources,
    interpret_curriculum_query,
    matching_curriculum_doc_ids,
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
_OFFICIAL_WEB_GENERIC_QUERY_TERMS = frozenset(
    {
        "中央民族大学",
        "民大",
        "学校",
        "官网",
    }
)
_OFFICIAL_WEB_UNANCHORED_LIFE_SERVICE_TERMS = (
    "食堂营业时间",
    "图书馆开放时间",
    "图书馆讲座",
    "校医院",
    "宿舍",
    "教务处电话",
)
_OFFICIAL_WEB_SPECIFICITY_HINT_TERMS = (
    "通知",
    "公告",
    "讲座",
    "专访",
    "解读",
    "促进法",
    "基地",
    "就业",
    "实习",
    "活动",
    "学院",
    "部门",
    "联系方式",
)
_OFFICIAL_WEB_FRESHNESS_QUERY_TERMS = (
    "今天",
    "今日",
    "最新",
    "最近",
    "近期",
    "刚刚",
    "本周",
    "这周",
    "本月",
)
_OFFICIAL_WEB_STABLE_REFERENCE_QUERY_TERMS = (
    "简介",
    "概况",
    "领导",
    "校友会",
    "基金会",
    "干部人事",
    "本科培养",
    "研究生培养",
    "博士后",
    "访问学者",
    "学术名流",
)
_OFFICIAL_WEB_STRICT_TITLE_TARGET_QUERY_TERMS = (
    "讲座",
    "预告",
    "专访",
    "解读",
)
_OFFICIAL_WEB_REFERENCE_SUPPORT_QUERY_HINTS = {
    "学校概况": "三个校区 12个学科门类",
    "本科培养": "本科专业 强基计划",
    "博士后": "博士后科研流动站 合格率",
    "研究生培养": "12个学科门类 研究生招生培养单位",
    "学术名流": "历史学 社会学 民族学 人类学 语言学 音乐",
}
_OFFICIAL_WEB_SCHOLAR_DOMAIN_HINTS = (
    ("history", ("历史学会", "新史学", "历史学", "中国史", "清史", "辽史", "元史", "考古")),
    ("social", ("社会学", "民族学", "人类学")),
    ("language", ("语言学", "藏学", "藏文", "突厥语", "彝语", "羌语", "语言文字")),
    ("arts", ("音乐", "二胡", "民乐", "艺术")),
)
_OFFICIAL_WEB_CHUNK_ORDINAL_PATTERN = re.compile(r"chunk[-_:]?0*(\d+)\b", re.IGNORECASE)
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
_SAME_DOC_SCROLL_BATCH_LIMIT = 64
_SAME_DOC_SCROLL_MAX_RECORDS = 256
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
            initial_query_limit = self._resolve_initial_query_limit(request=request, profile=profile)
            response = _retry_qdrant_read(
                lambda: self.qdrant_client.query_points(
                    collection_name=qdrant_collection_name,
                    prefetch=_build_hybrid_prefetch(
                        request=request,
                        profile=profile,
                        embedding_model=self.embedding_model,
                        sparse_embedding_model=self.sparse_embedding_model,
                        dense_query_embedding=dense_query_embedding,
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
        return bool(request.target_document_ids) and len(frozenset(request.target_document_ids)) == 1

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
        if _normalize_low_signal_query(support_query_text) == _normalize_low_signal_query(request.query_text):
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
            replace(source, score=max(source.score, boosted_score))
            for source in selected_sources
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
    official_web_support_query = _build_official_web_document_support_query_text(
        query_text=normalized_query,
        source=source,
    )
    if official_web_support_query:
        return official_web_support_query
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


def _build_official_web_document_support_query_text(*, query_text: str, source: EvidenceSource) -> str:
    if (
        source.source_channel != "official_web"
        or not is_official_web_stable_reference_like_collection(source.collection)
    ):
        return ""
    title = source.source_title.strip()
    hint = _OFFICIAL_WEB_REFERENCE_SUPPORT_QUERY_HINTS.get(title)
    if not title or hint is None:
        return ""
    if not query_targets_source_title(query_text=query_text, source=source):
        return ""
    return f"{title} {hint}".strip()


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


def _prefer_curriculum_semester_course_list_sources(
    *,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    interpretation = interpret_curriculum_query(query_text)
    if interpretation.intent_kind != "course_list" or not interpretation.semester_labels:
        return tuple(sources)
    scoped_sources, scope_applied = filter_curriculum_query_sources(
        query_text=query_text,
        sources=sources,
    )
    if not scope_applied or not scoped_sources:
        return tuple(sources)
    preferred_chunk_ids = {
        source.chunk_id
        for source in scoped_sources
        if _is_curriculum_course_list_table_source(source)
    }
    if not preferred_chunk_ids:
        return tuple(sources)
    preferred_sources = tuple(source for source in sources if source.chunk_id in preferred_chunk_ids)
    ordered_preferred_sources = _order_curriculum_semester_course_list_sources(
        semester_labels=interpretation.semester_labels,
        sources=preferred_sources,
    )
    remaining_sources = tuple(source for source in sources if source.chunk_id not in preferred_chunk_ids)
    return tuple((*ordered_preferred_sources, *remaining_sources))


def _order_curriculum_semester_course_list_sources(
    *,
    semester_labels: tuple[str, ...],
    sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    if len(sources) <= 1:
        return tuple(sources)

    ranked_sources = sorted(
        enumerate(sources),
        key=lambda item: (
            -_curriculum_exact_semester_row_count(item[1], semester_labels=semester_labels),
            -_curriculum_related_semester_row_count(item[1], semester_labels=semester_labels),
            item[0],
        ),
    )
    primary: list[EvidenceSource] = []
    secondary: list[EvidenceSource] = []
    seen_sections: set[str] = set()
    for _, source in ranked_sources:
        section_key = _curriculum_course_list_section_key(source)
        if section_key not in seen_sections:
            primary.append(source)
            seen_sections.add(section_key)
            continue
        secondary.append(source)
    return tuple((*primary, *secondary))


def _curriculum_course_list_section_key(source: EvidenceSource) -> str:
    if source.structural_path:
        return source.structural_path[-1].strip() or source.chunk_id
    return source.chunk_id


def _curriculum_support_section_key(source: EvidenceSource) -> str:
    if source.structural_path:
        normalized_path = tuple(part.strip() for part in source.structural_path if part.strip())
        if normalized_path:
            return " > ".join(normalized_path)
    if source.detail_label.strip():
        return source.detail_label.strip()
    return source.chunk_id


def _curriculum_exact_semester_row_count(
    source: EvidenceSource,
    *,
    semester_labels: tuple[str, ...],
) -> int:
    if not semester_labels:
        return 0
    numeric_labels = _curriculum_semester_numeric_labels(semester_labels)
    if not numeric_labels:
        return 0
    count = 0
    for cell in _curriculum_semester_cells(source):
        if cell in numeric_labels:
            count += 1
    return count


def _curriculum_related_semester_row_count(
    source: EvidenceSource,
    *,
    semester_labels: tuple[str, ...],
) -> int:
    if not semester_labels:
        return 0
    normalized_labels = {unicodedata.normalize("NFKC", label).strip() for label in semester_labels if label.strip()}
    numeric_labels = _curriculum_semester_numeric_labels(semester_labels)
    if not normalized_labels and not numeric_labels:
        return 0
    count = 0
    for cell in _curriculum_semester_cells(source):
        normalized_cell = unicodedata.normalize("NFKC", cell).strip()
        if not normalized_cell:
            continue
        if normalized_cell in numeric_labels:
            continue
        if normalized_cell in normalized_labels:
            count += 1
            continue
        if any(label in normalized_cell for label in normalized_labels):
            count += 1
            continue
        if any(
            re.search(rf"(?<!\d){re.escape(label)}(?!\d)", normalized_cell)
            for label in numeric_labels
        ):
            count += 1
    return count


def _curriculum_semester_cells(source: EvidenceSource) -> tuple[str, ...]:
    cells: list[str] = []
    for line in unicodedata.normalize("NFKC", source.snippet).splitlines():
        if "|" not in line:
            continue
        columns = [part.strip() for part in line.split("|")]
        if len(columns) < 2:
            continue
        last_cell = columns[-1].strip()
        if not last_cell or "学期" in last_cell:
            continue
        cells.append(last_cell)
    return tuple(cells)


def _curriculum_semester_numeric_labels(semester_labels: tuple[str, ...]) -> tuple[str, ...]:
    numerals = {
        "第一学期": "1",
        "第二学期": "2",
        "第三学期": "3",
        "第四学期": "4",
        "第五学期": "5",
        "第六学期": "6",
        "第七学期": "7",
        "第八学期": "8",
        "第九学期": "9",
        "第十学期": "10",
    }
    return tuple(
        dict.fromkeys(
            numerals[label]
            for label in semester_labels
            if label in numerals
        )
    )


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


def _resolve_content_kind(
    metadata: dict[str, object],
    *,
    collection: str,
    snippet: str,
    anchor: dict[str, object],
) -> str:
    explicit_kind = _optional_text(metadata.get("unit_type"))
    if explicit_kind is not None:
        return explicit_kind
    if _looks_like_curriculum_table_unit(collection=collection, snippet=snippet, anchor=anchor):
        return "table_unit"
    return ""


def _resolve_content_role(
    metadata: dict[str, object],
    *,
    collection: str,
    snippet: str,
    anchor: dict[str, object],
) -> str:
    explicit_role = _optional_text(metadata.get("content_role"))
    if explicit_role is not None:
        return explicit_role
    structural_path = _coerce_structural_path(anchor.get("section_path"))
    if any(segment.endswith("附则") or segment == "附则" for segment in structural_path):
        return "closing_provision"
    content_kind = _resolve_content_kind(
        metadata,
        collection=collection,
        snippet=snippet,
        anchor=anchor,
    )
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


def _resolve_canonical_source_id(metadata: dict[str, object]) -> str:
    return _optional_text(metadata.get("canonical_source_id")) or _optional_text(metadata.get("source_doc_id")) or ""


def _resolve_canonical_source_title(metadata: dict[str, object]) -> str:
    return (
        _optional_text(metadata.get("canonical_source_title"))
        or _optional_text(metadata.get("source_doc_title"))
        or ""
    )


def _resolve_source_unit_kind(
    metadata: dict[str, object],
    *,
    collection: str,
    anchor: dict[str, object],
) -> str:
    explicit_kind = _optional_text(metadata.get("source_unit_kind"))
    if explicit_kind is not None:
        return explicit_kind
    if collection != "program_semester_facts":
        return ""
    return _optional_text(metadata.get("content_role")) or _optional_text(anchor.get("fact_type")) or ""


def _resolve_source_unit_key(
    metadata: dict[str, object],
    *,
    collection: str,
) -> str:
    explicit_key = _optional_text(metadata.get("source_unit_key"))
    if explicit_key is not None:
        return explicit_key
    if collection != "program_semester_facts":
        return ""
    semester_index = _optional_text(metadata.get("semester_index"))
    if semester_index is None:
        return ""
    normalized = semester_index.strip()
    return f"semester-{normalized}" if normalized else ""


def _resolve_is_answer_bearing(
    metadata: dict[str, object],
    *,
    collection: str,
    snippet: str,
    anchor: dict[str, object],
) -> bool:
    explicit_value = _optional_bool(metadata.get("is_answer_bearing"))
    if explicit_value is not None:
        return explicit_value
    content_role = _resolve_content_role(
        metadata,
        collection=collection,
        snippet=snippet,
        anchor=anchor,
    )
    if content_role == "closing_provision":
        return False
    detail_label = _resolve_detail_label(metadata, anchor=anchor)
    content_kind = _resolve_content_kind(
        metadata,
        collection=collection,
        snippet=snippet,
        anchor=anchor,
    )
    if content_role == "table_fact":
        return True
    return bool(detail_label) and content_kind in {"article_body", "policy_page", "section_text", "table_unit"}


def _looks_like_curriculum_table_unit(
    *,
    collection: str,
    snippet: str,
    anchor: dict[str, object],
) -> bool:
    if collection != "curriculum_plan":
        return False
    normalized_snippet = unicodedata.normalize("NFKC", snippet)
    if "|" not in normalized_snippet:
        return False
    if "课程名称" not in normalized_snippet:
        return False
    if "修读学期" in normalized_snippet or "开设学期" in normalized_snippet:
        return True
    if "table_group_id" in anchor and "课程清单如下" in normalized_snippet:
        return True
    return False


def _is_curriculum_course_list_table_source(source: EvidenceSource) -> bool:
    if source.collection != "curriculum_plan" or source.content_role != "table_fact":
        return False
    normalized_snippet = unicodedata.normalize("NFKC", source.snippet)
    return "|" in normalized_snippet and "课程名称" in normalized_snippet


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
    if _has_unique_curriculum_doc_match(query_text=query_text, sources=sources):
        return sources
    return ()


def _apply_official_web_low_signal_policy(
    *,
    profile: CollectionRuntimeProfile,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    if not is_official_web_stable_reference_like_profile(profile):
        return tuple(sources)
    normalized_query = _normalize_low_signal_query(query_text)
    if not normalized_query or not sources:
        return tuple(sources)
    if (
        not profile.supports_freshness_sensitive_queries
        and _is_official_web_freshness_sensitive_query(normalized_query)
    ):
        return ()
    if normalized_query in _OFFICIAL_WEB_GENERIC_QUERY_TERMS:
        return ()
    if (
        any(term in normalized_query for term in _OFFICIAL_WEB_UNANCHORED_LIFE_SERVICE_TERMS)
        and not any(term in normalized_query for term in _OFFICIAL_WEB_SPECIFICITY_HINT_TERMS)
    ):
        return ()
    return tuple(sources)


def _apply_document_diversity_policy(
    *,
    profile: CollectionRuntimeProfile,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    if not is_official_web_stable_reference_like_profile(profile):
        return tuple(sources)
    title_targeting_sources = tuple(
        source for source in sources if query_targets_source_title(query_text=query_text, source=source)
    )
    normalized_query = _normalize_low_signal_query(query_text)
    if title_targeting_sources:
        if "学校概况" in normalized_query:
            school_overview_sources = _select_official_web_school_overview_support_sources(
                sources=title_targeting_sources,
            )
            if school_overview_sources:
                return school_overview_sources
        if "学术名流" in normalized_query:
            scholar_sources = _select_official_web_scholar_support_sources(
                sources=title_targeting_sources,
            )
            if scholar_sources:
                return scholar_sources
        representative_title_sources = _collapse_official_web_title_target_sources(
            query_text=query_text,
            sources=title_targeting_sources,
        )
        if any(term in normalized_query for term in _OFFICIAL_WEB_STABLE_REFERENCE_QUERY_TERMS):
            return representative_title_sources[:1]
        title_target_doc_ids = {source.doc_id for source in representative_title_sources}
        if any(term in normalized_query for term in _OFFICIAL_WEB_STRICT_TITLE_TARGET_QUERY_TERMS):
            sources = representative_title_sources
        else:
            sources = (
                *representative_title_sources,
                *(source for source in sources if source.doc_id not in title_target_doc_ids),
            )
    deduped_sources: list[EvidenceSource] = []
    seen_doc_ids: set[str] = set()
    for source in sources:
        if source.doc_id in seen_doc_ids:
            continue
        seen_doc_ids.add(source.doc_id)
        deduped_sources.append(source)
    return tuple(deduped_sources)


def _collapse_official_web_title_target_sources(
    *,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    grouped_sources: dict[str, list[EvidenceSource]] = {}
    for source in sources:
        grouped_sources.setdefault(source.doc_id, []).append(source)
    return tuple(
        _select_official_web_representative_source(
            query_text=query_text,
            sources=doc_sources,
        )
        for doc_sources in grouped_sources.values()
    )


def _select_official_web_school_overview_support_sources(
    *,
    sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    grouped_sources: dict[str, list[EvidenceSource]] = {}
    for source in sources:
        grouped_sources.setdefault(source.doc_id, []).append(source)
    selected_sources: list[EvidenceSource] = []
    for doc_sources in grouped_sources.values():
        campus_source = _select_official_web_school_overview_campus_source(doc_sources)
        discipline_source = _select_official_web_school_overview_discipline_source(doc_sources)
        if campus_source is not None:
            selected_sources.append(campus_source)
        if discipline_source is not None and all(
            discipline_source.chunk_id != existing.chunk_id for existing in selected_sources
        ):
            selected_sources.append(discipline_source)
    return tuple(selected_sources)


def _select_official_web_school_overview_campus_source(
    sources: Sequence[EvidenceSource],
) -> EvidenceSource | None:
    campus_sources = [
        source
        for source in sources
        if any(term in _normalize_low_signal_query(source.snippet) for term in ("三个校区", "海淀", "丰台"))
    ]
    if not campus_sources:
        return None
    return max(campus_sources, key=lambda source: source.score)


def _select_official_web_school_overview_discipline_source(
    sources: Sequence[EvidenceSource],
) -> EvidenceSource | None:
    discipline_sources = [
        source
        for source in sources
        if any(term in _normalize_low_signal_query(source.snippet) for term in ("12个学科门类", "71个本科专业"))
    ]
    if not discipline_sources:
        return None
    return max(
        discipline_sources,
        key=lambda source: (
            _official_web_source_chunk_ordinal(source) or 0,
            source.score,
        ),
    )


def _select_official_web_scholar_support_sources(
    *,
    sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    grouped_sources: dict[str, list[EvidenceSource]] = {}
    for source in sources:
        grouped_sources.setdefault(source.doc_id, []).append(source)

    selected_sources: list[EvidenceSource] = []
    for doc_sources in grouped_sources.values():
        ranked_sources = sorted(
            doc_sources,
            key=_official_web_scholar_support_sort_key,
            reverse=True,
        )
        doc_selected: list[EvidenceSource] = []
        used_people: set[str] = set()
        used_domains: set[str] = set()
        for source in ranked_sources:
            person = _official_web_scholar_person_label(source)
            source_domains = _official_web_scholar_source_domains(source)
            if person and person in used_people:
                continue
            if doc_selected and source_domains and source_domains.issubset(used_domains):
                continue
            doc_selected.append(source)
            if person:
                used_people.add(person)
            used_domains.update(source_domains)
            if len(doc_selected) >= 3:
                break
        if len(doc_selected) < 3:
            for source in ranked_sources:
                if any(existing.chunk_id == source.chunk_id for existing in doc_selected):
                    continue
                doc_selected.append(source)
                if len(doc_selected) >= 3:
                    break
        selected_sources.extend(doc_selected[:3])
    return tuple(selected_sources)


def _official_web_scholar_support_sort_key(source: EvidenceSource) -> tuple[int, int, int, float]:
    domains = _official_web_scholar_source_domains(source)
    normalized_snippet = _normalize_low_signal_query(source.snippet)
    contribution_bonus = 0
    if any(term in normalized_snippet for term in ("贡献", "创始", "首创", "培养", "代表著作", "主要著作", "研究")):
        contribution_bonus += 1
    chunk_ordinal = _official_web_source_chunk_ordinal(source)
    lead_bonus = 100 - min(chunk_ordinal, 100) if chunk_ordinal is not None else 0
    return (
        len(domains),
        contribution_bonus,
        lead_bonus,
        source.score,
    )


def _official_web_scholar_person_label(source: EvidenceSource) -> str:
    anchor = _coerce_dict(source.anchor)
    section_path = _coerce_structural_path(anchor.get("section_path"))
    title = source.source_title.strip()
    if section_path:
        candidate = section_path[-1].strip()
        if candidate and candidate != title:
            return candidate
    for item in reversed(source.structural_path):
        candidate = item.strip()
        if candidate and candidate != title:
            return candidate
    return ""


def _official_web_scholar_source_domains(source: EvidenceSource) -> set[str]:
    normalized_snippet = _normalize_low_signal_query(source.snippet)
    domains = {
        label
        for label, hints in _OFFICIAL_WEB_SCHOLAR_DOMAIN_HINTS
        if any(hint in normalized_snippet for hint in hints)
    }
    return domains


def _select_official_web_representative_source(
    *,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> EvidenceSource:
    if not sources:
        raise ValueError("sources must not be empty")
    return max(
        sources,
        key=lambda source: _official_web_representative_source_sort_key(
            query_text=query_text,
            source=source,
        ),
    )


def _official_web_representative_source_sort_key(
    *,
    query_text: str,
    source: EvidenceSource,
) -> tuple[int, int, int, int, float]:
    normalized_query = _normalize_low_signal_query(query_text)
    normalized_snippet = _normalize_low_signal_query(source.snippet)
    notice_bonus = 0
    fact_bonus = 0
    intro_bonus = 0
    if any(term in normalized_query for term in _OFFICIAL_WEB_STRICT_TITLE_TARGET_QUERY_TERMS):
        if any(term in normalized_snippet for term in ("讲座时间", "时间：", "讲座地点", "地点：", "讲座主题", "主题：")):
            notice_bonus += 40
        if any(term in normalized_snippet for term in ("二维码", "扫码", "扫描", "预约", "报名", "图书馆积分")):
            notice_bonus -= 40
    if "学校概况" in normalized_query:
        if any(term in normalized_snippet for term in ("12个学科门类", "71个本科专业")):
            fact_bonus += 300
        if any(term in normalized_snippet for term in ("三个校区", "海淀", "丰台")):
            fact_bonus += 120
    if "本科培养" in normalized_query:
        if any(term in normalized_snippet for term in ("本科专业71个", "在招专业61个", "11个学科门类")):
            fact_bonus += 260
        if any(term in normalized_snippet for term in ("强基计划", "一流本科专业")):
            fact_bonus += 180
    if "博士后" in normalized_query:
        if "博士后科研流动站" in normalized_snippet:
            fact_bonus += 320
        if any(term in normalized_snippet for term in ("合格率均为100", "优秀博士后流动站")):
            fact_bonus += 200
        if "双一流" in normalized_snippet:
            fact_bonus -= 140
    if "研究生培养" in normalized_query:
        if "12个学科门类" in normalized_snippet:
            fact_bonus += 280
        if any(term in normalized_snippet for term in ("24个研究生招生培养单位", "博士一级学科授权点", "硕士一级学科授权点")):
            fact_bonus += 180
    if any(term in normalized_query for term in _OFFICIAL_WEB_STABLE_REFERENCE_QUERY_TERMS):
        if any(term in source.snippet for term in ("是一所", "是党和国家", "创建的一所", "特色鲜明")):
            intro_bonus += 30
        if re.search(r"20\d{2}年", source.snippet) and any(term in source.snippet for term in ("入选", "大事记")):
            intro_bonus -= 20
    chunk_ordinal = _official_web_source_chunk_ordinal(source)
    lead_bonus = 200 - min(chunk_ordinal, 200) if chunk_ordinal is not None else 0
    return (
        notice_bonus,
        fact_bonus,
        lead_bonus,
        intro_bonus,
        1 if source.is_answer_bearing else 0,
        source.score,
    )


def _official_web_source_chunk_ordinal(source: EvidenceSource) -> int | None:
    anchor = source.anchor if isinstance(source.anchor, dict) else {}
    for key in ("segment_index", "segment_ord", "segmentOrdinal"):
        value = anchor.get(key)
        if isinstance(value, int) and value > 0:
            return value
        if isinstance(value, str) and value.isdigit() and int(value) > 0:
            return int(value)
    match = _OFFICIAL_WEB_CHUNK_ORDINAL_PATTERN.search(source.chunk_id)
    if match is None:
        return None
    ordinal = int(match.group(1))
    return ordinal if ordinal > 0 else None


def _normalize_low_signal_query(query_text: str) -> str:
    return "".join(character for character in query_text.strip() if not character.isspace())


def _is_official_web_freshness_sensitive_query(query_text: str) -> bool:
    normalized_query = _normalize_low_signal_query(query_text)
    return any(term in normalized_query for term in _OFFICIAL_WEB_FRESHNESS_QUERY_TERMS)


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


def _has_unique_curriculum_doc_match(
    *,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> bool:
    interpretation = interpret_curriculum_query(query_text)
    if not interpretation.program_compact_key:
        return False
    return len(matching_curriculum_doc_ids(query_text=query_text, sources=sources)) == 1


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
