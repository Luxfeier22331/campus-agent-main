from __future__ import annotations

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_shared.regulation_semantic_registry import (
    REGULATION_CONDITION_SUBJECT_DEFINITIONS,
)

from campus_retrieval_core.evidence_attributes import (
    EvidenceContractDiagnostics,
    EvidenceAttributes,
    evidence_attributes_for_source,
    evidence_contract_diagnostics_for_source,
)
from campus_retrieval_core.evidence_semantics import (
    infer_evidence_query_intent,
    source_conflicts_with_query_polarity,
)
from campus_retrieval_core.models import (
    RetrievalPlan,
    RetrievalSelector,
    RetrievalSemanticHint,
    RetrievalStep,
    RetrievalStepActivity,
    RetrievalStepBudget,
    RetrievalStepFailure,
    RetrievalStepResult,
)
from campus_retrieval_core.query_focus import (
    query_has_focus_constraints,
    select_sources_covering_query_focus,
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
        semantic_hint=step.semantic_hint,
        sources=evidence.sources,
    )
    status = "succeeded" if grounding else "empty"
    failure_kind = "reranker_degraded" if reranker_degraded else None
    if status == "empty" and evidence.sources:
        failure_kind = grounding_failure_kind or "no_grounding"
    contract_diagnostics = _merge_contract_diagnostics(evidence.sources)
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
            contract_missing=contract_diagnostics.contract_missing,
            contract_issue_reason=contract_diagnostics.contract_issue_reason,
            missing_contract_fields=contract_diagnostics.missing_contract_fields,
            source_index_contract_version=contract_diagnostics.source_index_contract_version,
        ),
    )


def _select_grounding_sources(
    *,
    query_text: str,
    semantic_hint: RetrievalSemanticHint | None,
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
        intent = _effective_query_intent(query_text=query_text, semantic_hint=semantic_hint)
        positive_grounding = tuple(
            source
            for source in sources
            if not _is_negative_grounding_source(source)
            and not source_conflicts_with_query_polarity(
                query_text=query_text,
                source=source,
            )
        )
        positive_grounding = _prefer_intent_specific_grounding(
            intent_answer_role=intent.answer_role,
            grounding=positive_grounding,
        )
        semantic_failure_kind = _semantic_grounding_failure_kind(
            query_text=query_text,
            semantic_hint=semantic_hint,
            sources=sources,
            grounding=positive_grounding,
        )
        if semantic_failure_kind:
            return (), semantic_failure_kind
        if query_has_focus_constraints(query_text):
            focus_grounding = select_sources_covering_query_focus(
                query_text=query_text,
                sources=positive_grounding,
            )
            if focus_grounding:
                semantic_failure_kind = _semantic_grounding_failure_kind(
                    query_text=query_text,
                    semantic_hint=semantic_hint,
                    sources=sources,
                    grounding=focus_grounding,
                )
                if semantic_failure_kind:
                    return (), semantic_failure_kind
                return focus_grounding, ""
            semantic_failure_kind = _semantic_grounding_failure_kind(
                query_text=query_text,
                semantic_hint=semantic_hint,
                sources=sources,
                grounding=positive_grounding,
            )
            if semantic_failure_kind:
                return (), semantic_failure_kind
            return (), "focus_mismatch"
        return positive_grounding, ""
    if all(_is_negative_grounding_source(source) for source in sources):
        return (), ""
    if query_has_focus_constraints(query_text):
        focus_grounding = select_sources_covering_query_focus(
            query_text=query_text,
            sources=sources,
        )
        if focus_grounding:
            return focus_grounding, ""
        return (), "focus_mismatch"
    return sources, ""


def _semantic_grounding_failure_kind(
    *,
    query_text: str,
    semantic_hint: RetrievalSemanticHint | None,
    sources: tuple[EvidenceSource, ...],
    grounding: tuple[EvidenceSource, ...],
) -> str:
    intent = _effective_query_intent(
        query_text=query_text,
        semantic_hint=semantic_hint,
    )
    if not grounding:
        if not sources:
            return ""
        if (
            intent.answer_role == "condition"
            and intent.condition_subject
            and _has_group_subject_only_match(
                sources=sources,
                condition_subject=intent.condition_subject,
            )
        ):
            return "group_support_missing"
        if intent.answer_role == "procedure" and _has_same_group_but_wrong_answer_role(
            sources=sources,
            expected_roles={"procedure_step"},
        ):
            return "procedure_group_answer_role_mismatch"
        if intent.answer_role == "condition" and _has_same_group_but_wrong_answer_role(
            sources=sources,
            expected_roles=_expected_condition_answer_roles(intent.condition_subject),
        ):
            return "condition_group_answer_role_mismatch"
        return ""

    if (
        intent.answer_role == "condition"
        and intent.condition_subject
        and _grounding_is_group_example_only(
            grounding=grounding,
            condition_subject=intent.condition_subject,
        )
    ):
        return "group_support_missing"
    if intent.answer_role == "procedure" and _grounding_lacks_expected_answer_role(
        grounding=grounding,
        expected_roles={"procedure_step"},
    ):
        return "procedure_group_answer_role_mismatch"
    if intent.answer_role == "condition" and _grounding_lacks_expected_answer_role(
        grounding=grounding,
        expected_roles=_expected_condition_answer_roles(intent.condition_subject),
    ):
        return "condition_group_answer_role_mismatch"
    return ""


def _effective_query_intent(
    *,
    query_text: str,
    semantic_hint: RetrievalSemanticHint | None,
):
    inferred_intent = infer_evidence_query_intent(query_text)
    if semantic_hint is None:
        return inferred_intent
    answer_role = _answer_role_from_semantic_hint(semantic_hint)
    if answer_role == "neutral":
        return inferred_intent
    semantic_intent = infer_evidence_query_intent_from_semantic_hint(
        semantic_hint=semantic_hint,
        answer_role=answer_role,
    )
    return type(semantic_intent)(
        polarity=(
            semantic_intent.polarity
            if semantic_intent.polarity != "neutral"
            else inferred_intent.polarity
        ),
        answer_role=semantic_intent.answer_role,
        action_type=semantic_intent.action_type or inferred_intent.action_type,
        condition_subject=semantic_intent.condition_subject or inferred_intent.condition_subject,
        category_id=semantic_intent.category_id or inferred_intent.category_id,
    )


def infer_evidence_query_intent_from_semantic_hint(
    *,
    semantic_hint: RetrievalSemanticHint,
    answer_role: str,
):
    polarity = "neutral"
    if answer_role in {"procedure", "condition"}:
        polarity = "positive"
    return type(infer_evidence_query_intent(""))(
        polarity=polarity,
        answer_role=answer_role,
        action_type="",
        condition_subject=semantic_hint.condition_subject,
        category_id=semantic_hint.category_id,
    )


def _answer_role_from_semantic_hint(semantic_hint: RetrievalSemanticHint) -> str:
    if semantic_hint.intent_kind == "policy_list":
        return "policy_list"
    if semantic_hint.intent_kind == "procedure_steps":
        return "procedure"
    if semantic_hint.intent_kind in {"condition_table", "eligibility_judgment"}:
        return "condition"
    return "neutral"


def _expected_condition_answer_roles(condition_subject: str) -> set[str]:
    normalized = condition_subject.strip()
    if not normalized:
        return {"eligibility_condition", "exception_rule", "exclusion_rule"}
    definition = REGULATION_CONDITION_SUBJECT_DEFINITIONS.get(normalized)
    if definition is None:
        return {"eligibility_condition", "exception_rule", "exclusion_rule"}
    return set(definition.expected_answer_roles)


def _has_group_subject_only_match(
    *,
    sources: tuple[EvidenceSource, ...],
    condition_subject: str,
) -> bool:
    return any(
        _normalized_condition_group_subject(attributes) == condition_subject
        and _normalized_condition_subject(attributes) != condition_subject
        for attributes in _attributes_for_sources(sources)
    )


def _grounding_is_group_example_only(
    *,
    grounding: tuple[EvidenceSource, ...],
    condition_subject: str,
) -> bool:
    attributes = _attributes_for_sources(grounding)
    if not attributes:
        return False
    return all(
        _normalized_condition_group_subject(item) == condition_subject
        and _normalized_condition_subject(item) != condition_subject
        and item.answer_role == "example_evidence"
        for item in attributes
    )


def _has_same_group_but_wrong_answer_role(
    *,
    sources: tuple[EvidenceSource, ...],
    expected_roles: set[str],
) -> bool:
    attributes = _attributes_for_sources(sources)
    if not attributes:
        return False
    return any(item.condition_group_id for item in attributes) and all(
        item.answer_role not in expected_roles for item in attributes
    )


def _grounding_lacks_expected_answer_role(
    *,
    grounding: tuple[EvidenceSource, ...],
    expected_roles: set[str],
) -> bool:
    attributes = _attributes_for_sources(grounding)
    if not attributes:
        return False
    return any(item.condition_group_id for item in attributes) and all(
        item.answer_role not in expected_roles for item in attributes
    )


def _attributes_for_sources(
    sources: tuple[EvidenceSource, ...],
) -> tuple[EvidenceAttributes, ...]:
    return tuple(evidence_attributes_for_source(source) for source in sources)


def _normalized_condition_subject(attributes: EvidenceAttributes) -> str:
    return attributes.condition_subject.strip()


def _normalized_condition_group_subject(attributes: EvidenceAttributes) -> str:
    return attributes.condition_group_subject.strip()


def _merge_contract_diagnostics(
    sources: tuple[EvidenceSource, ...],
) -> EvidenceContractDiagnostics:
    diagnostics = tuple(evidence_contract_diagnostics_for_source(source) for source in sources)
    contract_diagnostics = tuple(item for item in diagnostics if item.contract_missing)
    if not contract_diagnostics:
        source_index_contract_version = next(
            (
                item.source_index_contract_version
                for item in diagnostics
                if item.source_index_contract_version
            ),
            "",
        )
        return EvidenceContractDiagnostics(
            source_index_contract_version=source_index_contract_version,
        )
    missing_fields: list[str] = []
    for diagnostic in contract_diagnostics:
        for field_name in diagnostic.missing_contract_fields:
            if field_name not in missing_fields:
                missing_fields.append(field_name)
    return EvidenceContractDiagnostics(
        contract_missing=True,
        contract_issue_reason="missing_contract",
        missing_contract_fields=tuple(missing_fields),
        source_index_contract_version=next(
            (
                diagnostic.source_index_contract_version
                for diagnostic in contract_diagnostics
                if diagnostic.source_index_contract_version
            ),
            "",
        ),
    )


def _is_positive_grounding_source(source: EvidenceSource) -> bool:
    attributes = evidence_attributes_for_source(source)
    if attributes.answer_role in {"eligibility_intro", "definition", "supporting_detail"}:
        return False
    return source.is_answer_bearing or source.content_role in _POSITIVE_GROUNDING_CONTENT_ROLES


def _prefer_intent_specific_grounding(
    *,
    intent_answer_role: str,
    grounding: tuple[EvidenceSource, ...],
) -> tuple[EvidenceSource, ...]:
    if intent_answer_role == "procedure":
        procedure_grounding = tuple(
            source
            for source in grounding
            if source.is_answer_bearing
            or source.content_role == "procedure"
            or evidence_attributes_for_source(source).answer_role == "procedure_step"
        )
        return procedure_grounding or grounding
    if intent_answer_role == "condition":
        condition_grounding = tuple(
            source
            for source in grounding
            if source.is_answer_bearing
            or evidence_attributes_for_source(source).answer_role
            in _expected_condition_answer_roles(
                evidence_attributes_for_source(source).condition_subject
            )
        )
        return condition_grounding or grounding
    return grounding


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
    if query_mode != "freshness_sensitive":
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
