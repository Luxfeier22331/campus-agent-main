from __future__ import annotations

from tests.evals.golden_cases_test_support import (
    CURRICULUM_SCOPE,
    HANDBOOK_SCOPE,
    ActorContext,
    CapabilityResponse,
    ErrorInfo,
    EvidenceBundle,
    ExecutionResponse,
    ExecutionResult,
    GoldenCase,
    KnowledgeScope,
    ObservedTrace,
    RagResultDiagnostics,
    RagResultPayload,
    TraceExpectation,
    _response,
    _source,
    curriculum_regression_locked_cases,
    curriculum_release_gate_cases,
    curriculum_smoke_cases,
    expected_source_ref,
    handbook_error_gate_cases,
    run_cases,
    unittest,
)


class RunCasesAggregationRunnerTest(unittest.TestCase):
    def test_runner_surfaces_no_applicable_error_metric_for_live_release_gate(self) -> None:
        case = GoldenCase(
            case_id="completed-1",
            split="release_gate",
            source_type="expert_authored",
            user_goal="library hours",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="completed",
            expected_sources=(expected_source_ref("handbook:library"),),
            required_facts=("08:00",),
            trace_expectation=TraceExpectation(
                selected_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                retrieval_called=True,
            ),
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(sources=(_source(),)),
                observed_trace=ObservedTrace(
                    selected_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                    retrieval_called=True,
                ),
            ),
        )

        self.assertEqual(report.by_metric["error_path_correctness"].total, 0)
        self.assertIsNone(report.by_metric["error_path_correctness"].pass_rate)
        self.assertEqual(report.by_metric["error_path_correctness"].reason, "no_applicable_cases")

    def test_runner_grades_procedure_directness_for_procedure_queries(self) -> None:
        case = GoldenCase(
            case_id="procedure-directness",
            split="release_gate",
            source_type="expert_authored",
            user_goal="学生证丢了怎么办",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="completed",
            expected_sources=(expected_source_ref("handbook:student-card"),),
            required_facts=("挂失", "补办"),
            trace_expectation=TraceExpectation(
                selected_scope=HANDBOOK_SCOPE,
                retrieval_called=True,
            ),
        )

        good_report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    answer_text="根据学生手册相关规定，先到学院(系)挂失并报学生处备案；再提交书面申请并办理补办手续。",
                    sources=(_source(doc_id="handbook:student-card"),),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=HANDBOOK_SCOPE,
                    retrieval_called=True,
                ),
            ),
        )
        bad_report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    answer_text="根据学生手册相关规定，补办学生证时不予发放火车票学生优惠卡；学生证集中补办时间为每周四下午。",
                    sources=(_source(doc_id="handbook:student-card"),),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=HANDBOOK_SCOPE,
                    retrieval_called=True,
                ),
            ),
        )

        self.assertEqual(good_report.by_metric["procedure_directness"].passed, 1)
        self.assertEqual(bad_report.by_metric["procedure_directness"].failed, 1)

    def test_requirement_style_how_query_does_not_trigger_procedure_directness(self) -> None:
        case = GoldenCase(
            case_id="requirement-style-how-query",
            split="release_gate",
            source_type="expert_authored",
            user_goal="国奖第九条里对论文和著作怎么要求的？",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="completed",
            expected_sources=(expected_source_ref("handbook:national-scholarship"),),
            required_facts=("第一作者", "第一、二作者"),
            trace_expectation=TraceExpectation(
                selected_scope=HANDBOOK_SCOPE,
                retrieval_called=True,
            ),
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    answer_text=(
                        "根据学生手册相关规定，在学术研究上取得显著成绩，以第一作者发表的论文被SCI、EI、ISTP、SSCI全文收录，"
                        "以第一、二作者出版学术专著(须通过专家鉴定)。"
                    ),
                    sources=(_source(doc_id="handbook:national-scholarship"),),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=HANDBOOK_SCOPE,
                    retrieval_called=True,
                ),
            ),
        )

        result = report.results[0]
        self.assertTrue(result.passed)
        self.assertNotIn("procedure_directness", result.metric_results)

    def test_curriculum_course_map_case_requires_fail_closed_no_answer_without_procedure_directness(
        self,
    ) -> None:
        case = next(
            item
            for item in curriculum_release_gate_cases()
            if item.case_id == "curriculum-release-gate-course-map-unsupported"
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    status="no_answer",
                    answer_text=(
                        "当前还不能稳定解析《经济学拔尖人才创新班人才培养方案》里的课程地图/拓扑图，"
                        "因此不会根据课程地图推断课程先后关系、课程依赖或修读安排。"
                    ),
                    corpus="curriculum",
                    collection="curriculum_plan",
                    diagnostics=RagResultDiagnostics(
                        resolved_scope_corpus="curriculum",
                        resolved_scope_collection="curriculum_plan",
                        no_answer_reason="curriculum_course_map_unsupported",
                        semantic_outcome="unsupported_scope",
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=CURRICULUM_SCOPE,
                    retrieval_called=False,
                    clarification_emitted=False,
                    error_path=False,
                ),
            ),
        )

        result = report.results[0]
        self.assertTrue(result.passed)
        self.assertNotIn("procedure_directness", result.metric_results)

    def test_curriculum_smoke_hanyu_international_credits_case_accepts_total_credit_fact(
        self,
    ) -> None:
        case = next(
            item
            for item in curriculum_smoke_cases()
            if item.case_id == "curriculum-smoke-hanyu-international-credits"
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    answer_text=(
                        "根据培养方案相关内容，《汉语国际教育（国际学生）本科人才培养方案》明确："
                        "总学分:146学分。"
                    ),
                    corpus="curriculum",
                    collection="curriculum_plan",
                    sources=(
                        _source(
                            doc_id="curriculum:汉语国际教育（国际学生）本科人才培养方案",
                            collection="curriculum_plan",
                            snippet="总学分:146学分。",
                        ),
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=CURRICULUM_SCOPE,
                    retrieval_called=True,
                    clarification_emitted=False,
                    error_path=False,
                    supporting_sources=(
                        _source(
                            doc_id="curriculum:汉语国际教育（国际学生）本科人才培养方案",
                            collection="curriculum_plan",
                            snippet="总学分:146学分。",
                        ),
                    ),
                ),
            ),
        )

        result = report.results[0]
        self.assertTrue(result.passed)
        self.assertEqual(report.by_metric["expected_doc_hit"].passed, 1)
        self.assertEqual(report.by_metric["answer_accuracy"].passed, 1)

    def test_curriculum_regression_fiscal_core_credits_case_accepts_structured_core_credit_fact(
        self,
    ) -> None:
        case = next(
            item
            for item in curriculum_regression_locked_cases()
            if item.case_id == "curriculum-regression-fiscal-core-credits"
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    answer_text=(
                        "根据培养方案相关内容，《财政学本科人才培养方案》明确："
                        "财政学专业必修的专业核心课程 30 学分。"
                    ),
                    corpus="curriculum",
                    collection="curriculum_plan",
                    sources=(
                        _source(
                            doc_id="curriculum:财政学本科人才培养方案",
                            collection="curriculum_plan",
                            snippet="财政学专业必修的专业核心课程 30 学分。",
                        ),
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=CURRICULUM_SCOPE,
                    retrieval_called=True,
                    clarification_emitted=False,
                    error_path=False,
                    supporting_sources=(
                        _source(
                            doc_id="curriculum:财政学本科人才培养方案",
                            collection="curriculum_plan",
                            snippet="财政学专业必修的专业核心课程 30 学分。",
                        ),
                    ),
                ),
            ),
        )

        result = report.results[0]
        self.assertTrue(result.passed)
        self.assertEqual(report.by_metric["expected_doc_hit"].passed, 1)
        self.assertEqual(report.by_metric["answer_accuracy"].passed, 1)

    def test_runner_accepts_execution_clarification_without_rag_evidence(self) -> None:
        case = GoldenCase(
            case_id="execution-clarify-1",
            split="release_gate",
            source_type="expert_authored",
            user_goal="奖学金怎么申请？",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="needs_clarification",
            trace_expectation=TraceExpectation(
                retrieval_called=False,
                clarification_expected=True,
            ),
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=ExecutionResponse(
                    selected_capability=None,
                    status="needs_clarification",
                    follow_up_question="请先说明你想查询的知识范围或资料集合。",
                    confidence="low",
                ),
                observed_trace=ObservedTrace(
                    retrieval_called=False,
                    clarification_emitted=True,
                ),
            ),
        )

        result = report.results[0]
        self.assertTrue(result.passed)
        self.assertTrue(result.retrieval_result.passed)
        self.assertEqual(report.by_metric["clarification_accuracy"].passed, 1)

    def test_runner_supports_execution_terminal_statuses(self) -> None:
        approval_case = GoldenCase(
            case_id="approval-required-1",
            split="release_gate",
            source_type="expert_authored",
            user_goal="帮我提交奖学金申请",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="approval_required",
        )
        rejected_case = GoldenCase(
            case_id="rejected-1",
            split="release_gate",
            source_type="expert_authored",
            user_goal="请执行未授权操作",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="rejected",
        )

        def executor(case: GoldenCase) -> ExecutionResult:
            if case.case_id == "approval-required-1":
                return ExecutionResult(
                    response=ExecutionResponse(
                        selected_capability=None,
                        status="approval_required",
                        answer_text="该请求涉及需要人工确认的操作，必须先经过审批。",
                        confidence="low",
                    )
                )
            return ExecutionResult(
                response=ExecutionResponse(
                    selected_capability=None,
                    status="rejected",
                    confidence="low",
                    error=ErrorInfo(
                        code="request_rejected",
                        message="request was rejected by execution policy",
                    ),
                )
            )

        report = run_cases((approval_case, rejected_case), executor=executor)

        self.assertEqual(report.total, 2)
        self.assertEqual(report.passed, 2)
        self.assertEqual(report.by_metric["approval_required_accuracy"].passed, 1)
        self.assertEqual(report.by_metric["rejection_accuracy"].passed, 1)
        self.assertTrue(all(result.retrieval_result.passed for result in report.results))

    def test_runner_aggregates_deterministic_error_gate_metrics(self) -> None:
        cases = handbook_error_gate_cases()

        def executor(case: GoldenCase) -> ExecutionResult:
            return ExecutionResult(
                response=CapabilityResponse(
                    capability="knowledge",
                    status="error",
                    confidence="low",
                    answer_text="",
                    error=ErrorInfo(code=f"{case.case_id}-failed", message="deterministic failure"),
                    result=RagResultPayload(
                        evidence=EvidenceBundle(
                            query_text=case.user_goal,
                            corpus="regulations",
                            collection="student_rules",
                        )
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                    retrieval_called=True,
                    clarification_emitted=False,
                    error_path=True,
                ),
            )

        report = run_cases(cases, executor=executor)

        self.assertEqual(report.total, 3)
        self.assertEqual(report.passed, 3)
        self.assertEqual(report.by_metric["status_accuracy"].passed, 3)
        self.assertEqual(report.by_metric["error_path_correctness"].passed, 3)
        self.assertEqual(report.by_metric["trace_path_correctness"].passed, 3)
        self.assertEqual(report.by_metric["fail_closed"].passed, 3)
        self.assertEqual(report.by_metric["answer_accuracy"].total, 0)
        self.assertIsNone(report.by_metric["answer_accuracy"].pass_rate)
        self.assertEqual(report.by_metric["answer_accuracy"].reason, "no_applicable_cases")
