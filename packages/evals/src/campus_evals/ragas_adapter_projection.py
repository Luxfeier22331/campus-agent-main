from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts import (
    AgentResponse,
    EvidenceBundle,
    RagResultPayload,
    SupervisorResponse,
)

from campus_evals.models import ExecutionResult, GoldenCase, ObservedTrace


@dataclass(frozen=True, slots=True)
class RagasProjection:
    case_id: str
    user_input: str
    response: str
    retrieved_contexts: tuple[str, ...]
    reference: str
    retrieved_context_ids: tuple[str, ...] = field(default_factory=tuple)
    reference_context_ids: tuple[str, ...] = field(default_factory=tuple)
    reference_contexts: tuple[str, ...] = field(default_factory=tuple)
    metadata: dict[str, object] = field(default_factory=dict)


def build_ragas_projection(case: GoldenCase, execution: ExecutionResult) -> RagasProjection:
    response = _require_supported_response(execution)
    evidence = response.result.evidence if isinstance(response.result, RagResultPayload) else None
    observed_trace = execution.observed_trace
    contexts, context_ids, context_source = _resolve_projection_contexts(
        case=case,
        observed_trace=observed_trace,
        evidence=evidence,
    )
    reference = "\n".join(case.reference_facts or case.required_facts).strip()
    reference_source_type = _reference_source_type(case)
    metric_applicability = _build_metric_applicability(case)
    return RagasProjection(
        case_id=case.case_id,
        user_input=case.user_goal,
        response=response.answer_text,
        retrieved_contexts=contexts,
        reference=reference,
        retrieved_context_ids=context_ids,
        reference_context_ids=case.reference_context_ids,
        reference_contexts=case.reference_contexts,
        metadata={
            "expected_status": case.expected_status,
            "corpus": case.scope.corpus,
            "collection": case.scope.collection,
            "response_status": response.status,
            "projection_context_source": context_source,
            "reference_source_type": reference_source_type,
            "reference_fact_count": len(case.reference_facts or case.required_facts),
            "metric_applicability": metric_applicability,
            "retrieved_source_count": len(observed_trace.retrieved_sources)
            if observed_trace is not None
            else 0,
            "supporting_source_count": len(observed_trace.supporting_sources)
            if observed_trace is not None
            else len(contexts),
        },
    )


def _resolve_projection_contexts(
    *,
    case: GoldenCase,
    observed_trace: ObservedTrace | None,
    evidence: EvidenceBundle | None,
) -> tuple[tuple[str, ...], tuple[str, ...], str]:
    supporting_evidence, supporting_source = _resolve_projection_evidence(
        case=case,
        observed_trace=observed_trace,
        evidence=evidence,
    )
    if supporting_evidence is not None and supporting_evidence.sources:
        statement_contexts, statement_context_ids = _build_statement_level_contexts(
            supporting_evidence
        )
        if statement_contexts:
            return (
                statement_contexts,
                statement_context_ids,
                f"{supporting_source}:statement_contexts",
            )
        return (
            tuple(source.snippet for source in supporting_evidence.sources),
            tuple(_source_projection_id(source) for source in supporting_evidence.sources),
            supporting_source,
        )
    if observed_trace is not None and observed_trace.retrieved_sources:
        return (
            tuple(source.snippet for source in observed_trace.retrieved_sources),
            tuple(_source_projection_id(source) for source in observed_trace.retrieved_sources),
            "observed_trace.retrieved_sources",
        )
    return (), (), "none"


def _resolve_projection_evidence(
    *,
    case: GoldenCase,
    observed_trace: ObservedTrace | None,
    evidence: EvidenceBundle | None,
) -> tuple[EvidenceBundle | None, str]:
    if observed_trace is not None and observed_trace.supporting_sources:
        return (
            EvidenceBundle(
                query_text=case.user_goal,
                corpus=case.scope.corpus,
                collection=case.scope.collection,
                sources=observed_trace.supporting_sources,
            ),
            "observed_trace.supporting_sources",
        )
    if evidence is not None and evidence.sources:
        return evidence, "response.evidence.sources"
    return None, "none"


def _build_statement_level_contexts(
    evidence: EvidenceBundle,
) -> tuple[tuple[str, ...], tuple[str, ...]]:
    try:
        from campus_rag_agent import RagAgent

        draft = RagAgent().build_answer(evidence)
        return (
            draft.supporting_contexts,
            tuple(_source_projection_id(source) for source in draft.supporting_sources),
        )
    except Exception:
        return (), ()


def _source_projection_id(source) -> str:
    return str(source.canonical_source_id or source.doc_id or source.chunk_id or "").strip()


def _reference_source_type(case: GoldenCase) -> str:
    if case.reference_context_ids:
        return "reference_context_ids"
    if case.reference_contexts:
        return "reference_contexts"
    if case.reference_facts:
        return "reference_facts"
    if case.required_facts:
        return "required_facts_fallback"
    return "none"


def _build_metric_applicability(
    case: GoldenCase,
    *,
    metric_names: tuple[str, ...] | None = None,
) -> dict[str, bool]:
    resolved_metric_names = tuple(metric_names or build_default_ragas_metric_names())
    return {
        metric_name: _is_metric_applicable(case, metric_name)
        for metric_name in resolved_metric_names
    }


def _is_metric_applicable(case: GoldenCase, metric_name: str) -> bool:
    override = case.supplemental_metric_overrides.get(metric_name)
    if override is not None:
        return override
    return True


def _require_supported_response(
    execution: ExecutionResult,
) -> AgentResponse | SupervisorResponse:
    response = execution.response
    if not isinstance(response, (AgentResponse, SupervisorResponse)):
        raise TypeError("execution.response must be AgentResponse or SupervisorResponse")
    return response


def build_default_ragas_metric_names() -> tuple[str, ...]:
    from campus_evals.ragas_adapter_metrics import build_default_ragas_metric_names as _delegate

    return _delegate()


def build_ragas_dataset(projection: RagasProjection):
    from ragas import EvaluationDataset, SingleTurnSample

    return EvaluationDataset(
        samples=[
            SingleTurnSample(
                user_input=projection.user_input,
                retrieved_contexts=list(projection.retrieved_contexts),
                reference_contexts=list(projection.reference_contexts),
                retrieved_context_ids=list(projection.retrieved_context_ids),
                reference_context_ids=list(projection.reference_context_ids),
                response=projection.response,
                reference=projection.reference,
            )
        ],
        name=projection.case_id,
    )
