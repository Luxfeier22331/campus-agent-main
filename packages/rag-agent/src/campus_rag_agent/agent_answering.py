from __future__ import annotations

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_ingestion_core.corpus_profiles import is_official_web_stable_reference_like_collection

from .agent_answer_shape import AnswerShape
from .agent_answer_text_cleanup import finalize_answer_text
from .agent_answering_generic import _compose_generic_answer
from .agent_answering_procedure import _compose_procedure_answer
from .agent_answering_support import _render_supporting_contexts
from .agent_curriculum_answering import (
    _compose_curriculum_lookup_answer,
    _compose_curriculum_semester_course_list_answer,
)
from .agent_curriculum_terms import _is_curriculum_semester_course_list_query
from .agent_official_web import _compose_official_web_answer
from .agent_selection_query import _query_mode
from .agent_selection_statements import _is_generic_intro_statement
from .agent_shared import _normalize_snippet


def _compose_direct_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
    answer_shape: AnswerShape | None = None,
    category_display_name: str = "",
    audience: str = "",
) -> str:
    if not selected_rows:
        return ""

    mode = _query_mode(evidence.query_text)
    if answer_shape == AnswerShape.CATEGORY_DISCOVERY_LIST:
        return _compose_category_discovery_list_answer(
            selected_rows=selected_rows,
            category_display_name=category_display_name,
            audience=audience,
        )
    if mode == "procedure":
        return finalize_answer_text(
            _compose_procedure_answer(evidence=evidence, selected_rows=selected_rows)
        )
    if evidence.corpus == "official_web" and is_official_web_stable_reference_like_collection(
        evidence.collection
    ):
        official_web_answer = _compose_official_web_answer(
            evidence=evidence,
            selected_rows=selected_rows,
        )
        if official_web_answer:
            return finalize_answer_text(official_web_answer)
    if _is_curriculum_semester_course_list_query(evidence.query_text):
        semester_course_list_answer = _compose_curriculum_semester_course_list_answer(
            evidence=evidence,
            selected_rows=selected_rows,
        )
        if semester_course_list_answer:
            return finalize_answer_text(semester_course_list_answer)
    if evidence.corpus == "curriculum" and evidence.collection == "curriculum_plan":
        curriculum_lookup_answer = _compose_curriculum_lookup_answer(
            evidence=evidence,
            selected_rows=selected_rows,
        )
        if curriculum_lookup_answer:
            return finalize_answer_text(curriculum_lookup_answer)
    return finalize_answer_text(
        _compose_generic_answer(evidence=evidence, selected_rows=selected_rows)
    )


def _compose_category_discovery_list_answer(
    *,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
    category_display_name: str = "",
    audience: str = "",
) -> str:
    items: list[str] = []
    seen_titles: set[str] = set()
    for source, statements in selected_rows:
        title = source.source_title.strip() or source.doc_id.split(":", 1)[-1].strip()
        if not title or title in seen_titles:
            continue
        seen_titles.add(title)
        statement = next(
            (
                item
                for item in statements
                if item.strip() and _is_category_list_description_statement(item)
            ),
            "",
        )
        if statement:
            items.append(f"{len(items) + 1}. 《{title}》：{statement}")
        else:
            items.append(f"{len(items) + 1}. 《{title}》")
    if not items:
        return ""
    category = _normalize_snippet(category_display_name) or "相关"
    audience_prefix = f"{_normalize_snippet(audience)}" if audience else ""
    return finalize_answer_text(
        f"当前已收录依据中，{audience_prefix}{category}相关制度包括："
        + "；".join(items)
        + "。是否可申请、申请时间和名额以当年通知/学院细则为准。"
    )


def _is_category_list_description_statement(statement: str) -> bool:
    normalized = _normalize_snippet(statement)
    if not normalized:
        return False
    if _is_generic_intro_statement(normalized):
        return False
    if normalized.startswith("标题：") or " | 章节：" in normalized or " | 条款：" in normalized:
        return False
    if "->" in normalized or "→" in normalized:
        return False
    if any(cue in normalized for cue in ("流程", "步骤", "程序", "审核", "审定", "推荐")):
        return False
    if any(cue in normalized for cue in ("不得", "不得同时", "不能", "不予", "取消")):
        return False
    if "同时申请" in normalized:
        return False
    return not any(cue in normalized for cue in ("评定比例", "推荐比例", "名额", "特殊培养类型"))


__all__ = [
    "_compose_direct_answer",
    "_render_supporting_contexts",
]
