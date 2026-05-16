from __future__ import annotations

import re

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_retrieval_core.evidence_attributes import evidence_attributes_for_source

from .agent_shared import _lead_source_title, _normalize_snippet

_JUDGMENT_QUERY_CUES = (
    "吗",
    "是否",
    "能不能",
    "能否",
    "可以吗",
    "可不可以",
    "符合吗",
    "算不算",
    "适用于",
)

_NEGATIVE_STATUS_QUERY_CUES = (
    "没",
    "没有",
    "不在",
    "未",
    "达不到",
    "不足",
    "不满",
)


def compose_judgment_clause_answer(
    *,
    evidence: EvidenceBundle,
    query_text: str,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    if evidence.corpus != "regulations":
        return ""
    normalized_query = _normalize_snippet(query_text or evidence.query_text)
    if not _query_asks_judgment(normalized_query):
        return ""
    for source, statements in selected_rows:
        statement = next((_normalize_snippet(item) for item in statements if item.strip()), "")
        if not statement:
            continue
        answer = _compose_supported_judgment_answer(
            query_text=normalized_query,
            source=source,
            statement=statement,
        )
        if answer:
            return answer
    return ""


def _query_asks_judgment(query_text: str) -> bool:
    return bool(query_text and any(cue in query_text for cue in _JUDGMENT_QUERY_CUES))


def _compose_supported_judgment_answer(
    *,
    query_text: str,
    source: EvidenceSource,
    statement: str,
) -> str:
    attributes = evidence_attributes_for_source(source)
    if attributes.missing_contract_fields:
        return ""
    polarity = attributes.condition_polarity or attributes.polarity
    if not attributes.condition_subject or not polarity:
        return ""
    if attributes.condition_subject == "audience_scope":
        return _compose_audience_scope_judgment(
            source=source,
            statement=statement,
            polarity=polarity,
        )
    if attributes.condition_subject == "rank_threshold":
        return _compose_rank_threshold_judgment(
            query_text=query_text,
            source=source,
            statement=statement,
            polarity=polarity,
        )
    if attributes.condition_subject == "paper_or_publication":
        return _compose_paper_or_publication_judgment(
            source=source,
            statement=statement,
            polarity=polarity,
        )
    return ""


def _compose_audience_scope_judgment(
    *,
    source: EvidenceSource,
    statement: str,
    polarity: str,
) -> str:
    if polarity not in {"positive", "negative"}:
        return ""
    fragment = _extract_applicability_fragment(statement)
    if not fragment:
        return ""
    conclusion = "否，" if fragment.startswith("不适用于") or polarity == "negative" else "是，"
    return f"{conclusion}{fragment}。依据{_judgment_context_label(source)}。"


def _compose_rank_threshold_judgment(
    *,
    query_text: str,
    source: EvidenceSource,
    statement: str,
    polarity: str,
) -> str:
    if polarity != "positive":
        return ""
    if not any(cue in query_text for cue in _NEGATIVE_STATUS_QUERY_CUES):
        return ""
    if not any(token in statement for token in ("排名", "前10%", "前十", "前10")):
        return ""
    trimmed_statement = _trim_rank_exception_tail(statement)
    return f"不能，相关条件要求{trimmed_statement.rstrip('。；; ')}。依据{_judgment_context_label(source)}。"


def _compose_paper_or_publication_judgment(
    *,
    source: EvidenceSource,
    statement: str,
    polarity: str,
) -> str:
    if polarity != "positive":
        return ""
    if not any(token in statement for token in ("论文", "发表", "著作", "专著")):
        return ""
    return (
        f"可以，相关条件包括{statement.rstrip('。；; ')}。依据{_judgment_context_label(source)}。"
    )


def _trim_rank_exception_tail(statement: str) -> str:
    normalized = _normalize_snippet(statement)
    for marker in ("具体表现如下", "1.", "1．", "1、", "（1）", "(1)"):
        if marker in normalized:
            normalized = normalized.split(marker, 1)[0]
    return normalized.strip(" ，,。；;")


def _extract_applicability_fragment(statement: str) -> str:
    normalized = _normalize_snippet(statement).rstrip("。；; ")
    match = re.search(r"(?:不)?适用于[^。；;]+", normalized)
    if match is None:
        return ""
    return match.group(0).strip(" ，,。；;")


def _judgment_context_label(source: EvidenceSource) -> str:
    title = _lead_source_title((source,))
    detail_label = _normalize_snippet(source.detail_label)
    if title and detail_label:
        return f"《{title}》{detail_label}"
    if title:
        return f"《{title}》"
    return detail_label


__all__ = ["compose_judgment_clause_answer"]
