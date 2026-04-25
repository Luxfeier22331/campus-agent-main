from __future__ import annotations

from collections.abc import Callable

from campus_contracts import (
    SpecialistRequest,
    SpecialistResponse,
    SpecialistTarget,
    SupervisorRequest,
    SupervisorResponse,
)
from campus_rag_agent.prompt_execution import RagPromptExecutor

from campus_supervisor_core.agent import SpecialistDelegate, SupervisorAgent
from campus_supervisor_core.audit import (
    SupervisorAuditRecord,
    build_audit_record,
    build_error_audit_record,
)
from campus_supervisor_core.errors import (
    DisallowedKnowledgeScopeError,
    ExecutionCancelledError,
    InvalidSpecialistToolPolicyError,
    InvalidSupervisorRequestError,
    MissingRoutingInputError,
    MissingSpecialistDelegateError,
    SupervisorError,
    UnsupportedCapabilityError,
)
from campus_supervisor_core.prompt_execution import SupervisorPromptExecutor
from campus_supervisor_core.routing import RoutingDecision

AuditSink = Callable[[SupervisorAuditRecord], None]
CancellationChecker = Callable[[], bool]


def handle_request(
    request: SupervisorRequest,
    *,
    specialist_delegates: dict[SpecialistTarget, SpecialistDelegate] | None = None,
    audit_sink: AuditSink | None = None,
    supervisor_prompt_executor: SupervisorPromptExecutor | None = None,
    rag_prompt_executor: RagPromptExecutor | None = None,
    cancellation_checker: CancellationChecker | None = None,
    preplanned_routing_decision: RoutingDecision | None = None,
) -> SupervisorResponse:
    agent = SupervisorAgent(
        supervisor_prompt_executor=supervisor_prompt_executor,
        rag_prompt_executor=rag_prompt_executor,
        cancellation_checker=cancellation_checker,
        preplanned_routing_decision=preplanned_routing_decision,
    )
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
    rag_prompt_executor: RagPromptExecutor | None = None,
) -> SpecialistResponse:
    agent = SupervisorAgent(rag_prompt_executor=rag_prompt_executor)
    if specialist_delegates is not None:
        agent.specialist_delegates = dict(specialist_delegates)
    return agent.handle_specialist_request(request)


__all__ = [
    "DisallowedKnowledgeScopeError",
    "ExecutionCancelledError",
    "InvalidSpecialistToolPolicyError",
    "InvalidSupervisorRequestError",
    "MissingRoutingInputError",
    "MissingSpecialistDelegateError",
    "SupervisorAgent",
    "SupervisorAuditRecord",
    "SupervisorError",
    "UnsupportedCapabilityError",
    "build_audit_record",
    "build_error_audit_record",
    "handle_request",
    "handle_specialist_request",
]
