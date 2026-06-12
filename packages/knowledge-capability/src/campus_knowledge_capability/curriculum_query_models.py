from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .retrieval_intent import (
    RetrievalIntent,
    retrieval_intent_for_curriculum_course_plan,
    retrieval_intent_for_curriculum_plan,
    retrieval_intent_for_curriculum_program_family_plan,
)


@dataclass(frozen=True, slots=True)
class CurriculumCourseEntity:
    entity_type: Literal["course", "course_family"]
    canonical_id: str
    title: str
    aliases: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class CurriculumCourseQueryPlan:
    resolution_mode: Literal["resolved_single", "resolved_family"]
    entity_type: Literal["course", "course_family"]
    fact_intent: Literal["generic", "audience", "family_membership", "schedule"] = "generic"
    canonical_course_id: str = ""
    canonical_course_title: str = ""
    canonical_course_family_id: str = ""
    canonical_course_family_title: str = ""
    internal_collection: str = "course_facts"
    unsupported_fields: tuple[str, ...] = ()
    partial_answer: bool = False

    @property
    def retrieval_intent(self) -> RetrievalIntent:
        return retrieval_intent_for_curriculum_course_plan(self)


@dataclass(frozen=True, slots=True)
class CurriculumProgramFamilyQueryPlan:
    resolution_mode: Literal["resolved_family", "needs_clarification"]
    canonical_program_family_id: str = ""
    canonical_program_family_title: str = ""
    internal_collection: str = "program_family_facts"
    clarification_reason: str = ""
    clarification_candidates: tuple[str, ...] = ()

    @property
    def retrieval_intent(self) -> RetrievalIntent:
        return retrieval_intent_for_curriculum_program_family_plan(self)


@dataclass(frozen=True, slots=True)
class CurriculumDocument:
    document_id: str
    title: str
    title_key: str


@dataclass(frozen=True, slots=True)
class CurriculumQueryPlan:
    status: Literal[
        "pass_through", "resolved", "soft_preference", "needs_clarification", "unsupported"
    ]
    rewritten_query_text: str
    intent_kind: Literal["generic", "course_list", "curriculum_lookup"] = "generic"
    target_document_ids: tuple[str, ...] = ()
    preferred_document_ids: tuple[str, ...] = ()
    clarification_reason: str = ""
    unsupported_reason: str = ""
    clarification_candidates: tuple[str, ...] = ()
    resolved_document_title: str = ""
    used_verified_identity: bool = False
    used_soft_preference: bool = False
    candidate_title_summary: tuple[str, ...] = ()

    @property
    def retrieval_intent(self) -> RetrievalIntent:
        return retrieval_intent_for_curriculum_plan(self)


@dataclass(frozen=True, slots=True)
class CurriculumFamilyAliasConfig:
    alias: str
    candidate_terms: tuple[str, ...]
    major_candidates: dict[str, tuple[str, ...]]


@dataclass(frozen=True, slots=True)
class CurriculumQueryPlanningConfig:
    safe_aliases: tuple[tuple[str, str], ...]
    family_aliases: tuple[CurriculumFamilyAliasConfig, ...]
    scoped_aliases: tuple[tuple[str, str], ...]
    forbidden_generic_aliases: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ProgramFamilyConfig:
    canonical_program_family_id: str
    canonical_program_family_title: str
    match_aliases: tuple[str, ...]
    mode: Literal["direct_answer_family", "clarify_first_family"]
    clarification_options: tuple[str, ...] = ()
