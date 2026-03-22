from __future__ import annotations

from campus_contracts import DelegateToRagAgentResponse


def source_doc_ids_from_response(response: DelegateToRagAgentResponse) -> tuple[str, ...]:
    return tuple(source.doc_id for source in response.evidence.sources)
