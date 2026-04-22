from __future__ import annotations

from tests.evals.retrieval_benchmark_test_support import (
    KnowledgeScope,
    RetrievalBenchmarkRun,
    RetrievalCaseMetrics,
    RetrievalMetricSummary,
    RetrievalQrelsCase,
    RetrievalQrelsDataset,
    RetrievalQrelsSourceRef,
    _source,
    evaluate_retrieval_case,
    evaluate_retrieval_run,
    summarize_retrieval_metrics,
    unittest,
)


class RetrievalMetricsTest(unittest.TestCase):
    def test_evaluate_retrieval_case_supports_doc_level_matching(self) -> None:
        case = RetrievalQrelsCase(
            case_id="doc-level",
            split="smoke",
            query="library hours",
            scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            expected_sources=(
                RetrievalQrelsSourceRef(
                    doc_id="handbook:library", grade=2, rationale="main document"
                ),
            ),
        )

        metrics = evaluate_retrieval_case(
            case,
            (
                _source(doc_id="handbook:library", version_id="v7", chunk_id="chunk-42"),
                _source(doc_id="handbook:other", version_id="v1", chunk_id="chunk-2"),
            ),
        )

        self.assertEqual(metrics.hit_at_1, 1.0)
        self.assertEqual(metrics.hit_at_3, 1.0)
        self.assertEqual(metrics.recall_at_5, 1.0)
        self.assertEqual(metrics.precision_at_5, 0.5)
        self.assertEqual(metrics.mrr_at_5, 1.0)
        self.assertEqual(metrics.doc_hit_at_1, 1.0)
        self.assertEqual(metrics.doc_hit_at_3, 1.0)
        self.assertEqual(metrics.doc_recall_at_5, 1.0)
        self.assertEqual(metrics.doc_precision_at_5, 0.5)
        self.assertEqual(metrics.doc_mrr_at_5, 1.0)
        self.assertFalse(metrics.forbidden_hit)

    def test_evaluate_retrieval_case_supports_version_and_chunk_level_matching(self) -> None:
        case = RetrievalQrelsCase(
            case_id="chunk-level",
            split="regression_locked",
            query="图书馆开放时间",
            scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            expected_sources=(
                RetrievalQrelsSourceRef(
                    doc_id="handbook:library",
                    version_id="v2",
                    chunk_id="chunk-hours",
                    grade=2,
                    rationale="exact phrase chunk",
                ),
            ),
        )

        metrics = evaluate_retrieval_case(
            case,
            (
                _source(doc_id="handbook:library", version_id="v2", chunk_id="chunk-other"),
                _source(doc_id="handbook:library", version_id="v2", chunk_id="chunk-hours"),
            ),
        )

        self.assertEqual(metrics.hit_at_1, 0.0)
        self.assertEqual(metrics.hit_at_3, 1.0)
        self.assertEqual(metrics.recall_at_5, 1.0)
        self.assertEqual(metrics.precision_at_5, 0.5)
        self.assertEqual(metrics.mrr_at_5, 0.5)
        self.assertEqual(metrics.doc_hit_at_1, 1.0)
        self.assertEqual(metrics.doc_hit_at_3, 1.0)
        self.assertEqual(metrics.doc_recall_at_5, 1.0)
        self.assertEqual(metrics.doc_precision_at_5, 1.0)
        self.assertEqual(metrics.doc_mrr_at_5, 1.0)

    def test_evaluate_retrieval_case_flags_forbidden_hits(self) -> None:
        case = RetrievalQrelsCase(
            case_id="forbidden",
            split="smoke",
            query="办公室值班时间",
            scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            forbidden_sources=(
                RetrievalQrelsSourceRef(
                    doc_id="handbook:restricted-office", grade=1, rationale="restricted"
                ),
            ),
        )

        metrics = evaluate_retrieval_case(case, (_source(doc_id="handbook:restricted-office"),))

        self.assertEqual(metrics.hit_at_1, 0.0)
        self.assertEqual(metrics.recall_at_5, 0.0)
        self.assertEqual(metrics.precision_at_5, 0.0)
        self.assertEqual(metrics.mrr_at_5, 0.0)
        self.assertEqual(metrics.doc_hit_at_1, 0.0)
        self.assertEqual(metrics.doc_recall_at_5, 0.0)
        self.assertEqual(metrics.doc_precision_at_5, 0.0)
        self.assertEqual(metrics.doc_mrr_at_5, 0.0)
        self.assertTrue(metrics.forbidden_hit)

    def test_evaluate_retrieval_case_treats_empty_expectation_as_no_hit_contract(self) -> None:
        case = RetrievalQrelsCase(
            case_id="no-hit",
            split="smoke",
            query="校内宇宙签证办理处",
            scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
        )

        empty_metrics = evaluate_retrieval_case(case, ())
        noisy_metrics = evaluate_retrieval_case(case, (_source(doc_id="handbook:loan"),))

        self.assertEqual(empty_metrics.hit_at_1, 1.0)
        self.assertEqual(empty_metrics.hit_at_3, 1.0)
        self.assertEqual(empty_metrics.recall_at_5, 1.0)
        self.assertEqual(empty_metrics.precision_at_5, 1.0)
        self.assertEqual(empty_metrics.mrr_at_5, 1.0)
        self.assertEqual(empty_metrics.doc_hit_at_1, 1.0)
        self.assertEqual(empty_metrics.doc_recall_at_5, 1.0)
        self.assertEqual(empty_metrics.doc_precision_at_5, 1.0)
        self.assertEqual(empty_metrics.doc_mrr_at_5, 1.0)
        self.assertEqual(noisy_metrics.hit_at_1, 0.0)
        self.assertEqual(noisy_metrics.recall_at_5, 0.0)
        self.assertEqual(noisy_metrics.mrr_at_5, 0.0)

    def test_summarize_retrieval_metrics_aggregates_over_cases(self) -> None:
        metrics = (
            RetrievalCaseMetrics(
                case_id="case-1",
                split="smoke",
                hit_at_1=1.0,
                hit_at_3=1.0,
                recall_at_5=1.0,
                precision_at_5=0.5,
                mrr_at_5=1.0,
                doc_hit_at_1=1.0,
                doc_hit_at_3=1.0,
                doc_recall_at_5=1.0,
                doc_precision_at_5=0.5,
                doc_mrr_at_5=1.0,
                forbidden_hit=False,
            ),
            RetrievalCaseMetrics(
                case_id="case-2",
                split="smoke",
                hit_at_1=0.0,
                hit_at_3=1.0,
                recall_at_5=0.5,
                precision_at_5=0.25,
                mrr_at_5=0.5,
                doc_hit_at_1=0.0,
                doc_hit_at_3=1.0,
                doc_recall_at_5=1.0,
                doc_precision_at_5=0.5,
                doc_mrr_at_5=0.5,
                forbidden_hit=True,
            ),
        )

        summary = summarize_retrieval_metrics(metrics)

        self.assertIsInstance(summary, RetrievalMetricSummary)
        self.assertEqual(summary.total_cases, 2)
        self.assertAlmostEqual(summary.hit_at_1, 0.5)
        self.assertAlmostEqual(summary.hit_at_3, 1.0)
        self.assertAlmostEqual(summary.recall_at_5, 0.75)
        self.assertAlmostEqual(summary.precision_at_5, 0.375)
        self.assertAlmostEqual(summary.mrr_at_5, 0.75)
        self.assertAlmostEqual(summary.doc_hit_at_1, 0.5)
        self.assertAlmostEqual(summary.doc_hit_at_3, 1.0)
        self.assertAlmostEqual(summary.doc_recall_at_5, 1.0)
        self.assertAlmostEqual(summary.doc_precision_at_5, 0.5)
        self.assertAlmostEqual(summary.doc_mrr_at_5, 0.75)
        self.assertAlmostEqual(summary.forbidden_hit_rate, 0.5)
        self.assertIn("smoke", summary.by_split)
        self.assertAlmostEqual(summary.by_split["smoke"].mrr_at_5, 0.75)

    def test_evaluate_retrieval_run_defaults_missing_cases_to_zero_metrics(self) -> None:
        dataset = RetrievalQrelsDataset(
            schema_version=1,
            scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            baseline={},
            cases=(
                RetrievalQrelsCase(
                    case_id="missing-case",
                    split="smoke",
                    query="library hours",
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                    expected_sources=(RetrievalQrelsSourceRef(doc_id="handbook:library", grade=2),),
                ),
            ),
        )
        run = RetrievalBenchmarkRun(schema_version=1, cases=())

        metrics = evaluate_retrieval_run(dataset, run)

        self.assertEqual(len(metrics), 1)
        self.assertEqual(metrics[0].hit_at_1, 0.0)
        self.assertEqual(metrics[0].recall_at_5, 0.0)
        self.assertEqual(metrics[0].mrr_at_5, 0.0)
