from __future__ import annotations

from campus_contracts import CurriculumFollowUpSlots

from campus_knowledge_capability.query_planning import CurriculumQueryPlan

from .service_common import _normalize_text

_CURRICULUM_SESSION_PROGRAM_FAMILIES = (
    "民族实验班",
    "强基计划",
    "第二学士学位",
)
_CURRICULUM_PROGRAM_TITLE_SUFFIXES = (
    "本科第二学士学位人才培养方案",
    "第二学士学位人才培养方案",
    "本科专业人才培养方案",
    "本科专业培养方案",
    "本科人才培养方案",
    "人才培养方案",
)


def _curriculum_resolution_mode(plan: CurriculumQueryPlan) -> str:
    if plan.status == "resolved":
        return "resolved_single"
    if plan.status == "soft_preference":
        return "soft_preference"
    if plan.status == "needs_clarification":
        return "needs_clarification"
    if plan.status == "unsupported":
        return "unsupported"
    return ""


def _resolve_curriculum_diagnostics_follow_up(
    *,
    curriculum_plan: CurriculumQueryPlan,
    allow_session_follow_up: bool,
) -> CurriculumFollowUpSlots:
    if not allow_session_follow_up or curriculum_plan.status != "resolved":
        return CurriculumFollowUpSlots()
    program_family = _derive_curriculum_session_program_family(
        curriculum_plan.resolved_document_title
    )
    semester = _derive_curriculum_session_semester(curriculum_plan.rewritten_query_text)
    program = _derive_curriculum_session_program(
        document_title=curriculum_plan.resolved_document_title,
        program_family=program_family,
    )
    if not program_family or not program or not semester:
        return CurriculumFollowUpSlots()
    return CurriculumFollowUpSlots(
        program_family=program_family,
        program=program,
        semester=semester,
    )


def _derive_curriculum_session_program_family(document_title: str) -> str:
    normalized_title = _normalize_text(document_title)
    for family in _CURRICULUM_SESSION_PROGRAM_FAMILIES:
        if _normalize_text(family) in normalized_title:
            return family
    return ""


def _derive_curriculum_session_program(
    *,
    document_title: str,
    program_family: str,
) -> str:
    core_title = _strip_curriculum_program_title(document_title)
    if not core_title:
        return ""
    if program_family and f"（{program_family}）" in core_title:
        return core_title.replace(f"（{program_family}）", program_family).strip()
    if program_family and f"({program_family})" in core_title:
        return core_title.replace(f"({program_family})", program_family).strip()
    if program_family and program_family not in core_title:
        return f"{core_title}{program_family}".strip()
    return core_title


def _strip_curriculum_program_title(document_title: str) -> str:
    title = document_title.strip()
    for suffix in _CURRICULUM_PROGRAM_TITLE_SUFFIXES:
        if title.endswith(suffix):
            return title[: -len(suffix)].strip()
    return title


def _derive_curriculum_session_semester(rewritten_query: str) -> str:
    from campus_retrieval_core.curriculum_query_resolution import interpret_curriculum_query

    interpretation = interpret_curriculum_query(rewritten_query)
    if interpretation.semester_labels:
        return interpretation.semester_labels[0]
    return ""


__all__ = [
    "_CURRICULUM_PROGRAM_TITLE_SUFFIXES",
    "_CURRICULUM_SESSION_PROGRAM_FAMILIES",
    "_curriculum_resolution_mode",
    "_derive_curriculum_session_program",
    "_derive_curriculum_session_program_family",
    "_derive_curriculum_session_semester",
    "_resolve_curriculum_diagnostics_follow_up",
    "_strip_curriculum_program_title",
]
