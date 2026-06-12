from __future__ import annotations

import re

from campus_contracts import EvidenceBundle, EvidenceSource

from .answer_shared import _answer_prefix, _lead_source_title, _normalize_snippet


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
