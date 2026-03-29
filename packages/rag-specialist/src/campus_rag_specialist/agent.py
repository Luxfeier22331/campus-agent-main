from __future__ import annotations

from dataclasses import dataclass
import re

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_retrieval_core.evidence_ranking import select_supporting_evidence_sources


DEFAULT_MAX_ANSWER_SOURCES = 3
_WHITESPACE_RE = re.compile(r"\s+")


@dataclass(frozen=True, slots=True)
class RagSpecialistAgent:
    runtime_provider: str = ""
    max_answer_sources: int = DEFAULT_MAX_ANSWER_SOURCES

    def compose_answer(self, evidence: EvidenceBundle) -> str:
        if not evidence.sources:
            return ""

        supporting_sources = select_supporting_evidence_sources(
            query_text=evidence.query_text,
            sources=evidence.sources,
            max_sources=self.max_answer_sources,
        )
        rendered_parts = [
            f"{_render_source_support(source)} [{source.doc_id}#{source.chunk_id}]"
            for source in supporting_sources
        ]
        answer_prefix = _answer_prefix(evidence)
        lead_title = _lead_source_title(supporting_sources)
        if lead_title:
            return f"{answer_prefix}，《{lead_title}》相关内容显示：{'；'.join(rendered_parts)}"
        return f"{answer_prefix}：{'；'.join(rendered_parts)}"


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
    rendered = re.sub(r"(学制[:： ]*)(\d+)年", _replace_academic_years_match, rendered)
    return rendered


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
    if evidence.corpus == "curriculum" and evidence.collection == "curriculum_plan":
        return "根据培养方案相关内容"
    return "根据学生手册相关规定"
