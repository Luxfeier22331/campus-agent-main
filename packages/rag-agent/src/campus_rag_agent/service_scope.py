from __future__ import annotations

from campus_contracts import CurriculumFollowUpSlots, KnowledgeScope, SpecialistRequest
from campus_ingestion_core.curriculum_program_semester_facts_projection import (
    build_curriculum_program_semester_fact_document_id,
)
from campus_retrieval_core.curriculum_query_resolution import interpret_curriculum_query

from campus_rag_agent.query_planning import (
    CurriculumCourseQueryPlan,
    CurriculumProgramFamilyQueryPlan,
    CurriculumQueryPlan,
    HandbookQueryPlan,
    plan_curriculum_course_query,
    plan_curriculum_program_family_query,
    plan_curriculum_query,
    plan_student_handbook_query,
)

from .service_common import _normalize_text

_CURRICULUM_SCOPE_CUES = (
    "培养方案",
    "课程教学计划",
    "总学分",
    "毕业要求",
    "学期",
    "什么课",
    "哪些课",
    "课表",
)
_CURRICULUM_FOLLOW_UP_PREFIXES = ("那如果是", "如果是", "那如果", "那就", "换成", "还有", "那")
_CURRICULUM_FOLLOW_UP_TRAILING_PARTICLES = "呢呀啊吧嘛的"
_CURRICULUM_FOLLOW_UP_PROGRAM_BLOCKERS = frozenset(
    {
        "培养方案",
        "课程教学计划",
        "第",
        "学期",
        "课程",
        "课表",
        "什么",
        "哪些",
        "多少",
        "几年",
        "怎么",
        "如何",
        "学院",
        "专业要上",
    }
)


def _resolve_request_scope(
    request: SpecialistRequest,
    *,
    user_goal: str,
) -> KnowledgeScope | None:
    if request.payload.scope is not None:
        return request.payload.scope

    handbook_plan = plan_student_handbook_query(user_goal)
    curriculum_plan = plan_curriculum_query(
        user_goal,
        verified_major=request.context.actor.major,
    )
    curriculum_course_plan = plan_curriculum_course_query(user_goal)
    curriculum_program_family_plan = plan_curriculum_program_family_query(user_goal)

    has_curriculum_signal = _has_curriculum_scope_signal(
        user_goal=user_goal,
        curriculum_plan=curriculum_plan,
        curriculum_course_plan=curriculum_course_plan,
        curriculum_program_family_plan=curriculum_program_family_plan,
    )
    has_handbook_signal = handbook_plan.status != "pass_through"

    if has_curriculum_signal and not has_handbook_signal:
        return KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
    if has_handbook_signal and not has_curriculum_signal:
        return KnowledgeScope(corpus="regulations", collection="student_handbook")
    if has_curriculum_signal and has_handbook_signal:
        if handbook_plan.status == "resolved":
            return KnowledgeScope(corpus="regulations", collection="student_handbook")
        return KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
    return None


def _has_curriculum_scope_signal(
    *,
    user_goal: str,
    curriculum_plan: CurriculumQueryPlan,
    curriculum_course_plan: CurriculumCourseQueryPlan | None,
    curriculum_program_family_plan: CurriculumProgramFamilyQueryPlan | None,
) -> bool:
    if curriculum_course_plan is not None or curriculum_program_family_plan is not None:
        return True
    if curriculum_plan.status != "pass_through":
        return True
    normalized_goal = _normalize_text(user_goal)
    return any(cue in normalized_goal for cue in _CURRICULUM_SCOPE_CUES)


def _resolve_effective_curriculum_user_goal(
    scope: KnowledgeScope,
    *,
    user_goal: str,
    curriculum_follow_up: CurriculumFollowUpSlots,
    recent_goal: str,
) -> str:
    if scope.corpus != "curriculum" or scope.collection != "curriculum_plan":
        return user_goal
    rewritten_goal = _rewrite_curriculum_follow_up_goal(
        user_goal=user_goal,
        curriculum_follow_up=curriculum_follow_up,
    )
    if rewritten_goal:
        return rewritten_goal
    if not recent_goal.strip():
        return user_goal
    rewritten_goal = _rewrite_curriculum_follow_up_goal_from_recent_goal(
        user_goal=user_goal,
        recent_goal=recent_goal,
    )
    return rewritten_goal or user_goal


def _rewrite_curriculum_follow_up_goal(
    *,
    user_goal: str,
    curriculum_follow_up: CurriculumFollowUpSlots,
) -> str:
    current_interpretation = interpret_curriculum_query(user_goal)
    if current_interpretation.program_query_fragment:
        return ""

    if current_interpretation.semester_labels:
        if curriculum_follow_up.program:
            return f"{curriculum_follow_up.program}培养方案里{current_interpretation.semester_labels[0]}有什么课"
        return ""

    follow_up_program_fragment = _extract_curriculum_follow_up_program_fragment(
        current_interpretation.normalized_query_text,
    )
    if not follow_up_program_fragment or not curriculum_follow_up.program_family:
        return ""
    resolved_program = f"{follow_up_program_fragment}{curriculum_follow_up.program_family}"
    if curriculum_follow_up.semester:
        return f"{resolved_program}培养方案里{curriculum_follow_up.semester}有什么课"
    return f"{resolved_program}培养方案"


def _rewrite_curriculum_follow_up_goal_from_recent_goal(*, user_goal: str, recent_goal: str) -> str:
    recent_interpretation = interpret_curriculum_query(recent_goal)
    if not recent_interpretation.program_query_fragment:
        return ""

    current_interpretation = interpret_curriculum_query(user_goal)
    if current_interpretation.program_query_fragment:
        return ""

    if current_interpretation.semester_labels:
        return _rewrite_curriculum_follow_up_semester_goal(
            recent_goal=recent_interpretation.normalized_query_text,
            recent_program_fragment=recent_interpretation.program_query_fragment,
            recent_semester_labels=recent_interpretation.semester_labels,
            current_semester_label=current_interpretation.semester_labels[0],
            recent_intent_kind=recent_interpretation.intent_kind,
        )

    follow_up_program_fragment = _extract_curriculum_follow_up_program_fragment(
        current_interpretation.normalized_query_text,
    )
    if not follow_up_program_fragment:
        return ""
    return recent_interpretation.normalized_query_text.replace(
        recent_interpretation.program_query_fragment,
        f"{follow_up_program_fragment}{recent_interpretation.program_query_fragment}",
        1,
    )


def _rewrite_curriculum_follow_up_semester_goal(
    *,
    recent_goal: str,
    recent_program_fragment: str,
    recent_semester_labels: tuple[str, ...],
    current_semester_label: str,
    recent_intent_kind: str,
) -> str:
    if recent_semester_labels:
        return recent_goal.replace(recent_semester_labels[0], current_semester_label, 1)
    if recent_intent_kind == "course_list":
        return f"{recent_program_fragment}里{current_semester_label}有什么课"
    return f"{recent_program_fragment} {current_semester_label}".strip()


def _extract_curriculum_follow_up_program_fragment(normalized_query: str) -> str:
    compact_query = _normalize_text(normalized_query)
    if not compact_query:
        return ""
    for prefix in _CURRICULUM_FOLLOW_UP_PREFIXES:
        if compact_query.startswith(prefix):
            compact_query = compact_query[len(prefix) :].strip()
            break
    compact_query = compact_query.strip("，,。！？?!.；;：: ")
    while compact_query and compact_query[-1] in _CURRICULUM_FOLLOW_UP_TRAILING_PARTICLES:
        compact_query = compact_query[:-1].strip()
    if not compact_query:
        return ""
    if any(blocker in compact_query for blocker in _CURRICULUM_FOLLOW_UP_PROGRAM_BLOCKERS):
        return ""
    return compact_query


def _plan_handbook_query(
    scope: KnowledgeScope,
    user_goal: str,
) -> HandbookQueryPlan | None:
    if scope.corpus != "regulations" or scope.collection != "student_handbook":
        return None
    return plan_student_handbook_query(user_goal)


def _plan_curriculum_query(
    request: SpecialistRequest,
    scope: KnowledgeScope,
    user_goal: str,
) -> CurriculumQueryPlan | None:
    if scope.corpus != "curriculum" or scope.collection != "curriculum_plan":
        return None
    return plan_curriculum_query(
        user_goal,
        verified_major=request.context.actor.major,
    )


def _plan_curriculum_course_query(
    scope: KnowledgeScope,
    user_goal: str,
) -> CurriculumCourseQueryPlan | None:
    if scope.corpus != "curriculum" or scope.collection != "curriculum_plan":
        return None
    return plan_curriculum_course_query(user_goal)


def _plan_curriculum_program_family_query(
    scope: KnowledgeScope,
    user_goal: str,
) -> CurriculumProgramFamilyQueryPlan | None:
    if scope.corpus != "curriculum" or scope.collection != "curriculum_plan":
        return None
    return plan_curriculum_program_family_query(user_goal)


def _has_resolved_query_plan(
    *,
    handbook_plan: HandbookQueryPlan | None,
    curriculum_plan: CurriculumQueryPlan | None,
    curriculum_program_family_plan: CurriculumProgramFamilyQueryPlan | None,
) -> bool:
    if handbook_plan is not None and handbook_plan.status == "resolved":
        return True
    if (
        curriculum_program_family_plan is not None
        and curriculum_program_family_plan.resolution_mode == "resolved_family"
    ):
        return True
    return curriculum_plan is not None and curriculum_plan.status == "resolved"


def _should_use_curriculum_program_semester_facts(
    *,
    curriculum_plan: CurriculumQueryPlan | None,
    user_goal: str,
) -> bool:
    if curriculum_plan is None or curriculum_plan.status != "resolved":
        return False
    if len(curriculum_plan.target_document_ids) != 1:
        return False
    interpretation = interpret_curriculum_query(curriculum_plan.rewritten_query_text or user_goal)
    return interpretation.intent_kind == "course_list" and len(interpretation.semester_labels) == 1


def _resolve_curriculum_program_semester_fact_target_document_ids(
    *,
    curriculum_plan: CurriculumQueryPlan,
    user_goal: str,
) -> tuple[str, ...]:
    interpretation = interpret_curriculum_query(curriculum_plan.rewritten_query_text or user_goal)
    if len(curriculum_plan.target_document_ids) != 1 or len(interpretation.semester_labels) != 1:
        return ()
    return (
        build_curriculum_program_semester_fact_document_id(
            curriculum_plan.target_document_ids[0],
            interpretation.semester_labels[0],
        ),
    )
