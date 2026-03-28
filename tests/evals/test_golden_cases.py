from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagResultPayload,
    SpecialistResponse,
)
from campus_evals import (
    curriculum_error_gate_cases,
    curriculum_release_gate_cases,
    ExecutionResult,
    GoldenCase,
    handbook_error_gate_cases,
    handbook_release_gate_cases,
    handbook_smoke_cases,
    ObservedTrace,
    TraceExpectation,
    expected_source_ref,
    run_cases,
)

HANDBOOK_SCOPE = KnowledgeScope(corpus="regulations", collection="student_handbook")
CURRICULUM_SCOPE = KnowledgeScope(corpus="curriculum", collection="curriculum_plan")


def _source(
    *,
    doc_id: str = "handbook:library",
    version_id: str = "v1",
    chunk_id: str = "chunk-1",
    collection: str = "student_handbook",
    snippet: str = "Library hours are 08:00 to 22:00.",
) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id=version_id,
        chunk_id=chunk_id,
        anchor={"page": 1},
        acl_level="public",
        canonical_url="https://example.edu/handbook/library",
        latest_url="https://example.edu/handbook/library",
        source_channel="pdf_ocr",
        collection=collection,
        is_current=False,
        snippet=snippet,
        score=0.91,
    )


def _response(
    *,
    status: str = "completed",
    answer_text: str = "Library hours are 08:00 to 22:00.",
    corpus: str = "regulations",
    collection: str = "student_handbook",
    sources: tuple[EvidenceSource, ...] = (),
) -> SpecialistResponse:
    return SpecialistResponse(
        target="rag-specialist",
        status=status,
        answer_text=answer_text,
        confidence="high" if status == "completed" else "low",
        result=RagResultPayload(
            evidence=EvidenceBundle(
                query_text="library hours",
                corpus=corpus,
                collection=collection,
                sources=sources,
            )
        ),
    )


class GoldenCaseSchemaTest(unittest.TestCase):
    def test_case_requires_explicit_scope(self) -> None:
        with self.assertRaisesRegex(TypeError, "scope"):
            GoldenCase(
                case_id="case-1",
                split="smoke",
                source_type="expert_authored",
                user_goal="library hours",
                actor=ActorContext(),
                expected_status="completed",
            )

    def test_case_rejects_empty_user_goal(self) -> None:
        with self.assertRaisesRegex(ValueError, "user_goal"):
            GoldenCase(
                case_id="case-2",
                split="smoke",
                source_type="expert_authored",
                user_goal="   ",
                actor=ActorContext(),
                scope=HANDBOOK_SCOPE,
                expected_status="completed",
            )

    def test_trace_expectation_rejects_unknown_handoff(self) -> None:
        with self.assertRaisesRegex(ValueError, "expected_handoff"):
            TraceExpectation(expected_handoff="supervisor-direct")


class RunCasesTest(unittest.TestCase):
    def test_handbook_smoke_cases_keep_seed_queries(self) -> None:
        cases = handbook_smoke_cases()
        goals = tuple(case.user_goal for case in cases)

        self.assertEqual(
            goals,
            (
                "library hours",
                "scholarship eligibility",
                "graduation credits",
                "registrar transcript",
                "add/drop",
                "leave of absence",
            ),
        )
        self.assertTrue(all(case.source_type == "synthetic_expansion" for case in cases))
        self.assertTrue(all(case.generator_name == "bootstrap-smoke-generator" for case in cases))

    def test_handbook_release_gate_cases_cover_terminal_statuses(self) -> None:
        cases = handbook_release_gate_cases()

        self.assertEqual(len(cases), 6)
        self.assertEqual(
            tuple(case.case_id for case in cases),
            (
                "release-gate-scholarship-title",
                "release-gate-student-card",
                "release-gate-dormitory-lighting",
                "release-gate-medical-title",
                "release-gate-no-answer",
                "release-gate-needs-clarification",
            ),
        )
        self.assertEqual(
            tuple(case.expected_status for case in cases),
            (
                "completed",
                "completed",
                "completed",
                "completed",
                "no_answer",
                "needs_clarification",
            ),
        )
        self.assertTrue(all(case.split == "release_gate" for case in cases))
        self.assertTrue(all(case.scope == HANDBOOK_SCOPE for case in cases))

    def test_handbook_error_gate_cases_cover_deterministic_error_paths(self) -> None:
        cases = handbook_error_gate_cases()

        self.assertEqual(len(cases), 3)
        self.assertEqual(
            tuple(case.case_id for case in cases),
            (
                "error-gate-retrieval-backend-failure",
                "error-gate-evidence-shaping-failure",
                "error-gate-invalid-backend-contract",
            ),
        )
        self.assertTrue(all(case.expected_status == "error" for case in cases))
        self.assertTrue(all(case.split == "release_gate" for case in cases))
        self.assertTrue(all("error_gate" in case.tags for case in cases))
        self.assertTrue(all(case.scope == HANDBOOK_SCOPE for case in cases))

    def test_curriculum_release_gate_cases_cover_terminal_statuses(self) -> None:
        cases = curriculum_release_gate_cases()

        self.assertEqual(len(cases), 6)
        self.assertEqual(
            tuple(case.case_id for case in cases),
            (
                "curriculum-release-gate-ethnology-title",
                "curriculum-release-gate-academic-years",
                "curriculum-release-gate-total-credits",
                "curriculum-release-gate-course-map-table",
                "curriculum-release-gate-no-answer",
                "curriculum-release-gate-needs-clarification",
            ),
        )
        self.assertEqual(
            tuple(case.expected_status for case in cases),
            (
                "completed",
                "completed",
                "completed",
                "completed",
                "no_answer",
                "needs_clarification",
            ),
        )
        self.assertTrue(all(case.split == "release_gate" for case in cases))
        self.assertTrue(all(case.scope == CURRICULUM_SCOPE for case in cases))
        self.assertTrue(all("curriculum" in case.tags for case in cases))

    def test_curriculum_error_gate_cases_cover_deterministic_error_paths(self) -> None:
        cases = curriculum_error_gate_cases()

        self.assertEqual(len(cases), 3)
        self.assertEqual(
            tuple(case.case_id for case in cases),
            (
                "curriculum-error-gate-retrieval-backend-failure",
                "curriculum-error-gate-evidence-shaping-failure",
                "curriculum-error-gate-invalid-backend-contract",
            ),
        )
        self.assertTrue(all(case.expected_status == "error" for case in cases))
        self.assertTrue(all(case.split == "release_gate" for case in cases))
        self.assertTrue(all("error_gate" in case.tags for case in cases))
        self.assertTrue(all(case.scope == CURRICULUM_SCOPE for case in cases))

    def test_runner_filters_by_split_and_aggregates_dimensions(self) -> None:
        smoke_case = GoldenCase(
            case_id="smoke-1",
            split="smoke",
            source_type="expert_authored",
            user_goal="library hours",
            actor=ActorContext(),
            scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
            expected_status="completed",
            expected_sources=(expected_source_ref("handbook:library"),),
            required_facts=("08:00",),
            trace_expectation=TraceExpectation(
                selected_scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
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
                    selected_scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
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
            scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
            expected_status="completed",
            expected_sources=(expected_source_ref("handbook:library"),),
            forbidden_sources=(expected_source_ref("plan:fall"),),
            required_facts=("08:00", "22:00"),
            forbidden_claims=("24 hours",),
            trace_expectation=TraceExpectation(
                selected_scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
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
                    selected_scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan"),
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
                response=SpecialistResponse(
                    target="rag-specialist",
                    status="needs_clarification",
                    follow_up_question="请具体说明你想咨询学生手册中的哪一项制度、流程或表格。",
                    result=RagResultPayload(
                        evidence=EvidenceBundle(
                            query_text="这个规定怎么办理",
                            corpus="regulations",
                            collection="student_handbook",
                        )
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
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
                selected_scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
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
                        selected_scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
                        retrieval_called=True,
                    ),
                )
            if case.case_id == "clarify-accuracy":
                return ExecutionResult(
                    response=SpecialistResponse(
                        target="rag-specialist",
                        status="needs_clarification",
                        result=RagResultPayload(
                            evidence=EvidenceBundle(
                                query_text="奖学金怎么申请？",
                                corpus="regulations",
                                collection="student_handbook",
                            )
                        ),
                    ),
                    observed_trace=ObservedTrace(
                        selected_scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
                        retrieval_called=False,
                        clarification_emitted=True,
                    ),
                )
            if case.case_id == "no-answer-fail-close":
                return ExecutionResult(
                    response=SpecialistResponse(
                        target="rag-specialist",
                        status="no_answer",
                        result=RagResultPayload(
                            evidence=EvidenceBundle(
                                query_text="火星校区飞船停靠规则",
                                corpus="regulations",
                                collection="student_handbook",
                                sources=(_source(doc_id="handbook:unexpected"),),
                            )
                        ),
                    ),
                    observed_trace=ObservedTrace(
                        selected_scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
                        retrieval_called=True,
                    ),
                )
            return ExecutionResult(
                response=SpecialistResponse(
                    target="rag-specialist",
                    status="error",
                    confidence="low",
                    answer_text="retrieval failed",
                    error=None,
                    result=RagResultPayload(
                        evidence=EvidenceBundle(
                            query_text="system failure",
                            corpus="regulations",
                            collection="student_handbook",
                        )
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
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
                selected_scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
                retrieval_called=True,
            ),
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(sources=(_source(),)),
                observed_trace=ObservedTrace(
                    selected_scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
                    retrieval_called=True,
                ),
            ),
        )

        self.assertEqual(report.by_metric["error_path_correctness"].total, 0)
        self.assertIsNone(report.by_metric["error_path_correctness"].pass_rate)
        self.assertEqual(report.by_metric["error_path_correctness"].reason, "no_applicable_cases")

    def test_runner_aggregates_deterministic_error_gate_metrics(self) -> None:
        cases = handbook_error_gate_cases()

        def executor(case: GoldenCase) -> ExecutionResult:
            return ExecutionResult(
                response=SpecialistResponse(
                    target="rag-specialist",
                    status="error",
                    confidence="low",
                    answer_text="",
                    error=ErrorInfo(code=f"{case.case_id}-failed", message="deterministic failure"),
                    result=RagResultPayload(
                        evidence=EvidenceBundle(
                            query_text=case.user_goal,
                            corpus="regulations",
                            collection="student_handbook",
                        )
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
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


if __name__ == "__main__":
    unittest.main()
