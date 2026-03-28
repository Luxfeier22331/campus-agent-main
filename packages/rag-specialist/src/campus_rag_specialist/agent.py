from __future__ import annotations

from dataclasses import dataclass
import re

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_retrieval_core.evidence_ranking import prioritize_evidence_sources, query_targets_source_title


DEFAULT_MAX_ANSWER_SOURCES = 3
_WHITESPACE_RE = re.compile(r"\s+")


@dataclass(frozen=True, slots=True)
class RagSpecialistAgent:
    runtime_provider: str = ""
    max_answer_sources: int = DEFAULT_MAX_ANSWER_SOURCES

    def compose_answer(self, evidence: EvidenceBundle) -> str:
        if not evidence.sources:
            return ""

        supporting_sources = _select_supporting_sources(
            evidence,
            max_answer_sources=self.max_answer_sources,
        )
        rendered_parts = [
            f"{index}. {_render_snippet_for_answer(source.snippet)} [{source.doc_id}#{source.chunk_id}]"
            for index, source in enumerate(supporting_sources, start=1)
        ]
        return f"{_answer_prefix(evidence)}：{' '.join(rendered_parts)}"


def _select_supporting_sources(
    evidence: EvidenceBundle,
    *,
    max_answer_sources: int,
) -> tuple[EvidenceSource, ...]:
    selected: list[EvidenceSource] = []
    seen_chunks: set[str] = set()
    seen_snippets: set[str] = set()
    ranked_sources = prioritize_evidence_sources(
        query_text=evidence.query_text,
        sources=evidence.sources,
    )
    lead_doc_id = ranked_sources[0].doc_id if ranked_sources else ""
    doc_locked = bool(lead_doc_id) and query_targets_source_title(query_text=evidence.query_text, source=ranked_sources[0])
    for source in ranked_sources:
        if doc_locked and source.doc_id != lead_doc_id:
            continue
        if source.chunk_id in seen_chunks:
            continue
        normalized_snippet = _normalize_snippet(source.snippet)
        if not normalized_snippet or normalized_snippet in seen_snippets:
            continue
        selected.append(source)
        seen_chunks.add(source.chunk_id)
        seen_snippets.add(normalized_snippet)
        if len(selected) >= max_answer_sources:
            break
    return tuple(selected)


def _normalize_snippet(snippet: str) -> str:
    return _WHITESPACE_RE.sub(" ", snippet).strip()


def _render_snippet_for_answer(snippet: str) -> str:
    normalized = _normalize_snippet(snippet)
    return re.sub(r"(学制[:： ]*)(\d+)年", _replace_academic_years_match, normalized)


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
