from __future__ import annotations

import re
from typing import Callable

from campus_contracts import (
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    RagRequestPayload,
    RagResultPayload,
    SpecialistRequest,
    SpecialistResponse,
)
from campus_retrieval_core import CorpusQueryDisabledError, RetrievalBackendError, retrieve_sources

from campus_rag_specialist.agent import RagSpecialistAgent
from campus_rag_specialist.confidence import derive_confidence


Retriever = Callable[..., object]
_REFERENTIAL_PATTERNS = (
    "这个规定",
    "这个办法",
    "这个流程",
    "这个政策",
    "这个",
    "那个",
    "this rule",
    "that rule",
    "this policy",
    "that policy",
    "this process",
    "that process",
)
_GENERIC_AMBIGUOUS_TOPICS = ("奖学金", "scholarship", "学位", "degree", "规定", "办法", "policy", "流程", "procedure")
_GENERIC_TOPIC_QUALIFIERS = {
    "奖学金": ("国家", "励志", "专业", "专项", "社会", "助学金"),
    "scholarship": ("national", "professional", "special", "grant"),
    "学位": ("学士", "硕士", "博士", "本科"),
    "degree": ("bachelor", "master", "doctoral", "phd"),
}
_WHITESPACE_RE = re.compile(r"\s+")


def delegate_to_rag_agent(
    request: SpecialistRequest,
    *,
    retriever: Callable[..., object] = retrieve_sources,
) -> SpecialistResponse:
    if request.target != "rag-specialist":
        raise ValueError("delegate_to_rag_agent only accepts target='rag-specialist'")
    if not isinstance(request.payload, RagRequestPayload):
        raise TypeError("rag-specialist requires RagRequestPayload")

    user_goal = request.user_goal.strip()
    if _should_clarify_without_retrieval(user_goal):
        empty_evidence = EvidenceBundle(
            query_text=user_goal,
            corpus=request.payload.scope.corpus,
            collection=request.payload.scope.collection,
        )
        return SpecialistResponse(
            target="rag-specialist",
            status="needs_clarification",
            confidence="low",
            follow_up_question=_build_clarification_question(user_goal, empty_evidence),
            result=RagResultPayload(evidence=empty_evidence),
        )

    try:
        evidence = retriever(
            user_goal,
            corpus=request.payload.scope.corpus,
            collection=request.payload.scope.collection,
            campus_scope=request.actor.campus_scope,
            acl_groups=request.actor.groups,
        )
    except CorpusQueryDisabledError as exc:
        return SpecialistResponse(
            target="rag-specialist",
            status="error",
            confidence="low",
            error=ErrorInfo(code="corpus_not_query_enabled", message=str(exc), retryable=False),
        )
    except RetrievalBackendError as exc:
        return SpecialistResponse(
            target="rag-specialist",
            status="error",
            confidence="low",
            error=ErrorInfo(code="retrieval_failed", message=str(exc), retryable=False),
        )
    if not evidence.sources:
        return SpecialistResponse(
            target="rag-specialist",
            status="no_answer",
            confidence="low",
            result=RagResultPayload(evidence=evidence),
        )
    if _should_clarify_with_evidence(user_goal, evidence):
        return SpecialistResponse(
            target="rag-specialist",
            status="needs_clarification",
            confidence="low",
            follow_up_question=_build_clarification_question(user_goal, evidence),
            result=RagResultPayload(evidence=evidence),
        )

    confidence = derive_confidence(evidence)
    if confidence == "low":
        return SpecialistResponse(
            target="rag-specialist",
            status="no_answer",
            confidence="low",
            result=RagResultPayload(evidence=evidence),
        )

    agent = RagSpecialistAgent()
    return SpecialistResponse(
        target="rag-specialist",
        status="completed",
        answer_text=agent.compose_answer(evidence),
        confidence=confidence,
        result=RagResultPayload(evidence=evidence),
    )


def _should_clarify_without_retrieval(user_goal: str) -> bool:
    normalized_goal = _normalize_text(user_goal).lower()
    if any(pattern in normalized_goal for pattern in _REFERENTIAL_PATTERNS):
        return True
    return _is_target_missing_query(normalized_goal)


def _should_clarify_with_evidence(user_goal: str, evidence: EvidenceBundle) -> bool:
    if len(evidence.sources) < 2:
        return False

    first_source = evidence.sources[0]
    second_source = next(
        (source for source in evidence.sources[1:] if source.doc_id != first_source.doc_id),
        None,
    )
    if second_source is None:
        return False

    normalized_goal = _normalize_text(user_goal).lower()
    if not any(topic in normalized_goal for topic in _GENERIC_AMBIGUOUS_TOPICS):
        return False

    first_label = _source_label(first_source).lower()
    second_label = _source_label(second_source).lower()
    if (first_label and first_label in normalized_goal) or (second_label and second_label in normalized_goal):
        return False

    return abs(first_source.score - second_source.score) <= 0.12


def _build_clarification_question(user_goal: str, evidence: EvidenceBundle) -> str:
    if evidence.sources:
        labels: list[str] = []
        for source in evidence.sources:
            label = _source_label(source)
            if label and label not in labels:
                labels.append(label)
            if len(labels) >= 3:
                break
        if labels:
            return f"请说明你想咨询哪一项内容。当前相关结果包括：{'、'.join(labels)}。"
    if "奖学金" in user_goal or "scholarship" in user_goal.lower():
        return "请说明你想咨询哪一类奖学金或对应的评审办法。"
    return "请具体说明你想咨询学生手册中的哪一项制度、流程或表格。"


def _source_label(source: EvidenceSource) -> str:
    snippet = _normalize_text(source.snippet)
    for separator in (" | ", " / "):
        if separator in snippet:
            return snippet.split(separator, 1)[0].strip()
    return snippet.split("。", 1)[0].strip()


def _normalize_text(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", text).strip()


def _is_target_missing_query(normalized_goal: str) -> bool:
    for topic, qualifiers in _GENERIC_TOPIC_QUALIFIERS.items():
        if topic in normalized_goal and not any(qualifier in normalized_goal for qualifier in qualifiers):
            return True
    return False
