from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts import ClaimSupport, EvidenceSource
from campus_retrieval_core.evidence_attributes import evidence_attributes_for_source

from campus_rag_agent.agent_answer_shape import AnswerShape


@dataclass(frozen=True, slots=True)
class TypedDraftSupport:
    source_id: str
    chunk_id: str
    excerpt: str
    source_title: str = ""
    source_trust_tier: str = ""

    @property
    def has_support(self) -> bool:
        return bool(self.source_id and self.chunk_id and self.excerpt.strip())


@dataclass(frozen=True, slots=True)
class PolicyListDraftItem(TypedDraftSupport):
    text: str = ""


@dataclass(frozen=True, slots=True)
class ProcedureStepDraftItem(TypedDraftSupport):
    step_index: int | None = None
    actor: str = ""
    action: str = ""
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


def build_typed_answer_draft(
    *,
    answer_shape: AnswerShape,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> TypedAnswerDraft:
    if answer_shape == AnswerShape.CATEGORY_DISCOVERY_LIST:
        return TypedAnswerDraft(
            kind="policy_list",
            items=tuple(
                PolicyListDraftItem(
                    **_support_kwargs(source, statements),
                    text=_policy_item_text(source, statements),
                )
                for source, statements in selected_rows
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
            rows=tuple(_build_condition_row(source, statements) for source, statements in selected_rows),
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
            rows=tuple(_build_condition_row(source, statements) for source, statements in selected_rows),
        )
    return TypedAnswerDraft(kind="unsupported", unsupported_reason="no_supporting_evidence")


def validate_typed_answer_draft(
    draft: TypedAnswerDraft,
) -> TypedAnswerDraftValidationResult:
    if draft.kind == "policy_list":
        if not draft.items or any(not item.has_support or not item.text for item in draft.items):
            return _invalid("policy_list_item_support_missing")
        return _valid(_claim_supports("policy_list_item", draft.items))
    if draft.kind == "procedure_steps":
        if not draft.steps or any(not step.has_support for step in draft.steps):
            return _invalid("procedure_step_support_missing")
        return _valid(_claim_supports("procedure_step", draft.steps))
    if draft.kind == "eligibility_judgment":
        if draft.judgment is None or not draft.judgment.has_support:
            return _invalid("judgment_support_missing")
        return _valid(_claim_supports("eligibility_judgment", (draft.judgment,)))
    if draft.kind == "condition_table":
        if not draft.rows or any(not row.has_support for row in draft.rows):
            return _invalid("condition_row_support_missing")
        return _valid(_claim_supports("condition_row", draft.rows))
    if draft.kind == "unsupported":
        if not draft.unsupported_reason:
            return _invalid("unsupported_reason_missing")
        return _valid(())
    if draft.kind == "clarification":
        if not draft.clarification_question:
            return _invalid("clarification_question_missing")
        return _valid(())
    return _invalid("unsupported_draft_kind")


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
    )


def _support_kwargs(
    source: EvidenceSource,
    statements: tuple[str, ...],
) -> dict[str, str]:
    return {
        "source_id": source.doc_id,
        "chunk_id": source.chunk_id,
        "excerpt": _first_statement(source, statements),
        "source_title": source.source_title,
        "source_trust_tier": str(source.source_trust_tier or ""),
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


def _valid(claim_supports: tuple[ClaimSupport, ...]) -> TypedAnswerDraftValidationResult:
    return TypedAnswerDraftValidationResult(verdict="valid", claim_supports=claim_supports)


def _invalid(reason: str) -> TypedAnswerDraftValidationResult:
    return TypedAnswerDraftValidationResult(verdict="invalid", failure_reason=reason)


__all__ = [
    "ConditionTableDraftRow",
    "EligibilityJudgmentDraft",
    "PolicyListDraftItem",
    "ProcedureStepDraftItem",
    "TypedAnswerDraft",
    "TypedAnswerDraftValidationResult",
    "build_typed_answer_draft",
    "validate_typed_answer_draft",
]
