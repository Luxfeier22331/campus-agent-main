from __future__ import annotations

from campus_contracts import ActorContext, VersionQuery

from campus_evals.models import GoldenCase, TraceExpectation, expected_source_ref
from campus_evals.scenarios_shared import (
    _handbook_scope,
    _metric_overrides,
    _reference_context_ids,
)


def versioned_history_regression_locked_cases() -> tuple[GoldenCase, ...]:
    scope = _handbook_scope()
    return (
        GoldenCase(
            case_id="versioned-history-current-control",
            split="regression_locked",
            source_type="expert_authored",
            user_goal="中央民族大学本科学生国家奖学金评审办法现在怎么规定",
            actor=ActorContext(),
            scope=scope,
            version_query=VersionQuery(mode="current"),
            expected_status="completed",
            expected_semantic_outcome="grounded_answer",
            expected_sources=(
                expected_source_ref("handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15"),
            ),
            required_facts=("国家奖学金",),
            reference_context_ids=_reference_context_ids(
                "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15"
            ),
            supplemental_metric_overrides=_metric_overrides(answer_relevancy=False),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
                expected_tool="knowledge_query",
            ),
            tags=("versioned_history", "regression_locked", "current_control"),
        ),
        GoldenCase(
            case_id="versioned-history-historical-answer",
            split="regression_locked",
            source_type="expert_authored",
            user_goal="上一版国家奖学金评审办法怎么规定",
            actor=ActorContext(),
            scope=scope,
            version_query=VersionQuery(mode="historical"),
            expected_status="completed",
            expected_semantic_outcome="historical_grounded_answer",
            required_facts=("历史版本", "不是现行规定"),
            reference_contexts=("历史版本回答必须显式披露该内容不是现行规定。",),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
                expected_tool="knowledge_query",
            ),
            tags=("versioned_history", "regression_locked", "historical"),
        ),
        GoldenCase(
            case_id="versioned-history-as-of-answer",
            split="regression_locked",
            source_type="expert_authored",
            user_goal="按 2024-06-01 当时的版本，国家奖学金评审办法怎么规定",
            actor=ActorContext(),
            scope=scope,
            version_query=VersionQuery(mode="as_of", as_of="2024-06-01"),
            expected_status="completed",
            expected_semantic_outcome="as_of_grounded_answer",
            required_facts=("截至2024-06-01", "可解析到的版本"),
            reference_contexts=("as_of 回答必须显式披露 time anchor。",),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
                expected_tool="knowledge_query",
            ),
            tags=("versioned_history", "regression_locked", "as_of"),
        ),
        GoldenCase(
            case_id="versioned-history-compare-answer",
            split="regression_locked",
            source_type="expert_authored",
            user_goal="对比旧版和新版国家奖学金评审办法有什么变化",
            actor=ActorContext(),
            scope=scope,
            version_query=VersionQuery(
                mode="compare", version_id="v1:scholarship", compare_to_version_id="v2:scholarship"
            ),
            expected_status="completed",
            expected_semantic_outcome="compare_grounded_answer",
            required_facts=("旧版", "新版", "变化点"),
            reference_contexts=("compare 回答必须显式区分旧版、新版与变化点。",),
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
                expected_tool="knowledge_query",
            ),
            tags=("versioned_history", "regression_locked", "compare"),
        ),
        GoldenCase(
            case_id="versioned-history-unresolved-fail-close",
            split="regression_locked",
            source_type="expert_authored",
            user_goal="给我 2021 年以前那一版国家奖学金评审办法",
            actor=ActorContext(),
            scope=scope,
            version_query=VersionQuery(mode="historical", version_id="missing:historical"),
            expected_status="no_answer",
            expected_semantic_outcome="unsupported_by_evidence",
            expected_scope_class="in_scope",
            expected_retrieval_adequacy_verdict="insufficient",
            expected_retrieval_adequacy_reason="version_filter_unresolved",
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=False,
                clarification_expected=False,
                error_expected=False,
                fail_closed_expected=True,
                expected_tool="knowledge_query",
            ),
            tags=(
                "versioned_history",
                "regression_locked",
                "fail_close",
                "version_filter_unresolved",
            ),
        ),
        GoldenCase(
            case_id="versioned-history-compare-support-incomplete",
            split="regression_locked",
            source_type="expert_authored",
            user_goal="对比旧版和新版国家奖学金评审办法的变化",
            actor=ActorContext(),
            scope=scope,
            version_query=VersionQuery(
                mode="compare", version_id="v1:scholarship", compare_to_version_id="v2:scholarship"
            ),
            expected_status="no_answer",
            expected_semantic_outcome="unsupported_by_evidence",
            expected_scope_class="in_scope",
            expected_retrieval_adequacy_verdict="insufficient",
            expected_retrieval_adequacy_reason="compare_support_incomplete",
            trace_expectation=TraceExpectation(
                selected_scope=scope,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
                fail_closed_expected=True,
                expected_tool="knowledge_query",
            ),
            tags=(
                "versioned_history",
                "regression_locked",
                "fail_close",
                "compare_support_incomplete",
            ),
        ),
    )
