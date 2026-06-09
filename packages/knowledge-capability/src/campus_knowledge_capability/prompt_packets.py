from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from campus_contracts import CapabilityRequest, EvidenceBundle, EvidenceSource, KnowledgeScope

from campus_knowledge_capability.intent import RagIntentFrame, frame_rag_intent
from campus_knowledge_capability.remote_content_hardening import (
    apply_remote_content_suspicion_labels,
    build_remote_content_safe_summary,
)

RagPromptMode = Literal["answer", "clarify", "no_answer"]


@dataclass(frozen=True, slots=True)
class RagTaskPacket:
    request_id: str
    mode: RagPromptMode
    language: str
    question_kind: str
    personalization_mode: str
    resolved_scope_corpus: str
    resolved_scope_collection: str
    retrieval_plan: str
    allowed_actions: tuple[str, ...] = ()
    forbidden_actions: tuple[str, ...] = ()
    response_constraints: tuple[str, ...] = ()
    output_schema_name: str = ""
    ambiguity_reason: str | None = None
    missing_slots: tuple[str, ...] = ()
    no_answer_reason: str = ""
    citation_expected: bool = False


@dataclass(frozen=True, slots=True)
class RagEvidencePacketEntry:
    doc_id: str
    source_title: str
    detail_label: str
    structural_path: tuple[str, ...]
    snippet: str
    safe_summary: str
    score: float


@dataclass(frozen=True, slots=True)
class RagPromptPacket:
    prompt_id: str
    task: RagTaskPacket
    user_input_text: str
    safety_identifier: str | None = None
    evidence: tuple[RagEvidencePacketEntry, ...] = ()


def build_rag_clarify_prompt_packet(
    request: CapabilityRequest,
    *,
    intent_frame: RagIntentFrame | None = None,
    resolved_scope: KnowledgeScope,
) -> RagPromptPacket:
    frame = intent_frame or frame_rag_intent(request)
    if frame.response_mode != "clarify":
        raise ValueError("rag clarify prompt packet requires response_mode='clarify'")
    task = RagTaskPacket(
        request_id=request.request_id,
        mode="clarify",
        language="zh-CN",
        question_kind=frame.question_kind,
        personalization_mode=frame.personalization_mode,
        resolved_scope_corpus=resolved_scope.corpus,
        resolved_scope_collection=resolved_scope.collection,
        retrieval_plan=frame.retrieval_plan,
        allowed_actions=("ask_for_missing_information", "use_brief_user_facing_wording"),
        forbidden_actions=(
            "invent_facts",
            "override_authz",
            "expand_scope",
            "use_internal_jargon",
        ),
        response_constraints=("single_follow_up_question", "brief", "user_facing"),
        output_schema_name="rag_clarify_v1",
        ambiguity_reason=frame.ambiguity_reason,
        missing_slots=frame.missing_slots,
    )
    return RagPromptPacket(
        prompt_id="rag_clarify_v1",
        task=task,
        user_input_text=request.user_goal,
        safety_identifier=request.safety_identifier,
    )


def build_rag_no_answer_prompt_packet(
    request: CapabilityRequest,
    *,
    resolved_scope: KnowledgeScope,
    evidence: EvidenceBundle,
    no_answer_reason: str,
    intent_frame: RagIntentFrame | None = None,
) -> RagPromptPacket:
    frame = intent_frame or frame_rag_intent(request)
    apply_remote_content_suspicion_labels(evidence)
    prompt_id = _resolve_no_answer_prompt_id(no_answer_reason)
    task = RagTaskPacket(
        request_id=request.request_id,
        mode="no_answer",
        language="zh-CN",
        question_kind=frame.question_kind,
        personalization_mode=frame.personalization_mode,
        resolved_scope_corpus=resolved_scope.corpus,
        resolved_scope_collection=resolved_scope.collection,
        retrieval_plan=frame.retrieval_plan,
        allowed_actions=("explain_gap_briefly", "cite_safe_limitations"),
        forbidden_actions=(
            "invent_facts",
            "override_authz",
            "quote_hidden_content",
            "use_internal_jargon",
        ),
        response_constraints=("brief", "user_facing", "no_hidden_content_leak"),
        output_schema_name=prompt_id,
        ambiguity_reason=frame.ambiguity_reason,
        missing_slots=frame.missing_slots,
        no_answer_reason=no_answer_reason,
    )
    return RagPromptPacket(
        prompt_id=prompt_id,
        task=task,
        user_input_text=request.user_goal,
        safety_identifier=request.safety_identifier,
        evidence=tuple(_serialize_evidence_entry(source) for source in evidence.sources),
    )


def build_rag_answer_prompt_packet(
    request: CapabilityRequest,
    *,
    resolved_scope: KnowledgeScope,
    evidence: EvidenceBundle,
    intent_frame: RagIntentFrame | None = None,
) -> RagPromptPacket:
    frame = intent_frame or frame_rag_intent(request)
    apply_remote_content_suspicion_labels(evidence)
    task = RagTaskPacket(
        request_id=request.request_id,
        mode="answer",
        language="zh-CN",
        question_kind=frame.question_kind,
        personalization_mode=frame.personalization_mode,
        resolved_scope_corpus=resolved_scope.corpus,
        resolved_scope_collection=resolved_scope.collection,
        retrieval_plan=frame.retrieval_plan,
        allowed_actions=("summarize_grounded_evidence", "cite_support_briefly"),
        forbidden_actions=(
            "invent_facts",
            "override_authz",
            "quote_hidden_content",
            "use_internal_jargon",
        ),
        response_constraints=("brief", "grounded", "user_facing"),
        output_schema_name="rag_answer_v1",
        ambiguity_reason=frame.ambiguity_reason,
        missing_slots=frame.missing_slots,
        citation_expected=True,
    )
    return RagPromptPacket(
        prompt_id="rag_answer_v1",
        task=task,
        user_input_text=request.user_goal,
        safety_identifier=request.safety_identifier,
        evidence=tuple(_serialize_evidence_entry(source) for source in evidence.sources),
    )


def _serialize_evidence_entry(source: EvidenceSource) -> RagEvidencePacketEntry:
    return RagEvidencePacketEntry(
        doc_id=source.doc_id,
        source_title=source.source_title,
        detail_label=source.detail_label,
        structural_path=source.structural_path,
        snippet=source.snippet,
        safe_summary=build_remote_content_safe_summary(source),
        score=source.score,
    )


def _resolve_no_answer_prompt_id(no_answer_reason: str) -> str:
    if no_answer_reason == "restricted_access_denied":
        return "rag_no_answer_v1"
    return "rag_unsupported_v1"


__all__ = [
    "RagEvidencePacketEntry",
    "RagPromptMode",
    "RagPromptPacket",
    "RagTaskPacket",
    "build_rag_answer_prompt_packet",
    "build_rag_clarify_prompt_packet",
    "build_rag_no_answer_prompt_packet",
]
