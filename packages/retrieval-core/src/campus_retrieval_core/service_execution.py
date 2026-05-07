from __future__ import annotations

from campus_contracts import EvidenceBundle, EvidenceSource

from campus_retrieval_core.evidence_attributes import (
    EvidenceFallbackDiagnostics,
    evidence_fallback_diagnostics_for_source,
)
from campus_retrieval_core.evidence_semantics import source_conflicts_with_query_polarity
from campus_retrieval_core.models import (
    RetrievalPlan,
    RetrievalSelector,
    RetrievalStep,
    RetrievalStepActivity,
    RetrievalStepBudget,
    RetrievalStepFailure,
    RetrievalStepResult,
)
from campus_retrieval_core.query_focus import (
    query_has_focus_constraints,
    source_covers_query_focus,
)

_NEGATIVE_GROUNDING_CONTENT_ROLES = frozenset(
    {
        "appendix",
        "background",
        "closing_provision",
        "navigation",
        "source_attribution",
        "boilerplate",
        "media_caption",
    }
)
_POSITIVE_GROUNDING_CONTENT_ROLES = frozenset(
    {
        "audience",
        "course_fact",
        "deadline",
        "definition",
        "eligibility",
        "family_membership",
        "primary_content",
        "procedure",
        "reference_fact",
        "requirement",
        "scope_rule",
        "semester",
        "semester_course_list",
        "table_fact",
        "time_rule",
    }
)


def validate_replanned_step(
    *,
    plan: RetrievalPlan,
    triggering_step: RetrievalStep,
    replanned_step: RetrievalStep,
) -> str | None:
    if replanned_step.step_type != "indexed_lookup":
        return "replanned step must stay on indexed_lookup and cannot switch to live branch"
    if replanned_step.scope != triggering_step.scope:
        return "replanned step must preserve the triggering step scope"
    if triggering_step.step_id not in replanned_step.depends_on_step_ids:
        return "replanned step must depend on the triggering step"
    if replanned_step.expected_output != triggering_step.expected_output:
        return "replanned step must preserve expected_output"

    selector_error = validate_replanned_selector(
        original=triggering_step.selector,
        replanned=replanned_step.selector,
    )
    if selector_error is not None:
        return selector_error

    budget_error = validate_replanned_step_budget(
        original=triggering_step.budget,
        replanned=replanned_step.budget,
    )
    if budget_error is not None:
        return budget_error

    admitted_scope_keys = {(scope.corpus, scope.collection) for scope in plan.admitted_scopes}
    if (replanned_step.scope.corpus, replanned_step.scope.collection) not in admitted_scope_keys:
        return "replanned step must stay within admitted_scopes"

    return None


def validate_replanned_selector(
    *,
    original: RetrievalSelector,
    replanned: RetrievalSelector,
) -> str | None:
    tuple_fields = (
        "target_document_ids",
        "target_version_ids",
        "preferred_document_ids",
        "canonical_course_ids",
        "canonical_course_family_ids",
        "canonical_program_family_ids",
        "entity_keys",
    )
    for field_name in tuple_fields:
        original_values = getattr(original, field_name)
        replanned_values = getattr(replanned, field_name)
        if not original_values:
            continue
        if not replanned_values:
            return f"replanned selector must preserve {field_name}"
        if not set(replanned_values).issubset(original_values):
            return f"replanned selector must not widen {field_name}"

    if (
        original.target_revision_track
        and replanned.target_revision_track != original.target_revision_track
    ):
        return "replanned selector must preserve target_revision_track"

    return None


def validate_replanned_step_budget(
    *,
    original: RetrievalStepBudget,
    replanned: RetrievalStepBudget,
) -> str | None:
    if replanned.top_k > original.top_k:
        return "replanned step must not widen top_k"
    if original.timeout_ms is not None and (
        replanned.timeout_ms is None or replanned.timeout_ms > original.timeout_ms
    ):
        return "replanned step must not widen timeout_ms"
    return None


def build_succeeded_step_result(
    step: RetrievalStep,
    *,
    evidence: EvidenceBundle,
    latency_ms: int,
    reranker_degraded: bool = False,
    reranker_failure_kind: str = "",
) -> RetrievalStepResult:
    grounding, grounding_failure_kind = _select_grounding_sources(
        query_text=step.query_text,
        sources=evidence.sources,
    )
    status = "succeeded" if grounding else "empty"
    failure_kind = "reranker_degraded" if reranker_degraded else None
    if status == "empty" and evidence.sources:
        failure_kind = grounding_failure_kind or "no_grounding"
    fallback_diagnostics = _merge_fallback_diagnostics(evidence.sources)
    return RetrievalStepResult(
        step_id=step.step_id,
        status=status,
        grounding=grounding,
        references=evidence.sources,
        activity=RetrievalStepActivity(
            step_id=step.step_id,
            step_type=step.step_type,
            corpus=step.scope.corpus,
            collection=step.scope.collection,
            status=status,
            query_text=step.query_text,
            need_ids=step.need_ids,
            target_document_ids=step.selector.target_document_ids,
            target_version_ids=step.selector.target_version_ids,
            top_k=step.budget.top_k,
            latency_ms=latency_ms,
            candidate_count=len(evidence.sources),
            reference_count=len(evidence.sources),
            failure_kind=failure_kind,
            reranker_degraded=reranker_degraded,
            reranker_failure_kind=reranker_failure_kind,
            fallback_used=fallback_diagnostics.fallback_used,
            fallback_reason=fallback_diagnostics.fallback_reason,
            missing_contract_fields=fallback_diagnostics.missing_contract_fields,
            source_index_contract_version=fallback_diagnostics.source_index_contract_version,
            fallback_primary_signal=fallback_diagnostics.fallback_primary_signal,
        ),
    )


def _select_grounding_sources(
    *,
    query_text: str,
    sources: tuple[EvidenceSource, ...],
) -> tuple[tuple[EvidenceSource, ...], str]:
    if not sources:
        return (), ""
    if (
        sources
        and source_conflicts_with_query_polarity(query_text=query_text, source=sources[0])
        and not any(
            _is_positive_grounding_source(source)
            and not source_conflicts_with_query_polarity(query_text=query_text, source=source)
            for source in sources
        )
    ):
        return (), "polarity_conflict"
    if any(_is_positive_grounding_source(source) for source in sources):
        positive_grounding = tuple(
            source
            for source in sources
            if not _is_negative_grounding_source(source)
            and not source_conflicts_with_query_polarity(
                query_text=query_text,
                source=source,
            )
        )
        if query_has_focus_constraints(query_text):
            focus_grounding = tuple(
                source
                for source in positive_grounding
                if source_covers_query_focus(query_text=query_text, source=source)
            )
            if focus_grounding:
                return focus_grounding, ""
            return (), "focus_mismatch"
        return positive_grounding, ""
    if all(_is_negative_grounding_source(source) for source in sources):
        return (), ""
    if query_has_focus_constraints(query_text):
        focus_grounding = tuple(
            source
            for source in sources
            if source_covers_query_focus(query_text=query_text, source=source)
        )
        if focus_grounding:
            return focus_grounding, ""
        return (), "focus_mismatch"
    return sources, ""


def _merge_fallback_diagnostics(
    sources: tuple[EvidenceSource, ...],
) -> EvidenceFallbackDiagnostics:
    diagnostics = tuple(evidence_fallback_diagnostics_for_source(source) for source in sources)
    fallback_diagnostics = tuple(item for item in diagnostics if item.fallback_used)
    if not fallback_diagnostics:
        source_index_contract_version = next(
            (
                item.source_index_contract_version
                for item in diagnostics
                if item.source_index_contract_version
            ),
            "",
        )
        return EvidenceFallbackDiagnostics(
            source_index_contract_version=source_index_contract_version,
        )
    missing_fields: list[str] = []
    for diagnostic in fallback_diagnostics:
        for field_name in diagnostic.missing_contract_fields:
            if field_name not in missing_fields:
                missing_fields.append(field_name)
    return EvidenceFallbackDiagnostics(
        fallback_used=True,
        fallback_reason="missing_contract",
        missing_contract_fields=tuple(missing_fields),
        source_index_contract_version=next(
            (
                diagnostic.source_index_contract_version
                for diagnostic in fallback_diagnostics
                if diagnostic.source_index_contract_version
            ),
            "",
        ),
        fallback_primary_signal=next(
            (
                diagnostic.fallback_primary_signal
                for diagnostic in fallback_diagnostics
                if diagnostic.fallback_primary_signal
            ),
            "",
        ),
    )


def _is_positive_grounding_source(source: EvidenceSource) -> bool:
    return source.is_answer_bearing or source.content_role in _POSITIVE_GROUNDING_CONTENT_ROLES


def _is_negative_grounding_source(source: EvidenceSource) -> bool:
    return source.content_role in _NEGATIVE_GROUNDING_CONTENT_ROLES


def build_decision_step_result(
    step: RetrievalStep,
    *,
    status: str,
) -> RetrievalStepResult:
    return RetrievalStepResult(
        step_id=step.step_id,
        status=status,
        activity=RetrievalStepActivity(
            step_id=step.step_id,
            step_type=step.step_type,
            corpus=step.scope.corpus,
            collection=step.scope.collection,
            status=status,
            query_text=step.query_text,
            need_ids=step.need_ids,
            target_document_ids=step.selector.target_document_ids,
            target_version_ids=step.selector.target_version_ids,
            top_k=step.budget.top_k,
            candidate_count=0,
            reference_count=0,
        ),
    )


def build_blocked_step_result(
    step: RetrievalStep,
    *,
    failure_kind: str,
    message: str,
) -> RetrievalStepResult:
    return RetrievalStepResult(
        step_id=step.step_id,
        status="blocked",
        activity=RetrievalStepActivity(
            step_id=step.step_id,
            step_type=step.step_type,
            corpus=step.scope.corpus,
            collection=step.scope.collection,
            status="blocked",
            query_text=step.query_text,
            need_ids=step.need_ids,
            target_document_ids=step.selector.target_document_ids,
            target_version_ids=step.selector.target_version_ids,
            top_k=step.budget.top_k,
            candidate_count=0,
            reference_count=0,
            failure_kind=failure_kind,
        ),
        failure=RetrievalStepFailure(failure_kind=failure_kind, terminal=True, message=message),
    )


def build_failed_step_result(
    step: RetrievalStep,
    *,
    failure_kind: str,
    message: str,
) -> RetrievalStepResult:
    failure_step_id = f"{step.step_id}:failure"
    return RetrievalStepResult(
        step_id=failure_step_id,
        status="failed",
        activity=RetrievalStepActivity(
            step_id=failure_step_id,
            step_type=step.step_type,
            corpus=step.scope.corpus,
            collection=step.scope.collection,
            status="failed",
            query_text=step.query_text,
            need_ids=step.need_ids,
            target_document_ids=step.selector.target_document_ids,
            target_version_ids=step.selector.target_version_ids,
            top_k=step.budget.top_k,
            candidate_count=0,
            reference_count=0,
            failure_kind=failure_kind,
        ),
        failure=RetrievalStepFailure(failure_kind=failure_kind, terminal=True, message=message),
    )


def filter_merged_evidence_by_source_trust_policy(
    evidence: EvidenceBundle,
    *,
    query_mode: str,
    minimum_tier: str,
) -> EvidenceBundle:
    if query_mode not in {"freshness_sensitive", "live_assisted"}:
        return evidence
    if not minimum_tier:
        return evidence
    filtered_sources = tuple(
        source
        for source in evidence.sources
        if source_trust_tier_satisfies_policy(
            required_tier=minimum_tier,
            observed_tier=source.source_trust_tier,
        )
    )
    if filtered_sources == evidence.sources:
        return evidence
    return EvidenceBundle(
        query_text=evidence.query_text,
        corpus=evidence.corpus,
        collection=evidence.collection,
        sources=filtered_sources,
    )


def source_trust_tier_satisfies_policy(
    *,
    required_tier: str,
    observed_tier: str,
) -> bool:
    if not observed_tier:
        return False
    if required_tier == "T0":
        return observed_tier == "T0"
    if required_tier == "T1":
        return observed_tier in {"T0", "T1"}
    if required_tier == "T2":
        return observed_tier == "T2"
    if required_tier == "T3":
        return observed_tier == "T3"
    return False


def merge_step_evidence(
    *,
    executed_steps: tuple[RetrievalStep, ...],
    step_results: tuple[RetrievalStepResult, ...],
) -> EvidenceBundle:
    ordered_sources: dict[str, object] = {}
    query_text = ""
    final_scope = executed_steps[0].scope

    for step, result in zip(executed_steps, step_results, strict=False):
        if not query_text:
            query_text = step.query_text
        for source in result.grounding:
            chunk_id = getattr(source, "chunk_id", "")
            dedupe_key = chunk_id or repr(source)
            ordered_sources.setdefault(dedupe_key, source)

    return EvidenceBundle(
        query_text=query_text,
        corpus=final_scope.corpus,
        collection=final_scope.collection,
        sources=tuple(ordered_sources.values()),
    )


__all__ = [
    "build_blocked_step_result",
    "build_decision_step_result",
    "build_failed_step_result",
    "build_succeeded_step_result",
    "filter_merged_evidence_by_source_trust_policy",
    "merge_step_evidence",
    "source_trust_tier_satisfies_policy",
    "validate_replanned_selector",
    "validate_replanned_step",
    "validate_replanned_step_budget",
]
