from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from campus_contracts import ActorContext, EvidenceBundle, EvidenceSource, KnowledgeScope, RagRequestPayload, RagResultPayload, SpecialistResponse
from campus_evals import ExecutionResult, GoldenCase, TraceExpectation
from campus_evals.handbook_live_benchmark import build_default_output_dir, build_handbook_live_executor, main


HANDBOOK_SCOPE = KnowledgeScope(corpus="regulations", collection="student_handbook")


def _source(doc_id: str, *, chunk_id: str = "chunk-1", score: float = 0.9) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id="v1",
        chunk_id=chunk_id,
        anchor={"page": 1},
        acl_level="public",
        canonical_url=f"https://example.edu/{doc_id}",
        latest_url=f"https://example.edu/{doc_id}",
        source_channel="pdf_ocr",
        collection="student_handbook",
        is_current=True,
        snippet=f"snippet for {doc_id}",
        score=score,
        source_title=doc_id,
    )


def _case(*, case_id: str = "release-gate-student-card", user_goal: str = "学生证丢了怎么办") -> GoldenCase:
    return GoldenCase(
        case_id=case_id,
        split="release_gate",
        source_type="expert_authored",
        user_goal=user_goal,
        actor=ActorContext(),
        scope=HANDBOOK_SCOPE,
        expected_status="completed",
        trace_expectation=TraceExpectation(
            selected_scope=HANDBOOK_SCOPE,
            retrieval_called=True,
            clarification_expected=False,
            error_expected=False,
        ),
    )


class HandbookLiveExecutorTest(unittest.TestCase):
    def test_build_handbook_live_executor_captures_retrieved_and_supporting_sources(self) -> None:
        retrieved_bundle = EvidenceBundle(
            query_text="学生证丢了怎么办",
            corpus="regulations",
            collection="student_handbook",
            sources=(
                _source("handbook:e90f9707387f9e232ea88ce1c7f5328242e52389", chunk_id="chunk-a", score=0.97),
                _source("handbook:background", chunk_id="chunk-b", score=0.73),
            ),
        )
        supporting_source = retrieved_bundle.sources[0]
        seen_requests = []

        def fake_delegate(request, *, retriever):
            seen_requests.append(request)
            bundle = retriever(
                request.user_goal,
                corpus=request.payload.scope.corpus,
                collection=request.payload.scope.collection,
                campus_scope=request.actor.campus_scope,
                acl_groups=request.actor.groups,
                personalization_hint=None,
            )
            self.assertEqual(bundle, retrieved_bundle)
            return SpecialistResponse(
                target="rag-specialist",
                status="completed",
                answer_text="学生证遗失后应补办学生证。",
                confidence="high",
                result=RagResultPayload(
                    evidence=EvidenceBundle(
                        query_text=request.user_goal,
                        corpus=bundle.corpus,
                        collection=bundle.collection,
                        sources=(supporting_source,),
                    )
                ),
            )

        executor = build_handbook_live_executor(
            retriever=lambda *args, **kwargs: retrieved_bundle,
            delegate=fake_delegate,
        )

        result = executor(_case())

        self.assertIsInstance(result, ExecutionResult)
        self.assertEqual(len(seen_requests), 1)
        self.assertEqual(seen_requests[0].payload, RagRequestPayload(scope=HANDBOOK_SCOPE))
        self.assertEqual(result.observed_trace.selected_scope, HANDBOOK_SCOPE)
        self.assertTrue(result.observed_trace.retrieval_called)
        self.assertFalse(result.observed_trace.clarification_emitted)
        self.assertFalse(result.observed_trace.error_path)
        self.assertEqual(result.observed_trace.retrieved_sources, retrieved_bundle.sources)
        self.assertEqual(result.observed_trace.supporting_sources, (supporting_source,))

    def test_build_handbook_live_executor_marks_pre_retrieval_clarification(self) -> None:
        def fake_delegate(request, *, retriever):
            del retriever
            return SpecialistResponse(
                target="rag-specialist",
                status="needs_clarification",
                follow_up_question="请说明你想咨询哪一类奖学金。",
                confidence="low",
                result=RagResultPayload(
                    evidence=EvidenceBundle(
                        query_text=request.user_goal,
                        corpus="regulations",
                        collection="student_handbook",
                    )
                ),
            )

        executor = build_handbook_live_executor(
            retriever=lambda *args, **kwargs: self.fail("retriever should not be called"),
            delegate=fake_delegate,
        )

        result = executor(
            _case(
                case_id="release-gate-needs-clarification",
                user_goal="奖学金怎么申请？",
            )
        )

        self.assertFalse(result.observed_trace.retrieval_called)
        self.assertTrue(result.observed_trace.clarification_emitted)
        self.assertFalse(result.observed_trace.error_path)
        self.assertEqual(result.observed_trace.retrieved_sources, ())
        self.assertEqual(result.observed_trace.supporting_sources, ())


class HandbookLiveBenchmarkCliTest(unittest.TestCase):
    def test_build_default_output_dir_uses_timestamped_eval_directory(self) -> None:
        path = build_default_output_dir(prefix="student-handbook-formal-benchmark", timestamp="20260329T123456")
        self.assertEqual(path, Path(".tmp/evals/student-handbook-formal-benchmark-20260329T123456"))

    def test_main_runs_formal_benchmark_with_live_executor_and_default_output_dir(self) -> None:
        case = _case()
        adapters = (object(),)

        with TemporaryDirectory() as tmpdir:
            expected_output_dir = Path(tmpdir) / "student-handbook-formal-benchmark-20260329T123456"
            with (
                patch("campus_evals.handbook_live_benchmark.handbook_release_gate_cases", return_value=(case,)),
                patch(
                    "campus_evals.handbook_live_benchmark.build_default_handbook_supplemental_adapters_from_env",
                    return_value=adapters,
                ),
                patch(
                    "campus_evals.handbook_live_benchmark.build_default_output_dir",
                    return_value=expected_output_dir,
                ),
                patch("campus_evals.handbook_live_benchmark.build_handbook_live_executor", return_value="executor"),
                patch("campus_evals.handbook_live_benchmark.run_handbook_formal_benchmark") as run_benchmark,
            ):
                exit_code = main(["run", "--reruns", "3"])

        self.assertEqual(exit_code, 0)
        run_benchmark.assert_called_once_with(
            cases=(case,),
            executor="executor",
            supplemental_adapters=adapters,
            output_dir=expected_output_dir,
            reruns=3,
        )

    def test_main_runs_repair_against_existing_benchmark_dir(self) -> None:
        case = _case()
        adapters = (object(),)

        with TemporaryDirectory() as tmpdir:
            benchmark_dir = Path(tmpdir) / "existing-benchmark"
            benchmark_dir.mkdir()
            expected_output_dir = Path(tmpdir) / "student-handbook-formal-benchmark-repair-20260329T123456"
            with (
                patch("campus_evals.handbook_live_benchmark.handbook_release_gate_cases", return_value=(case,)),
                patch(
                    "campus_evals.handbook_live_benchmark.build_default_handbook_supplemental_adapters_from_env",
                    return_value=adapters,
                ),
                patch(
                    "campus_evals.handbook_live_benchmark.build_default_output_dir",
                    return_value=expected_output_dir,
                ),
                patch("campus_evals.handbook_live_benchmark.build_handbook_live_executor", return_value="executor"),
                patch("campus_evals.handbook_live_benchmark.repair_handbook_formal_benchmark") as repair_benchmark,
            ):
                exit_code = main(["repair", "--benchmark-dir", str(benchmark_dir)])

        self.assertEqual(exit_code, 0)
        repair_benchmark.assert_called_once_with(
            cases=(case,),
            executor="executor",
            supplemental_adapters=adapters,
            benchmark_dir=benchmark_dir,
            output_dir=expected_output_dir,
        )

    def test_main_runs_acceptance_against_live_chain(self) -> None:
        case = _case()

        with TemporaryDirectory() as tmpdir:
            expected_output_dir = Path(tmpdir) / "student-handbook-formal-benchmark-accept-20260329T123456"
            with (
                patch("campus_evals.handbook_live_benchmark.handbook_release_gate_cases", return_value=(case,)),
                patch(
                    "campus_evals.handbook_live_benchmark.build_default_output_dir",
                    return_value=expected_output_dir,
                ),
                patch("campus_evals.handbook_live_benchmark.accept_live_benchmark_profile") as accept_benchmark,
            ):
                exit_code = main(["accept", "--reruns", "3"])

        self.assertEqual(exit_code, 0)
        accept_benchmark.assert_called_once()
        self.assertEqual(accept_benchmark.call_args.kwargs["output_dir"], expected_output_dir)
        self.assertEqual(accept_benchmark.call_args.kwargs["reruns"], 3)
