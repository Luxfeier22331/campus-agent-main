from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    DelegateToRagAgentResponse,
    EvidenceBundle,
    EvidenceSource,
)
from campus_evals import (
    ExecutionResult,
    GoldenCase,
    GraderPolicy,
    ObservedTrace,
    TraceExpectation,
    expected_source_ref,
    run_cases,
    student_handbook_smoke_cases,
)


def _source(
    *,
    doc_id: str = "handbook:library",
    version_id: str = "v1",
    chunk_id: str = "chunk-1",
    snippet: str = "Library hours are 08:00 to 22:00.",
) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        version_id=version_id,
        chunk_id=chunk_id,
        anchor={"page": 1},
        acl_level="public",
        canonical_url="https://example.edu/handbook/library",
        latest_url="https://example.edu/handbook/library",
        snippet=snippet,
        score=0.91,
    )


def _response(
    *,
    status: str = "completed",
    answer_text: str = "Library hours are 08:00 to 22:00.",
    corpus: str = "student_handbook",
    sources: tuple[EvidenceSource, ...] = (),
) -> DelegateToRagAgentResponse:
    return DelegateToRagAgentResponse(
        status=status,
        answer_text=answer_text,
        confidence="high" if status == "completed" else "low",
        evidence=EvidenceBundle(query_text="library hours", corpus=corpus, sources=sources),
    )


class GoldenCaseSchemaTest(unittest.TestCase):
    def test_case_rejects_empty_corpora(self) -> None:
        with self.assertRaisesRegex(ValueError, "corpora"):
            GoldenCase(
                case_id="case-1",
                split="smoke",
                source_type="expert_authored",
                user_goal="library hours",
                actor=ActorContext(),
                corpora=(),
                expected_status="completed",
                expected_evidence_corpus="student_handbook",
            )

    def test_case_rejects_expected_corpus_not_in_request_corpora(self) -> None:
        with self.assertRaisesRegex(ValueError, "expected_evidence_corpus"):
            GoldenCase(
                case_id="case-2",
                split="smoke",
                source_type="expert_authored",
                user_goal="library hours",
                actor=ActorContext(),
                corpora=("student_handbook",),
                expected_status="completed",
                expected_evidence_corpus="curriculum_plan",
            )


class RunCasesTest(unittest.TestCase):
    def test_student_handbook_smoke_cases_keep_phase1_queries(self) -> None:
        goals = tuple(case.user_goal for case in student_handbook_smoke_cases())

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

    def test_runner_filters_by_split_and_aggregates_dimensions(self) -> None:
        smoke_case = GoldenCase(
            case_id="smoke-1",
            split="smoke",
            source_type="expert_authored",
            user_goal="library hours",
            actor=ActorContext(),
            corpora=("student_handbook", "curriculum_plan"),
            expected_status="completed",
            expected_evidence_corpus="student_handbook",
            expected_sources=(expected_source_ref("handbook:library", "v1", "chunk-1"),),
            required_facts=("08:00",),
            trace_expectation=TraceExpectation(
                selected_corpus="student_handbook",
                retrieval_called=True,
            ),
        )
        exploratory_case = GoldenCase(
            case_id="explore-1",
            split="exploratory",
            source_type="expert_authored",
            user_goal="leave of absence",
            actor=ActorContext(),
            corpora=("student_handbook",),
            expected_status="completed",
            expected_evidence_corpus="student_handbook",
        )

        def executor(case: GoldenCase) -> ExecutionResult:
            return ExecutionResult(
                response=_response(sources=(_source(),)),
                observed_trace=ObservedTrace(
                    selected_corpus="student_handbook",
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
            corpora=("student_handbook", "curriculum_plan"),
            expected_status="completed",
            expected_evidence_corpus="student_handbook",
            expected_sources=(expected_source_ref("handbook:library", "v1", "chunk-1"),),
            forbidden_sources=(expected_source_ref("plan:fall", "v2", "chunk-9"),),
            required_facts=("08:00", "22:00"),
            forbidden_claims=("24 hours",),
            trace_expectation=TraceExpectation(
                selected_corpus="student_handbook",
                retrieval_called=True,
            ),
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(
                response=_response(
                    answer_text="Library hours are 24 hours.",
                    corpus="curriculum_plan",
                    sources=(
                        _source(doc_id="plan:fall", version_id="v2", chunk_id="chunk-9"),
                    ),
                ),
                observed_trace=ObservedTrace(
                    selected_corpus="curriculum_plan",
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
            corpora=("student_handbook",),
            expected_status="completed",
            expected_evidence_corpus="student_handbook",
            trace_expectation=TraceExpectation(
                selected_corpus="student_handbook",
                retrieval_called=True,
            ),
        )

        report = run_cases(
            (case,),
            executor=lambda _: ExecutionResult(response=_response(sources=(_source(),))),
        )

        self.assertFalse(report.results[0].trace_result.passed)
        self.assertIn("missing", report.results[0].trace_result.reason)


if __name__ == "__main__":
    unittest.main()
