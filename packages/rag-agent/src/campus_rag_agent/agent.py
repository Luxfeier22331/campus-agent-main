from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_retrieval_core.evidence_ranking import select_supporting_evidence_sources

from .agent_answering import _compose_direct_answer, _render_supporting_contexts
from .agent_selection_query import _query_mode
from .agent_selection_rows import _select_answer_support_rows

DEFAULT_MAX_ANSWER_SOURCES = 3
__all__ = (
    "DEFAULT_MAX_ANSWER_SOURCES",
    "AnswerDraft",
    "RagAgent",
    "_query_mode",
    "_select_answer_support_rows",
)


@dataclass(frozen=True, slots=True)
class AnswerDraft:
    answer_text: str
    supporting_sources: tuple[EvidenceSource, ...]
    supporting_contexts: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class RagAgent:
    runtime_provider: str = ""
    max_answer_sources: int = DEFAULT_MAX_ANSWER_SOURCES

    def build_answer(self, evidence: EvidenceBundle) -> AnswerDraft:
        if not evidence.sources:
            return AnswerDraft(answer_text="", supporting_sources=(), supporting_contexts=())

        candidate_sources = select_supporting_evidence_sources(
            query_text=evidence.query_text,
            sources=evidence.sources,
            max_sources=self.max_answer_sources,
        )
        selected_rows = _select_answer_support_rows(
            query_text=evidence.query_text,
            sources=candidate_sources,
            max_sources=self.max_answer_sources,
        )
        supporting_sources = tuple(source for source, _ in selected_rows)
        supporting_contexts = _render_supporting_contexts(selected_rows)
        answer_text = _compose_direct_answer(
            evidence=evidence,
            selected_rows=selected_rows,
        )
        return AnswerDraft(
            answer_text=answer_text,
            supporting_sources=supporting_sources,
            supporting_contexts=supporting_contexts,
        )

    def compose_answer(self, evidence: EvidenceBundle) -> str:
        return self.build_answer(evidence).answer_text
