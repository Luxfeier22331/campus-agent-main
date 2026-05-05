from __future__ import annotations

from campus_contracts import (
    ClaimEvidenceGraphEntry,
    ClaimSupport,
    EvidenceBundle,
    KnowledgeScope,
    RagPlannerInformationNeed,
    RagProjectionContextSummary,
    RagReplanDecisionSummary,
)
from campus_retrieval_core import RetrievalExecutionResult

_COLLECTION_MINIMUM_SOURCE_TRUST_TIER = {
    "curriculum_plan": "T0",
    "program_semester_facts": "T0",
    "program_family_facts": "T0",
    "course_facts": "T0",
    "student_rules": "T1",
    "institutional_rules": "T1",
    "stable_reference": "T2",
}


def build_planner_information_needs(
    *,
    user_goal: str,
    effective_scope: KnowledgeScope,
    retrieval_collection: str,
    query_mode: str,
) -> tuple[RagPlannerInformationNeed, ...]:
    goal = user_goal.strip()
    if not goal:
        return ()
    evidence_kinds = _infer_expected_evidence_kinds(goal)
    return tuple(
        RagPlannerInformationNeed(
            need_id=f"need:{index}:{kind}",
            question=_question_for_kind(goal, kind),
            target_collection=retrieval_collection,
            query_mode=query_mode,
            expected_evidence_kind=kind,
            source_trust_tier=_minimum_source_trust_tier(
                effective_scope=effective_scope,
                retrieval_collection=retrieval_collection,
            ),
        )
        for index, kind in enumerate(evidence_kinds, start=1)
    )


def build_projection_context_summaries(
    projection_refs: tuple[dict[str, object], ...],
) -> tuple[RagProjectionContextSummary, ...]:
    summaries: list[RagProjectionContextSummary] = []
    for projection_ref in projection_refs:
        safety = projection_ref.get("safety")
        summaries.append(
            RagProjectionContextSummary(
                projection_id=str(projection_ref.get("projection_id") or "").strip(),
                source_step_id=str(projection_ref.get("source_step_id") or "").strip(),
                projection_kind=str(projection_ref.get("projection_kind") or "").strip(),
                content_hash=str(projection_ref.get("content_hash") or "").strip(),
                safety_summary=dict(safety) if isinstance(safety, dict) else {},
                evidence_use="planning_framing",
            )
        )
    return tuple(summaries)


def build_replan_decision_summary(
    retrieval_execution_result: RetrievalExecutionResult | None,
) -> RagReplanDecisionSummary | None:
    if retrieval_execution_result is None:
        return None
    if retrieval_execution_result.replan_count <= 0:
        return None
    failed_step = next(
        (
            result
            for result in retrieval_execution_result.step_results
            if result.failure is not None or result.status in {"blocked", "failed"}
        ),
        None,
    )
    if failed_step is not None and failed_step.failure is not None:
        trigger_reason = str(failed_step.failure.failure_kind)
        outcome = "failed_closed" if failed_step.failure.terminal else "scope_preserved"
        fail_close_reason = trigger_reason if failed_step.failure.terminal else ""
    elif any(result.status == "empty" for result in retrieval_execution_result.step_results):
        trigger_reason = "empty_supporting_evidence"
        outcome = "scope_preserved"
        fail_close_reason = ""
    else:
        trigger_reason = "evidence_expansion"
        outcome = "scope_preserved"
        fail_close_reason = ""
    return RagReplanDecisionSummary(
        attempted=True,
        replan_count=retrieval_execution_result.replan_count,
        trigger_reason=trigger_reason,
        outcome=outcome,
        fail_close_reason=fail_close_reason,
    )


def build_claim_evidence_graph(
    *,
    evidence: EvidenceBundle,
    claim_supports: tuple[ClaimSupport, ...],
) -> tuple[ClaimEvidenceGraphEntry, ...]:
    if claim_supports:
        return tuple(
            ClaimEvidenceGraphEntry(
                claim_id=f"claim:{index}",
                claim_text=claim.claim_text,
                supported=claim.supported,
                support_source_doc_ids=_claim_support_doc_ids(claim, evidence),
                support_chunk_ids=_claim_support_chunk_ids(claim, evidence),
                support_need_ids=_claim_support_need_ids(claim, evidence),
                support_version_sides=_claim_support_version_sides(claim, evidence),
                support_status="supported" if claim.supported else "unsupported",
                required_source_trust_tier=claim.required_source_trust_tier,
                observed_source_trust_tiers=_claim_observed_tiers(claim, evidence),
            )
            for index, claim in enumerate(claim_supports, start=1)
        )
    return tuple(
        ClaimEvidenceGraphEntry(
            claim_id=f"claim:{index}",
            claim_text=_source_claim_text(source),
            supported=True,
            support_source_doc_ids=(source.doc_id,),
            support_chunk_ids=(source.chunk_id,),
            support_need_ids=_source_support_need_ids(source),
            support_version_sides=_source_support_version_sides(source),
            support_status="supported",
            required_source_trust_tier=str(source.source_trust_tier or ""),
            observed_source_trust_tiers=(
                (str(source.source_trust_tier),) if source.source_trust_tier else ()
            ),
        )
        for index, source in enumerate(evidence.sources, start=1)
        if source.is_answer_bearing
    )


def _infer_expected_evidence_kinds(user_goal: str) -> tuple[str, ...]:
    kinds: list[str] = []
    if any(token in user_goal for token in ("材料", "需要", "条件", "要求")):
        kinds.append("requirement")
    if any(token in user_goal for token in ("流程", "步骤", "办理", "审核", "怎么")):
        kinds.append("procedure")
    if any(token in user_goal for token in ("区别", "比较", "变化", "不同")):
        kinds.append("comparison")
    if any(token in user_goal for token in ("依据", "条款", "规定", "规则")):
        kinds.append("policy_clause")
    if not kinds:
        kinds.append("answer_bearing_passage")
    return tuple(dict.fromkeys(kinds))


def _question_for_kind(user_goal: str, evidence_kind: str) -> str:
    if evidence_kind == "requirement":
        return f"{user_goal} - identify required materials, conditions, or obligations"
    if evidence_kind == "procedure":
        return f"{user_goal} - identify procedure, review, or handling steps"
    if evidence_kind == "comparison":
        return f"{user_goal} - identify both sides of the comparison"
    if evidence_kind == "policy_clause":
        return f"{user_goal} - identify the governing policy clause"
    return user_goal


def _minimum_source_trust_tier(
    *,
    effective_scope: KnowledgeScope,
    retrieval_collection: str,
) -> str:
    if effective_scope.corpus == "curriculum":
        return "T0"
    return _COLLECTION_MINIMUM_SOURCE_TRUST_TIER.get(retrieval_collection, "T1")


def _claim_support_doc_ids(
    claim: ClaimSupport,
    evidence: EvidenceBundle,
) -> tuple[str, ...]:
    if claim.support_source_doc_id:
        return (claim.support_source_doc_id,)
    return tuple(source.doc_id for source in evidence.sources if source.is_answer_bearing)


def _claim_support_chunk_ids(
    claim: ClaimSupport,
    evidence: EvidenceBundle,
) -> tuple[str, ...]:
    if claim.support_source_doc_id:
        return tuple(
            source.chunk_id
            for source in evidence.sources
            if source.doc_id == claim.support_source_doc_id
        )
    return tuple(source.chunk_id for source in evidence.sources if source.is_answer_bearing)


def _claim_support_need_ids(
    claim: ClaimSupport,
    evidence: EvidenceBundle,
) -> tuple[str, ...]:
    if claim.support_source_doc_id:
        return tuple(
            dict.fromkeys(
                need_id
                for source in evidence.sources
                if source.doc_id == claim.support_source_doc_id
                for need_id in _source_support_need_ids(source)
            )
        )
    return tuple(
        dict.fromkeys(
            need_id
            for source in evidence.sources
            if source.is_answer_bearing
            for need_id in _source_support_need_ids(source)
        )
    )


def _claim_support_version_sides(
    claim: ClaimSupport,
    evidence: EvidenceBundle,
) -> tuple[str, ...]:
    if claim.support_source_doc_id:
        return tuple(
            dict.fromkeys(
                version_side
                for source in evidence.sources
                if source.doc_id == claim.support_source_doc_id
                for version_side in _source_support_version_sides(source)
            )
        )
    return tuple(
        dict.fromkeys(
            version_side
            for source in evidence.sources
            if source.is_answer_bearing
            for version_side in _source_support_version_sides(source)
        )
    )


def _claim_observed_tiers(
    claim: ClaimSupport,
    evidence: EvidenceBundle,
) -> tuple[str, ...]:
    if claim.support_source_trust_tier:
        return (str(claim.support_source_trust_tier),)
    return tuple(
        dict.fromkeys(
            str(source.source_trust_tier)
            for source in evidence.sources
            if source.is_answer_bearing and source.source_trust_tier
        )
    )


def _source_support_need_ids(source) -> tuple[str, ...]:
    raw_need_ids = source.anchor.get("retrieval_need_ids")
    if not isinstance(raw_need_ids, tuple):
        return ()
    return tuple(str(need_id) for need_id in raw_need_ids if str(need_id).strip())


def _source_support_version_sides(source) -> tuple[str, ...]:
    raw_version_side = source.anchor.get("retrieval_version_side")
    if not isinstance(raw_version_side, str) or not raw_version_side.strip():
        return ()
    return (raw_version_side.strip(),)


def _source_claim_text(source) -> str:
    snippet = source.snippet.strip()
    if snippet:
        return snippet
    if source.source_title.strip():
        return source.source_title.strip()
    return source.doc_id


__all__ = [
    "build_claim_evidence_graph",
    "build_planner_information_needs",
    "build_projection_context_summaries",
    "build_replan_decision_summary",
]
