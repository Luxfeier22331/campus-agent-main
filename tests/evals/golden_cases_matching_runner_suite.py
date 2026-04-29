from __future__ import annotations

from tests.evals.golden_cases_test_support import (
    CURRICULUM_SCOPE,
    HANDBOOK_SCOPE,
    ActorContext,
    AgentResponse,
    ErrorInfo,
    EvidenceBundle,
    ExecutionResult,
    GoldenCase,
    KnowledgeScope,
    ObservedTrace,
    RagResultDiagnostics,
    RagResultPayload,
    SupervisorObservability,
    SupervisorResponse,
    TraceExpectation,
    _response,
    _source,
    build_curriculum_program_semester_fact_document_id,
    expected_source_ref,
    policy_risk_and_grounding_release_gate_cases,
    run_cases,
    unittest,
)


class RunCasesMatchingRunnerTest(unittest.TestCase):
    def test_run_cases_grades_phase15_retrieval_adequacy_and_grounding_truth(self) -> None:
        clarification_case = GoldenCase(
            case_id="case-clarification-instead-of-guess",
            split="release_gate",
            source_type="expert_authored",
            user_goal="奖学金怎么申请？",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="needs_clarification",
            expected_retrieval_adequacy_verdict="ambiguous",
            expected_retrieval_adequacy_reason="policy_object_missing",
            trace_expectation=TraceExpectation(
                selected_scope=HANDBOOK_SCOPE,
                retrieval_called=False,
                clarification_expected=True,
                error_expected=False,
            ),
            tags=("clarification_instead_of_guess",),
        )
        citation_required_case = GoldenCase(
            case_id="case-citation-required-answer",
            split="release_gate",
            source_type="expert_authored",
            user_goal="思想政治理论课有哪些要求",
            actor=ActorContext(),
            scope=CURRICULUM_SCOPE,
            expected_status="no_answer",
            expected_semantic_outcome="unsupported_by_evidence",
            expected_scope_class="in_scope",
            expected_retrieval_adequacy_verdict="sufficient",
            expected_retrieval_adequacy_reason="sufficient",
            expected_grounding_verdict="unsupported",
            expected_unsupported_fields=(
                "offering_unit_claims",
                "audience_claims",
            ),
            trace_expectation=TraceExpectation(
                selected_scope=CURRICULUM_SCOPE,
                retrieval_called=True,
                clarification_expected=False,
                error_expected=False,
                fail_closed_expected=True,
            ),
            tags=("citation_required_answer",),
        )

        def executor(case: GoldenCase) -> ExecutionResult:
            if case.case_id == "case-clarification-instead-of-guess":
                return ExecutionResult(
                    response=AgentResponse(
                        target="rag-agent",
                        status="needs_clarification",
                        answer_text="你想问的是哪一类奖学金评审办法？",
                        follow_up_question="你想问的是哪一类奖学金评审办法？",
                        confidence="low",
                        result=RagResultPayload(
                            evidence=EvidenceBundle(
                                query_text=case.user_goal,
                                corpus="regulations",
                                collection="student_rules",
                                sources=(),
                            ),
                            diagnostics=RagResultDiagnostics(
                                clarification_reason="policy_object_missing",
                                retrieval_adequacy_verdict="ambiguous",
                                retrieval_adequacy_reason="policy_object_missing",
                            ),
                        ),
                    ),
                    observed_trace=ObservedTrace(
                        selected_scope=HANDBOOK_SCOPE,
                        retrieval_called=False,
                        clarification_emitted=True,
                        error_path=False,
                    ),
                )
            return ExecutionResult(
                response=AgentResponse(
                    target="rag-agent",
                    status="no_answer",
                    answer_text="当前检索结果不足以支持开课单位和适用专业，请以原文为准。",
                    confidence="low",
                    result=RagResultPayload(
                        evidence=EvidenceBundle(
                            query_text=case.user_goal,
                            corpus="curriculum",
                            collection="curriculum_plan",
                            sources=(),
                        ),
                        diagnostics=RagResultDiagnostics(
                            semantic_outcome="unsupported_by_evidence",
                            scope_class="in_scope",
                            retrieval_adequacy_verdict="sufficient",
                            retrieval_adequacy_reason="sufficient",
                            grounding_verdict="unsupported",
                            grounding_downgraded=True,
                            unsupported_fields=("offering_unit_claims", "audience_claims"),
                        ),
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=CURRICULUM_SCOPE,
                    retrieval_called=True,
                    clarification_emitted=False,
                    error_path=False,
                ),
            )

        report = run_cases((clarification_case, citation_required_case), executor=executor)

        self.assertTrue(report.results[0].metric_results["retrieval_adequacy_accuracy"].passed)
        self.assertTrue(report.results[1].metric_results["retrieval_adequacy_accuracy"].passed)
        self.assertTrue(report.results[1].metric_results["grounding_claim_accuracy"].passed)

    def test_policy_risk_and_grounding_release_gate_cases_grade_supervisor_stop_and_agent_paths(
        self,
    ) -> None:
        cases = policy_risk_and_grounding_release_gate_cases()

        def executor(case: GoldenCase) -> ExecutionResult:
            if case.case_id == "policy-risk-release-gate-campus-political-course-audience":
                return ExecutionResult(
                    response=_response(
                        answer_text="根据当前已采集的培养方案和通识课程教学计划，习概面向所有本预科学生。",
                        corpus="curriculum",
                        collection="course_facts",
                        sources=(
                            _source(
                                doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                                collection="course_facts",
                                snippet="思想政治理论课为全校性公共必修课，所有本预科学生应认真完成上述7门课程设置的各教学环节。",
                            ),
                        ),
                        diagnostics=RagResultDiagnostics(
                            semantic_outcome="grounded_answer",
                            retrieval_adequacy_verdict="sufficient",
                            retrieval_adequacy_reason="sufficient",
                            grounding_verdict="grounded",
                        ),
                    ),
                    observed_trace=ObservedTrace(
                        selected_scope=CURRICULUM_SCOPE,
                        retrieval_called=True,
                        clarification_emitted=False,
                        error_path=False,
                    ),
                )
            if case.case_id == "policy-risk-release-gate-open-domain-political-fact":
                return ExecutionResult(
                    response=SupervisorResponse(
                        selected_target=None,
                        status="no_answer",
                        answer_text="这个问题不在当前支持范围内。",
                        confidence="low",
                        observability=SupervisorObservability(
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
                        selected_scope=None,
                        retrieval_called=False,
                        clarification_emitted=False,
                        error_path=False,
                    ),
                )
            if case.case_id == "policy-risk-release-gate-political-persuasion-refusal":
                return ExecutionResult(
                    response=SupervisorResponse(
                        selected_target=None,
                        status="rejected",
                        answer_text="这个请求不在当前可执行范围内。",
                        confidence="low",
                        error=ErrorInfo(
                            code="request_rejected",
                            message="request was rejected by supervisor policy",
                        ),
                        observability=SupervisorObservability(
                            retrieval_attempted=False,
                            candidate_count=0,
                            retrieved_source_count=0,
                            citation_expected=False,
                            citation_count=0,
                            citation_missing=False,
                            refusal_class="rejected",
                            semantic_outcome="policy_refusal",
                            policy_reason="political_persuasion",
                            acl_decision="denied",
                            fail_closed=True,
                        ),
                    ),
                    observed_trace=ObservedTrace(
                        selected_scope=None,
                        retrieval_called=False,
                        clarification_emitted=False,
                        error_path=False,
                    ),
                )
            return ExecutionResult(
                response=SupervisorResponse(
                    selected_target="rag-agent",
                    status="no_answer",
                    answer_text="当前未检索到足够依据支持回答这个学生手册问题。",
                    confidence="low",
                    result=RagResultPayload(
                        evidence=EvidenceBundle(
                            query_text=case.user_goal,
                            corpus=case.scope.corpus,
                            collection=case.scope.collection,
                        )
                    ),
                    observability=SupervisorObservability(
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
                        fail_closed=True,
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=HANDBOOK_SCOPE,
                    retrieval_called=True,
                    clarification_emitted=False,
                    error_path=False,
                ),
            )

        report = run_cases(cases, executor=executor)
        results = {result.case_id: result for result in report.results}

        self.assertTrue(report.passed == report.total)
        self.assertTrue(results["policy-risk-release-gate-campus-political-course-audience"].passed)
        self.assertTrue(
            results["policy-risk-release-gate-open-domain-political-fact"]
            .metric_results["out_of_scope_accuracy"]
            .passed
        )
        self.assertTrue(
            results["policy-risk-release-gate-political-persuasion-refusal"]
            .metric_results["policy_refusal_accuracy"]
            .passed
        )
        self.assertTrue(
            results["policy-risk-release-gate-unsupported-campus-policy-claim"]
            .metric_results["unsupported_abstention_accuracy"]
            .passed
        )

    def test_runner_filters_by_split_and_aggregates_dimensions(self) -> None:
        smoke_case = GoldenCase(
            case_id="smoke-1",
            split="smoke",
            source_type="expert_authored",
            user_goal="library hours",
            actor=ActorContext(),
            scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            expected_status="completed",
            expected_sources=(expected_source_ref("handbook:library"),),
            required_facts=("08:00",),
            trace_expectation=TraceExpectation(
                selected_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                retrieval_called=True,
            ),
        )
        exploratory_case = GoldenCase(
            case_id="explore-1",
            split="exploratory",
            source_type="expert_authored",
            user_goal="leave of absence",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="completed",
        )

        def executor(case: GoldenCase) -> ExecutionResult:
            return ExecutionResult(
                response=_response(sources=(_source(),)),
                observed_trace=ObservedTrace(
                    selected_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                    retrieval_called=True,
                ),
            )

        report = run_cases((smoke_case, exploratory_case), executor=executor, split="smoke")

        self.assertEqual(report.total, 1)
        self.assertEqual(report.passed, 1)
        self.assertEqual(report.failed, 0)
        self.assertEqual(report.by_split["smoke"].passed, 1)
        self.assertEqual(report.by_dimension["status"].passed, 1)
        self.assertEqual(report.by_dimension["retrieval"].passed, 1)
        self.assertEqual(report.by_dimension["answer"].passed, 1)
        self.assertEqual(report.by_dimension["trace"].passed, 1)

    def test_runner_reports_retrieval_answer_and_trace_failures(self) -> None:
        case = GoldenCase(
            case_id="routing-1",
            split="smoke",
            source_type="expert_authored",
            user_goal="library hours",
            actor=ActorContext(),
            scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            expected_status="completed",
            expected_sources=(expected_source_ref("handbook:library"),),
            forbidden_sources=(expected_source_ref("plan:fall"),),
            required_facts=("08:00", "22:00"),
            forbidden_claims=("24 hours",),
            trace_expectation=TraceExpectation(
                selected_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                retrieval_called=True,
            ),
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    answer_text="Library hours are 24 hours.",
                    corpus="curriculum",
                    collection="curriculum_plan",
                    sources=(
                        _source(
                            doc_id="plan:fall",
                            version_id="v2",
                            chunk_id="chunk-9",
                            collection="curriculum_plan",
                        ),
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=KnowledgeScope(
                        corpus="curriculum", collection="curriculum_plan"
                    ),
                    retrieval_called=False,
                ),
            ),
        )

        result = report.results[0]
        self.assertFalse(result.passed)
        self.assertTrue(result.status_result.passed)
        self.assertFalse(result.retrieval_result.passed)
        self.assertFalse(result.answer_result.passed)
        self.assertFalse(result.trace_result.passed)
        self.assertEqual(report.by_dimension["status"].passed, 1)
        self.assertEqual(report.by_dimension["retrieval"].failed, 1)
        self.assertEqual(report.by_dimension["answer"].failed, 1)
        self.assertEqual(report.by_dimension["trace"].failed, 1)

    def test_trace_grading_fails_when_trace_is_required_but_missing(self) -> None:
        case = GoldenCase(
            case_id="trace-1",
            split="smoke",
            source_type="expert_authored",
            user_goal="library hours",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="completed",
            trace_expectation=TraceExpectation(
                selected_scope=HANDBOOK_SCOPE,
                retrieval_called=True,
            ),
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(response=_response(sources=(_source(),))),
        )

        self.assertFalse(report.results[0].trace_result.passed)
        self.assertIn("missing", report.results[0].trace_result.reason)

    def test_runner_accepts_needs_clarification_with_scope_stable_evidence_payload(self) -> None:
        case = GoldenCase(
            case_id="clarify-1",
            split="smoke",
            source_type="expert_authored",
            user_goal="这个规定怎么办理",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="needs_clarification",
            trace_expectation=TraceExpectation(
                selected_scope=HANDBOOK_SCOPE,
                retrieval_called=False,
                clarification_expected=True,
            ),
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=AgentResponse(
                    target="rag-agent",
                    status="needs_clarification",
                    follow_up_question="请具体说明你想咨询学生手册中的哪一项制度、流程或表格。",
                    result=RagResultPayload(
                        evidence=EvidenceBundle(
                            query_text="这个规定怎么办理",
                            corpus="regulations",
                            collection="student_rules",
                        )
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                    retrieval_called=False,
                    clarification_emitted=True,
                ),
            ),
        )

        self.assertTrue(report.results[0].passed)
        self.assertEqual(report.by_dimension["status"].passed, 1)
        self.assertEqual(report.by_dimension["retrieval"].passed, 1)
        self.assertEqual(report.by_dimension["answer"].passed, 1)
        self.assertEqual(report.by_dimension["trace"].passed, 1)

    def test_doc_level_source_matching_does_not_require_chunk_id(self) -> None:
        case = GoldenCase(
            case_id="doc-level-1",
            split="smoke",
            source_type="synthetic_expansion",
            user_goal="library hours",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="completed",
            expected_sources=(expected_source_ref("handbook:library"),),
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    sources=(
                        _source(doc_id="handbook:library", version_id="v7", chunk_id="chunk-42"),
                    ),
                )
            ),
        )

        self.assertTrue(report.results[0].retrieval_result.passed)

    def test_version_level_source_matching_still_works_when_provided(self) -> None:
        case = GoldenCase(
            case_id="version-level-1",
            split="smoke",
            source_type="synthetic_expansion",
            user_goal="library hours",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="completed",
            expected_sources=(expected_source_ref("handbook:library", "v3"),),
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    sources=(
                        _source(doc_id="handbook:library", version_id="v2", chunk_id="chunk-1"),
                    ),
                )
            ),
        )

        self.assertFalse(report.results[0].retrieval_result.passed)

    def test_curriculum_internal_source_matching_requires_canonical_parent_and_semester_unit(
        self,
    ) -> None:
        follow_up_doc_id = build_curriculum_program_semester_fact_document_id(
            "curriculum:法学（民族实验班）本科人才培养方案",
            "第四学期",
        )
        case = GoldenCase(
            case_id="curriculum-follow-up-internal-source",
            split="smoke",
            source_type="synthetic_expansion",
            user_goal="法学民族班培养方案里大二下有什么课",
            actor=ActorContext(),
            scope=CURRICULUM_SCOPE,
            expected_status="completed",
            expected_sources=(
                expected_source_ref(
                    follow_up_doc_id,
                    canonical_source_id="curriculum:法学（民族实验班）本科人才培养方案",
                    source_unit_kind="semester_course_list",
                    source_unit_key="semester-4",
                ),
            ),
        )

        matched_report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    corpus="curriculum",
                    collection="curriculum_plan",
                    sources=(
                        _source(
                            doc_id=follow_up_doc_id,
                            collection="program_semester_facts",
                            snippet="第四学期有中国少数民族文字学、侵权责任法。",
                            canonical_source_id="curriculum:法学（民族实验班）本科人才培养方案",
                            canonical_source_title="法学（民族实验班）本科人才培养方案",
                            source_unit_kind="semester_course_list",
                            source_unit_key="semester-4",
                        ),
                    ),
                )
            ),
        )
        wrong_canonical_report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    corpus="curriculum",
                    collection="curriculum_plan",
                    sources=(
                        _source(
                            doc_id=follow_up_doc_id,
                            collection="program_semester_facts",
                            snippet="第四学期有中国少数民族文字学、侵权责任法。",
                            canonical_source_id="curriculum:错误培养方案",
                            canonical_source_title="错误培养方案",
                            source_unit_kind="semester_course_list",
                            source_unit_key="semester-4",
                        ),
                    ),
                )
            ),
        )
        wrong_unit_report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    corpus="curriculum",
                    collection="curriculum_plan",
                    sources=(
                        _source(
                            doc_id=follow_up_doc_id,
                            collection="program_semester_facts",
                            snippet="第四学期有中国少数民族文字学、侵权责任法。",
                            canonical_source_id="curriculum:法学（民族实验班）本科人才培养方案",
                            canonical_source_title="法学（民族实验班）本科人才培养方案",
                            source_unit_kind="semester_course_list",
                            source_unit_key="semester-3",
                        ),
                    ),
                )
            ),
        )

        self.assertTrue(matched_report.results[0].retrieval_result.passed)
        self.assertFalse(wrong_canonical_report.results[0].retrieval_result.passed)
        self.assertFalse(wrong_unit_report.results[0].retrieval_result.passed)

    def test_runner_aggregates_deterministic_release_gate_metrics(self) -> None:
        completed_case = GoldenCase(
            case_id="completed-1",
            split="release_gate",
            source_type="expert_authored",
            user_goal="library hours",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="completed",
            expected_sources=(expected_source_ref("handbook:library"),),
            forbidden_sources=(expected_source_ref("plan:fall"),),
            required_facts=("08:00",),
            forbidden_claims=("24 hours",),
            trace_expectation=TraceExpectation(
                selected_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                retrieval_called=True,
            ),
        )
        clarification_case = GoldenCase(
            case_id="clarify-accuracy",
            split="release_gate",
            source_type="expert_authored",
            user_goal="奖学金怎么申请？",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="needs_clarification",
            trace_expectation=TraceExpectation(
                selected_scope=HANDBOOK_SCOPE,
                retrieval_called=False,
                clarification_expected=True,
            ),
        )
        no_answer_case = GoldenCase(
            case_id="no-answer-fail-close",
            split="release_gate",
            source_type="expert_authored",
            user_goal="火星校区飞船停靠规则",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="no_answer",
            trace_expectation=TraceExpectation(
                selected_scope=HANDBOOK_SCOPE,
                retrieval_called=True,
                fail_closed_expected=True,
            ),
        )
        error_case = GoldenCase(
            case_id="error-path",
            split="release_gate",
            source_type="expert_authored",
            user_goal="system failure",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="error",
            trace_expectation=TraceExpectation(
                selected_scope=HANDBOOK_SCOPE,
                retrieval_called=True,
                error_expected=True,
            ),
        )

        def executor(case: GoldenCase) -> ExecutionResult:
            if case.case_id == "completed-1":
                return ExecutionResult(
                    response=_response(sources=(_source(),)),
                    observed_trace=ObservedTrace(
                        selected_scope=KnowledgeScope(
                            corpus="regulations", collection="student_rules"
                        ),
                        retrieval_called=True,
                    ),
                )
            if case.case_id == "clarify-accuracy":
                return ExecutionResult(
                    response=AgentResponse(
                        target="rag-agent",
                        status="needs_clarification",
                        result=RagResultPayload(
                            evidence=EvidenceBundle(
                                query_text="奖学金怎么申请？",
                                corpus="regulations",
                                collection="student_rules",
                            )
                        ),
                    ),
                    observed_trace=ObservedTrace(
                        selected_scope=KnowledgeScope(
                            corpus="regulations", collection="student_rules"
                        ),
                        retrieval_called=False,
                        clarification_emitted=True,
                    ),
                )
            if case.case_id == "no-answer-fail-close":
                return ExecutionResult(
                    response=AgentResponse(
                        target="rag-agent",
                        status="no_answer",
                        answer_text="当前未检索到足够依据支持回答该问题，请确认它是否属于学生手册范围，或补充更具体的制度名称。",
                        result=RagResultPayload(
                            evidence=EvidenceBundle(
                                query_text="火星校区飞船停靠规则",
                                corpus="regulations",
                                collection="student_rules",
                                sources=(_source(doc_id="handbook:unexpected"),),
                            )
                        ),
                    ),
                    observed_trace=ObservedTrace(
                        selected_scope=KnowledgeScope(
                            corpus="regulations", collection="student_rules"
                        ),
                        retrieval_called=True,
                    ),
                )
            return ExecutionResult(
                response=AgentResponse(
                    target="rag-agent",
                    status="error",
                    confidence="low",
                    answer_text="retrieval failed",
                    error=None,
                    result=RagResultPayload(
                        evidence=EvidenceBundle(
                            query_text="system failure",
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

        report = run_cases(
            (completed_case, clarification_case, no_answer_case, error_case),
            executor=executor,
        )

        self.assertEqual(report.by_metric["status_accuracy"].passed, 4)
        self.assertEqual(report.by_metric["expected_doc_hit"].passed, 1)
        self.assertEqual(report.by_metric["forbidden_doc_miss"].passed, 1)
        self.assertEqual(report.by_metric["answer_accuracy"].passed, 1)
        self.assertEqual(report.by_metric["answer_completeness"].passed, 1)
        self.assertEqual(report.by_metric["forbidden_claim_free"].passed, 1)
        self.assertEqual(report.by_metric["citation_completeness"].passed, 1)
        self.assertEqual(report.by_metric["source_locator_completeness"].passed, 1)
        self.assertEqual(report.by_metric["clarification_accuracy"].failed, 1)
        self.assertEqual(report.by_metric["no_answer_accuracy"].passed, 1)
        self.assertEqual(report.by_metric["fail_closed"].failed, 1)
        self.assertEqual(report.by_metric["error_path_correctness"].failed, 1)
        self.assertFalse(report.results[1].passed)
        self.assertFalse(report.results[2].passed)
        self.assertFalse(report.results[3].passed)
