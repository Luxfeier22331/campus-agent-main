from __future__ import annotations

from typing import Literal

from campus_retrieval_core.curriculum_query_resolution import interpret_curriculum_query

from .curriculum_query_config import (
    _course_entities,
    _course_family_entities,
    course_family_member_ids,
    course_family_member_titles,
)
from .curriculum_query_models import CurriculumCourseEntity, CurriculumCourseQueryPlan

_COURSE_LIST_CUES = ("包括哪些课", "包括什么课")
_COURSE_AUDIENCE_CUES = ("哪些专业要上", "谁要上", "哪些人要上")
_COURSE_SCHEDULE_CUES = ("第几学期开", "什么学期开", "哪学期开", "开设学期", "开课学期")
_COURSE_UNSUPPORTED_FIELD_CUES = {"offering_unit": ("哪个学院", "哪个系", "谁开", "开课学院")}


def plan_curriculum_course_query(query_text: str) -> CurriculumCourseQueryPlan | None:
    normalized_query = interpret_curriculum_query(query_text).normalized_query_text
    fact_intent = _resolve_course_fact_intent(normalized_query)
    resolved_course = _resolve_course_entity(normalized_query)
    if resolved_course is not None:
        unsupported_fields = _resolve_unsupported_course_fields(normalized_query)
        return CurriculumCourseQueryPlan(
            resolution_mode="resolved_single",
            entity_type="course",
            fact_intent=fact_intent,
            canonical_course_id=resolved_course.canonical_id,
            canonical_course_title=resolved_course.title,
            unsupported_fields=unsupported_fields,
            partial_answer=bool(unsupported_fields),
        )
    resolved_family = _resolve_course_family_entity(normalized_query)
    if resolved_family is None:
        return None
    unsupported_fields = _resolve_unsupported_course_fields(normalized_query)
    return CurriculumCourseQueryPlan(
        resolution_mode="resolved_family",
        entity_type="course_family",
        fact_intent=fact_intent,
        canonical_course_family_id=resolved_family.canonical_id,
        canonical_course_family_title=resolved_family.title,
        unsupported_fields=unsupported_fields,
        partial_answer=bool(unsupported_fields),
    )


def _resolve_course_entity(normalized_query: str) -> CurriculumCourseEntity | None:
    if _resolve_course_family_entity(normalized_query) is not None:
        if any(cue in normalized_query for cue in _COURSE_LIST_CUES):
            return None
        if "思政课" in normalized_query or "思修课" in normalized_query:
            return None
    for entity in _course_entities():
        for alias in entity.aliases:
            if alias in normalized_query:
                return entity
        if entity.title in normalized_query:
            return entity
    return None


def _resolve_course_family_entity(normalized_query: str) -> CurriculumCourseEntity | None:
    for entity in _course_family_entities():
        if entity.title in normalized_query:
            return entity
        if any(alias in normalized_query for alias in entity.aliases):
            return entity
    return None


def _resolve_unsupported_course_fields(normalized_query: str) -> tuple[str, ...]:
    fields = []
    for field_name, cues in _COURSE_UNSUPPORTED_FIELD_CUES.items():
        if any(cue in normalized_query for cue in cues):
            fields.append(field_name)
    return tuple(fields)


def _resolve_course_fact_intent(
    normalized_query: str,
) -> Literal["generic", "audience", "family_membership", "schedule"]:
    if any(cue in normalized_query for cue in _COURSE_LIST_CUES):
        return "family_membership"
    if any(cue in normalized_query for cue in _COURSE_AUDIENCE_CUES):
        return "audience"
    if any(cue in normalized_query for cue in _COURSE_SCHEDULE_CUES):
        return "schedule"
    return "generic"


__all__ = [
    "course_family_member_ids",
    "course_family_member_titles",
    "plan_curriculum_course_query",
]
