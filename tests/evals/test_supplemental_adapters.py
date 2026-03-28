from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagResultPayload,
    SpecialistResponse,
    SupervisorResponse,
)
from campus_evals import ExecutionResult, GoldenCase, ObservedTrace, SupplementalResult, TraceExpectation, build_ragas_projection, run_cases
from campus_evals.ragas_adapter import RagasSupplementalAdapter

HANDBOOK_SCOPE = KnowledgeScope(corpus="regulations", collection="student_handbook")


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


class RagasProjectionTest(unittest.TestCase):
    def test_build_ragas_projection_uses_query_answer_contexts_and_reference(self) -> None:
        case = GoldenCase(
            case_id="ragas-1",
            split="release_gate",
            source_type="expert_authored",
            user_goal="library hours",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="completed",
            required_facts=("08:00", "22:00"),
            trace_expectation=TraceExpectation(
                selected_scope=HANDBOOK_SCOPE,
                retrieval_called=True,
            ),
        )
        execution = ExecutionResult(
            response=_response(sources=(_source(), _source(chunk_id="chunk-2", snippet="Closed on holidays."))),
            observed_trace=ObservedTrace(
                selected_scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
                retrieval_called=True,
            ),
        )

        projection = build_ragas_projection(case, execution)

        self.assertEqual(projection.case_id, "ragas-1")
        self.assertEqual(projection.user_input, "library hours")
        self.assertEqual(projection.response, "Library hours are 08:00 to 22:00.")
        self.assertEqual(
            projection.retrieved_contexts,
            ("Library hours are 08:00 to 22:00.", "Closed on holidays."),
        )
        self.assertEqual(projection.reference, "08:00\n22:00")
        self.assertEqual(projection.metadata["collection"], "student_handbook")
        self.assertEqual(projection.metadata["expected_status"], "completed")

    def test_build_ragas_projection_uses_supporting_evidence_for_contexts_and_trace_for_counts(self) -> None:
        case = GoldenCase(
            case_id="ragas-2",
            split="release_gate",
            source_type="expert_authored",
            user_goal="library hours",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="completed",
            required_facts=("08:00",),
            trace_expectation=TraceExpectation(
                selected_scope=HANDBOOK_SCOPE,
                retrieval_called=True,
            ),
        )
        support_source = _source(chunk_id="chunk-support", snippet="Library hours are 08:00 to 22:00.")
        raw_background = _source(chunk_id="chunk-background", snippet="The library policy is interpreted by the student office.")
        execution = ExecutionResult(
            response=_response(sources=(support_source,)),
            observed_trace=ObservedTrace(
                selected_scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
                retrieval_called=True,
                retrieved_sources=(support_source, raw_background),
                supporting_sources=(support_source,),
            ),
        )

        projection = build_ragas_projection(case, execution)

        self.assertEqual(projection.retrieved_contexts, ("Library hours are 08:00 to 22:00.",))
        self.assertEqual(projection.metadata["retrieved_source_count"], 2)
        self.assertEqual(projection.metadata["supporting_source_count"], 1)

    def test_build_ragas_projection_accepts_supervisor_response_shape(self) -> None:
        case = GoldenCase(
            case_id="ragas-supervisor-1",
            split="release_gate",
            source_type="expert_authored",
            user_goal="library hours",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="completed",
            required_facts=("08:00",),
        )
        execution = ExecutionResult(
            response=SupervisorResponse(
                selected_target="rag-specialist",
                status="completed",
                answer_text="Library hours are 08:00 to 22:00.",
                confidence="high",
                result=RagResultPayload(
                    evidence=EvidenceBundle(
                        query_text="library hours",
                        corpus="regulations",
                        collection="student_handbook",
                        sources=(_source(),),
                    )
                ),
            ),
            observed_trace=ObservedTrace(
                selected_scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
                retrieval_called=True,
                retrieved_sources=(_source(),),
                supporting_sources=(_source(),),
            ),
        )

        projection = build_ragas_projection(case, execution)

        self.assertEqual(projection.response, "Library hours are 08:00 to 22:00.")
        self.assertEqual(projection.metadata["response_status"], "completed")
        self.assertEqual(projection.metadata["retrieved_source_count"], 1)


class SupplementalRunnerTest(unittest.TestCase):
    def test_run_cases_attaches_supplemental_results_without_changing_deterministic_pass(self) -> None:
        case = GoldenCase(
            case_id="supplemental-1",
            split="release_gate",
            source_type="expert_authored",
            user_goal="library hours",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="completed",
            required_facts=("08:00",),
            trace_expectation=TraceExpectation(
                selected_scope=HANDBOOK_SCOPE,
                retrieval_called=True,
            ),
        )
        adapter = RagasSupplementalAdapter(
            scorer=lambda projection: (
                SupplementalResult(
                    adapter_id="ragas",
                    metric_name="faithfulness",
                    score=0.9,
                    verdict="passed",
                    rationale=f"scored for {projection.case_id}",
                ),
            )
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
            supplemental_adapters=(adapter,),
        )

        self.assertEqual(report.passed, 1)
        self.assertEqual(len(report.results[0].supplemental_results), 1)
        supplemental = report.results[0].supplemental_results[0]
        self.assertEqual(supplemental.adapter_id, "ragas")
        self.assertEqual(supplemental.metric_name, "faithfulness")
        self.assertEqual(report.by_supplemental["ragas.faithfulness"].total, 1)
        self.assertAlmostEqual(report.by_supplemental["ragas.faithfulness"].average_score, 0.9)
        self.assertEqual(report.by_supplemental["ragas.faithfulness"].verdict_counts["passed"], 1)
        self.assertTrue(report.by_supplemental["ragas.faithfulness"].report_only)

    def test_failed_report_only_supplemental_result_does_not_flip_deterministic_verdict(self) -> None:
        case = GoldenCase(
            case_id="supplemental-2",
            split="release_gate",
            source_type="expert_authored",
            user_goal="library hours",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="completed",
            required_facts=("08:00",),
            trace_expectation=TraceExpectation(
                selected_scope=HANDBOOK_SCOPE,
                retrieval_called=True,
            ),
        )
        adapter = RagasSupplementalAdapter(
            scorer=lambda projection: (
                SupplementalResult(
                    adapter_id="ragas",
                    metric_name="faithfulness",
                    score=0.2,
                    verdict="failed",
                    rationale=f"scored for {projection.case_id}",
                ),
            )
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
            supplemental_adapters=(adapter,),
        )

        self.assertEqual(report.passed, 1)
        self.assertEqual(report.by_supplemental["ragas.faithfulness"].verdict_counts["failed"], 1)
        self.assertTrue(report.results[0].passed)
