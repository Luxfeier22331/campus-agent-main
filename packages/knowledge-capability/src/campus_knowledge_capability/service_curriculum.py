from __future__ import annotations

import re

from campus_contracts import EvidenceBundle, EvidenceSource

from campus_knowledge_capability.query_planning import (
    CurriculumCourseQueryPlan,
    CurriculumProgramFamilyQueryPlan,
    course_family_member_ids,
    course_family_member_titles,
)


def _build_curriculum_course_answer(
    *,
    evidence: EvidenceBundle,
    plan: CurriculumCourseQueryPlan,
) -> str:
    if plan.fact_intent == "schedule":
        return _build_curriculum_course_schedule_answer(evidence=evidence, plan=plan)
    unique_snippets = _unique_curriculum_course_snippets(evidence)
    answer = _build_curriculum_course_direct_answer(
        evidence=evidence,
        plan=plan,
        unique_snippets=unique_snippets,
    )
    if not answer:
        if plan.entity_type == "course":
            answer = f"当前还不能稳定确认{plan.canonical_course_title}的相关事实。"
        else:
            answer = f"当前还不能稳定确认{plan.canonical_course_family_title}的相关事实。"
    if plan.partial_answer and "offering_unit" in plan.unsupported_fields:
        return _append_course_partial_answer_suffix(
            answer=answer,
            unsupported_fields=plan.unsupported_fields,
        )
    return _ensure_terminal_period(answer)


def _build_curriculum_course_schedule_answer(
    *,
    evidence: EvidenceBundle,
    plan: CurriculumCourseQueryPlan,
) -> str:
    unique_snippets = _unique_curriculum_course_snippets(evidence)

    if plan.entity_type == "course":
        if unique_snippets:
            answer = _ensure_terminal_period(unique_snippets[0])
            if plan.partial_answer:
                return _append_course_partial_answer_suffix(
                    answer=answer,
                    unsupported_fields=plan.unsupported_fields,
                )
            return answer
        answer = f"当前还不能稳定确认{plan.canonical_course_title}的开设学期。"
        if plan.partial_answer:
            return _append_course_partial_answer_suffix(
                answer=answer,
                unsupported_fields=plan.unsupported_fields,
            )
        return answer

    schedule_by_course: dict[str, str] = {}
    for snippet in unique_snippets:
        if "开设学期：" not in snippet:
            continue
        course_title, semester_text = snippet.split("开设学期：", 1)
        course_title = course_title.strip("：: ")
        semester_text = semester_text.strip()
        if not course_title or not semester_text:
            continue
        schedule_by_course.setdefault(course_title, semester_text)
    schedule_lines = _order_course_family_schedule_lines(
        plan=plan,
        schedule_by_course=schedule_by_course,
    )
    if schedule_lines:
        canonical_titles = course_family_member_titles(plan.canonical_course_family_id)
        is_complete_family_schedule = bool(canonical_titles) and len(schedule_lines) >= len(
            canonical_titles
        )
        if is_complete_family_schedule:
            answer = f"{plan.canonical_course_family_title}各课程开设学期如下：{'；'.join(schedule_lines)}。"
        else:
            answer = (
                f"{plan.canonical_course_family_title}目前能确认的有：{'；'.join(schedule_lines)}。"
            )
        if plan.partial_answer:
            return _append_course_partial_answer_suffix(
                answer=answer,
                unsupported_fields=plan.unsupported_fields,
            )
        return answer
    answer = f"当前还不能稳定确认{plan.canonical_course_family_title}的开设学期安排。"
    if plan.partial_answer:
        return _append_course_partial_answer_suffix(
            answer=answer,
            unsupported_fields=plan.unsupported_fields,
        )
    return answer


def _order_course_family_schedule_lines(
    *,
    plan: CurriculumCourseQueryPlan,
    schedule_by_course: dict[str, str],
) -> list[str]:
    ordered_lines: list[str] = []
    canonical_titles = course_family_member_titles(plan.canonical_course_family_id)
    for title in canonical_titles:
        semester_text = schedule_by_course.pop(title, "")
        if semester_text:
            ordered_lines.append(f"{title}：{semester_text}")
    for title, semester_text in schedule_by_course.items():
        ordered_lines.append(f"{title}：{semester_text}")
    return ordered_lines


def _resolve_curriculum_course_fact_target_document_ids(
    plan: CurriculumCourseQueryPlan,
) -> tuple[str, ...]:
    if plan.entity_type == "course":
        if plan.fact_intent == "schedule" and plan.canonical_course_id:
            document_id = _build_curriculum_course_fact_document_id(
                plan.canonical_course_id,
                fact_type="semester",
            )
            return (document_id,) if document_id else ()
        if plan.fact_intent == "audience" and plan.canonical_course_id:
            document_id = _build_curriculum_course_fact_document_id(
                plan.canonical_course_id,
                fact_type="audience",
            )
            return (document_id,) if document_id else ()
        return ()
    if plan.entity_type != "course_family":
        return ()
    if plan.fact_intent == "family_membership":
        return ("course_facts:family-membership",)
    if plan.fact_intent == "audience":
        return ("course_facts:family-audience",)
    if plan.fact_intent != "schedule":
        return ()
    return tuple(
        document_id
        for document_id in (
            _build_curriculum_course_fact_document_id(course_id, fact_type="semester")
            for course_id in course_family_member_ids(plan.canonical_course_family_id)
        )
        if document_id
    )


def _build_curriculum_course_fact_document_id(
    canonical_course_id: str,
    *,
    fact_type: str,
) -> str:
    suffix = canonical_course_id.split(":", 1)[-1].strip()
    if not suffix:
        return ""
    return f"course_facts:{suffix}-{fact_type}"


def _unique_curriculum_course_snippets(evidence: EvidenceBundle) -> list[str]:
    unique_snippets: list[str] = []
    for source in evidence.sources:
        snippet = source.snippet.strip().rstrip("。")
        if snippet and snippet not in unique_snippets:
            unique_snippets.append(snippet)
    return unique_snippets


def _build_curriculum_course_direct_answer(
    *,
    evidence: EvidenceBundle,
    plan: CurriculumCourseQueryPlan,
    unique_snippets: list[str],
) -> str:
    if not unique_snippets:
        return ""
    if plan.fact_intent == "audience":
        audience_answer = _build_curriculum_course_audience_answer(
            evidence=evidence,
            plan=plan,
            unique_snippets=unique_snippets,
        )
        if audience_answer:
            return audience_answer
    return unique_snippets[0]


def _build_curriculum_course_audience_answer(
    *,
    evidence: EvidenceBundle,
    plan: CurriculumCourseQueryPlan,
    unique_snippets: list[str],
) -> str:
    audience = _extract_curriculum_course_audience(evidence.sources)
    if not audience:
        return unique_snippets[0]
    subject = (
        plan.canonical_course_title
        if plan.entity_type == "course"
        else plan.canonical_course_family_title
    )
    if not subject:
        return unique_snippets[0]
    return f"{subject}面向{audience}"


def _extract_curriculum_course_audience(
    sources: tuple[EvidenceSource, ...],
) -> str:
    for source in sources:
        snippet = source.snippet.strip()
        match = re.search(r"(所有本预科学生|所有本科学生|全体本科学生|全校学生)", snippet)
        if match:
            return match.group(1)
    return ""


def _ensure_terminal_period(text: str) -> str:
    normalized = text.strip()
    if not normalized:
        return normalized
    return normalized if normalized.endswith("。") else f"{normalized}。"


def _append_course_partial_answer_suffix(
    *, answer: str, unsupported_fields: tuple[str, ...]
) -> str:
    normalized_answer = answer if answer.endswith("。") else f"{answer}。"
    if "offering_unit" not in unsupported_fields:
        return normalized_answer
    suffix = "当前还不能稳定确认开课学院。"
    trimmed = normalized_answer.rstrip("。")
    return f"{trimmed}；{suffix}"


def _build_curriculum_program_family_answer(
    *,
    evidence: EvidenceBundle,
    plan: CurriculumProgramFamilyQueryPlan,
) -> str:
    snippets = [source.snippet.strip() for source in evidence.sources if source.snippet.strip()]
    for snippet in snippets:
        if plan.canonical_program_family_title and plan.canonical_program_family_title in snippet:
            return snippet if snippet.endswith("。") else f"{snippet}。"
    if snippets:
        snippet = snippets[0]
        return snippet if snippet.endswith("。") else f"{snippet}。"
    return f"我还不能稳定确认{plan.canonical_program_family_title}对应的项目班信息。"
