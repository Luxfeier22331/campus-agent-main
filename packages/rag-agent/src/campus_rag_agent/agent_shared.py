from __future__ import annotations

import re

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_ingestion_core.corpus_profiles import is_official_web_stable_reference_like_collection

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
        return explicit_title
    return sources[0].doc_id.split(":", 1)[-1].strip()


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
    if evidence.corpus == "official_web" and is_official_web_stable_reference_like_collection(
        evidence.collection
    ):
        return "根据官网页面内容"
    if evidence.corpus == "curriculum":
        return "根据培养方案相关内容"
    return "根据学生手册相关规定"
