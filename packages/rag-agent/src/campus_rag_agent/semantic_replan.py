from __future__ import annotations

from dataclasses import dataclass

from campus_retrieval_core import (
    RetrievalPlan,
    RetrievalSelector,
    RetrievalStep,
    RetrievalStepBudget,
    RetrievalStepResult,
)


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
        ),
        need_ids=follow_up_need_ids,
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
    if (
        last_result.activity is not None
        and last_result.activity.failure_kind == "polarity_conflict"
    ):
        return "polarity_conflict"
    return "empty_supporting_evidence"


def _step_by_id(plan: RetrievalPlan, step_id: str) -> RetrievalStep | None:
    for step in plan.steps:
        if step.step_id == step_id:
            return step
    return None


def _focused_replan_need_ids(need_ids: tuple[str, ...]) -> tuple[str, ...]:
    if not need_ids:
        return ()
    for kind in ("procedure", "requirement", "comparison", "policy_clause"):
        focused = tuple(need_id for need_id in need_ids if need_id.endswith(f":{kind}"))
        if focused:
            return focused
    return need_ids


def _focused_replan_query(*, query_text: str, need_ids: tuple[str, ...]) -> str:
    if any(need_id.endswith(":procedure") for need_id in need_ids):
        if _is_lift_discipline_procedure_query(query_text):
            return "解除处分 申请 条件 程序 办理步骤"
        topic = _query_topic_before_first_need_marker(query_text)
        if _is_loss_or_reissue_procedure_query(query_text):
            return f"{topic} 挂失 补办 办理步骤".strip()
        return f"{topic} 审核流程 办理步骤".strip()
    if any(need_id.endswith(":requirement") for need_id in need_ids):
        topic = _query_topic_before_first_need_marker(query_text)
        return f"{topic} 所需材料 条件 要求".strip()
    if any(need_id.endswith(":comparison") for need_id in need_ids):
        topic = _query_topic_before_first_need_marker(query_text)
        return f"{topic} 比较 变化 不同".strip()
    if any(need_id.endswith(":policy_clause") for need_id in need_ids):
        topic = _query_topic_before_first_need_marker(query_text)
        return f"{topic} 依据 条款 规定".strip()
    return query_text


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
