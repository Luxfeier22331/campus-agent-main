from __future__ import annotations

import re
from dataclasses import dataclass

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_ingestion_core.corpus_profiles import is_official_web_stable_reference_like_collection

from .agent_answer_shape import AnswerShape
from .agent_answer_text_cleanup import finalize_answer_text
from .agent_answering_generic import _compose_generic_answer
from .agent_answering_conditions import _compose_condition_table_answer
from .agent_answering_judgment import compose_judgment_clause_answer
from .agent_answering_procedure import _compose_procedure_answer
from .agent_answering_support import _render_supporting_contexts
from .agent_curriculum_answering import (
    _compose_curriculum_identity_answer,
    _compose_curriculum_lookup_answer,
    _compose_curriculum_semester_course_list_answer,
    _query_requires_curriculum_typed_lookup,
)
from .agent_curriculum_terms import _is_curriculum_semester_course_list_query
from .agent_official_web import _compose_official_web_answer
from .agent_selection_query import _query_mode
from .agent_selection_statements import _is_generic_intro_statement
from .agent_shared import _answer_prefix, _lead_source_title, _normalize_snippet
from .answer_presentation_contract import AnswerPresentationDraft, PresentationKind


@dataclass(frozen=True, slots=True)
class DirectAnswerResult:
    answer_text: str
    presentation: AnswerPresentationDraft | None = None
    presentation_path: str = ""
    diagnostic_reason: str = ""




def _compose_direct_answer(
    *,
    evidence: EvidenceBundle,
    query_text: str = "",
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
    answer_shape: AnswerShape | None = None,
    category_display_name: str = "",
    audience: str = "",
    expected_answer_kind: str = "",
) -> DirectAnswerResult:
    if not selected_rows:
        return DirectAnswerResult(answer_text="")

    answer_query_text = query_text.strip() or evidence.query_text
    mode = _query_mode(answer_query_text)
    if answer_shape == AnswerShape.CATEGORY_DISCOVERY_LIST:
        return DirectAnswerResult(
            answer_text=_compose_category_discovery_list_answer(
                selected_rows=selected_rows,
                category_display_name=category_display_name,
                audience=audience,
            ),
        )
    if answer_shape == AnswerShape.TITLE_LOOKUP and evidence.corpus == "curriculum":
        curriculum_identity_answer = _compose_curriculum_identity_answer(
            evidence=evidence,
            query_text=answer_query_text,
            selected_rows=selected_rows,
            document_reference_only=expected_answer_kind == "curriculum_document",
        )
        if curriculum_identity_answer:
            normalized_answer = finalize_answer_text(curriculum_identity_answer)
            return DirectAnswerResult(
                answer_text=normalized_answer,
                presentation=AnswerPresentationDraft(
                    kind=PresentationKind.DOCUMENT_IDENTITY,
                    answer_shape=AnswerShape.TITLE_LOOKUP,
                    fragments=(normalized_answer,),
                    identity_tokens=(
                        _lead_source_title(tuple(source for source, _ in selected_rows)),
                    ),
                ),
            )
    if answer_shape == AnswerShape.TITLE_LOOKUP and not (
        evidence.corpus == "official_web"
        and is_official_web_stable_reference_like_collection(evidence.collection)
    ):
        return _compose_document_identity_answer(evidence=evidence, selected_rows=selected_rows)
    if expected_answer_kind == "procedure_steps" or (
        mode == "procedure"
        and answer_shape
        not in {
            AnswerShape.CONDITION_OVERVIEW,
            AnswerShape.FACT_LOOKUP,
            AnswerShape.JUDGMENT_CLAUSE,
        }
    ):
        return DirectAnswerResult(
            answer_text=finalize_answer_text(
                _compose_procedure_answer(
                    evidence=evidence,
                    query_text=answer_query_text,
                    selected_rows=selected_rows,
                )
            )
        )
    if evidence.corpus == "official_web" and is_official_web_stable_reference_like_collection(
        evidence.collection
    ):
        official_web_answer = _compose_official_web_answer(
            evidence=evidence,
            selected_rows=selected_rows,
        )
        if official_web_answer:
            normalized_answer = finalize_answer_text(official_web_answer)
            fragments = tuple(
                fragment
                for fragment in (item.strip() for item in normalized_answer.split("；"))
                if fragment
            )[:2]
            return DirectAnswerResult(
                answer_text=normalized_answer,
                presentation=AnswerPresentationDraft(
                    kind=PresentationKind.BRIEF_REFERENCE,
                    answer_shape=AnswerShape.TITLE_LOOKUP,
                    fragments=fragments or (normalized_answer,),
                ),
            )
    if _is_curriculum_semester_course_list_query(evidence.query_text):
        semester_course_list_answer = _compose_curriculum_semester_course_list_answer(
            evidence=evidence,
            query_text=answer_query_text,
            selected_rows=selected_rows,
        )
        if semester_course_list_answer:
            return DirectAnswerResult(answer_text=finalize_answer_text(semester_course_list_answer))
    if evidence.corpus == "curriculum" and evidence.collection == "curriculum_plan":
        curriculum_lookup_answer = _compose_curriculum_lookup_answer(
            evidence=evidence,
            selected_rows=selected_rows,
        )
        if curriculum_lookup_answer:
            return DirectAnswerResult(answer_text=finalize_answer_text(curriculum_lookup_answer))
        if _query_requires_curriculum_typed_lookup(evidence.query_text):
            return DirectAnswerResult(answer_text="")
    if answer_shape == AnswerShape.DETAIL_CLAUSE:
        detail_clause_answer = _compose_focused_detail_clause_answer(
            evidence=evidence,
            selected_rows=selected_rows,
        )
        if detail_clause_answer:
            return DirectAnswerResult(answer_text=finalize_answer_text(detail_clause_answer))
    if answer_shape == AnswerShape.JUDGMENT_CLAUSE:
        judgment_clause_answer = compose_judgment_clause_answer(
            evidence=evidence,
            query_text=answer_query_text,
            selected_rows=selected_rows,
        )
        return DirectAnswerResult(answer_text=finalize_answer_text(judgment_clause_answer))
    if answer_shape == AnswerShape.CONDITION_OVERVIEW:
        condition_table_answer = _compose_condition_table_answer(
            evidence=evidence,
            query_text=answer_query_text,
            selected_rows=selected_rows,
        )
        if condition_table_answer:
            return DirectAnswerResult(answer_text=finalize_answer_text(condition_table_answer))
    collapse_to_short = answer_shape == AnswerShape.GENERAL_SUMMARY
    generic_answer = finalize_answer_text(
        _compose_generic_answer(
            evidence=evidence,
            selected_rows=selected_rows,
            collapse_to_short=collapse_to_short,
        )
    )
    if not generic_answer:
        return DirectAnswerResult(answer_text="")
    if not collapse_to_short:
        return DirectAnswerResult(answer_text=generic_answer)
    return DirectAnswerResult(
        answer_text=generic_answer,
        presentation=AnswerPresentationDraft(
            kind=PresentationKind.GENERAL_SUMMARY,
            answer_shape=AnswerShape.GENERAL_SUMMARY,
            fragments=(generic_answer,),
        ),
    )


def _compose_document_identity_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> DirectAnswerResult:
    title = _lead_source_title(tuple(source for source, _ in selected_rows))
    if not title:
        return DirectAnswerResult(answer_text="")
    answer_text = finalize_answer_text(f"{_answer_prefix(evidence)}，相关依据为《{title}》。")
    return DirectAnswerResult(
        answer_text=answer_text,
        presentation=AnswerPresentationDraft(
            kind=PresentationKind.DOCUMENT_IDENTITY,
            answer_shape=AnswerShape.TITLE_LOOKUP,
            fragments=(answer_text,),
            identity_tokens=(title,),
        ),
    )


def _compose_focused_detail_clause_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    if evidence.corpus != "regulations":
        return ""
    normalized_query = _normalize_snippet(evidence.query_text)
    focus_labels = _detail_focus_labels(normalized_query)
    if len(focus_labels) < 2:
        return ""
    source, statements = selected_rows[0]
    statement = next((_normalize_snippet(item) for item in statements if item.strip()), "")
    if not statement:
        return ""
    focused_parts = tuple(
        part for label in focus_labels if (part := _extract_detail_focus_part(statement, label))
    )
    if len(focused_parts) < len(focus_labels):
        return ""
    context_label = _detail_context_label(source=source)
    if context_label:
        return f"{context_label}规定：{'；'.join(focused_parts)}。"
    return f"{_answer_prefix(evidence)}，{'；'.join(focused_parts)}。"


def _detail_focus_labels(query_text: str) -> tuple[str, ...]:
    labels: list[str] = []
    if "论文" in query_text:
        labels.append("论文")
    if "著作" in query_text or "专著" in query_text:
        labels.append("著作")
    if "专利" in query_text:
        labels.append("专利")
    return tuple(labels)


def _detail_query_subject_label(query_text: str) -> str:
    normalized = _normalize_snippet(query_text)
    if "国奖" in normalized or "国家奖学金" in normalized:
        return "国家奖学金第九条" if "第九条" in normalized else "国家奖学金"
    return ""


def _extract_detail_focus_part(statement: str, label: str) -> str:
    normalized = _normalize_snippet(statement).rstrip("。；; ")
    if not normalized:
        return ""
    if label in {"论文", "著作"}:
        fragment = _extract_paper_book_clause(normalized, label=label)
        if fragment:
            return fragment
    if label == "论文":
        fragment = _extract_between(
            normalized,
            left=("以第一作者发表的论文", "第一作者发表的论文", "发表的论文", "论文"),
            right=("以第一、二作者", "以第一、二作者出版", "著作", "专著", "发明专利", "体育竞赛"),
        )
        return fragment if fragment else ""
    if label == "著作":
        fragment = _extract_between(
            normalized,
            left=(
                "以第一、二作者出版学术专著",
                "以第一、二作者出版",
                "出版学术专著",
                "学术专著",
                "著作",
            ),
            right=("发明专利", "体育竞赛", "获得"),
        )
        return fragment if fragment else ""
    if label == "专利":
        fragment = _extract_between(
            normalized,
            left=("发明专利", "专利"),
            right=("体育竞赛", "获得"),
        )
        return f"专利要求：{fragment}" if fragment else ""
    return ""


def _extract_paper_book_clause(text: str, *, label: str) -> str:
    start_cues = (
        ("以第一作者", "第一作者", "论文")
        if label == "论文"
        else ("以第一、二作者", "第一、二作者", "出版学术专著", "学术专著", "著作")
    )
    for start_cue in start_cues:
        start = text.find(start_cue)
        if start < 0:
            continue
        end = len(text)
        if label == "论文":
            for right_cue in ("以第一、二作者", "出版学术专著", "学术专著"):
                index = text.find(right_cue, start + len(start_cue))
                if index >= 0:
                    end = min(end, index)
        for separator in ("；", ";", "。"):
            index = text.find(separator, start)
            if index >= 0:
                end = min(end, index)
        return text[start:end].strip(" ，,；;。")
    return ""


def _extract_between(
    text: str,
    *,
    left: tuple[str, ...],
    right: tuple[str, ...],
) -> str:
    left_match = next((cue for cue in left if cue in text), "")
    if not left_match:
        return ""
    start = text.index(left_match)
    end = len(text)
    for cue in right:
        index = text.find(cue, start + len(left_match))
        if index >= 0:
            end = min(end, index)
    fragment = text[start:end].strip(" ，,；;。")
    return re.sub(r"^第[一二三四五六七八九十0-9]+条\s*", "", fragment).strip()


def _detail_context_label(*, source: EvidenceSource) -> str:
    title = _lead_source_title((source,))
    detail_label = _normalize_snippet(source.detail_label)
    if title and detail_label:
        return f"《{title}》{detail_label}"
    if title:
        return f"《{title}》"
    if detail_label:
        return detail_label
    return ""


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
