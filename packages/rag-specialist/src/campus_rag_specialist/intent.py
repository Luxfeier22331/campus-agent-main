from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Literal

from campus_contracts import PersonalizationHint, SpecialistRequest


RagQuestionKind = Literal["fact", "policy_basis", "eligibility", "procedure", "materials", "deadline", "comparison"]
RagPersonalizationMode = Literal["generic", "cohort_grounded", "user_grounded"]
RagResponseMode = Literal["clarify", "retrieve_then_answer", "no_answer"]
RagRetrievalPlan = Literal["default_rewrite", "personalized_rewrite"]

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


@dataclass(frozen=True, slots=True)
class RagIntentFrame:
    question_kind: RagQuestionKind
    personalization_mode: RagPersonalizationMode
    missing_slots: tuple[str, ...]
    ambiguity_reason: str | None
    retrieval_plan: RagRetrievalPlan
    response_mode: RagResponseMode


def frame_rag_intent(request: SpecialistRequest) -> RagIntentFrame:
    normalized_goal = _normalize_text(request.user_goal).lower()
    personalization_hint = build_personalization_hint(request)
    personalization_mode: RagPersonalizationMode
    if personalization_hint.recent_goal or personalization_hint.confirmed_slot_terms:
        personalization_mode = "user_grounded"
    elif personalization_hint.actor_claim_terms:
        personalization_mode = "cohort_grounded"
    else:
        personalization_mode = "generic"

    ambiguity_reason: str | None = None
    missing_slots: tuple[str, ...] = ()
    response_mode: RagResponseMode = "retrieve_then_answer"
    if any(pattern in normalized_goal for pattern in _REFERENTIAL_PATTERNS):
        ambiguity_reason = "referential"
        missing_slots = ("target_policy",)
        response_mode = "clarify"
    elif _is_target_missing_query(normalized_goal):
        ambiguity_reason = "missing_target"
        missing_slots = ("target_policy",)
        response_mode = "clarify"

    return RagIntentFrame(
        question_kind=_question_kind(normalized_goal),
        personalization_mode=personalization_mode,
        missing_slots=missing_slots,
        ambiguity_reason=ambiguity_reason,
        retrieval_plan="personalized_rewrite" if personalization_mode != "generic" else "default_rewrite",
        response_mode=response_mode,
    )


def build_personalization_hint(request: SpecialistRequest) -> PersonalizationHint:
    actor_terms: list[str] = []
    actor = request.context.actor
    visibility_scope = request.context.authorization.visibility_scope
    if visibility_scope:
        actor_terms.append(f"{visibility_scope} campus")
    if actor.cohort:
        actor_terms.append(f"{actor.cohort} cohort")
    if actor.major:
        actor_terms.append(f"{actor.major} major")
    if actor.program:
        actor_terms.append(f"{actor.program} program")

    recent_goal = ""
    for item in request.context.profile_memory.items:
        if item.visibility != "user_visible":
            continue
        if item.key == "recent_goal":
            recent_goal = item.value
            break

    confirmed_slot_terms = tuple(
        slot.value
        for slot in request.context.session.confirmed_slots
        if slot.confirmed and slot.value.strip()
    )
    return PersonalizationHint(
        actor_claim_terms=tuple(actor_terms),
        recent_goal=recent_goal,
        confirmed_slot_terms=confirmed_slot_terms,
    )


def _question_kind(normalized_goal: str) -> RagQuestionKind:
    if any(token in normalized_goal for token in ("流程", "办理", "申请", "process", "how do i", "how to")):
        return "procedure"
    if any(token in normalized_goal for token in ("条件", "资格", "eligible", "eligibility")):
        return "eligibility"
    if any(token in normalized_goal for token in ("材料", "document", "documents")):
        return "materials"
    if any(token in normalized_goal for token in ("截止", "deadline", "截至")):
        return "deadline"
    if any(token in normalized_goal for token in ("还是", "区别", "compare", "vs")):
        return "comparison"
    if any(token in normalized_goal for token in ("依据", "条文", "policy basis")):
        return "policy_basis"
    return "fact"


def _normalize_text(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", text).strip()


def _is_target_missing_query(normalized_goal: str) -> bool:
    for topic, qualifiers in _GENERIC_TOPIC_QUALIFIERS.items():
        if topic in normalized_goal and not any(qualifier in normalized_goal for qualifier in qualifiers):
            return True
    return False
