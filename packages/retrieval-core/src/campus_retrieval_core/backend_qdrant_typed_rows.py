from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile
from qdrant_client.http import models as qdrant_models

from campus_retrieval_core.backend_qdrant_evidence import build_evidence_sources_from_records
from campus_retrieval_core.backend_qdrant_filters import _build_qdrant_filter
from campus_retrieval_core.backend_qdrant_runtime import _RetrievalDeadline, _retry_qdrant_read
from campus_retrieval_core.evidence_attributes import evidence_attributes_for_source
from campus_retrieval_core.models import RetrievalRequest

_CONDITION_TABLE_CORE_CUES = (
    "申请",
    "参评",
    "评选对象",
    "参评对象",
    "具有学校正式学籍",
    "全日制本科",
    "热爱祖国",
    "拥护中国共产党",
    "遵纪守法",
    "遵守学校规章制度",
    "诚实守信",
    "道德品质",
    "学习成绩",
    "学业成绩",
    "成绩优良",
    "成绩优秀",
    "单科成绩",
    "平均成绩",
    "综合测评",
    "排名",
    "家庭经济困难",
)
_CONDITION_TABLE_NON_ELIGIBILITY_CUES = (
    "颁发",
    "奖金",
    "奖励标准",
    "荣誉证书",
    "装入学生本人档案",
    "表彰奖励相关材料",
    "不再适用此奖励",
)
_ANSWER_ROLE_ROW_CANDIDATE_LIMIT = 16


def should_use_answer_role_row_lookup(request: RetrievalRequest) -> bool:
    semantic_hint = request.semantic_hint
    if semantic_hint is None:
        return False
    if semantic_hint.intent_kind not in {"condition_table", "eligibility_judgment"}:
        return False
    if semantic_hint.selection_policy not in {
        "answer_role_first",
        "one_answer_ready_source_per_member",
    }:
        return False
    if not request.target_document_ids:
        return False
    return bool(role for role in semantic_hint.expected_answer_roles if role != "eligibility_intro")


def retrieve_answer_role_rows(
    backend: object,
    *,
    request: RetrievalRequest,
    profile: CollectionRuntimeProfile,
    qdrant_collection_name: str,
    deadline: _RetrievalDeadline,
) -> EvidenceBundle:
    records = _scroll_answer_role_records(
        backend,
        request=request,
        profile=profile,
        qdrant_collection_name=qdrant_collection_name,
        deadline=deadline,
    )
    sources = build_evidence_sources_from_records(
        backend,
        records,
        default_score=1.0,
    )
    ordered_sources = _rank_answer_role_sources(
        request=request,
        sources=_dedupe_sources_by_chunk_id(sources),
    )
    return EvidenceBundle(
        query_text=request.query_text,
        corpus=request.corpus,
        collection=request.collection,
        sources=ordered_sources[: request.top_k],
    )


def _scroll_answer_role_records(
    backend: object,
    *,
    request: RetrievalRequest,
    profile: CollectionRuntimeProfile,
    qdrant_collection_name: str,
    deadline: _RetrievalDeadline,
) -> tuple[qdrant_models.Record, ...]:
    candidate_limit = _answer_role_row_candidate_limit(request=request, profile=profile)
    document_ids = tuple(dict.fromkeys(request.target_document_ids))
    if _should_scroll_condition_subject_records_by_document(
        request=request, document_ids=document_ids
    ):
        per_document_limit = _per_document_candidate_limit(
            candidate_limit=candidate_limit,
            document_count=len(document_ids),
        )
        records: list[qdrant_models.Record] = []
        for document_id in document_ids:
            if deadline.is_expired():
                raise TimeoutError("qdrant read deadline exceeded")
            records.extend(
                _scroll_answer_role_records_for_request(
                    backend,
                    request=replace(request, target_document_ids=(document_id,)),
                    profile=profile,
                    qdrant_collection_name=qdrant_collection_name,
                    deadline=deadline,
                    candidate_limit=per_document_limit,
                )
            )
            if len(records) >= candidate_limit:
                break
        return tuple(records[:candidate_limit])
    return _scroll_answer_role_records_for_request(
        backend,
        request=request,
        profile=profile,
        qdrant_collection_name=qdrant_collection_name,
        deadline=deadline,
        candidate_limit=candidate_limit,
    )


def _scroll_answer_role_records_for_request(
    backend: object,
    *,
    request: RetrievalRequest,
    profile: CollectionRuntimeProfile,
    qdrant_collection_name: str,
    deadline: _RetrievalDeadline,
    candidate_limit: int,
) -> tuple[qdrant_models.Record, ...]:
    records: list[qdrant_models.Record] = []
    offset: int | str | None = None
    qdrant_filter = _build_qdrant_filter(request, profile=profile)
    while len(records) < candidate_limit:
        if deadline.is_expired():
            raise TimeoutError("qdrant read deadline exceeded")
        remaining = candidate_limit - len(records)
        batch, offset = _retry_qdrant_read(
            lambda remaining=remaining, offset=offset: backend.qdrant_client.scroll(
                collection_name=qdrant_collection_name,
                scroll_filter=qdrant_filter,
                limit=remaining,
                offset=offset,
                with_payload=True,
                with_vectors=False,
                timeout=deadline.qdrant_timeout_seconds(),
            ),
            deadline=deadline,
        )
        if not batch:
            break
        records.extend(batch)
        if offset is None:
            break
    return tuple(records[:candidate_limit])


def _should_scroll_condition_subject_records_by_document(
    *,
    request: RetrievalRequest,
    document_ids: tuple[str, ...],
) -> bool:
    semantic_hint = request.semantic_hint
    if semantic_hint is None:
        return False
    return (
        len(document_ids) > 1
        and semantic_hint.coverage_policy == "condition_subject_alignment"
        and bool(semantic_hint.condition_subject)
    )


def _per_document_candidate_limit(*, candidate_limit: int, document_count: int) -> int:
    if document_count <= 0:
        raise ValueError("document_count must be greater than zero")
    return max(1, (candidate_limit + document_count - 1) // document_count)


def _answer_role_row_candidate_limit(
    *,
    request: RetrievalRequest,
    profile: CollectionRuntimeProfile,
) -> int:
    return max(request.top_k, _ANSWER_ROLE_ROW_CANDIDATE_LIMIT)


def _dedupe_sources_by_chunk_id(sources: Sequence[EvidenceSource]) -> tuple[EvidenceSource, ...]:
    selected: list[EvidenceSource] = []
    seen_chunk_ids: set[str] = set()
    for source in sources:
        key = source.chunk_id or repr(source)
        if key in seen_chunk_ids:
            continue
        seen_chunk_ids.add(key)
        selected.append(source)
    return tuple(selected)


def _rank_answer_role_sources(
    *,
    request: RetrievalRequest,
    sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    admitted_sources = tuple(
        source
        for source in sources
        if _answer_role_priority(request, _source_answer_role(source)) >= 0
    )
    return tuple(
        sorted(
            admitted_sources,
            key=lambda source: _answer_role_source_sort_key(request=request, source=source),
            reverse=True,
        )
    )


def _answer_role_source_sort_key(
    *,
    request: RetrievalRequest,
    source: EvidenceSource,
) -> tuple[int, int, int, int, float]:
    attributes = evidence_attributes_for_source(source)
    return (
        _answer_role_priority(request, attributes.answer_role),
        _condition_subject_score(request=request, source=source),
        _condition_core_text_score(source.snippet),
        1 if source.is_answer_bearing else 0,
        source.score,
    )


def _condition_subject_score(*, request: RetrievalRequest, source: EvidenceSource) -> int:
    semantic_hint = request.semantic_hint
    if semantic_hint is None or not semantic_hint.condition_subject:
        return 0
    attributes = evidence_attributes_for_source(source)
    if attributes.condition_subject == semantic_hint.condition_subject:
        return 20
    if attributes.condition_group_subject == semantic_hint.condition_subject:
        return 14
    if attributes.condition_subject or attributes.condition_group_subject:
        return -8
    return 0


def _answer_role_priority(request: RetrievalRequest, answer_role: str) -> int:
    semantic_hint = request.semantic_hint
    if semantic_hint is None:
        return -1
    expected_roles = tuple(
        dict.fromkeys(
            role
            for role in semantic_hint.expected_answer_roles
            if role and role != "eligibility_intro"
        )
    )
    for index, expected_role in enumerate(expected_roles):
        if answer_role == expected_role:
            return len(expected_roles) - index
    return -1


def _source_answer_role(source: EvidenceSource) -> str:
    return evidence_attributes_for_source(source).answer_role


def _condition_core_text_score(text: str) -> int:
    normalized = text.strip()
    score = sum(2 for cue in _CONDITION_TABLE_CORE_CUES if cue in normalized)
    score -= sum(4 for cue in _CONDITION_TABLE_NON_ELIGIBILITY_CUES if cue in normalized)
    if "用以奖励" in normalized and "申请" not in normalized and "参评" not in normalized:
        score -= 6
    return score


__all__ = [
    "retrieve_answer_role_rows",
    "should_use_answer_role_row_lookup",
]
