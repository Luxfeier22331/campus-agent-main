from __future__ import annotations

from campus_contracts import KnowledgeScope

from campus_rag_agent.query_planning import (
    CurriculumProgramFamilyQueryPlan,
    CurriculumQueryPlan,
    HandbookQueryPlan,
)
from campus_rag_agent.retrieval_adequacy import (
    RetrievalAdequacyAssessment,
    ambiguous_retrieval_adequacy,
    insufficient_retrieval_adequacy,
)


def _retrieval_adequacy_verdict(
    retrieval_adequacy: RetrievalAdequacyAssessment | None,
) -> str:
    if retrieval_adequacy is None:
        return ""
    return retrieval_adequacy.verdict


def _retrieval_adequacy_reason(
    retrieval_adequacy: RetrievalAdequacyAssessment | None,
) -> str:
    if retrieval_adequacy is None:
        return ""
    return retrieval_adequacy.reason


def _planned_retrieval_adequacy(
    *,
    handbook_plan: HandbookQueryPlan | None,
    curriculum_plan: CurriculumQueryPlan | None,
    curriculum_program_family_plan: CurriculumProgramFamilyQueryPlan | None,
) -> RetrievalAdequacyAssessment:
    for reason in (
        handbook_plan.clarification_reason if handbook_plan is not None else "",
        (
            curriculum_program_family_plan.clarification_reason
            if curriculum_program_family_plan is not None
            else ""
        ),
        curriculum_plan.clarification_reason if curriculum_plan is not None else "",
    ):
        if reason:
            return ambiguous_retrieval_adequacy(reason)
    return ambiguous_retrieval_adequacy("multi_candidate_title")


def _clarification_retrieval_adequacy(
    *,
    resolved_scope: KnowledgeScope,
    handbook_plan: HandbookQueryPlan | None,
    curriculum_plan: CurriculumQueryPlan | None,
    curriculum_program_family_plan: CurriculumProgramFamilyQueryPlan | None,
    intent_frame,
) -> RetrievalAdequacyAssessment | None:
    if (
        resolved_scope.corpus == "regulations"
        and resolved_scope.collection == "student_rules"
        and intent_frame.ambiguity_reason == "missing_target"
    ):
        return ambiguous_retrieval_adequacy("policy_object_missing")
    if (
        (handbook_plan is None or not handbook_plan.clarification_reason)
        and (
            curriculum_program_family_plan is None
            or not curriculum_program_family_plan.clarification_reason
        )
        and (curriculum_plan is None or not curriculum_plan.clarification_reason)
    ):
        return None
    return _planned_retrieval_adequacy(
        handbook_plan=handbook_plan,
        curriculum_plan=curriculum_plan,
        curriculum_program_family_plan=curriculum_program_family_plan,
    )


def _empty_evidence_retrieval_adequacy(no_answer_reason: str):
    if no_answer_reason == "resolved_policy_clause_not_found":
        return insufficient_retrieval_adequacy("resolved_policy_clause_not_found")
    if no_answer_reason == "freshness_fail_close":
        return insufficient_retrieval_adequacy("freshness_fail_close")
    if no_answer_reason == "version_filter_unresolved":
        return insufficient_retrieval_adequacy("version_filter_unresolved")
    if no_answer_reason == "weak_supporting_evidence":
        return insufficient_retrieval_adequacy("weak_supporting_evidence")
    return insufficient_retrieval_adequacy("no_supporting_sources")


__all__ = [
    "_clarification_retrieval_adequacy",
    "_empty_evidence_retrieval_adequacy",
    "_planned_retrieval_adequacy",
    "_retrieval_adequacy_reason",
    "_retrieval_adequacy_verdict",
]
