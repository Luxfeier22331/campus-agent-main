from __future__ import annotations

from dataclasses import dataclass
from typing import Union

from campus_contracts import (
    AvailabilityCheckPayload,
    RagRequestPayload,
    RequestedCapability,
    SpecialistRequest,
    SpecialistResponse,
    SpecialistTarget,
    SupervisorRequest,
)
from campus_contracts.models import AllowedCorpus, DelegateStatus

from campus_supervisor_core.response import source_doc_ids_from_response


@dataclass(frozen=True, slots=True)
class SupervisorAuditRecord:
    request_id: str
    trace_id: str
    user_id: str
    selected_target: SpecialistTarget
    requested_capability: RequestedCapability | None
    requested_scope_corpus: AllowedCorpus | None
    requested_scope_collection: str | None
    status: DelegateStatus
    source_doc_ids: tuple[str, ...]


def build_audit_record(
    request: Union[SupervisorRequest, SpecialistRequest],
    response: SpecialistResponse,
) -> SupervisorAuditRecord:
    requested_capability = _requested_capability_from_request(request)
    requested_scope = _requested_scope_from_request(request)
    return SupervisorAuditRecord(
        request_id=request.request_id,
        trace_id=request.trace.trace_id,
        user_id=request.actor.user_id,
        selected_target=response.target,
        requested_capability=requested_capability,
        requested_scope_corpus=None if requested_scope is None else requested_scope.corpus,
        requested_scope_collection=None if requested_scope is None else requested_scope.collection,
        status=response.status,
        source_doc_ids=source_doc_ids_from_response(response),
    )


def _requested_capability_from_request(
    request: Union[SupervisorRequest, SpecialistRequest],
) -> RequestedCapability | None:
    if isinstance(request, SupervisorRequest):
        if request.requested_capability is not None:
            return request.requested_capability
        if request.requested_scope is not None and request.availability_target_id is None:
            return "knowledge"
        if request.availability_target_id is not None and request.requested_scope is None:
            return "availability"
        return None
    if isinstance(request.payload, AvailabilityCheckPayload):
        return "availability"
    return "knowledge"


def _requested_scope_from_request(
    request: Union[SupervisorRequest, SpecialistRequest],
):
    if isinstance(request, SupervisorRequest):
        return request.requested_scope
    if isinstance(request.payload, RagRequestPayload):
        return request.payload.scope
    return None
