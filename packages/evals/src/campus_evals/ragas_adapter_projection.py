from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts import EvidenceBundle, ExecutionResponse, RagResultPayload, ToolResponse

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
        observed_trace=observed_trace,
        evidence=evidence,
    )
    reference = "\n".join(case.reference_facts or case.required_facts).strip()
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
            "reference_source_type": _reference_source_type(case),
            "reference_fact_count": len(case.reference_facts or case.required_facts),
            "metric_applicability": _build_metric_applicability(case),
            "retrieved_source_count": len(observed_trace.retrieved_sources)
            if observed_trace is not None
            else 0,
            "supporting_source_count": len(observed_trace.supporting_sources)
            if observed_trace is not None
            else len(contexts),
            "retrieved_doc_ids": _source_doc_ids(
                observed_trace.retrieved_sources if observed_trace is not None else ()
            ),
            "retrieved_chunk_ids": _source_chunk_ids(
                observed_trace.retrieved_sources if observed_trace is not None else ()
            ),
            "supporting_doc_ids": _source_doc_ids(
                observed_trace.supporting_sources if observed_trace is not None else ()
            ),
            "supporting_chunk_ids": _source_chunk_ids(
                observed_trace.supporting_sources if observed_trace is not None else ()
            ),
        },
    )


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


def _resolve_projection_contexts(
    *,
    observed_trace: ObservedTrace | None,
    evidence: EvidenceBundle | None,
) -> tuple[tuple[str, ...], tuple[str, ...], str]:
    if observed_trace is not None and observed_trace.supporting_sources:
        return (
            tuple(source.snippet for source in observed_trace.supporting_sources),
            tuple(_source_projection_id(source) for source in observed_trace.supporting_sources),
            "observed_trace.supporting_sources",
        )
    if evidence is not None and evidence.sources:
        return (
            tuple(source.snippet for source in evidence.sources),
            tuple(_source_projection_id(source) for source in evidence.sources),
            "response.evidence.sources",
        )
    if observed_trace is not None and observed_trace.retrieved_sources:
        return (
            tuple(source.snippet for source in observed_trace.retrieved_sources),
            tuple(_source_projection_id(source) for source in observed_trace.retrieved_sources),
            "observed_trace.retrieved_sources",
        )
    return (), (), "none"


def _source_projection_id(source) -> str:
    return str(source.canonical_source_id or source.doc_id or source.chunk_id or "").strip()


def _source_doc_ids(sources) -> tuple[str, ...]:
    return tuple(
        str(source.doc_id or "").strip() for source in sources if str(source.doc_id or "").strip()
    )


def _source_chunk_ids(sources) -> tuple[str, ...]:
    return tuple(
        str(source.chunk_id or "").strip()
        for source in sources
        if str(source.chunk_id or "").strip()
    )


def _reference_source_type(case: GoldenCase) -> str:
    if case.reference_context_ids:
        return "reference_context_ids"
    if case.reference_contexts:
        return "reference_contexts"
    if case.reference_facts:
        return "reference_facts"
    if case.required_facts:
        return "required_facts_derived"
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
) -> ToolResponse | ExecutionResponse:
    response = execution.response
    if not isinstance(response, (ToolResponse, ExecutionResponse)):
        raise TypeError("execution.response must be ToolResponse or ExecutionResponse")
    return response


def build_default_ragas_metric_names() -> tuple[str, ...]:
    from campus_evals.ragas_adapter_metrics import build_default_ragas_metric_names as _delegate

    return _delegate()
