from __future__ import annotations

from dataclasses import dataclass
from typing import Union

from campus_contracts import (
    AvailabilityCheckPayload,
    RagResultPayload,
    RagRequestPayload,
    RequestedCapability,
    SpecialistRequest,
    SpecialistResponse,
    SpecialistTarget,
    SupervisorResponse,
    SupervisorStatus,
    SupervisorRequest,
)
from campus_contracts.models import AllowedCorpus

from campus_supervisor_core.response import source_doc_ids_from_response


@dataclass(frozen=True, slots=True)
class SupervisorAuditRecord:
    request_id: str
    trace_id: str
    user_id: str
    selected_target: SpecialistTarget | None
    requested_capability: RequestedCapability | None
    requested_scope_corpus: AllowedCorpus | None
    requested_scope_collection: str | None
    status: SupervisorStatus
    error_code: str | None
    source_doc_ids: tuple[str, ...]
    evidence_source_count: int
    follow_up_emitted: bool
    fail_closed: bool


def build_audit_record(
    request: Union[SupervisorRequest, SpecialistRequest],
    response: SpecialistResponse | SupervisorResponse,
) -> SupervisorAuditRecord:
    requested_capability = _requested_capability_from_request(request)
    requested_scope = _requested_scope_from_request(request)
    return SupervisorAuditRecord(
        request_id=request.request_id,
        trace_id=request.trace.trace_id,
        user_id=request.actor.user_id,
        selected_target=_selected_target_from_response(response),
        requested_capability=requested_capability,
        requested_scope_corpus=None if requested_scope is None else requested_scope.corpus,
        requested_scope_collection=None if requested_scope is None else requested_scope.collection,
        status=response.status,
        error_code=None,
        source_doc_ids=source_doc_ids_from_response(response),
        evidence_source_count=_evidence_source_count_from_response(response),
        follow_up_emitted=bool(response.follow_up_question.strip()),
        fail_closed=_is_fail_closed_status(response.status),
    )


def build_error_audit_record(
    request: SupervisorRequest,
    *,
    error_code: str,
) -> SupervisorAuditRecord:
    requested_capability = _requested_capability_from_request(request)
    requested_scope = _requested_scope_from_request(request)
    return SupervisorAuditRecord(
        request_id=request.request_id,
        trace_id=request.trace.trace_id,
        user_id=request.actor.user_id,
        selected_target=_selected_target_from_request(request),
        requested_capability=requested_capability,
        requested_scope_corpus=None if requested_scope is None else requested_scope.corpus,
        requested_scope_collection=None if requested_scope is None else requested_scope.collection,
        status="error",
        error_code=error_code,
        source_doc_ids=(),
        evidence_source_count=0,
        follow_up_emitted=False,
        fail_closed=True,
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


def _selected_target_from_request(request: SupervisorRequest) -> SpecialistTarget | None:
    if request.requested_scope is not None and request.availability_target_id is None:
        return "rag-specialist"
    if request.availability_target_id is not None and request.requested_scope is None:
        return "availability-specialist"
    return None


def _selected_target_from_response(
    response: SpecialistResponse | SupervisorResponse,
) -> SpecialistTarget | None:
    if isinstance(response, SpecialistResponse):
        return response.target
    return response.selected_target


def _evidence_source_count_from_response(response: SpecialistResponse | SupervisorResponse) -> int:
    if not isinstance(response.result, RagResultPayload):
        return 0
    return len(response.result.evidence.sources)


def _is_fail_closed_status(status: SupervisorStatus) -> bool:
    return status in {"no_answer", "error"}
