from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import DelegateToRagAgentRequest, DelegateToRagAgentResponse


@dataclass(frozen=True, slots=True)
class SupervisorAuditRecord:
    request_id: str
    trace_id: str
    user_id: str
    status: str
    source_doc_ids: tuple[str, ...]


def build_audit_record(
    request: DelegateToRagAgentRequest,
    response: DelegateToRagAgentResponse,
) -> SupervisorAuditRecord:
    return SupervisorAuditRecord(
        request_id=request.request_id,
        trace_id=request.trace.trace_id,
        user_id=request.actor.user_id,
        status=response.status,
        source_doc_ids=tuple(source.doc_id for source in response.evidence.sources),
    )
