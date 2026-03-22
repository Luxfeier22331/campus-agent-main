from __future__ import annotations

from typing import Callable

from campus_contracts import DelegateToRagAgentRequest, DelegateToRagAgentResponse

from campus_supervisor_core.agent import SpecialistDelegate, SupervisorAgent
from campus_supervisor_core.audit import SupervisorAuditRecord, build_audit_record


AuditSink = Callable[[SupervisorAuditRecord], None]


def handle_request(
    request: DelegateToRagAgentRequest,
    *,
    specialist_delegate: SpecialistDelegate | None = None,
    audit_sink: AuditSink | None = None,
) -> DelegateToRagAgentResponse:
    agent = SupervisorAgent()
    if specialist_delegate is not None:
        agent.specialist_delegate = specialist_delegate
    response = agent.handle(request)
    if audit_sink is not None:
        audit_sink(build_audit_record(request, response))
    return response


__all__ = ["SupervisorAgent", "SupervisorAuditRecord", "handle_request"]
