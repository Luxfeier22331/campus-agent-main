from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts import ClaimSupport, EvidenceSource
from campus_retrieval_core.evidence_attributes import evidence_attributes_for_source
from campus_shared.answer_ready_evidence_contract import (
    ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
)
from campus_shared.regulation_semantic_registry import (
    REGULATION_CONDITION_SUBJECT_DEFINITIONS,
    RegulationCategoryDefinition,
    load_regulation_discovery_config,
    regulation_categories_for_document,
)

from campus_rag_agent.agent_answer_shape import AnswerShape
from campus_rag_agent.answer_presentation_contract import (
    AnswerPresentationDraft,
    validate_answer_presentation_draft,
)
from campus_rag_agent.retrieval_intent import RetrievalIntent


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
class DetailClauseDraftItem(TypedDraftSupport):
    text: str = ""
    answer_role: str = ""
    article_no: str = ""
    clause_no: str = ""
    section_kind: str = ""


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
    detail_clauses: tuple[DetailClauseDraftItem, ...] = field(default_factory=tuple)
    rows: tuple[ConditionTableDraftRow, ...] = field(default_factory=tuple)
    references: tuple[TypedDraftSupport, ...] = field(default_factory=tuple)
    unsupported_reason: str = ""
    clarification_question: str = ""
    presentation: AnswerPresentationDraft | None = None


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
    retrieval_intent: RetrievalIntent | None = None,
) -> TypedAnswerDraft:
    expected_answer_kind = retrieval_intent.expected.answer_kind if retrieval_intent else ""
    if expected_answer_kind == "policy_list":
        answer_shape = AnswerShape.CATEGORY_DISCOVERY_LIST
    elif expected_answer_kind == "eligibility_judgment":
        answer_shape = AnswerShape.JUDGMENT_CLAUSE
    elif expected_answer_kind == "condition_table":
        answer_shape = AnswerShape.CONDITION_OVERVIEW
    elif expected_answer_kind in {
        "policy_object",
        "official_reference",
        "curriculum_document",
    }:
        answer_shape = AnswerShape.TITLE_LOOKUP
    elif expected_answer_kind == "curriculum_fact":
        answer_shape = AnswerShape.GENERAL_SUMMARY
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
                _build_condition_row(
                    source,
                    statements,
                    retrieval_intent=retrieval_intent,
                )
                for source, statements in selected_rows
            ),
        )
    if answer_shape == AnswerShape.GENERAL_SUMMARY:
        return TypedAnswerDraft(
            kind="short_factual_summary",
            references=tuple(
                _build_short_reference(source, statements)
                for source, statements in _short_factual_summary_rows(
                    selected_rows=selected_rows,
                    expected_answer_kind=expected_answer_kind,
                )
            ),
        )
    if _should_build_procedure_steps_draft(
        expected_answer_kind=expected_answer_kind,
        selected_rows=selected_rows,
    ):
        return TypedAnswerDraft(
            kind="procedure_steps",
            steps=tuple(
                _build_procedure_step(source, statements)
                for source, statements in selected_rows
                if _is_procedure_step_draft_source(source)
            ),
        )
    if answer_shape == AnswerShape.DETAIL_CLAUSE:
        return TypedAnswerDraft(
            kind="detail_clause",
            detail_clauses=tuple(
                _build_detail_clause(source, statements) for source, statements in selected_rows
            ),
        )
    if answer_shape == AnswerShape.TITLE_LOOKUP:
        return TypedAnswerDraft(
            kind="short_reference",
            references=tuple(
                _build_short_reference(source, statements) for source, statements in selected_rows
            ),
        )
    if selected_rows:
        return TypedAnswerDraft(
            kind="condition_table",
            rows=tuple(
                _build_condition_row(
                    source,
                    statements,
                    retrieval_intent=retrieval_intent,
                )
                for source, statements in selected_rows
            ),
        )
    return TypedAnswerDraft(kind="unsupported", unsupported_reason="no_supporting_evidence")


def validate_typed_answer_draft(
    draft: TypedAnswerDraft,
    *,
    expected_answer_kind: str = "",
) -> TypedAnswerDraftValidationResult:
    presentation_validation = _validate_presentation_contract(draft)
    if presentation_validation is not None:
        return presentation_validation
    if expected_answer_kind and not _draft_kind_matches_expected(
        draft_kind=draft.kind,
        expected_answer_kind=expected_answer_kind,
    ):
        return _invalid("typed_answer_kind_mismatch")
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
    if draft.kind == "detail_clause":
        if not draft.detail_clauses or any(
            not detail.has_support or not detail.text for detail in draft.detail_clauses
        ):
            return _invalid("detail_clause_support_missing")
        if any(
            _is_v3_contract_item(detail) and not detail.answer_role
            for detail in draft.detail_clauses
        ):
            return _invalid("detail_clause_contract_missing")
        return _valid(_detail_clause_claim_supports(draft.detail_clauses))
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
    if draft.kind == "short_factual_summary":
        if not draft.references or any(
            not ref.has_support or not ref.excerpt for ref in draft.references
        ):
            return _invalid("short_factual_summary_support_missing")
        if _short_factual_summary_reference_budget_exceeded(
            draft=draft,
            expected_answer_kind=expected_answer_kind,
        ):
            return _invalid("short_factual_summary_reference_budget_exceeded")
        return _valid(_claim_supports("short_factual_summary", draft.references))
    if draft.kind == "short_reference":
        if not draft.references or any(
            not ref.has_support or not ref.excerpt for ref in draft.references
        ):
            return _invalid("short_reference_support_missing")
        if len(draft.references) > _short_reference_max_references(expected_answer_kind):
            return _invalid("short_reference_reference_budget_exceeded")
        return _valid(_claim_supports("title_or_entity_identity", draft.references))
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


def _build_detail_clause(
    source: EvidenceSource,
    statements: tuple[str, ...],
) -> DetailClauseDraftItem:
    attributes = evidence_attributes_for_source(source)
    return DetailClauseDraftItem(
        **_support_kwargs(source, statements),
        text=_first_statement(source, statements),
        answer_role=attributes.answer_role,
        article_no=attributes.article_no,
        clause_no=attributes.clause_no,
        section_kind=attributes.section_kind,
    )


def _build_condition_row(
    source: EvidenceSource,
    statements: tuple[str, ...],
    *,
    retrieval_intent: RetrievalIntent | None = None,
) -> ConditionTableDraftRow:
    attributes = evidence_attributes_for_source(source)
    condition_subject = attributes.condition_subject or _condition_subject_from_retrieval_intent(
        source=source,
        statements=statements,
        retrieval_intent=retrieval_intent,
    )
    return ConditionTableDraftRow(
        **_support_kwargs(source, statements),
        condition_subject=condition_subject,
        polarity=attributes.condition_polarity or attributes.polarity,
        condition_text=_first_statement(source, statements),
        answer_role=attributes.answer_role,
    )


def _build_short_reference(
    source: EvidenceSource,
    statements: tuple[str, ...],
) -> TypedDraftSupport:
    return TypedDraftSupport(**_support_kwargs(source, statements))


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


def _condition_subject_from_retrieval_intent(
    *,
    source: EvidenceSource,
    statements: tuple[str, ...],
    retrieval_intent: RetrievalIntent | None,
) -> str:
    if retrieval_intent is None:
        return ""
    if retrieval_intent.expected.answer_kind != "condition_table":
        return ""
    condition_subject = retrieval_intent.target.condition_subject
    if not condition_subject:
        return ""
    definition = REGULATION_CONDITION_SUBJECT_DEFINITIONS.get(condition_subject)
    if definition is None:
        return ""
    attributes = evidence_attributes_for_source(source)
    if attributes.answer_role not in retrieval_intent.expected.evidence_roles:
        return ""
    if not _source_text_covers_condition_subject(
        source=source,
        statements=statements,
        condition_subject=condition_subject,
    ):
        return ""
    return condition_subject


def _source_text_covers_condition_subject(
    *,
    source: EvidenceSource,
    statements: tuple[str, ...],
    condition_subject: str,
) -> bool:
    definition = REGULATION_CONDITION_SUBJECT_DEFINITIONS.get(condition_subject)
    if definition is None:
        return False
    normalized = _normalize_evidence_text(
        " ".join(
            fragment
            for fragment in (
                source.source_title,
                source.detail_label,
                source.snippet,
                *statements,
            )
            if fragment
        )
    )
    if not normalized:
        return False
    direct_terms = tuple(term for term in definition.query_focus_terms if term)
    if direct_terms and not any(term in normalized for term in direct_terms):
        return False
    return all(
        any(term in normalized for term in equivalent_group if term)
        for equivalent_group in definition.query_focus_equivalents
    )


def _normalize_evidence_text(text: str) -> str:
    return "".join(text.split())


def _source_answer_role(source: EvidenceSource) -> str:
    return evidence_attributes_for_source(source).answer_role


def _source_has_procedure_contract(source: EvidenceSource) -> bool:
    procedure = evidence_attributes_for_source(source).procedure
    return procedure.step_index is not None and bool(procedure.actor) and bool(procedure.action)


def _should_build_procedure_steps_draft(
    *,
    expected_answer_kind: str,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> bool:
    if expected_answer_kind == "procedure_steps":
        return True
    if expected_answer_kind not in {"", "general_fact"}:
        return False
    return any(_source_answer_role(source) == "procedure_step" for source, _ in selected_rows)


def _is_procedure_step_draft_source(source: EvidenceSource) -> bool:
    if _source_answer_role(source) == "procedure_step":
        return True
    return _source_answer_role(source) == "time_constraint" and _source_has_procedure_contract(
        source
    )


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


def _draft_kind_matches_expected(*, draft_kind: str, expected_answer_kind: str) -> bool:
    if draft_kind == expected_answer_kind:
        return True
    if (draft_kind, expected_answer_kind) == ("detail_clause", "specific_clause"):
        return True
    if expected_answer_kind in {
        "policy_object",
        "official_reference",
        "curriculum_document",
    }:
        return draft_kind == "short_reference"
    if expected_answer_kind == "general_fact":
        return draft_kind in {
            "condition_table",
            "detail_clause",
            "eligibility_judgment",
            "procedure_steps",
            "short_reference",
        }
    if expected_answer_kind == "curriculum_fact":
        return draft_kind in {"short_reference", "short_factual_summary"}
    return False


def _short_factual_summary_reference_budget_exceeded(
    *,
    draft: TypedAnswerDraft,
    expected_answer_kind: str,
) -> bool:
    max_references = 6 if expected_answer_kind == "curriculum_fact" else 2
    return len(draft.references) > max_references


def _short_reference_max_references(expected_answer_kind: str) -> int:
    if expected_answer_kind == "official_reference":
        return 6
    return 2


def _short_factual_summary_rows(
    *,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
    expected_answer_kind: str,
) -> tuple[tuple[EvidenceSource, tuple[str, ...]], ...]:
    max_references = 6 if expected_answer_kind == "curriculum_fact" else 2
    return selected_rows[:max_references]


def _validate_presentation_contract(
    draft: TypedAnswerDraft,
) -> TypedAnswerDraftValidationResult | None:
    if draft.presentation is None:
        return None
    result = validate_answer_presentation_draft(draft.presentation)
    if result.verdict == "valid":
        return None
    return _invalid(result.failure_reason)


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


def _detail_clause_claim_supports(
    detail_clauses: tuple[DetailClauseDraftItem, ...],
) -> tuple[ClaimSupport, ...]:
    return tuple(
        ClaimSupport(
            claim_type=_detail_clause_claim_type(detail),
            claim_text=detail.text,
            supported=detail.has_support,
            support_source_doc_id=detail.source_id,
            support_snippet=detail.excerpt,
            support_source_trust_tier=detail.source_trust_tier,
        )
        for detail in detail_clauses
    )


def _detail_clause_claim_type(detail: DetailClauseDraftItem) -> str:
    if detail.answer_role in {"definition", "supporting_detail"}:
        return detail.answer_role
    return "detail_clause"


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
    "DetailClauseDraftItem",
    "EligibilityJudgmentDraft",
    "PolicyListDraftItem",
    "ProcedureStepDraftItem",
    "TypedAnswerDraft",
    "TypedAnswerDraftValidationResult",
    "build_typed_answer_draft",
    "validate_typed_answer_draft",
]
