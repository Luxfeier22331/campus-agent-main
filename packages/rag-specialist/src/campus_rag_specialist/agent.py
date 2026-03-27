from __future__ import annotations

from dataclasses import dataclass
import re

from campus_contracts import EvidenceBundle, EvidenceSource


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
            evidence.sources,
            max_answer_sources=self.max_answer_sources,
        )
        rendered_parts = [
            f"{index}. {_normalize_snippet(source.snippet)} [{source.doc_id}#{source.chunk_id}]"
            for index, source in enumerate(supporting_sources, start=1)
        ]
        return f"根据学生手册相关规定：{' '.join(rendered_parts)}"


def _select_supporting_sources(
    sources: tuple[EvidenceSource, ...],
    *,
    max_answer_sources: int,
) -> tuple[EvidenceSource, ...]:
    selected: list[EvidenceSource] = []
    seen_chunks: set[str] = set()
    seen_snippets: set[str] = set()
    for source in sources:
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
