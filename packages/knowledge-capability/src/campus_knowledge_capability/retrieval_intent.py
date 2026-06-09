from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from campus_contracts import KnowledgeScope
from campus_regulation_semantics.regulation_semantic_registry import (
    REGULATION_CONDITION_SUBJECT_DEFINITIONS,
)

from .retrieval_intent_classifiers import (
    _curriculum_semester_fact_target_document_ids,
    _institutional_specific_policy_intent_kind,
    _looks_like_curriculum_fact_query,
    _specific_policy_intent_kind,
)
from .retrieval_intent_validation import (
    _normalize_and_validate_literal,
    _normalize_str_field,
    _normalize_tuple_field,
)

RetrievalIntentKind = Literal[
    "policy_list",
    "policy_object_lookup",
    "specific_clause_lookup",
    "eligibility_judgment",
    "procedure_steps",
    "condition_table",
    "version_compare",
    "curriculum_document_lookup",
    "curriculum_fact_lookup",
    "official_reference_lookup",
    "general_fact_lookup",
    "clarification_required",
    "unsupported",
]
RetrievalAnswerKind = Literal[
    "policy_list",
    "policy_object",
    "specific_clause",
    "eligibility_judgment",
    "procedure_steps",
    "condition_table",
    "version_compare",
    "curriculum_document",
    "curriculum_fact",
    "official_reference",
    "general_fact",
    "clarification",
    "unsupported",
]
RetrievalCoveragePolicy = Literal[
    "none",
    "single_document_focus",
    "category_member_coverage",
    "condition_subject_alignment",
    "procedure_step_completeness",
    "version_pair_coverage",
]
RetrievalSelectionPolicy = Literal[
    "default",
    "answer_role_first",
    "document_identity_first",
    "one_answer_ready_source_per_member",
    "focused_clause_first",
    "official_reference_first",
]
RetrievalRerankPolicy = Literal["profile_gated_if_eligible", "disabled"]
RetrievalReplanPolicy = Literal[
    "none",
    "intent_gap_replan",
    "coverage_gap_replan",
    "focus_gap_replan",
]

ALLOWED_RETRIEVAL_INTENT_KINDS = (
    "policy_list",
    "policy_object_lookup",
    "specific_clause_lookup",
    "eligibility_judgment",
    "procedure_steps",
    "condition_table",
    "version_compare",
    "curriculum_document_lookup",
    "curriculum_fact_lookup",
    "official_reference_lookup",
    "general_fact_lookup",
    "clarification_required",
    "unsupported",
)
ALLOWED_RETRIEVAL_ANSWER_KINDS = (
    "policy_list",
    "policy_object",
    "specific_clause",
    "eligibility_judgment",
    "procedure_steps",
    "condition_table",
    "version_compare",
    "curriculum_document",
    "curriculum_fact",
    "official_reference",
    "general_fact",
    "clarification",
    "unsupported",
)
ALLOWED_RETRIEVAL_COVERAGE_POLICIES = (
    "none",
    "single_document_focus",
    "category_member_coverage",
    "condition_subject_alignment",
    "procedure_step_completeness",
    "version_pair_coverage",
)
ALLOWED_RETRIEVAL_SELECTION_POLICIES = (
    "default",
    "answer_role_first",
    "document_identity_first",
    "one_answer_ready_source_per_member",
    "focused_clause_first",
    "official_reference_first",
)
ALLOWED_RETRIEVAL_RERANK_POLICIES = ("profile_gated_if_eligible", "disabled")
ALLOWED_RETRIEVAL_REPLAN_POLICIES = (
    "none",
    "intent_gap_replan",
    "coverage_gap_replan",
    "focus_gap_replan",
)


@dataclass(frozen=True, slots=True)
class RetrievalIntentExpectation:
    answer_kind: RetrievalAnswerKind | str
    evidence_roles: tuple[str, ...] = field(default_factory=tuple)
    coverage_policy: RetrievalCoveragePolicy | str = "none"
    selection_policy: RetrievalSelectionPolicy | str = "default"
    rerank_policy: RetrievalRerankPolicy | str = "profile_gated_if_eligible"
    replan_policy: RetrievalReplanPolicy | str = "intent_gap_replan"

    def __post_init__(self) -> None:
        _normalize_and_validate_literal(
            self,
            field_name="answer_kind",
            allowed=ALLOWED_RETRIEVAL_ANSWER_KINDS,
            label="retrieval answer kind",
        )
        _normalize_and_validate_literal(
            self,
            field_name="coverage_policy",
            allowed=ALLOWED_RETRIEVAL_COVERAGE_POLICIES,
            label="retrieval coverage policy",
        )
        _normalize_and_validate_literal(
            self,
            field_name="selection_policy",
            allowed=ALLOWED_RETRIEVAL_SELECTION_POLICIES,
            label="retrieval selection policy",
        )
        _normalize_and_validate_literal(
            self,
            field_name="rerank_policy",
            allowed=ALLOWED_RETRIEVAL_RERANK_POLICIES,
            label="retrieval rerank policy",
        )
        _normalize_and_validate_literal(
            self,
            field_name="replan_policy",
            allowed=ALLOWED_RETRIEVAL_REPLAN_POLICIES,
            label="retrieval replan policy",
        )
        _normalize_tuple_field(self, "evidence_roles")

    def to_dict(self) -> dict[str, object]:
        return {
            "answer_kind": self.answer_kind,
            "evidence_roles": list(self.evidence_roles),
            "coverage_policy": self.coverage_policy,
            "selection_policy": self.selection_policy,
            "rerank_policy": self.rerank_policy,
            "replan_policy": self.replan_policy,
        }


@dataclass(frozen=True, slots=True)
class RetrievalIntentTarget:
    corpus: str
    collection: str
    document_ids: tuple[str, ...] = field(default_factory=tuple)
    document_titles: tuple[str, ...] = field(default_factory=tuple)
    preferred_document_ids: tuple[str, ...] = field(default_factory=tuple)
    version_ids: tuple[str, ...] = field(default_factory=tuple)
    revision_track: str = ""
    article_nos: tuple[str, ...] = field(default_factory=tuple)
    clause_nos: tuple[str, ...] = field(default_factory=tuple)
    detail_labels: tuple[str, ...] = field(default_factory=tuple)
    focus_terms: tuple[str, ...] = field(default_factory=tuple)
    category_id: str = ""
    category_member_document_ids: tuple[str, ...] = field(default_factory=tuple)
    condition_subject: str = ""

    def __post_init__(self) -> None:
        for field_name in (
            "document_ids",
            "document_titles",
            "preferred_document_ids",
            "version_ids",
            "article_nos",
            "clause_nos",
            "detail_labels",
            "focus_terms",
            "category_member_document_ids",
        ):
            _normalize_tuple_field(self, field_name)
        for field_name in (
            "corpus",
            "collection",
            "revision_track",
            "category_id",
            "condition_subject",
        ):
            _normalize_str_field(self, field_name)
        if not self.corpus:
            raise ValueError("retrieval intent target corpus must not be empty")
        if not self.collection:
            raise ValueError("retrieval intent target collection must not be empty")

    def to_dict(self) -> dict[str, object]:
        return {
            "corpus": self.corpus,
            "collection": self.collection,
            "document_ids": list(self.document_ids),
            "document_titles": list(self.document_titles),
            "preferred_document_ids": list(self.preferred_document_ids),
            "version_ids": list(self.version_ids),
            "revision_track": self.revision_track,
            "article_nos": list(self.article_nos),
            "clause_nos": list(self.clause_nos),
            "detail_labels": list(self.detail_labels),
            "focus_terms": list(self.focus_terms),
            "category_id": self.category_id,
            "category_member_document_ids": list(self.category_member_document_ids),
            "condition_subject": self.condition_subject,
        }


@dataclass(frozen=True, slots=True)
class RetrievalIntent:
    kind: RetrievalIntentKind | str
    normalized_query: str
    expected: RetrievalIntentExpectation
    target: RetrievalIntentTarget
    critical_terms: tuple[str, ...] = field(default_factory=tuple)
    clarification_reason: str = ""
    unsupported_reason: str = ""
    schema_version: int = 1

    def __post_init__(self) -> None:
        if self.schema_version != 1:
            raise ValueError("retrieval intent schema_version must be 1")
        _normalize_and_validate_literal(
            self,
            field_name="kind",
            allowed=ALLOWED_RETRIEVAL_INTENT_KINDS,
            label="retrieval intent kind",
        )
        _normalize_str_field(self, "normalized_query")
        _normalize_str_field(self, "clarification_reason")
        _normalize_str_field(self, "unsupported_reason")
        _normalize_tuple_field(self, "critical_terms")
        if not self.normalized_query:
            raise ValueError("retrieval intent normalized_query must not be empty")
        self._validate_required_target()

    def _validate_required_target(self) -> None:
        if self.kind == "policy_list" and not self.target.category_id:
            raise ValueError("policy_list requires category_id")
        if self.kind == "policy_object_lookup" and not (
            self.target.document_ids or self.target.document_titles
        ):
            raise ValueError("policy_object_lookup requires document_ids or document_titles")
        if self.kind in {
            "specific_clause_lookup",
            "eligibility_judgment",
            "procedure_steps",
            "condition_table",
        } and not (self.target.document_ids or self.target.category_member_document_ids):
            raise ValueError(f"{self.kind} requires document_ids or category_member_document_ids")
        if self.kind == "version_compare" and len(self.target.version_ids) < 2:
            raise ValueError("version_compare requires at least two version_ids")
        if self.kind == "clarification_required" and not self.clarification_reason:
            raise ValueError("clarification_required requires clarification_reason")
        if self.kind == "unsupported" and not self.unsupported_reason:
            raise ValueError("unsupported requires unsupported_reason")

    def to_dict(self) -> dict[str, object]:
        return {
            "schema_version": self.schema_version,
            "kind": self.kind,
            "normalized_query": self.normalized_query,
            "expected": self.expected.to_dict(),
            "target": self.target.to_dict(),
            "critical_terms": list(self.critical_terms),
            "clarification_reason": self.clarification_reason,
            "unsupported_reason": self.unsupported_reason,
        }


def retrieval_intent_for_official_web_stable_reference(
    *,
    query_text: str,
    scope: KnowledgeScope,
) -> RetrievalIntent:
    if scope.corpus != "official_web":
        raise ValueError("official web retrieval intent requires official_web corpus")
    return RetrievalIntent(
        kind="official_reference_lookup",
        normalized_query=query_text,
        expected=RetrievalIntentExpectation(
            answer_kind="official_reference",
            evidence_roles=("reference_fact", "directory_reference", "primary_content"),
            coverage_policy="single_document_focus",
            selection_policy="official_reference_first",
            replan_policy="focus_gap_replan",
        ),
        target=RetrievalIntentTarget(
            corpus=scope.corpus,
            collection=scope.collection,
        ),
    )


def retrieval_intent_for_general_fact_scope(
    *,
    query_text: str,
    scope: KnowledgeScope,
) -> RetrievalIntent:
    return RetrievalIntent(
        kind="general_fact_lookup",
        normalized_query=query_text,
        expected=RetrievalIntentExpectation(
            answer_kind="general_fact",
            evidence_roles=("primary_content", "reference_fact", "table_fact"),
            coverage_policy="single_document_focus",
            selection_policy="answer_role_first",
            replan_policy="focus_gap_replan",
        ),
        target=RetrievalIntentTarget(
            corpus=scope.corpus,
            collection=scope.collection,
        ),
    )


def _specific_policy_expectation(plan) -> RetrievalIntentExpectation:
    kind = _specific_policy_intent_kind(plan)
    if kind == "procedure_steps":
        return RetrievalIntentExpectation(
            answer_kind="procedure_steps",
            evidence_roles=_condition_subject_expected_roles(
                plan.query_condition_subject,
                default_roles=("procedure_step", "procedure"),
            ),
            coverage_policy="procedure_step_completeness",
            selection_policy="answer_role_first",
            replan_policy="intent_gap_replan",
        )
    if kind == "eligibility_judgment":
        return RetrievalIntentExpectation(
            answer_kind="eligibility_judgment",
            evidence_roles=_condition_subject_expected_roles(
                plan.query_condition_subject,
                default_roles=("judgment_clause", "eligibility", "requirement"),
            ),
            coverage_policy="condition_subject_alignment",
            selection_policy="answer_role_first",
            replan_policy="intent_gap_replan",
        )
    if kind == "condition_table":
        if plan.category_member_document_ids and not plan.target_document_ids:
            return RetrievalIntentExpectation(
                answer_kind="condition_table",
                evidence_roles=_condition_subject_expected_roles(
                    plan.query_condition_subject,
                    default_roles=("eligibility", "requirement", "condition"),
                ),
                coverage_policy="category_member_coverage",
                selection_policy="one_answer_ready_source_per_member",
                replan_policy="coverage_gap_replan",
            )
        return RetrievalIntentExpectation(
            answer_kind="condition_table",
            evidence_roles=_condition_subject_expected_roles(
                plan.query_condition_subject,
                default_roles=(
                    "eligibility_condition",
                    "exception_rule",
                    "exclusion_rule",
                    "material_requirement",
                    "time_constraint",
                    "table_fact",
                    "supporting_detail",
                    "eligibility",
                    "requirement",
                    "condition",
                ),
            ),
            coverage_policy="condition_subject_alignment",
            selection_policy="answer_role_first",
            replan_policy="intent_gap_replan",
        )
    if kind == "policy_object_lookup":
        return RetrievalIntentExpectation(
            answer_kind="policy_object",
            evidence_roles=("document_identity",),
            coverage_policy="single_document_focus",
            selection_policy="document_identity_first",
            replan_policy="focus_gap_replan",
        )
    return RetrievalIntentExpectation(
        answer_kind="specific_clause",
        evidence_roles=(
            "primary_content",
            "procedure_step",
            "eligibility_condition",
            "exception_rule",
            "exclusion_rule",
            "material_requirement",
            "time_constraint",
            "supporting_detail",
            "eligibility",
            "requirement",
        ),
        coverage_policy="single_document_focus",
        selection_policy="focused_clause_first",
        replan_policy="focus_gap_replan",
    )


def _condition_subject_expected_roles(
    condition_subject: str,
    *,
    default_roles: tuple[str, ...],
) -> tuple[str, ...]:
    normalized_subject = condition_subject.strip()
    if not normalized_subject:
        return default_roles
    definition = REGULATION_CONDITION_SUBJECT_DEFINITIONS.get(normalized_subject)
    if definition is None or not definition.expected_answer_roles:
        return default_roles
    return definition.expected_answer_roles


def retrieval_intent_for_handbook_plan(plan) -> RetrievalIntent:
    target = RetrievalIntentTarget(
        corpus="regulations",
        collection="student_rules",
        document_ids=plan.target_document_ids,
        preferred_document_ids=plan.preferred_document_ids,
        article_nos=plan.focus_article_nos,
        clause_nos=plan.focus_clause_nos,
        detail_labels=plan.focus_detail_labels,
        focus_terms=plan.focus_terms,
        category_id=plan.category_id,
        category_member_document_ids=plan.category_member_document_ids,
        condition_subject=plan.query_condition_subject,
    )
    if plan.status == "needs_clarification":
        return RetrievalIntent(
            kind="clarification_required",
            normalized_query=plan.rewritten_query_text,
            expected=RetrievalIntentExpectation(
                answer_kind="clarification",
                evidence_roles=(),
                coverage_policy="none",
                selection_policy="default",
                rerank_policy="disabled",
                replan_policy="none",
            ),
            target=target,
            clarification_reason=plan.clarification_reason or plan.task_kind,
        )
    if plan.task_kind == "category_discovery":
        return RetrievalIntent(
            kind="policy_list",
            normalized_query=plan.rewritten_query_text,
            expected=RetrievalIntentExpectation(
                answer_kind="policy_list",
                evidence_roles=("category_overview", "policy_list"),
                coverage_policy="category_member_coverage",
                selection_policy="one_answer_ready_source_per_member",
                replan_policy="coverage_gap_replan",
            ),
            target=target,
            critical_terms=(plan.category_display_name or plan.category_id,),
        )
    if plan.task_kind == "specific_policy_lookup" and plan.status == "resolved":
        return RetrievalIntent(
            kind=_specific_policy_intent_kind(plan),
            normalized_query=plan.focused_query_text or plan.rewritten_query_text,
            expected=_specific_policy_expectation(plan),
            target=target,
            critical_terms=plan.focus_terms,
        )
    return RetrievalIntent(
        kind="unsupported",
        normalized_query=plan.rewritten_query_text,
        expected=RetrievalIntentExpectation(
            answer_kind="unsupported",
            evidence_roles=(),
            coverage_policy="none",
            selection_policy="default",
            rerank_policy="disabled",
            replan_policy="none",
        ),
        target=target,
        unsupported_reason=plan.task_kind or "unsupported_or_no_hit",
    )


def retrieval_intent_for_institutional_rules_plan(plan) -> RetrievalIntent:
    if plan.task_kind == "category_discovery":
        return RetrievalIntent(
            kind="policy_list",
            normalized_query=plan.normalized_query,
            expected=RetrievalIntentExpectation(
                answer_kind="policy_list",
                evidence_roles=("category_overview", "policy_list"),
                coverage_policy="category_member_coverage",
                selection_policy="one_answer_ready_source_per_member",
                replan_policy="coverage_gap_replan",
            ),
            target=RetrievalIntentTarget(
                corpus="regulations",
                collection="institutional_rules",
                preferred_document_ids=plan.target_document_ids,
                category_id=plan.category_id,
                category_member_document_ids=plan.category_member_document_ids,
                condition_subject=plan.query_condition_subject,
            ),
            critical_terms=(plan.category_id,),
        )
    kind = _institutional_specific_policy_intent_kind(plan)
    if kind == "policy_object_lookup":
        expected = RetrievalIntentExpectation(
            answer_kind="policy_object",
            evidence_roles=("document_identity",),
            coverage_policy="single_document_focus",
            selection_policy="document_identity_first",
            replan_policy="focus_gap_replan",
        )
    elif kind == "specific_clause_lookup":
        expected = RetrievalIntentExpectation(
            answer_kind="specific_clause",
            evidence_roles=("primary_content", "eligibility", "requirement"),
            coverage_policy="single_document_focus",
            selection_policy="focused_clause_first",
            replan_policy="focus_gap_replan",
        )
    else:
        expected = _specific_policy_expectation(plan)
    return RetrievalIntent(
        kind=kind,
        normalized_query=plan.normalized_query,
        expected=expected,
        target=RetrievalIntentTarget(
            corpus="regulations",
            collection="institutional_rules",
            document_ids=plan.target_document_ids,
            document_titles=plan.target_document_titles,
            condition_subject=plan.query_condition_subject,
        ),
        critical_terms=plan.focus_terms,
    )


def retrieval_intent_for_curriculum_plan(plan) -> RetrievalIntent:
    if plan.status == "needs_clarification":
        return RetrievalIntent(
            kind="clarification_required",
            normalized_query=plan.rewritten_query_text,
            expected=RetrievalIntentExpectation(
                answer_kind="clarification",
                rerank_policy="disabled",
                replan_policy="none",
            ),
            target=RetrievalIntentTarget(
                corpus="curriculum",
                collection="curriculum_plan",
                document_ids=plan.target_document_ids,
                preferred_document_ids=plan.preferred_document_ids,
            ),
            clarification_reason=plan.clarification_reason,
        )
    if plan.status == "unsupported":
        return RetrievalIntent(
            kind="unsupported",
            normalized_query=plan.rewritten_query_text,
            expected=RetrievalIntentExpectation(
                answer_kind="unsupported",
                rerank_policy="disabled",
                replan_policy="none",
            ),
            target=RetrievalIntentTarget(
                corpus="curriculum",
                collection="curriculum_plan",
                document_ids=plan.target_document_ids,
                preferred_document_ids=plan.preferred_document_ids,
            ),
            unsupported_reason=plan.unsupported_reason,
        )
    if (
        getattr(plan, "intent_kind", "") == "generic"
        and plan.target_document_ids
        and not _looks_like_curriculum_fact_query(plan.rewritten_query_text)
    ):
        return RetrievalIntent(
            kind="curriculum_document_lookup",
            normalized_query=plan.rewritten_query_text,
            expected=RetrievalIntentExpectation(
                answer_kind="curriculum_document",
                evidence_roles=("document_identity",),
                coverage_policy="single_document_focus",
                selection_policy="document_identity_first",
                replan_policy="focus_gap_replan",
            ),
            target=RetrievalIntentTarget(
                corpus="curriculum",
                collection="curriculum_plan",
                document_ids=plan.target_document_ids,
                preferred_document_ids=plan.preferred_document_ids,
            ),
            critical_terms=(plan.resolved_document_title or "curriculum_document",),
        )
    semester_fact_document_ids = _curriculum_semester_fact_target_document_ids(plan)
    if semester_fact_document_ids:
        return RetrievalIntent(
            kind="curriculum_fact_lookup",
            normalized_query=plan.rewritten_query_text,
            expected=RetrievalIntentExpectation(
                answer_kind="curriculum_fact",
                evidence_roles=(
                    "course_fact",
                    "semester_course_list",
                    "table_fact",
                    "section_text",
                ),
                coverage_policy="single_document_focus",
                selection_policy="answer_role_first",
                replan_policy="focus_gap_replan",
            ),
            target=RetrievalIntentTarget(
                corpus="curriculum",
                collection="program_semester_facts",
                document_ids=semester_fact_document_ids,
            ),
            critical_terms=(plan.intent_kind,),
        )
    return RetrievalIntent(
        kind="curriculum_fact_lookup",
        normalized_query=plan.rewritten_query_text,
        expected=RetrievalIntentExpectation(
            answer_kind="curriculum_fact",
            evidence_roles=("course_fact", "semester_course_list", "table_fact", "section_text"),
            coverage_policy="single_document_focus",
            selection_policy="answer_role_first",
            replan_policy="focus_gap_replan",
        ),
        target=RetrievalIntentTarget(
            corpus="curriculum",
            collection="curriculum_plan",
            document_ids=plan.target_document_ids,
            preferred_document_ids=plan.preferred_document_ids,
        ),
        critical_terms=(plan.intent_kind,),
    )


def retrieval_intent_for_curriculum_course_plan(plan) -> RetrievalIntent:
    return RetrievalIntent(
        kind="curriculum_fact_lookup",
        normalized_query=(
            plan.canonical_course_title
            or plan.canonical_course_family_title
            or plan.canonical_course_id
            or plan.canonical_course_family_id
        ),
        expected=RetrievalIntentExpectation(
            answer_kind="curriculum_fact",
            evidence_roles=("course_fact", "family_membership", "semester_course_list"),
            coverage_policy="single_document_focus",
            selection_policy="answer_role_first",
            replan_policy="focus_gap_replan",
        ),
        target=RetrievalIntentTarget(
            corpus="curriculum",
            collection=plan.internal_collection,
        ),
        critical_terms=(plan.fact_intent,),
        unsupported_reason=",".join(plan.unsupported_fields),
    )


def retrieval_intent_for_curriculum_program_family_plan(plan) -> RetrievalIntent:
    if plan.resolution_mode == "needs_clarification":
        return RetrievalIntent(
            kind="clarification_required",
            normalized_query=plan.canonical_program_family_title or plan.clarification_reason,
            expected=RetrievalIntentExpectation(
                answer_kind="clarification",
                rerank_policy="disabled",
                replan_policy="none",
            ),
            target=RetrievalIntentTarget(
                corpus="curriculum",
                collection=plan.internal_collection,
            ),
            clarification_reason=plan.clarification_reason,
        )
    return RetrievalIntent(
        kind="curriculum_fact_lookup",
        normalized_query=plan.canonical_program_family_title or plan.canonical_program_family_id,
        expected=RetrievalIntentExpectation(
            answer_kind="curriculum_fact",
            evidence_roles=("family_membership",),
            coverage_policy="single_document_focus",
            selection_policy="answer_role_first",
            replan_policy="focus_gap_replan",
        ),
        target=RetrievalIntentTarget(
            corpus="curriculum",
            collection=plan.internal_collection,
        ),
        critical_terms=("family_membership",),
    )


__all__ = [
    "RetrievalIntent",
    "RetrievalIntentExpectation",
    "RetrievalIntentTarget",
    "retrieval_intent_for_curriculum_course_plan",
    "retrieval_intent_for_curriculum_plan",
    "retrieval_intent_for_curriculum_program_family_plan",
    "retrieval_intent_for_general_fact_scope",
    "retrieval_intent_for_handbook_plan",
    "retrieval_intent_for_institutional_rules_plan",
    "retrieval_intent_for_official_web_stable_reference",
]
