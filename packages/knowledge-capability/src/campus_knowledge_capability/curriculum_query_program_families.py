from __future__ import annotations

from campus_retrieval_core.curriculum_query_resolution import interpret_curriculum_query

from .curriculum_query_config import _load_program_family_configs
from .curriculum_query_models import CurriculumProgramFamilyQueryPlan
from .curriculum_query_text import _normalize_text

_PROGRAM_FAMILY_MEMBERSHIP_CUES = ("有哪些", "有哪几个", "都有哪些", "包括哪些")
_PROGRAM_FAMILY_NAME_PATTERN_PREFIXES = ("名称里带", "名字里带")
_PROGRAM_FAMILY_QUERY_BLOCKERS = (
    "培养方案",
    "学期",
    "大一",
    "大二",
    "大三",
    "大四",
    "大五",
    "课程",
    "课表",
    "总学分",
)


def plan_curriculum_program_family_query(
    query_text: str,
) -> CurriculumProgramFamilyQueryPlan | None:
    interpretation = interpret_curriculum_query(query_text)
    normalized_query = interpretation.normalized_query_text
    if not _is_program_family_membership_query(normalized_query):
        return None
    families = sorted(
        _load_program_family_configs(),
        key=lambda item: max((len(alias) for alias in item.match_aliases), default=0),
        reverse=True,
    )
    for family in families:
        if not any(alias in normalized_query for alias in family.match_aliases):
            continue
        if family.mode == "direct_answer_family":
            return CurriculumProgramFamilyQueryPlan(
                resolution_mode="resolved_family",
                canonical_program_family_id=family.canonical_program_family_id,
                canonical_program_family_title=family.canonical_program_family_title,
            )
        return CurriculumProgramFamilyQueryPlan(
            resolution_mode="needs_clarification",
            canonical_program_family_title=family.canonical_program_family_title,
            clarification_reason=f"program_family:{family.canonical_program_family_id}",
            clarification_candidates=family.clarification_options,
        )
    return None


def _is_program_family_membership_query(normalized_query: str) -> bool:
    if not any(cue in normalized_query for cue in _PROGRAM_FAMILY_MEMBERSHIP_CUES):
        return False
    if any(prefix in normalized_query for prefix in _PROGRAM_FAMILY_NAME_PATTERN_PREFIXES):
        return True
    return not any(blocker in normalized_query for blocker in _PROGRAM_FAMILY_QUERY_BLOCKERS)


def _clarification_options_for_program_family_alias(alias: str) -> tuple[str, ...]:
    normalized_alias = _normalize_text(alias)
    for family in _load_program_family_configs():
        if family.mode != "clarify_first_family":
            continue
        if any(_normalize_text(value) == normalized_alias for value in family.match_aliases):
            return family.clarification_options
    return ()


def _query_contains_more_specific_family_alias(normalized_query: str, alias: str) -> bool:
    normalized_alias = _normalize_text(alias)
    for family in _load_program_family_configs():
        for match_alias in family.match_aliases:
            normalized_match_alias = _normalize_text(match_alias)
            if normalized_match_alias == normalized_alias:
                continue
            if (
                normalized_alias in normalized_match_alias
                and normalized_match_alias in normalized_query
            ):
                return True
    return False


__all__ = [
    "plan_curriculum_program_family_query",
]
