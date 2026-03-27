from __future__ import annotations

from contextlib import redirect_stdout
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_contracts import EvidenceSource, KnowledgeScope
from campus_evals import (
    RetrievalBenchmarkRun,
    RetrievalCaseMetrics,
    RetrievalMetricSummary,
    RetrievalObservedSource,
    RetrievalQrelsCase,
    RetrievalQrelsDataset,
    RetrievalQrelsSourceRef,
    evaluate_retrieval_case,
    evaluate_retrieval_run,
    load_retrieval_benchmark_run,
    load_retrieval_qrels_dataset,
    render_retrieval_summary_text,
    summarize_retrieval_metrics,
)
from campus_evals.retrieval_benchmark import main as benchmark_main


FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "evals"
    / "fixtures"
    / "student_handbook_retrieval_qrels.json"
)
ANNOTATION_TEMPLATE_PATH = (
    Path(__file__).resolve().parents[2]
    / "packages"
    / "evals"
    / "fixtures"
    / "student_handbook_retrieval_annotation_template.json"
)


def _source(
    *,
    doc_id: str,
    version_id: str = "v1",
    chunk_id: str = "chunk-1",
) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id=version_id,
        chunk_id=chunk_id,
        anchor={"page": 1},
        acl_level="public",
        canonical_url=f"https://example.edu/{doc_id}",
        latest_url=f"https://example.edu/{doc_id}",
        source_channel="pdf_ocr",
        collection="student_handbook",
        is_current=False,
        snippet=f"Snippet for {doc_id}",
        score=0.91,
    )


class RetrievalQrelsFixtureTest(unittest.TestCase):
    def test_load_retrieval_qrels_dataset_reads_phase1_baseline(self) -> None:
        dataset = load_retrieval_qrels_dataset(FIXTURE_PATH)

        self.assertIsInstance(dataset, RetrievalQrelsDataset)
        self.assertEqual(dataset.schema_version, 1)
        self.assertEqual(dataset.scope, KnowledgeScope(corpus="regulations", collection="student_handbook"))
        self.assertEqual(dataset.baseline["dense_model"], "Qwen3-Embedding-4B")
        self.assertEqual(dataset.baseline["sparse_model"], "qdrant/bm25")
        self.assertEqual(dataset.baseline["fusion"], "rrf")
        self.assertGreaterEqual(len(dataset.cases), 18)

    def test_qrels_fixture_contains_doc_level_and_chunk_level_cases(self) -> None:
        dataset = load_retrieval_qrels_dataset(FIXTURE_PATH)

        case_ids = {case.case_id for case in dataset.cases}
        self.assertIn("article-number-degree-procedure", case_ids)
        self.assertIn("fixed-phrase-office-hours", case_ids)
        article_case = next(case for case in dataset.cases if case.case_id == "article-number-degree-procedure")
        fixed_phrase_case = next(case for case in dataset.cases if case.case_id == "fixed-phrase-office-hours")
        self.assertTrue(all(source.chunk_id is None for source in article_case.expected_sources))
        self.assertTrue(any(source.chunk_id is not None for source in fixed_phrase_case.expected_sources))

    def test_qrels_fixture_loads_request_overrides_for_acl_and_campus_cases(self) -> None:
        dataset = load_retrieval_qrels_dataset(FIXTURE_PATH)

        acl_case = next(case for case in dataset.cases if case.case_id == "acl-restricted-office-hours")
        campus_case = next(case for case in dataset.cases if case.case_id == "campus-scope-nansha-library")
        self.assertEqual(acl_case.request_overrides["acl_groups"], ["students"])
        self.assertEqual(campus_case.request_overrides["campus_scope"], "nansha")

    def test_annotation_template_exists_and_matches_qrels_case_count(self) -> None:
        template = json.loads(ANNOTATION_TEMPLATE_PATH.read_text(encoding="utf-8"))
        dataset = load_retrieval_qrels_dataset(FIXTURE_PATH)

        self.assertEqual(template["schema_version"], 1)
        self.assertEqual(template["corpus"], "regulations")
        self.assertEqual(template["collection"], "student_handbook")
        self.assertEqual(len(template["cases"]), len(dataset.cases))
        self.assertIn("instructions", template)


class RetrievalMetricsTest(unittest.TestCase):
    def test_evaluate_retrieval_case_supports_doc_level_matching(self) -> None:
        case = RetrievalQrelsCase(
            case_id="doc-level",
            split="smoke",
            query="library hours",
            scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
            expected_sources=(
                RetrievalQrelsSourceRef(doc_id="handbook:library", grade=2, rationale="main document"),
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
        self.assertFalse(metrics.forbidden_hit)

    def test_evaluate_retrieval_case_supports_version_and_chunk_level_matching(self) -> None:
        case = RetrievalQrelsCase(
            case_id="chunk-level",
            split="regression_locked",
            query="图书馆开放时间",
            scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
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

    def test_evaluate_retrieval_case_flags_forbidden_hits(self) -> None:
        case = RetrievalQrelsCase(
            case_id="forbidden",
            split="smoke",
            query="办公室值班时间",
            scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
            forbidden_sources=(
                RetrievalQrelsSourceRef(doc_id="handbook:restricted-office", grade=1, rationale="restricted"),
            ),
        )

        metrics = evaluate_retrieval_case(case, (_source(doc_id="handbook:restricted-office"),))

        self.assertEqual(metrics.hit_at_1, 0.0)
        self.assertEqual(metrics.recall_at_5, 0.0)
        self.assertEqual(metrics.precision_at_5, 0.0)
        self.assertEqual(metrics.mrr_at_5, 0.0)
        self.assertTrue(metrics.forbidden_hit)

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
        self.assertAlmostEqual(summary.forbidden_hit_rate, 0.5)
        self.assertIn("smoke", summary.by_split)
        self.assertAlmostEqual(summary.by_split["smoke"].mrr_at_5, 0.75)

    def test_evaluate_retrieval_run_defaults_missing_cases_to_zero_metrics(self) -> None:
        dataset = RetrievalQrelsDataset(
            schema_version=1,
            scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
            baseline={},
            cases=(
                RetrievalQrelsCase(
                    case_id="missing-case",
                    split="smoke",
                    query="library hours",
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook"),
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


class RetrievalBenchmarkCliTest(unittest.TestCase):
    def test_load_retrieval_benchmark_run_reads_observed_sources(self) -> None:
        with TemporaryDirectory() as temp_dir:
            run_path = Path(temp_dir) / "run.json"
            run_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "cases": [
                            {
                                "case_id": "case-1",
                                "retrieved_sources": [
                                    {
                                        "doc_id": "handbook:library",
                                        "version_id": "v1",
                                        "chunk_id": "chunk-1",
                                        "score": 0.9
                                    }
                                ]
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )

            run = load_retrieval_benchmark_run(run_path)

        self.assertIsInstance(run, RetrievalBenchmarkRun)
        self.assertEqual(run.schema_version, 1)
        self.assertEqual(run.cases[0].retrieved_sources[0], RetrievalObservedSource("handbook:library", "v1", "chunk-1", 0.9))

    def test_render_retrieval_summary_text_prints_expected_metrics(self) -> None:
        text = render_retrieval_summary_text(
            RetrievalMetricSummary(
                total_cases=2,
                hit_at_1=0.5,
                hit_at_3=1.0,
                recall_at_5=0.75,
                precision_at_5=0.375,
                mrr_at_5=0.75,
                forbidden_hit_rate=0.5,
                by_split={},
            )
        )

        self.assertIn("Retrieval Benchmark Summary", text)
        self.assertIn("hit@1: 0.500", text)
        self.assertIn("mrr@5: 0.750", text)

    def test_benchmark_main_supports_text_and_json_output(self) -> None:
        with TemporaryDirectory() as temp_dir:
            qrels_path = Path(temp_dir) / "qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "case-1",
                                "split": "smoke",
                                "query": "library hours",
                                "expected_sources": [{"doc_id": "handbook:library", "grade": 2}]
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )
            run_path = Path(temp_dir) / "run.json"
            run_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "cases": [
                            {
                                "case_id": "case-1",
                                "retrieved_sources": [{"doc_id": "handbook:library", "score": 0.9}]
                            }
                        ]
                    }
                ),
                encoding="utf-8",
            )

            text_buffer = io.StringIO()
            with redirect_stdout(text_buffer):
                exit_code = benchmark_main(["--qrels", str(qrels_path), "--results", str(run_path)])
            json_buffer = io.StringIO()
            with redirect_stdout(json_buffer):
                json_exit_code = benchmark_main(
                    ["--qrels", str(qrels_path), "--results", str(run_path), "--format", "json"]
                )

        self.assertEqual(exit_code, 0)
        self.assertEqual(json_exit_code, 0)
        self.assertIn("Retrieval Benchmark Summary", text_buffer.getvalue())
        self.assertEqual(json.loads(json_buffer.getvalue())["hit_at_1"], 1.0)


if __name__ == "__main__":
    unittest.main()
