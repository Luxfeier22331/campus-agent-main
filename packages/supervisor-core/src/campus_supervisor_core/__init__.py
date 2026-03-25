from __future__ import annotations

from typing import Callable

from campus_contracts import SpecialistRequest, SpecialistResponse, SpecialistTarget, SupervisorRequest

from campus_supervisor_core.agent import SpecialistDelegate, SupervisorAgent
from campus_supervisor_core.audit import SupervisorAuditRecord, build_audit_record
from campus_supervisor_core.errors import (
    DisallowedKnowledgeScopeError,
    InvalidSupervisorRequestError,
    MissingRoutingInputError,
    MissingSpecialistDelegateError,
    SupervisorError,
    UnsupportedCapabilityError,
)


AuditSink = Callable[[SupervisorAuditRecord], None]


def handle_request(
    request: SupervisorRequest,
    *,
    specialist_delegates: dict[SpecialistTarget, SpecialistDelegate] | None = None,
    audit_sink: AuditSink | None = None,
) -> SpecialistResponse:
    agent = SupervisorAgent()
    if specialist_delegates is not None:
        agent.specialist_delegates = dict(specialist_delegates)
    response = agent.handle(request)
    if audit_sink is not None:
        audit_sink(build_audit_record(request, response))
    return response


def handle_specialist_request(
    request: SpecialistRequest,
    *,
    specialist_delegates: dict[SpecialistTarget, SpecialistDelegate] | None = None,
) -> SpecialistResponse:
    agent = SupervisorAgent()
    if specialist_delegates is not None:
        agent.specialist_delegates = dict(specialist_delegates)
    return agent.handle_specialist_request(request)


__all__ = [
    "SupervisorAgent",
    "SupervisorAuditRecord",
    "SupervisorError",
    "InvalidSupervisorRequestError",
    "MissingRoutingInputError",
    "UnsupportedCapabilityError",
    "DisallowedKnowledgeScopeError",
    "MissingSpecialistDelegateError",
    "handle_request",
    "handle_specialist_request",
]
