from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import SpecialistRequest, SpecialistResponse
from campus_contracts.models import DelegateStatus

from campus_supervisor_core.response import source_doc_ids_from_response


@dataclass(frozen=True, slots=True)
class SupervisorAuditRecord:
    request_id: str
    trace_id: str
    user_id: str
    status: DelegateStatus
    source_doc_ids: tuple[str, ...]


def build_audit_record(
    request: SpecialistRequest,
    response: SpecialistResponse,
) -> SupervisorAuditRecord:
    return SupervisorAuditRecord(
        request_id=request.request_id,
        trace_id=request.trace.trace_id,
        user_id=request.actor.user_id,
        status=response.status,
        source_doc_ids=source_doc_ids_from_response(response),
    )
