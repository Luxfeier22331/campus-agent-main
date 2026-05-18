from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field

from campus_contracts import AgentResponse, ClaimSupport, EvidenceSource, RagResultPayload
from campus_rag_agent.handbook_query_planning import plan_student_handbook_query
from campus_retrieval_core.evidence_attributes import (
    evidence_attributes_for_source,
)
from campus_retrieval_core.evidence_semantics import (
    infer_evidence_query_intent,
    query_requests_negative_polarity,
)
from campus_shared.regulation_semantic_registry import canonical_regulation_condition_subject

from .answer_ready_component_eval import (
    AnswerReadyComponentObservationSet,
    ObservedAnswerReadyComponents,
)

_NEGATIVE_ANSWER_ROLES = frozenset({"exclusion_rule"})
_PROCEDURE_ANSWER_ROLES = frozenset({"procedure_step", "material_requirement"})
_JUDGMENT_ANSWER_ROLES = frozenset(
    {
        "eligibility_condition",
        "exception_rule",
        "example_evidence",
        "exclusion_rule",
        "material_requirement",
        "table_fact",
        "time_constraint",
    }
)


@dataclass(frozen=True, slots=True)
class AnswerReadyComponentRuntimeArtifact:
    case_id: str
    query: str
    response: AgentResponse
    retrieval_runtime_observations: tuple[Mapping[str, object], ...] = field(default_factory=tuple)
    release_contract_status: str = ""
    release_contract_failure_classes: tuple[str, ...] = field(default_factory=tuple)


def collect_answer_ready_component_runtime_observations(
    artifacts: Iterable[AnswerReadyComponentRuntimeArtifact],
) -> AnswerReadyComponentObservationSet:
    observations: dict[str, ObservedAnswerReadyComponents] = {}
    for artifact in artifacts:
        observations[artifact.case_id] = build_answer_ready_component_observation(
            query=artifact.query,
            response=artifact.response,
            retrieval_runtime_observations=artifact.retrieval_runtime_observations,
            release_contract_status=artifact.release_contract_status,
            release_contract_failure_classes=artifact.release_contract_failure_classes,
        )
    return AnswerReadyComponentObservationSet(
        schema_version=1,
        observations=observations,
    )


def build_answer_ready_component_observation(
    *,
    query: str,
    response: AgentResponse,
    retrieval_runtime_observations: Sequence[Mapping[str, object]] = (),
    release_contract_status: str = "",
    release_contract_failure_classes: Sequence[str] = (),
) -> ObservedAnswerReadyComponents:
    result = response.result
    if not isinstance(result, RagResultPayload):
        raise ValueError("answer ready component runtime observation requires RagResultPayload")

    diagnostics = result.diagnostics
    clarification_reason = _clarification_reason(response)
    is_clarification = bool(clarification_reason) or response.status == "needs_clarification"
    is_unsupported = _is_unsupported_no_hit(response)
    selected_sources = tuple(result.evidence.sources)
    retrieved_sources = (
        tuple(diagnostics.retrieved_sources)
        if diagnostics is not None and diagnostics.retrieved_sources
        else selected_sources
    )
    selected_roles = tuple(_answer_role_for_source(source) for source in selected_sources)
    selected_subjects = tuple(
        _ordered_unique(
            _condition_subject_for_source(source)
            for source in selected_sources
            if _condition_subject_for_source(source)
        )
    )
    selected_polarities = tuple(
        _ordered_unique(
            _polarity_for_source(source)
            for source in selected_sources
            if _polarity_for_source(source)
        )
    )
    draft_kind = _draft_kind_from_runtime(
        claim_supports=diagnostics.claim_supports if diagnostics is not None else (),
        selected_roles=selected_roles,
    )
    task_kind = _task_kind_from_runtime(
        query=query,
        response=response,
        collection=result.evidence.collection,
        selected_roles=selected_roles,
    )
    if is_clarification:
        answer_role = "clarification"
        draft_kind = "clarification"
        condition_subject = _clarification_condition_subject(query=query, task_kind=task_kind)
    elif is_unsupported:
        answer_role = "unsupported"
        draft_kind = "unsupported"
        condition_subject = ""
    else:
        answer_role = selected_roles[0] if selected_roles else ""
        condition_subject = selected_subjects[0] if selected_subjects else ""
    return ObservedAnswerReadyComponents(
        task_kind=task_kind,
        query_polarity=_query_polarity_from_runtime(
            query=query,
            task_kind=task_kind,
            selected_roles=selected_roles,
            selected_polarities=selected_polarities,
        ),
        answer_role=answer_role,
        retrieved_document_ids=tuple(
            _ordered_unique(source.doc_id for source in retrieved_sources)
        ),
        ranked_evidence_roles=tuple(
            _answer_role_for_source(source) for source in retrieved_sources
        ),
        selected_evidence_roles=selected_roles,
        draft_kind=draft_kind,
        grounding_support_present=_grounding_support_present(
            claim_supports=diagnostics.claim_supports if diagnostics is not None else (),
            grounding_verdict=diagnostics.grounding_verdict if diagnostics is not None else "",
        ),
        condition_subject=condition_subject,
        selected_condition_subjects=selected_subjects,
        selected_polarities=selected_polarities,
        no_answer_reason=_no_answer_reason(response),
        release_contract_status=release_contract_status.strip(),
        release_contract_failure_classes=tuple(
            failure_class.strip()
            for failure_class in release_contract_failure_classes
            if str(failure_class).strip()
        ),
    )


def _task_kind_from_runtime(
    *,
    query: str,
    response: AgentResponse,
    collection: str,
    selected_roles: Sequence[str],
) -> str:
    if _is_unsupported_no_hit(response):
        return "unsupported_or_no_hit"
    selected_role = selected_roles[0] if selected_roles else ""
    if collection == "student_rules":
        handbook_plan = plan_student_handbook_query(query)
        if handbook_plan.task_kind == "category_discovery":
            return "category_discovery"
        if handbook_plan.task_kind == "ambiguous_procedure":
            return "ambiguous_procedure"
        if query_requests_negative_polarity(query) and selected_role in _NEGATIVE_ANSWER_ROLES:
            return "restriction_lookup"
    clarification_reason = _clarification_reason(response)
    if clarification_reason == "ambiguous_procedure" or response.status == "needs_clarification":
        return "ambiguous_procedure"
    query_intent = infer_evidence_query_intent(query)
    if selected_role == "category_overview" or query_intent.answer_role == "policy_list":
        return "category_discovery"
    if selected_role in _PROCEDURE_ANSWER_ROLES:
        return "procedure_lookup"
    if selected_role in _NEGATIVE_ANSWER_ROLES and query_requests_negative_polarity(query):
        return "restriction_lookup"
    if selected_role in _JUDGMENT_ANSWER_ROLES:
        return "eligibility_judgment"
    if query_intent.answer_role == "procedure":
        return "procedure_lookup"
    if query_intent.answer_role in {"condition", "restriction"}:
        return "eligibility_judgment"
    if selected_role:
        return "specific_policy_lookup"
    return "unsupported_or_no_hit"


def _query_polarity_from_runtime(
    *,
    query: str,
    task_kind: str,
    selected_roles: Sequence[str],
    selected_polarities: Sequence[str],
) -> str:
    query_intent = infer_evidence_query_intent(query)
    if task_kind == "ambiguous_procedure":
        return "neutral"
    if task_kind == "unsupported_or_no_hit":
        return "neutral"
    if query_intent.polarity != "neutral":
        return query_intent.polarity
    if query_requests_negative_polarity(query):
        return "negative"
    if task_kind == "category_discovery":
        return "neutral"
    if any(role in _NEGATIVE_ANSWER_ROLES for role in selected_roles) and "negative" in set(
        selected_polarities
    ):
        return "negative"
    if task_kind in {
        "specific_policy_lookup",
        "procedure_lookup",
        "eligibility_judgment",
        "ambiguous_procedure",
    }:
        return "positive"
    return "neutral"


def _draft_kind_from_runtime(
    *,
    claim_supports: Sequence[ClaimSupport],
    selected_roles: Sequence[str],
) -> str:
    supported_claim_types = tuple(
        _ordered_unique(
            claim.claim_type.strip()
            for claim in claim_supports
            if claim.supported and claim.claim_type
        )
    )
    if "policy_list_item" in supported_claim_types:
        return "policy_list"
    if "procedure_step" in supported_claim_types:
        return "procedure_steps"
    if "eligibility_judgment" in supported_claim_types:
        return "eligibility_judgment"
    if {"condition_row", "table_fact", "time_constraint", "material_requirement"} & set(
        supported_claim_types
    ):
        return "condition_table"
    if not selected_roles:
        return ""
    if selected_roles[0] == "category_overview":
        return "policy_list"
    if selected_roles[0] == "procedure_step":
        return "procedure_steps"
    return "condition_table"


def _grounding_support_present(
    *,
    claim_supports: Sequence[ClaimSupport],
    grounding_verdict: str,
) -> bool:
    if any(claim.supported for claim in claim_supports):
        return True
    return grounding_verdict == "grounded"


def _answer_role_for_source(source: EvidenceSource) -> str:
    attributes = evidence_attributes_for_source(source)
    return (
        attributes.answer_role
        or attributes.semantic_role
        or source.semantic_role
        or source.content_role
    )


def _condition_subject_for_source(source: EvidenceSource) -> str:
    attributes = evidence_attributes_for_source(source)
    return canonical_regulation_condition_subject(attributes.condition_subject)


def _polarity_for_source(source: EvidenceSource) -> str:
    attributes = evidence_attributes_for_source(source)
    return (attributes.condition_polarity or attributes.polarity or source.polarity).strip()


def _clarification_reason(response: AgentResponse) -> str:
    result = response.result
    if not isinstance(result, RagResultPayload) or result.diagnostics is None:
        return ""
    return result.diagnostics.clarification_reason.strip()


def _no_answer_reason(response: AgentResponse) -> str:
    result = response.result
    if not isinstance(result, RagResultPayload) or result.diagnostics is None:
        return ""
    return result.diagnostics.no_answer_reason.strip()


def _clarification_condition_subject(*, query: str, task_kind: str) -> str:
    query_intent = infer_evidence_query_intent(query)
    if task_kind == "ambiguous_procedure" or query_intent.answer_role == "procedure":
        return "application_procedure"
    return ""


def _is_unsupported_no_hit(response: AgentResponse) -> bool:
    result = response.result
    if response.status != "no_answer" or not isinstance(result, RagResultPayload):
        return False
    diagnostics = result.diagnostics
    if diagnostics is None:
        return False
    if diagnostics.semantic_outcome != "unsupported_by_evidence":
        return False
    if result.evidence.sources:
        return False
    return diagnostics.retrieval_adequacy_reason in {
        "no_supporting_sources",
        "resolved_policy_clause_not_found",
        "",
    }


def _ordered_unique(values: Iterable[str]) -> tuple[str, ...]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        normalized = str(value or "").strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(normalized)
    return tuple(ordered)


__all__ = [
    "AnswerReadyComponentRuntimeArtifact",
    "build_answer_ready_component_observation",
    "collect_answer_ready_component_runtime_observations",
]
