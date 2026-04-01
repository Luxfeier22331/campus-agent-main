from __future__ import annotations

import re
import unittest

from campus_contracts import (
    ActorContext,
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagResultPayload,
    SpecialistResponse,
    SupervisorResponse,
)
from campus_evals import (
    curriculum_error_gate_cases,
    curriculum_regression_locked_cases,
    curriculum_release_gate_cases,
    curriculum_smoke_cases,
    ExecutionResult,
    GoldenCase,
    handbook_error_gate_cases,
    handbook_regression_locked_cases,
    handbook_release_gate_cases,
    handbook_smoke_cases,
    ObservedTrace,
    TraceExpectation,
    expected_source_ref,
    run_cases,
)

HANDBOOK_SCOPE = KnowledgeScope(corpus="regulations", collection="student_handbook")
CURRICULUM_SCOPE = KnowledgeScope(corpus="curriculum", collection="curriculum_plan")


def _is_lookup_style_goal(user_goal: str) -> bool:
    normalized = user_goal.strip()
    if re.search(r"第[一二三四五六七八九十百0-9]+条$", normalized):
        return True
    if any(token in normalized for token in ("怎么办", "怎么", "如何", "多少", "几年", "安排", "授予")):
        return False
    return normalized.endswith(("管理办法", "评审办法", "人才培养方案", "教学计划", "宿舍照明"))


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

    def test_case_accepts_reference_context_truth_and_metric_overrides(self) -> None:
        case = GoldenCase(
            case_id="case-with-supplemental-truth",
            split="release_gate",
            source_type="expert_authored",
            user_goal="图书馆开放时间是什么？",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="completed",
            reference_context_ids=("handbook:library",),
            reference_contexts=("图书馆开放时间为 08:00-22:00。",),
            supplemental_metric_overrides={"answer_relevancy": False},
        )

        self.assertEqual(case.reference_context_ids, ("handbook:library",))
        self.assertEqual(case.reference_contexts, ("图书馆开放时间为 08:00-22:00。",))
        self.assertEqual(case.supplemental_metric_overrides, {"answer_relevancy": False})


class RunCasesTest(unittest.TestCase):
    def test_handbook_smoke_cases_cover_stable_terminal_statuses(self) -> None:
        cases = handbook_smoke_cases()

        self.assertEqual(
            tuple(case.case_id for case in cases),
            (
                "handbook-smoke-scholarship-title",
                "handbook-smoke-student-card",
                "handbook-smoke-no-answer",
                "handbook-smoke-needs-clarification",
            ),
        )
        self.assertEqual(
            tuple(case.expected_status for case in cases),
            (
                "completed",
                "completed",
                "no_answer",
                "needs_clarification",
            ),
        )
        self.assertTrue(all(case.source_type == "expert_authored" for case in cases))
        self.assertTrue(all(case.split == "smoke" for case in cases))
        self.assertTrue(all(case.scope == HANDBOOK_SCOPE for case in cases))

    def test_handbook_regression_locked_cases_cover_high_risk_lanes(self) -> None:
        cases = handbook_regression_locked_cases()

        self.assertEqual(
            tuple(case.case_id for case in cases),
            (
                "handbook-regression-student-status-article",
                "handbook-regression-dormitory-lighting",
                "handbook-regression-student-card-reissue",
                "handbook-regression-no-answer-visa",
                "handbook-regression-needs-clarification-scholarship",
            ),
        )
        self.assertEqual(
            tuple(case.expected_status for case in cases),
            (
                "completed",
                "completed",
                "completed",
                "no_answer",
                "needs_clarification",
            ),
        )
        self.assertTrue(all(case.source_type == "expert_authored" for case in cases))
        self.assertTrue(all(case.split == "regression_locked" for case in cases))
        self.assertTrue(all(case.scope == HANDBOOK_SCOPE for case in cases))

    def test_handbook_release_gate_cases_cover_terminal_statuses(self) -> None:
        cases = handbook_release_gate_cases()
        cases_by_id = {case.case_id: case for case in cases}

        self.assertEqual(len(cases), 8)
        self.assertEqual(
            tuple(case.case_id for case in cases),
            (
                "release-gate-scholarship-title",
                "release-gate-student-card",
                "release-gate-student-card-materials",
                "release-gate-student-card-time",
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
                "completed",
                "completed",
                "no_answer",
                "needs_clarification",
            ),
        )
        self.assertTrue(all(case.split == "release_gate" for case in cases))
        self.assertTrue(all(case.scope == HANDBOOK_SCOPE for case in cases))
        self.assertTrue(
            any("24:00" in fact for fact in cases_by_id["release-gate-dormitory-lighting"].reference_facts)
        )
        self.assertTrue(
            any("每周四下午" in fact for fact in cases_by_id["release-gate-student-card"].reference_facts)
        )
        self.assertTrue(
            any("书面申请" in fact for fact in cases_by_id["release-gate-student-card-materials"].reference_facts)
        )
        self.assertTrue(
            any("每周四下午" in fact for fact in cases_by_id["release-gate-student-card-time"].reference_facts)
        )
        self.assertEqual(
            cases_by_id["release-gate-scholarship-title"].supplemental_metric_overrides.get("answer_relevancy"),
            False,
        )
        self.assertEqual(
            cases_by_id["release-gate-dormitory-lighting"].reference_context_ids,
            ("handbook:2ec80263a9e7b11379281349196ceb96afa44c3b",),
        )

    def test_completed_release_and_regression_cases_define_context_truth_or_explicit_metric_skip(self) -> None:
        cases = (
            *handbook_release_gate_cases(),
            *handbook_regression_locked_cases(),
            *curriculum_release_gate_cases(),
            *curriculum_regression_locked_cases(),
        )

        for case in cases:
            if case.expected_status != "completed":
                continue
            with self.subTest(case_id=case.case_id):
                self.assertTrue(
                    case.reference_context_ids or case.reference_contexts,
                    "completed case must define supplemental context truth",
                )
                self.assertEqual(
                    case.supplemental_metric_overrides.get("answer_relevancy") is False,
                    _is_lookup_style_goal(case.user_goal),
                )

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

    def test_curriculum_smoke_cases_cover_stable_terminal_statuses(self) -> None:
        cases = curriculum_smoke_cases()

        self.assertEqual(
            tuple(case.case_id for case in cases),
            (
                "curriculum-smoke-ethnology-title",
                "curriculum-smoke-academic-years",
                "curriculum-smoke-hanyu-international-credits",
                "curriculum-smoke-no-answer",
                "curriculum-smoke-needs-clarification",
            ),
        )
        self.assertEqual(
            tuple(case.expected_status for case in cases),
            (
                "completed",
                "completed",
                "completed",
                "no_answer",
                "needs_clarification",
            ),
        )
        self.assertTrue(all(case.source_type == "expert_authored" for case in cases))
        self.assertTrue(all(case.split == "smoke" for case in cases))
        self.assertTrue(all(case.scope == CURRICULUM_SCOPE for case in cases))

    def test_curriculum_regression_locked_cases_cover_high_risk_lanes(self) -> None:
        cases = curriculum_regression_locked_cases()

        self.assertEqual(
            tuple(case.case_id for case in cases),
            (
                "curriculum-regression-history-strong-base",
                "curriculum-regression-course-map-table",
                "curriculum-regression-general-english-credits",
                "curriculum-regression-minority-language-strong-base",
                "curriculum-regression-education-second-degree-years",
                "curriculum-regression-fiscal-core-credits",
                "curriculum-regression-no-answer-program",
                "curriculum-regression-needs-clarification-degree",
            ),
        )
        self.assertEqual(
            tuple(case.expected_status for case in cases),
            (
                "completed",
                "completed",
                "completed",
                "completed",
                "completed",
                "completed",
                "no_answer",
                "needs_clarification",
            ),
        )
        self.assertTrue(all(case.source_type == "expert_authored" for case in cases))
        self.assertTrue(all(case.split == "regression_locked" for case in cases))
        self.assertTrue(all(case.scope == CURRICULUM_SCOPE for case in cases))

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
                    answer_text="当前未检索到足够依据支持回答该问题，请确认它是否属于学生手册范围，或补充更具体的制度名称。",
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

    def test_curriculum_course_map_case_accepts_table_style_answer_without_procedure_directness(self) -> None:
        case = next(
            item
            for item in curriculum_release_gate_cases()
            if item.case_id == "curriculum-release-gate-course-map-table"
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    answer_text=(
                        "根据培养方案相关内容，《经济学拔尖人才创新班人才培养方案》明确："
                        "经济学拔尖人才创新班必修的专业核心课程 30 学分。；"
                        "1034030157 | 博弈论与信息经济学 | 3 | 54 | / | 5；"
                        "1034040239 | 空间经济学及应用 | 3 | 54 | / | 6"
                    ),
                    corpus="curriculum",
                    collection="curriculum_plan",
                    sources=(
                        _source(
                            doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                            collection="curriculum_plan",
                            snippet="经济学拔尖人才创新班必修的专业核心课程 30 学分。",
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
                            doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                            collection="curriculum_plan",
                            snippet="经济学拔尖人才创新班必修的专业核心课程 30 学分。",
                        ),
                    ),
                ),
            ),
        )

        result = report.results[0]
        self.assertTrue(result.passed)
        self.assertNotIn("procedure_directness", result.metric_results)

    def test_curriculum_smoke_hanyu_international_credits_case_accepts_total_credit_fact(self) -> None:
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

    def test_curriculum_regression_fiscal_core_credits_case_accepts_structured_core_credit_fact(self) -> None:
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

    def test_runner_accepts_supervisor_clarification_without_rag_evidence(self) -> None:
        case = GoldenCase(
            case_id="supervisor-clarify-1",
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
                response=SupervisorResponse(
                    selected_target=None,
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

    def test_runner_supports_supervisor_only_terminal_statuses(self) -> None:
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
                    response=SupervisorResponse(
                        selected_target=None,
                        status="approval_required",
                        answer_text="该请求涉及需要人工确认的操作，必须先经过审批。",
                        confidence="low",
                    )
                )
            return ExecutionResult(
                response=SupervisorResponse(
                    selected_target=None,
                    status="rejected",
                    confidence="low",
                    error=ErrorInfo(
                        code="request_rejected",
                        message="request was rejected by supervisor policy",
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
