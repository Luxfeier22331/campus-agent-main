from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts import ClaimSupport, EvidenceSource
from campus_retrieval_core.evidence_attributes import evidence_attributes_for_source
from campus_shared.answer_ready_evidence_contract import (
    ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
)
from campus_shared.regulation_semantic_registry import (
    RegulationCategoryDefinition,
    load_regulation_discovery_config,
    regulation_categories_for_document,
)

from campus_rag_agent.agent_answer_shape import AnswerShape


@dataclass(frozen=True, slots=True)
class TypedDraftSupport:
    source_id: str
    chunk_id: str
    excerpt: str
    source_title: str = ""
    source_trust_tier: str = ""
    evidence_contract_version: str = ""

    @property
    def has_support(self) -> bool:
        return bool(self.source_id and self.chunk_id and self.excerpt.strip())


@dataclass(frozen=True, slots=True)
class PolicyListDraftItem(TypedDraftSupport):
    text: str = ""
    category_id: str = ""
    audience: str = ""
    member_document_ids: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class ProcedureStepDraftItem(TypedDraftSupport):
    step_index: int | None = None
    actor: str = ""
    action: str = ""
    condition_subject: str = ""
    materials: tuple[str, ...] = field(default_factory=tuple)
    next_actor: str = ""


@dataclass(frozen=True, slots=True)
class EligibilityJudgmentDraft(TypedDraftSupport):
    condition_subject: str = ""
    polarity: str = ""
    conclusion: str = ""


@dataclass(frozen=True, slots=True)
class ConditionTableDraftRow(TypedDraftSupport):
    condition_subject: str = ""
    polarity: str = ""
    condition_text: str = ""
    answer_role: str = ""


@dataclass(frozen=True, slots=True)
class TypedAnswerDraft:
    kind: str
    items: tuple[PolicyListDraftItem, ...] = field(default_factory=tuple)
    steps: tuple[ProcedureStepDraftItem, ...] = field(default_factory=tuple)
    judgment: EligibilityJudgmentDraft | None = None
    rows: tuple[ConditionTableDraftRow, ...] = field(default_factory=tuple)
    unsupported_reason: str = ""
    clarification_question: str = ""


@dataclass(frozen=True, slots=True)
class TypedAnswerDraftValidationResult:
    verdict: str
    failure_reason: str = ""
    claim_supports: tuple[ClaimSupport, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class CategoryDiscoveryDraftContext:
    collection: str
    category_id: str = ""
    category_display_name: str = ""
    audience: str = ""


def build_typed_answer_draft(
    *,
    answer_shape: AnswerShape,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
    category_discovery_context: CategoryDiscoveryDraftContext | None = None,
) -> TypedAnswerDraft:
    if answer_shape == AnswerShape.CATEGORY_DISCOVERY_LIST:
        return TypedAnswerDraft(
            kind="policy_list",
            items=tuple(
                _build_policy_list_item(
                    source,
                    statements,
                    category_discovery_context=category_discovery_context,
                )
                for source, statements in selected_rows
                if _is_policy_list_source(
                    source,
                    category_discovery_context=category_discovery_context,
                )
            ),
        )
    if answer_shape == AnswerShape.JUDGMENT_CLAUSE:
        return TypedAnswerDraft(
            kind="eligibility_judgment",
            judgment=_build_judgment(selected_rows),
        )
    if answer_shape == AnswerShape.CONDITION_OVERVIEW:
        return TypedAnswerDraft(
            kind="condition_table",
            rows=tuple(
                _build_condition_row(source, statements) for source, statements in selected_rows
            ),
        )
    if any(_source_answer_role(source) == "procedure_step" for source, _ in selected_rows):
        return TypedAnswerDraft(
            kind="procedure_steps",
            steps=tuple(
                _build_procedure_step(source, statements)
                for source, statements in selected_rows
                if _source_answer_role(source) == "procedure_step"
            ),
        )
    if selected_rows:
        return TypedAnswerDraft(
            kind="condition_table",
            rows=tuple(
                _build_condition_row(source, statements) for source, statements in selected_rows
            ),
        )
    return TypedAnswerDraft(kind="unsupported", unsupported_reason="no_supporting_evidence")


def validate_typed_answer_draft(
    draft: TypedAnswerDraft,
) -> TypedAnswerDraftValidationResult:
    if draft.kind == "policy_list":
        if not draft.items or any(not item.has_support or not item.text for item in draft.items):
            return _invalid("policy_list_item_support_missing")
        if any(
            _is_v3_contract_item(item)
            and (not item.category_id or not item.audience or not item.member_document_ids)
            for item in draft.items
        ):
            return _invalid("policy_list_contract_missing")
        return _valid(_claim_supports("policy_list_item", draft.items))
    if draft.kind == "procedure_steps":
        if not draft.steps or any(not step.has_support for step in draft.steps):
            return _invalid("procedure_step_support_missing")
        if any(
            _is_v3_contract_item(step)
            and (
                step.step_index is None
                or not step.actor
                or not step.action
                or not step.condition_subject
            )
            for step in draft.steps
        ):
            return _invalid("procedure_step_contract_missing")
        return _valid(_claim_supports("procedure_step", draft.steps))
    if draft.kind == "eligibility_judgment":
        if draft.judgment is None or not draft.judgment.has_support:
            return _invalid("judgment_support_missing")
        if _is_v3_contract_item(draft.judgment) and (
            not draft.judgment.condition_subject or not draft.judgment.polarity
        ):
            return _invalid("eligibility_judgment_contract_missing")
        return _valid(_claim_supports("eligibility_judgment", (draft.judgment,)))
    if draft.kind == "condition_table":
        if not draft.rows or any(not row.has_support for row in draft.rows):
            return _invalid("condition_row_support_missing")
        if any(
            _is_v3_contract_item(row)
            and (
                not row.condition_subject
                or not row.polarity
                or not row.condition_text
                or not row.answer_role
            )
            for row in draft.rows
        ):
            return _invalid("condition_row_contract_missing")
        return _valid(_condition_row_claim_supports(draft.rows))
    if draft.kind == "unsupported":
        if not draft.unsupported_reason:
            return _invalid("unsupported_reason_missing")
        return _valid(())
    if draft.kind == "clarification":
        if not draft.clarification_question:
            return _invalid("clarification_question_missing")
        return _valid(())
    return _invalid("unsupported_draft_kind")


def _build_policy_list_item(
    source: EvidenceSource,
    statements: tuple[str, ...],
    *,
    category_discovery_context: CategoryDiscoveryDraftContext | None = None,
) -> PolicyListDraftItem:
    attributes = evidence_attributes_for_source(source)
    category = _resolve_policy_list_category(
        source=source,
        category_discovery_context=category_discovery_context,
    )
    category_id = attributes.category_id or (category.category_id if category is not None else "")
    audience = attributes.category_audience or (category.audience if category is not None else "")
    member_document_ids = attributes.category_member_document_ids or (
        category.member_policy_document_ids if category is not None else ()
    )
    return PolicyListDraftItem(
        **_support_kwargs(source, statements),
        text=_policy_item_text(source, statements),
        category_id=category_id,
        audience=audience,
        member_document_ids=member_document_ids,
    )


def _build_procedure_step(
    source: EvidenceSource,
    statements: tuple[str, ...],
) -> ProcedureStepDraftItem:
    attributes = evidence_attributes_for_source(source)
    return ProcedureStepDraftItem(
        **_support_kwargs(source, statements),
        step_index=attributes.procedure.step_index,
        actor=attributes.procedure.actor,
        action=attributes.procedure.action,
        condition_subject=attributes.condition_subject,
        materials=attributes.procedure.materials,
        next_actor=attributes.procedure.next_actor,
    )


def _build_judgment(
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> EligibilityJudgmentDraft | None:
    if not selected_rows:
        return None
    source, statements = selected_rows[0]
    attributes = evidence_attributes_for_source(source)
    return EligibilityJudgmentDraft(
        **_support_kwargs(source, statements),
        condition_subject=attributes.condition_subject,
        polarity=attributes.condition_polarity or attributes.polarity,
        conclusion=_first_statement(source, statements),
    )


def _build_condition_row(
    source: EvidenceSource,
    statements: tuple[str, ...],
) -> ConditionTableDraftRow:
    attributes = evidence_attributes_for_source(source)
    return ConditionTableDraftRow(
        **_support_kwargs(source, statements),
        condition_subject=attributes.condition_subject,
        polarity=attributes.condition_polarity or attributes.polarity,
        condition_text=_first_statement(source, statements),
        answer_role=attributes.answer_role,
    )


def _support_kwargs(
    source: EvidenceSource,
    statements: tuple[str, ...],
) -> dict[str, str]:
    attributes = evidence_attributes_for_source(source)
    return {
        "source_id": source.doc_id,
        "chunk_id": source.chunk_id,
        "excerpt": _first_statement(source, statements),
        "source_title": source.source_title,
        "source_trust_tier": str(source.source_trust_tier or ""),
        "evidence_contract_version": attributes.evidence_contract_version,
    }


def _policy_item_text(source: EvidenceSource, statements: tuple[str, ...]) -> str:
    title = source.source_title.strip() or source.doc_id.split(":", 1)[-1].strip()
    statement = _first_statement(source, statements)
    return f"《{title}》：{statement}" if statement else f"《{title}》"


def _first_statement(source: EvidenceSource, statements: tuple[str, ...]) -> str:
    for statement in statements:
        normalized = statement.strip()
        if normalized:
            return normalized
    return source.snippet.strip()


def _source_answer_role(source: EvidenceSource) -> str:
    return evidence_attributes_for_source(source).answer_role


def _is_policy_list_source(
    source: EvidenceSource,
    *,
    category_discovery_context: CategoryDiscoveryDraftContext | None = None,
) -> bool:
    attributes = evidence_attributes_for_source(source)
    if attributes.answer_role == "category_overview" or source.content_role == "policy_list":
        return True
    return (
        _resolve_policy_list_category(
            source=source,
            category_discovery_context=category_discovery_context,
        )
        is not None
    )


def _resolve_policy_list_category(
    *,
    source: EvidenceSource,
    category_discovery_context: CategoryDiscoveryDraftContext | None,
) -> RegulationCategoryDefinition | None:
    if source.collection not in {"student_rules", "institutional_rules"}:
        return None
    categories = regulation_categories_for_document(
        collection=source.collection,
        document_id=source.doc_id,
    )
    if not categories:
        return None
    if category_discovery_context is None:
        return categories[0] if len(categories) == 1 else None
    if category_discovery_context.collection != source.collection:
        return None
    if category_discovery_context.category_id:
        category = _category_by_id(
            collection=source.collection,
            category_id=category_discovery_context.category_id,
        )
        if category is not None and source.doc_id in category.member_policy_document_ids:
            return category
    if category_discovery_context.category_display_name:
        normalized_display_name = category_discovery_context.category_display_name.strip()
        matching = tuple(
            category
            for category in categories
            if category.display_name == normalized_display_name
            and (
                not category_discovery_context.audience
                or category.audience == category_discovery_context.audience
            )
        )
        if len(matching) == 1:
            return matching[0]
    return categories[0] if len(categories) == 1 else None


def _category_by_id(*, collection: str, category_id: str) -> RegulationCategoryDefinition | None:
    if not category_id:
        return None
    discovery = load_regulation_discovery_config(collection)
    return next(
        (category for category in discovery.categories if category.category_id == category_id),
        None,
    )


def _is_v3_contract_item(item: TypedDraftSupport) -> bool:
    return item.evidence_contract_version == ANSWER_READY_EVIDENCE_CONTRACT_VERSION


def _claim_supports(
    claim_type: str,
    supports: tuple[TypedDraftSupport, ...],
) -> tuple[ClaimSupport, ...]:
    return tuple(
        ClaimSupport(
            claim_type=claim_type,
            claim_text=support.excerpt,
            supported=support.has_support,
            support_source_doc_id=support.source_id,
            support_snippet=support.excerpt,
            support_source_trust_tier=support.source_trust_tier,
        )
        for support in supports
    )


def _condition_row_claim_supports(
    rows: tuple[ConditionTableDraftRow, ...],
) -> tuple[ClaimSupport, ...]:
    return tuple(
        ClaimSupport(
            claim_type=_condition_row_claim_type(row),
            claim_text=row.excerpt,
            supported=row.has_support,
            support_source_doc_id=row.source_id,
            support_snippet=row.excerpt,
            support_source_trust_tier=row.source_trust_tier,
        )
        for row in rows
    )


def _condition_row_claim_type(row: ConditionTableDraftRow) -> str:
    if row.answer_role in {"table_fact", "time_constraint", "material_requirement"}:
        return row.answer_role
    return "condition_row"


def _valid(claim_supports: tuple[ClaimSupport, ...]) -> TypedAnswerDraftValidationResult:
    return TypedAnswerDraftValidationResult(verdict="valid", claim_supports=claim_supports)


def _invalid(reason: str) -> TypedAnswerDraftValidationResult:
    return TypedAnswerDraftValidationResult(verdict="invalid", failure_reason=reason)


__all__ = [
    "CategoryDiscoveryDraftContext",
    "ConditionTableDraftRow",
    "EligibilityJudgmentDraft",
    "PolicyListDraftItem",
    "ProcedureStepDraftItem",
    "TypedAnswerDraft",
    "TypedAnswerDraftValidationResult",
    "build_typed_answer_draft",
    "validate_typed_answer_draft",
]
