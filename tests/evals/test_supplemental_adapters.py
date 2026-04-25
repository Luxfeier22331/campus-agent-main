from __future__ import annotations

import time
import unittest
from dataclasses import replace
from threading import Lock

from campus_contracts import (
    ActorContext,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagResultPayload,
    AgentResponse,
    SupervisorResponse,
)
from campus_evals import (
    ExecutionResult,
    GoldenCase,
    ObservedTrace,
    SupplementalResult,
    TraceExpectation,
    build_ragas_projection,
    run_cases,
)
from campus_evals.ragas_adapter import RagasSupplementalAdapter

HANDBOOK_SCOPE = KnowledgeScope(corpus="regulations", collection="student_rules")


def _source(
    *,
    doc_id: str = "handbook:library",
    version_id: str = "v1",
    chunk_id: str = "chunk-1",
    collection: str = "student_rules",
    snippet: str = "Library hours are 08:00 to 22:00.",
) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id=version_id,
        chunk_id=chunk_id,
        anchor={"page": 1},
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
    collection: str = "student_rules",
    sources: tuple[EvidenceSource, ...] = (),
) -> AgentResponse:
    return AgentResponse(
        target="rag-agent",
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
            reference_facts=("Library opens at 08:00.", "Library closes at 22:00."),
            trace_expectation=TraceExpectation(
                selected_scope=HANDBOOK_SCOPE,
                retrieval_called=True,
            ),
        )
        execution = ExecutionResult(
            response=_response(
                sources=(_source(), _source(chunk_id="chunk-2", snippet="Closed on holidays."))
            ),
            observed_trace=ObservedTrace(
                selected_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
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
        self.assertEqual(projection.retrieved_context_ids, ("handbook:library", "handbook:library"))
        self.assertEqual(projection.reference_context_ids, ())
        self.assertEqual(projection.reference_contexts, ())
        self.assertEqual(projection.reference, "Library opens at 08:00.\nLibrary closes at 22:00.")
        self.assertEqual(projection.metadata["collection"], "student_rules")
        self.assertEqual(projection.metadata["expected_status"], "completed")
        self.assertEqual(projection.metadata["reference_fact_count"], 2)
        self.assertEqual(
            projection.metadata["projection_context_source"],
            "response.evidence.sources:statement_contexts",
        )

    def test_build_ragas_projection_uses_supporting_evidence_for_contexts_and_trace_for_counts(
        self,
    ) -> None:
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
        support_source = _source(
            chunk_id="chunk-support", snippet="Library hours are 08:00 to 22:00."
        )
        raw_background = _source(
            chunk_id="chunk-background",
            snippet="The library policy is interpreted by the student office.",
        )
        execution = ExecutionResult(
            response=_response(sources=(support_source,)),
            observed_trace=ObservedTrace(
                selected_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                retrieval_called=True,
                retrieved_sources=(support_source, raw_background),
                supporting_sources=(support_source,),
            ),
        )

        projection = build_ragas_projection(case, execution)

        self.assertEqual(projection.retrieved_contexts, ("Library hours are 08:00 to 22:00.",))
        self.assertEqual(
            projection.metadata["projection_context_source"],
            "observed_trace.supporting_sources:statement_contexts",
        )
        self.assertEqual(projection.metadata["retrieved_source_count"], 2)
        self.assertEqual(projection.metadata["supporting_source_count"], 1)

    def test_build_ragas_projection_falls_back_to_retrieved_sources_when_supporting_and_evidence_are_empty(
        self,
    ) -> None:
        case = GoldenCase(
            case_id="ragas-3",
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
        retrieved_source = _source(
            chunk_id="chunk-retrieved", snippet="Library hours are 08:00 to 22:00."
        )
        execution = ExecutionResult(
            response=_response(sources=()),
            observed_trace=ObservedTrace(
                selected_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                retrieval_called=True,
                retrieved_sources=(retrieved_source,),
                supporting_sources=(),
            ),
        )

        projection = build_ragas_projection(case, execution)

        self.assertEqual(projection.retrieved_contexts, ("Library hours are 08:00 to 22:00.",))
        self.assertEqual(
            projection.metadata["projection_context_source"],
            "observed_trace.retrieved_sources",
        )

    def test_build_ragas_projection_uses_statement_level_supporting_contexts_for_multiline_sources(
        self,
    ) -> None:
        case = GoldenCase(
            case_id="ragas-4",
            split="release_gate",
            source_type="expert_authored",
            user_goal="宿舍照明",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="completed",
            required_facts=("24:00", "6月1日至9月30日"),
            trace_expectation=TraceExpectation(
                selected_scope=HANDBOOK_SCOPE,
                retrieval_called=True,
            ),
        )
        support_source = _source(
            doc_id="handbook:lighting",
            chunk_id="chunk-lighting",
            snippet=(
                "中央民族大学关于学生宿舍照明的管理规定 / 一、时间安排\n"
                "文号：民大校发[2007]299号\n"
                "1. 10月至次年5月31日:\n"
                "亮灯时间: 周一至周五 每天早晨 5:30。\n"
                "熄灯时间: 周日至周四 每天晚上 24:00; 23:50 提示。\n"
                "每周五、周六晚上及复习考试期间不统一熄灯。\n"
                "2. 6月1日至9月30日,学生宿舍不统一熄灯。"
            ),
        )
        support_source = replace(
            support_source,
            source_title="中央民族大学关于学生宿舍照明的管理规定",
            detail_label="一、时间安排",
            content_role="time_rule",
            is_answer_bearing=True,
            structural_path=("一、时间安排",),
        )
        execution = ExecutionResult(
            response=_response(
                answer_text="根据学生手册相关规定，关于宿舍照明：亮灯时间: 周一至周五 每天早晨 5:30。；熄灯时间: 周日至周四 每天晚上 24:00; 23:50 提示。；每周五、周六晚上及复习考试期间不统一熄灯。；6月1日至9月30日,学生宿舍不统一熄灯。 [handbook:lighting#chunk-lighting]",
                sources=(support_source,),
            ),
            observed_trace=ObservedTrace(
                selected_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                retrieval_called=True,
                supporting_sources=(support_source,),
            ),
        )

        projection = build_ragas_projection(case, execution)

        self.assertEqual(len(projection.retrieved_contexts), 1)
        self.assertIn("中央民族大学关于学生宿舍照明的管理规定：", projection.retrieved_contexts[0])
        self.assertIn("24:00", projection.retrieved_contexts[0])
        self.assertIn("6月1日至9月30日", projection.retrieved_contexts[0])
        self.assertNotIn("文号：", projection.retrieved_contexts[0])

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
                selected_target="rag-agent",
                status="completed",
                answer_text="Library hours are 08:00 to 22:00.",
                confidence="high",
                result=RagResultPayload(
                    evidence=EvidenceBundle(
                        query_text="library hours",
                        corpus="regulations",
                        collection="student_rules",
                        sources=(_source(),),
                    )
                ),
            ),
            observed_trace=ObservedTrace(
                selected_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                retrieval_called=True,
                retrieved_sources=(_source(),),
                supporting_sources=(_source(),),
            ),
        )

        projection = build_ragas_projection(case, execution)

        self.assertEqual(projection.response, "Library hours are 08:00 to 22:00.")
        self.assertEqual(projection.metadata["response_status"], "completed")
        self.assertEqual(projection.metadata["retrieved_source_count"], 1)

    def test_build_ragas_projection_uses_case_reference_context_ids_and_contexts(self) -> None:
        case = GoldenCase(
            case_id="ragas-context-ids",
            split="release_gate",
            source_type="expert_authored",
            user_goal="学生证丢了怎么办",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="completed",
            required_facts=("学生证",),
            reference_facts=("学生应及时挂失。",),
            reference_context_ids=("handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",),
            reference_contexts=("学生应及时挂失。",),
        )
        support_source = _source(
            doc_id="handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",
            chunk_id="chunk-support",
            snippet="学生证遗失后，应及时到学院挂失。",
        )
        execution = ExecutionResult(
            response=_response(
                answer_text="应及时到学院挂失。",
                sources=(support_source,),
            ),
            observed_trace=ObservedTrace(
                selected_scope=HANDBOOK_SCOPE,
                retrieval_called=True,
                supporting_sources=(support_source,),
            ),
        )

        projection = build_ragas_projection(case, execution)

        self.assertEqual(
            projection.retrieved_context_ids,
            ("handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",),
        )
        self.assertEqual(
            projection.reference_context_ids,
            ("handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",),
        )
        self.assertEqual(projection.reference_contexts, ("学生应及时挂失。",))
        self.assertEqual(projection.metadata["reference_source_type"], "reference_context_ids")


class SupplementalRunnerTest(unittest.TestCase):
    def test_ragas_adapter_marks_case_level_overridden_metric_not_applicable(self) -> None:
        case = GoldenCase(
            case_id="supplemental-override",
            split="release_gate",
            source_type="expert_authored",
            user_goal="中央民族大学本科学生国家奖学金评审办法",
            actor=ActorContext(),
            scope=HANDBOOK_SCOPE,
            expected_status="completed",
            supplemental_metric_overrides={"answer_relevancy": False},
        )
        adapter = RagasSupplementalAdapter(
            scorer=lambda projection: self.fail(f"scorer should not run for {projection.case_id}"),
            metric_names=("answer_relevancy",),
        )

        results = adapter.evaluate(
            case,
            ExecutionResult(
                response=_response(sources=(_source(),)),
                observed_trace=ObservedTrace(
                    selected_scope=HANDBOOK_SCOPE,
                    retrieval_called=True,
                ),
            ),
        )

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].metric_name, "answer_relevancy")
        self.assertEqual(results[0].verdict, "not_applicable")
        self.assertEqual(results[0].metadata["metric_applicable"], False)

    def test_run_cases_attaches_supplemental_results_without_changing_deterministic_pass(
        self,
    ) -> None:
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
                    selected_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
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

    def test_failed_report_only_supplemental_result_does_not_flip_deterministic_verdict(
        self,
    ) -> None:
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
                    selected_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                    retrieval_called=True,
                ),
            ),
            supplemental_adapters=(adapter,),
        )

        self.assertEqual(report.passed, 1)
        self.assertEqual(report.by_supplemental["ragas.faithfulness"].verdict_counts["failed"], 1)
        self.assertTrue(report.results[0].passed)

    def test_run_cases_respects_case_workers_and_preserves_case_order(self) -> None:
        cases = tuple(
            GoldenCase(
                case_id=case_id,
                split="release_gate",
                source_type="expert_authored",
                user_goal=f"library hours {index}",
                actor=ActorContext(),
                scope=HANDBOOK_SCOPE,
                expected_status="completed",
                required_facts=("08:00",),
                trace_expectation=TraceExpectation(
                    selected_scope=HANDBOOK_SCOPE,
                    retrieval_called=True,
                ),
            )
            for index, case_id in enumerate(
                ("supplemental-parallel-1", "supplemental-parallel-2", "supplemental-parallel-3")
            )
        )
        sleep_by_case_id = {
            "supplemental-parallel-1": 0.08,
            "supplemental-parallel-2": 0.01,
            "supplemental-parallel-3": 0.01,
        }
        active_count = 0
        max_active_count = 0
        lock = Lock()

        def executor(case: GoldenCase) -> ExecutionResult:
            nonlocal active_count, max_active_count
            with lock:
                active_count += 1
                max_active_count = max(max_active_count, active_count)
            time.sleep(sleep_by_case_id[case.case_id])
            with lock:
                active_count -= 1
            return ExecutionResult(
                response=_response(sources=(_source(doc_id=f"handbook:{case.case_id}"),)),
                observed_trace=ObservedTrace(
                    selected_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                    retrieval_called=True,
                ),
            )

        report = run_cases(
            cases,
            executor=executor,
            case_workers=2,
        )

        self.assertEqual(report.passed, 3)
        self.assertGreaterEqual(max_active_count, 2)
        self.assertEqual(
            tuple(result.case_id for result in report.results),
            tuple(case.case_id for case in cases),
        )
