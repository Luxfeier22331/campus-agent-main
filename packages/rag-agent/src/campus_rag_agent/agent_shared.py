from __future__ import annotations

import re

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_retrieval_core.evidence_ranking import query_targets_source_title

_WHITESPACE_RE = re.compile(r"\s+")


def _normalize_snippet(snippet: str) -> str:
    return _WHITESPACE_RE.sub(" ", snippet).strip()


def _render_source_support(source: EvidenceSource) -> str:
    normalized = _normalize_snippet(source.snippet)
    filtered_lines: list[str] = []
    title = _normalize_snippet(source.source_title)
    ignored_lines = {
        title,
        *(_normalize_snippet(item) for item in source.structural_path if item.strip()),
    }
    if source.detail_label.strip():
        ignored_lines.add(_normalize_snippet(source.detail_label))
    for raw_line in re.split(r"[\r\n]+", normalized):
        line = _normalize_snippet(raw_line)
        if not line or line in ignored_lines:
            continue
        filtered_lines.append(line)
    rendered = " ".join(filtered_lines) if filtered_lines else normalized
    return re.sub(r"(学制[:： ]*)(\d+)年", _replace_academic_years_match, rendered)


def _lead_source_title(sources: tuple[EvidenceSource, ...]) -> str:
    if not sources:
        return ""
    explicit_title = _normalize_snippet(sources[0].source_title)
    if explicit_title:
        return _normalize_title_display_text(explicit_title)
    return sources[0].doc_id.split(":", 1)[-1].strip()


def _normalize_title_display_text(title: str) -> str:
    normalized = _normalize_snippet(title)
    normalized = re.sub(r"\s+([“”])", r"\1", normalized)
    return re.sub(r"([“”])\s+", r"\1", normalized)


def _lead_context_title(
    *,
    evidence: EvidenceBundle,
    sources: tuple[EvidenceSource, ...],
) -> str:
    title = _lead_source_title(sources)
    if not title:
        return ""
    if any(
        query_targets_source_title(query_text=evidence.query_text, source=source)
        for source in sources
    ):
        return title
    normalized_query = _normalize_snippet(evidence.query_text)
    normalized_title = _normalize_snippet(title)
    if normalized_title and normalized_title in normalized_query:
        return title
    if _query_asks_for_governing_document_title(normalized_query) and _source_title_is_policy(
        normalized_title
    ):
        return title
    if len(title) <= 24 and any(token in normalized_query for token in _title_signal_tokens(title)):
        return title
    return ""


def _query_asks_for_governing_document_title(query_text: str) -> bool:
    return any(
        cue in query_text
        for cue in (
            "哪份管理办法",
            "哪份办法",
            "哪个管理办法",
            "哪个办法",
            "依据哪份",
            "依据哪个",
        )
    )


def _source_title_is_policy(title: str) -> bool:
    return title.endswith(("办法", "规定", "细则", "章程", "条例"))


def _source_context_label(
    *,
    evidence: EvidenceBundle,
    source: EvidenceSource,
) -> str:
    labels: list[str] = []
    title = _lead_context_title(evidence=evidence, sources=(source,))
    if not title and source.detail_label.strip():
        title = _lead_source_title((source,))
    if title:
        labels.append(f"《{title}》")
    detail_label = _normalize_snippet(source.detail_label)
    if detail_label and detail_label not in labels:
        labels.append(detail_label)
    section_label = _matching_structural_context_label(
        query_text=evidence.query_text,
        source=source,
    )
    if section_label and section_label not in labels:
        labels.append(section_label)
    return " ".join(labels)


def _matching_structural_context_label(*, query_text: str, source: EvidenceSource) -> str:
    normalized_query = _normalize_snippet(query_text)
    for label in source.structural_path[1:]:
        normalized_label = _normalize_snippet(label)
        if not normalized_label:
            continue
        if normalized_label in normalized_query:
            return normalized_label
        for token in _title_signal_tokens(normalized_label):
            if token in normalized_query:
                return normalized_label
    return ""


def _title_signal_tokens(title: str) -> tuple[str, ...]:
    normalized = _normalize_snippet(title)
    return tuple(
        token
        for token in (
            "国家奖学金",
            "课程教学计划",
            "培养方案",
            "课程设置",
            "修读建议",
            "第九条",
        )
        if token in normalized
    )


def _replace_academic_years_match(match: re.Match[str]) -> str:
    prefix, years = match.groups()
    return f"{prefix}{_arabic_number_to_chinese(years)}年"


def _arabic_number_to_chinese(value: str) -> str:
    numerals = {
        "1": "一",
        "2": "两",
        "3": "三",
        "4": "四",
        "5": "五",
        "6": "六",
        "7": "七",
        "8": "八",
        "9": "九",
    }
    if value in numerals:
        return numerals[value]
    return value


def _answer_prefix(evidence: EvidenceBundle) -> str:
    if evidence.corpus == "official_web":
        return "根据官网页面内容"
    if evidence.corpus == "curriculum":
        return "根据培养方案相关内容"
    if evidence.corpus == "regulations" and evidence.collection == "institutional_rules":
        return "根据校级制度相关规定"
    return "根据学生手册相关规定"
