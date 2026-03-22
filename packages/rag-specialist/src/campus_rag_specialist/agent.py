from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import EvidenceBundle


DEFAULT_MAX_ANSWER_SOURCES = 3


@dataclass(frozen=True, slots=True)
class RagSpecialistAgent:
    runtime_provider: str = "agno"
    max_answer_sources: int = DEFAULT_MAX_ANSWER_SOURCES

    def compose_answer(self, evidence: EvidenceBundle) -> str:
        if not evidence.sources:
            return ""

        lead_source = evidence.sources[0]
        citations = ", ".join(
            f"{source.doc_id}#{source.chunk_id}" for source in evidence.sources[: self.max_answer_sources]
        )
        lead_snippet = lead_source.snippet.strip()
        return f"{lead_snippet} Sources: {citations}."
