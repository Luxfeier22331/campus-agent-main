from __future__ import annotations

from dataclasses import dataclass

from campus_retrieval_core import (
    RetrievalPlan,
    RetrievalSelector,
    RetrievalSemanticHint,
    RetrievalStep,
    RetrievalStepBudget,
    RetrievalStepResult,
)
from campus_retrieval_core.evidence_attributes import evidence_attributes_for_source


@dataclass(frozen=True, slots=True)
class SemanticReplanDecision:
    attempted: bool
    trigger_reason: str = ""
    planned_steps: tuple[RetrievalStep, ...] = ()
    fail_close_reason: str = ""


def build_semantic_replan_steps(
    plan: RetrievalPlan,
    step_results: tuple[RetrievalStepResult, ...],
    last_result: RetrievalStepResult,
) -> tuple[RetrievalStep, ...]:
    decision = build_semantic_replan_decision(
        plan=plan,
        step_results=step_results,
        last_result=last_result,
    )
    return decision.planned_steps


def build_semantic_replan_decision(
    *,
    plan: RetrievalPlan,
    step_results: tuple[RetrievalStepResult, ...],
    last_result: RetrievalStepResult,
) -> SemanticReplanDecision:
    if last_result.status != "empty":
        return SemanticReplanDecision(
            attempted=False,
            fail_close_reason=f"unsupported_replan_trigger:{last_result.status}",
        )
    trigger_reason = _trigger_reason(last_result)
    triggering_step = _step_by_id(plan, last_result.step_id)
    triggering_result = _step_result_by_id(step_results, last_result.step_id) or last_result
    if triggering_step is None:
        return SemanticReplanDecision(
            attempted=True,
            trigger_reason=trigger_reason,
            fail_close_reason="triggering_step_not_found",
        )
    if triggering_step.step_type not in {
        "indexed_lookup",
        "entity_resolution",
        "historical_version_lookup",
    }:
        return SemanticReplanDecision(
            attempted=True,
            trigger_reason=trigger_reason,
            fail_close_reason="unsupported_step_type",
        )
    follow_up_need_ids = _focused_replan_need_ids(triggering_step.need_ids)
    follow_up = RetrievalStep(
        step_id=f"{triggering_step.step_id}-semantic-replan",
        step_type="indexed_lookup",
        scope=triggering_step.scope,
        query_text=_focused_replan_query(
            query_text=triggering_step.query_text,
            need_ids=follow_up_need_ids,
            semantic_hint=triggering_step.semantic_hint,
            trigger_reason=trigger_reason,
            references=triggering_result.references,
        ),
        need_ids=follow_up_need_ids,
        semantic_hint=triggering_step.semantic_hint,
        depends_on_step_ids=(triggering_step.step_id,),
        selector=RetrievalSelector(
            target_document_ids=triggering_step.selector.target_document_ids,
            target_version_ids=triggering_step.selector.target_version_ids,
            target_revision_track=triggering_step.selector.target_revision_track,
            preferred_document_ids=triggering_step.selector.preferred_document_ids,
            focus_detail_labels=triggering_step.selector.focus_detail_labels,
            focus_article_nos=triggering_step.selector.focus_article_nos,
            focus_clause_nos=triggering_step.selector.focus_clause_nos,
            focus_terms=triggering_step.selector.focus_terms,
            canonical_course_ids=triggering_step.selector.canonical_course_ids,
            canonical_course_family_ids=triggering_step.selector.canonical_course_family_ids,
            canonical_program_family_ids=triggering_step.selector.canonical_program_family_ids,
            entity_keys=triggering_step.selector.entity_keys,
        ),
        budget=RetrievalStepBudget(
            top_k=triggering_step.budget.top_k,
            timeout_ms=triggering_step.budget.timeout_ms,
        ),
        expected_output=triggering_step.expected_output,
    )
    return SemanticReplanDecision(
        attempted=True,
        trigger_reason=trigger_reason,
        planned_steps=(follow_up,),
    )


def _trigger_reason(last_result: RetrievalStepResult) -> str:
    if last_result.activity is not None and last_result.activity.failure_kind:
        return str(last_result.activity.failure_kind)
    return "empty_supporting_evidence"


def _step_by_id(plan: RetrievalPlan, step_id: str) -> RetrievalStep | None:
    for step in plan.steps:
        if step.step_id == step_id:
            return step
    return None


def _step_result_by_id(
    step_results: tuple[RetrievalStepResult, ...],
    step_id: str,
) -> RetrievalStepResult | None:
    for step_result in step_results:
        if step_result.step_id == step_id:
            return step_result
    return None


def _focused_replan_need_ids(need_ids: tuple[str, ...]) -> tuple[str, ...]:
    if not need_ids:
        return ()
    for kind in (
        "procedure_steps",
        "condition_table",
        "eligibility_judgment",
        "version_compare",
        "specific_clause",
        "procedure",
        "requirement",
        "comparison",
        "policy_clause",
    ):
        focused = tuple(need_id for need_id in need_ids if need_id.endswith(f":{kind}"))
        if focused:
            return focused
    return need_ids


def _focused_replan_query(
    *,
    query_text: str,
    need_ids: tuple[str, ...],
    semantic_hint: RetrievalSemanticHint | None,
    trigger_reason: str,
    references,
) -> str:
    if trigger_reason == "group_support_missing":
        return _group_support_missing_replan_query(
            query_text=query_text,
            semantic_hint=semantic_hint,
            references=references,
        )
    if trigger_reason == "condition_group_answer_role_mismatch":
        return _condition_subject_replan_query(
            query_text=query_text,
            semantic_hint=semantic_hint,
            references=references,
        )
    if _semantic_hint_has_need_kind(semantic_hint, "procedure_steps") or any(
        need_id.endswith((":procedure_steps", ":procedure")) for need_id in need_ids
    ):
        if _is_lift_discipline_procedure_query(query_text):
            return "解除处分 申请 条件 程序 办理步骤"
        topic = _query_topic_before_first_need_marker(query_text)
        if _is_loss_or_reissue_procedure_query(query_text):
            return f"{topic} 挂失 补办 办理步骤".strip()
        return f"{topic} 审核流程 办理步骤".strip()
    if (
        _semantic_hint_has_need_kind(semantic_hint, "condition_table")
        or _semantic_hint_has_need_kind(semantic_hint, "eligibility_judgment")
        or any(
            need_id.endswith((":condition_table", ":eligibility_judgment", ":requirement"))
            for need_id in need_ids
        )
    ):
        topic = _query_topic_before_first_need_marker(query_text)
        return f"{topic} 所需材料 条件 要求".strip()
    if _semantic_hint_has_need_kind(semantic_hint, "version_compare") or any(
        need_id.endswith((":version_compare", ":comparison")) for need_id in need_ids
    ):
        topic = _query_topic_before_first_need_marker(query_text)
        return f"{topic} 比较 变化 不同".strip()
    if _semantic_hint_has_need_kind(semantic_hint, "specific_clause") or any(
        need_id.endswith((":specific_clause", ":policy_clause")) for need_id in need_ids
    ):
        topic = _query_topic_before_first_need_marker(query_text)
        return f"{topic} 依据 条款 规定".strip()
    return query_text


def _group_support_missing_replan_query(
    *,
    query_text: str,
    semantic_hint: RetrievalSemanticHint | None,
    references,
) -> str:
    topic = _query_topic_before_first_need_marker(query_text)
    subject = _replan_condition_subject(semantic_hint=semantic_hint, references=references)
    subject_terms = _condition_subject_replan_terms(subject)
    if subject_terms:
        return f"{topic} {' '.join(subject_terms)} 条款 规定".strip()
    return f"{topic} 条件 例外 条款 规定".strip()


def _condition_subject_replan_query(
    *,
    query_text: str,
    semantic_hint: RetrievalSemanticHint | None,
    references,
) -> str:
    topic = _query_topic_before_first_need_marker(query_text)
    subject = _replan_condition_subject(semantic_hint=semantic_hint, references=references)
    subject_terms = _condition_subject_replan_terms(subject)
    if subject_terms:
        return f"{topic} {' '.join(subject_terms)} 条件 要求".strip()
    return f"{topic} 条件 要求".strip()


def _replan_condition_subject(
    *,
    semantic_hint: RetrievalSemanticHint | None,
    references,
) -> str:
    if semantic_hint is not None and semantic_hint.condition_subject:
        return semantic_hint.condition_subject
    for source in references:
        attributes = evidence_attributes_for_source(source)
        if attributes.condition_group_subject:
            return attributes.condition_group_subject
        if attributes.condition_subject:
            return attributes.condition_subject
    return ""


def _condition_subject_replan_terms(condition_subject: str) -> tuple[str, ...]:
    return _CONDITION_SUBJECT_REPLAN_TERMS.get(condition_subject.strip(), ())


def _semantic_hint_has_need_kind(
    semantic_hint: RetrievalSemanticHint | None,
    need_kind: str,
) -> bool:
    return semantic_hint is not None and need_kind in semantic_hint.need_kinds


_CONDITION_SUBJECT_REPLAN_TERMS: dict[str, tuple[str, ...]] = {
    "rank_threshold": ("排名", "前10", "前30", "例外"),
    "paper_or_publication": ("论文", "著作", "发表"),
    "amount_or_quota": ("金额", "名额", "比例", "额度"),
    "material_requirement": ("材料", "证明", "提交"),
    "deadline": ("时间", "截止", "期限"),
    "discipline_relief_condition": ("解除处分", "条件", "考察期"),
    "discipline_relief_exclusion": ("解除处分", "不予", "情形"),
    "student_card_or_identity_credential": ("学生证", "挂失", "补办"),
}


def _query_topic_before_first_need_marker(query_text: str) -> str:
    topic = query_text.strip()
    for marker in (
        "丢了",
        "丢失",
        "遗失",
        "弄丢",
        "怎么办",
        "需要",
        "并说明",
        "说明",
        "流程",
        "步骤",
        "材料",
        "条件",
        "要求",
    ):
        if marker in topic:
            topic = topic.split(marker, 1)[0].strip(" ，,；;。")
            break
    return topic or query_text.strip()


def _is_loss_or_reissue_procedure_query(query_text: str) -> bool:
    normalized = query_text.strip().lower()
    return any(token in normalized for token in ("丢", "遗失", "挂失", "补办", "补卡", "补证"))


def _is_lift_discipline_procedure_query(query_text: str) -> bool:
    normalized = query_text.strip().lower()
    return any(token in normalized for token in ("解除处分", "处分怎么消", "消处分", "纪律处分"))


__all__ = [
    "SemanticReplanDecision",
    "build_semantic_replan_decision",
    "build_semantic_replan_steps",
]
