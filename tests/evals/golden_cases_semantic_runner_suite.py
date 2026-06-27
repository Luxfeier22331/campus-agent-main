from __future__ import annotations

from tests.evals.golden_cases_test_support import (
    HANDBOOK_SCOPE,
    ActorContext,
    ErrorInfo,
    EvidenceBundle,
    ExecutionObservability,
    ExecutionResponse,
    ExecutionResult,
    GoldenCase,
    KnowledgeScope,
    ObservedTrace,
    RagResultDiagnostics,
    RagResultPayload,
    TraceExpectation,
    VersionQuery,
    _response,
    _source,
    run_cases,
    unittest,
    versioned_history_regression_locked_cases,
)


class RunCasesSemanticRunnerTest(unittest.TestCase):
    def test_run_cases_grades_expected_tool(self) -> None:
        matching_case = GoldenCase(
            case_id="case-runtime-target-match",
            split="release_gate",
            source_type="expert_authored",
            user_goal="学生证丢了怎么办",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="no_answer",
            trace_expectation=TraceExpectation(
                selected_scope=HANDBOOK_SCOPE,
                retrieval_called=False,
                clarification_expected=False,
                error_expected=False,
                expected_tool="knowledge_query",
            ),
        )
        mismatched_tool_case = GoldenCase(
            case_id="case-runtime-target-mismatch",
            split="release_gate",
            source_type="expert_authored",
            user_goal="学生证丢了怎么办",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="no_answer",
            trace_expectation=TraceExpectation(
                selected_scope=HANDBOOK_SCOPE,
                retrieval_called=False,
                clarification_expected=False,
                error_expected=False,
                expected_tool="campus_notice_discover",
            ),
        )

        report = run_cases(
            (matching_case, mismatched_tool_case),
            executor=lambda _case: ExecutionResult(
                response=ExecutionResponse(
                    selected_tool="knowledge_query",
                    status="no_answer",
                    answer_text="当前依据不足，暂时不能直接回答。",
                    confidence="low",
                    observability=ExecutionObservability(
                        retrieval_attempted=False,
                        candidate_count=0,
                        retrieved_source_count=0,
                        citation_expected=False,
                        citation_count=0,
                        citation_missing=False,
                        refusal_class="unsupported_by_evidence",
                        semantic_outcome="unsupported_by_evidence",
                        scope_class="in_scope",
                        policy_reason="",
                        acl_decision="allowed",
                        fail_closed=True,
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=HANDBOOK_SCOPE,
                    retrieval_called=False,
                    clarification_emitted=False,
                    error_path=False,
                ),
            ),
        )

        self.assertTrue(report.results[0].trace_result.passed)
        self.assertFalse(report.results[1].trace_result.passed)
        self.assertEqual(report.results[1].trace_result.reason, "selected_tool=knowledge_query")

    def test_run_cases_grades_out_of_scope_semantic_truth(self) -> None:
        case = GoldenCase(
            case_id="case-out-of-scope",
            split="release_gate",
            source_type="expert_authored",
            user_goal="MIT的校长是谁",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="no_answer",
            expected_semantic_outcome="out_of_scope",
            expected_scope_class="out_of_scope",
            expected_policy_reason="product_scope_boundary",
            trace_expectation=TraceExpectation(
                selected_scope=HANDBOOK_SCOPE,
                retrieval_called=False,
                clarification_expected=False,
                error_expected=False,
            ),
        )

        report = run_cases(
            (case,),
            executor=lambda _case: ExecutionResult(
                response=ExecutionResponse(
                    selected_tool=None,
                    status="no_answer",
                    answer_text="这个问题不在当前支持范围内。",
                    confidence="low",
                    observability=ExecutionObservability(
                        retrieval_attempted=False,
                        candidate_count=0,
                        retrieved_source_count=0,
                        citation_expected=False,
                        citation_count=0,
                        citation_missing=False,
                        refusal_class="out_of_scope",
                        semantic_outcome="out_of_scope",
                        scope_class="out_of_scope",
                        policy_reason="product_scope_boundary",
                        acl_decision="allowed",
                        fail_closed=True,
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=HANDBOOK_SCOPE,
                    retrieval_called=False,
                    clarification_emitted=False,
                    error_path=False,
                ),
            ),
        )

        result = report.results[0]
        self.assertTrue(result.metric_results["out_of_scope_accuracy"].passed)
        self.assertTrue(result.metric_results["unsafe_false_allow_rate"].passed)

    def test_run_cases_grades_unsupported_abstention_and_false_refusal_metrics(self) -> None:
        unsupported_case = GoldenCase(
            case_id="case-unsupported",
            split="release_gate",
            source_type="expert_authored",
            user_goal="火星校区飞船停靠规则",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="no_answer",
            expected_semantic_outcome="unsupported_by_evidence",
            expected_scope_class="in_scope",
        )
        completed_case = GoldenCase(
            case_id="case-completed",
            split="release_gate",
            source_type="expert_authored",
            user_goal="学生证丢了怎么办",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="completed",
            expected_semantic_outcome="grounded_answer",
            expected_scope_class="in_scope",
            required_facts=("学生证",),
        )

        report = run_cases(
            (unsupported_case, completed_case),
            executor=lambda case: ExecutionResult(
                response=(
                    ExecutionResponse(
                        selected_tool="knowledge_query",
                        status="no_answer",
                        answer_text="当前未检索到足够依据支持回答这个学生手册问题。",
                        confidence="low",
                        observability=ExecutionObservability(
                            retrieval_attempted=True,
                            candidate_count=0,
                            retrieved_source_count=0,
                            citation_expected=False,
                            citation_count=0,
                            citation_missing=False,
                            refusal_class="no_answer",
                            semantic_outcome="unsupported_by_evidence",
                            scope_class="in_scope",
                            acl_decision="allowed",
                            fail_closed=False,
                        ),
                    )
                    if case.case_id == "case-unsupported"
                    else ExecutionResponse(
                        selected_tool="knowledge_query",
                        status="no_answer",
                        answer_text="当前依据不足。",
                        confidence="low",
                        observability=ExecutionObservability(
                            retrieval_attempted=True,
                            candidate_count=0,
                            retrieved_source_count=0,
                            citation_expected=False,
                            citation_count=0,
                            citation_missing=False,
                            refusal_class="no_answer",
                            semantic_outcome="unsupported_by_evidence",
                            scope_class="in_scope",
                            acl_decision="allowed",
                            fail_closed=False,
                        ),
                    )
                ),
            ),
        )

        unsupported_result = next(
            result for result in report.results if result.case_id == "case-unsupported"
        )
        completed_result = next(
            result for result in report.results if result.case_id == "case-completed"
        )
        self.assertTrue(unsupported_result.metric_results["unsupported_abstention_accuracy"].passed)
        self.assertFalse(completed_result.metric_results["false_refusal_rate"].passed)

    def test_run_cases_grades_versioned_grounded_semantic_outcomes(self) -> None:
        cases = (
            GoldenCase(
                case_id="case-historical-grounded-answer",
                split="regression_locked",
                source_type="expert_authored",
                user_goal="上一版奖学金评审办法怎么规定",
                actor=ActorContext(),
                scope=HANDBOOK_SCOPE,
                version_query=VersionQuery(mode="historical"),
                expected_status="completed",
                expected_semantic_outcome="historical_grounded_answer",
                required_facts=("历史版本", "不是现行规定"),
                trace_expectation=TraceExpectation(
                    selected_scope=HANDBOOK_SCOPE,
                    retrieval_called=True,
                    clarification_expected=False,
                    error_expected=False,
                ),
            ),
            GoldenCase(
                case_id="case-as-of-grounded-answer",
                split="regression_locked",
                source_type="expert_authored",
                user_goal="按 2024-06-01 当时的版本，奖学金评审办法怎么规定",
                actor=ActorContext(),
                scope=HANDBOOK_SCOPE,
                version_query=VersionQuery(mode="as_of", as_of="2024-06-01"),
                expected_status="completed",
                expected_semantic_outcome="as_of_grounded_answer",
                required_facts=("截至2024-06-01", "可解析到的版本"),
                trace_expectation=TraceExpectation(
                    selected_scope=HANDBOOK_SCOPE,
                    retrieval_called=True,
                    clarification_expected=False,
                    error_expected=False,
                ),
            ),
            GoldenCase(
                case_id="case-compare-grounded-answer",
                split="regression_locked",
                source_type="expert_authored",
                user_goal="对比旧版和新版奖学金评审办法有什么变化",
                actor=ActorContext(),
                scope=HANDBOOK_SCOPE,
                version_query=VersionQuery(
                    mode="compare",
                    version_id="v1:scholarship",
                    compare_to_version_id="v2:scholarship",
                ),
                expected_status="completed",
                expected_semantic_outcome="compare_grounded_answer",
                required_facts=("旧版", "新版", "变化点"),
                trace_expectation=TraceExpectation(
                    selected_scope=HANDBOOK_SCOPE,
                    retrieval_called=True,
                    clarification_expected=False,
                    error_expected=False,
                ),
            ),
        )

        report = run_cases(
            cases,
            executor=lambda case: ExecutionResult(
                response=_response(
                    answer_text=(
                        "以下内容基于历史版本，不是现行规定。"
                        if case.case_id == "case-historical-grounded-answer"
                        else "以下内容基于截至2024-06-01可解析到的版本。"
                        if case.case_id == "case-as-of-grounded-answer"
                        else "旧版：要求 A。新版：要求 B。变化点：删除 A，新增 B。"
                    ),
                    sources=(_source(doc_id="handbook:test", version_id="v1", chunk_id="chunk-1"),),
                    diagnostics=RagResultDiagnostics(
                        semantic_outcome=case.expected_semantic_outcome,
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=HANDBOOK_SCOPE,
                    retrieval_called=True,
                    clarification_emitted=False,
                    error_path=False,
                ),
            ),
        )

        self.assertEqual(report.by_metric["semantic_outcome_accuracy"].passed, 3)
        for result in report.results:
            self.assertTrue(result.metric_results["semantic_outcome_accuracy"].passed)

    def test_run_cases_grades_versioned_fail_close_retrieval_adequacy_reasons(self) -> None:
        cases = tuple(
            case
            for case in versioned_history_regression_locked_cases()
            if case.case_id
            in {
                "versioned-history-unresolved-fail-close",
                "versioned-history-compare-support-incomplete",
            }
        )

        report = run_cases(
            cases,
            executor=lambda case: ExecutionResult(
                response=_response(
                    status="no_answer",
                    answer_text="当前依据不足，暂时不能直接回答。",
                    sources=(),
                    diagnostics=RagResultDiagnostics(
                        semantic_outcome="unsupported_by_evidence",
                        scope_class="in_scope",
                        no_answer_reason=case.expected_retrieval_adequacy_reason,
                        retrieval_adequacy_verdict="insufficient",
                        retrieval_adequacy_reason=case.expected_retrieval_adequacy_reason,
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=HANDBOOK_SCOPE,
                    retrieval_called=bool(
                        case.trace_expectation and case.trace_expectation.retrieval_called
                    ),
                    clarification_emitted=False,
                    error_path=False,
                ),
            ),
        )

        self.assertEqual(report.by_metric["retrieval_adequacy_accuracy"].passed, 2)
        self.assertEqual(report.by_metric["unsupported_abstention_accuracy"].passed, 2)
        self.assertEqual(report.by_metric["fail_closed"].passed, 2)
        for result in report.results:
            self.assertTrue(result.metric_results["retrieval_adequacy_accuracy"].passed)
            self.assertTrue(result.metric_results["unsupported_abstention_accuracy"].passed)
            self.assertTrue(result.metric_results["fail_closed"].passed)

    def test_run_cases_grades_policy_refusal_restricted_access_and_freshness_metrics(self) -> None:
        policy_case = GoldenCase(
            case_id="case-policy-refusal",
            split="release_gate",
            source_type="expert_authored",
            user_goal="请执行未授权操作",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="rejected",
            expected_semantic_outcome="policy_refusal",
            expected_policy_reason="request_rejected",
        )
        restricted_case = GoldenCase(
            case_id="case-restricted-access",
            split="release_gate",
            source_type="expert_authored",
            user_goal="查看受限通知",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="no_answer",
            expected_semantic_outcome="restricted_access_denied",
            expected_scope_class="in_scope",
        )
        freshness_case = GoldenCase(
            case_id="case-freshness-fail-close",
            split="release_gate",
            source_type="expert_authored",
            user_goal="中央民族大学今天有什么讲座",
            actor=ActorContext(),
            scope=KnowledgeScope(corpus="official_web", collection="muc_public_pages"),
            expected_status="no_answer",
            expected_semantic_outcome="freshness_fail_close",
            expected_scope_class="in_scope",
        )

        report = run_cases(
            (policy_case, restricted_case, freshness_case),
            executor=lambda case: ExecutionResult(
                response=(
                    ExecutionResponse(
                        selected_tool=None,
                        status="rejected",
                        answer_text="这个请求不在当前可执行范围内。",
                        confidence="low",
                        error=ErrorInfo(
                            code="request_rejected",
                            message="request was rejected by execution policy",
                        ),
                        observability=ExecutionObservability(
                            retrieval_attempted=False,
                            candidate_count=0,
                            retrieved_source_count=0,
                            citation_expected=False,
                            citation_count=0,
                            citation_missing=False,
                            refusal_class="rejected",
                            semantic_outcome="policy_refusal",
                            policy_reason="request_rejected",
                            acl_decision="denied",
                            fail_closed=True,
                        ),
                    )
                    if case.case_id == "case-policy-refusal"
                    else ExecutionResponse(
                        selected_tool="knowledge_query",
                        status="no_answer",
                        answer_text="当前无法提供这部分受限内容。",
                        confidence="low",
                        result=RagResultPayload(
                            evidence=EvidenceBundle(
                                query_text=case.user_goal,
                                corpus=case.scope.corpus,
                                collection=case.scope.collection,
                            )
                        ),
                        observability=ExecutionObservability(
                            retrieval_attempted=True,
                            candidate_count=0,
                            retrieved_source_count=0,
                            citation_expected=False,
                            citation_count=0,
                            citation_missing=False,
                            refusal_class="no_answer",
                            semantic_outcome=(
                                "restricted_access_denied"
                                if case.case_id == "case-restricted-access"
                                else "freshness_fail_close"
                            ),
                            scope_class="in_scope",
                            acl_decision=(
                                "denied" if case.case_id == "case-restricted-access" else "allowed"
                            ),
                            fail_closed=True,
                        ),
                    )
                ),
            ),
        )

        policy_result = next(
            result for result in report.results if result.case_id == "case-policy-refusal"
        )
        restricted_result = next(
            result for result in report.results if result.case_id == "case-restricted-access"
        )
        freshness_result = next(
            result for result in report.results if result.case_id == "case-freshness-fail-close"
        )
        self.assertTrue(policy_result.metric_results["policy_refusal_accuracy"].passed)
        self.assertTrue(
            restricted_result.metric_results["restricted_access_denied_accuracy"].passed
        )
        self.assertTrue(freshness_result.metric_results["freshness_fail_close_accuracy"].passed)
        self.assertTrue(policy_result.metric_results["unsafe_false_allow_rate"].passed)
        self.assertTrue(restricted_result.metric_results["unsafe_false_allow_rate"].passed)
        self.assertTrue(freshness_result.metric_results["unsafe_false_allow_rate"].passed)
