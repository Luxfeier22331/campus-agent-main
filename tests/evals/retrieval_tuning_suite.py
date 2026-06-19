from __future__ import annotations

from campus_evals.benchmark import (
    RetrievalTuningReport,
    build_retrieval_tuning_report,
    default_query_enabled_retrieval_qrels_paths,
    resolve_retrieval_fixture_manifest_path,
    validate_retrieval_qrels_fixture,
)
from campus_evals.langfuse_score_report import validate_langfuse_score_report
from campus_evals.retrieval_tuning import main as tuning_main

from tests.evals.retrieval_benchmark_test_support import (
    KnowledgeScope,
    Path,
    TemporaryDirectory,
    io,
    json,
    redirect_stdout,
    unittest,
)


class RetrievalTuningReportTest(unittest.TestCase):
    def test_default_query_enabled_collections_have_qrels_fixtures(self) -> None:
        paths = default_query_enabled_retrieval_qrels_paths()

        self.assertEqual(
            set(paths),
            {
                "regulations/student_rules",
                "regulations/institutional_rules",
                "curriculum/curriculum_plan",
                "official_web/stable_reference",
            },
        )
        for fixture_path in paths.values():
            self.assertTrue(fixture_path.exists(), fixture_path)
            self.assertEqual(
                validate_retrieval_qrels_fixture(
                    fixture_path,
                    manifest_path=resolve_retrieval_fixture_manifest_path(fixture_path),
                    ambiguity_severity="error",
                ),
                (),
            )

    def test_build_retrieval_tuning_report_recommends_best_passing_candidate(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            qrels_path = root / "qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "positive",
                                "split": "smoke",
                                "query": "校园卡丢了怎么办",
                                "expected_sources": [
                                    {
                                        "doc_id": "handbook:card",
                                        "version_id": "v1",
                                        "grade": 2,
                                    }
                                ],
                            },
                            {
                                "case_id": "no-hit",
                                "split": "smoke",
                                "query": "校内宇宙签证办理处",
                                "expected_sources": [],
                            },
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            manifest_path = root / "manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "documents": [
                            {
                                "document_id": "handbook:card",
                                "title": "中央民族大学本科(预科)学生证管理办法",
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            runtime_profile_path = root / "runtime-profile.json"
            runtime_profile_path.write_text(
                json.dumps(
                    {
                        "dense_prefetch_limit": 20,
                        "sparse_prefetch_limit": 20,
                        "rrf_k": 60,
                        "rrf_dense_weight": 1.0,
                        "rrf_sparse_weight": 1.0,
                        "no_hit_min_top_score": 0.6,
                        "no_hit_min_score_gap": 0.1,
                    }
                ),
                encoding="utf-8",
            )
            baseline_path = root / "baseline.json"
            baseline_path.write_text(
                json.dumps(
                    {
                        "schema_version": "retrieval-tuning-candidate-run-v1",
                        "candidate_id": "baseline",
                        "profile": {
                            "dense_prefetch_limit": 20,
                            "sparse_prefetch_limit": 20,
                            "rrf_k": 60,
                            "rrf_dense_weight": 1.0,
                            "rrf_sparse_weight": 1.0,
                            "no_hit_min_top_score": 0.6,
                            "no_hit_min_score_gap": 0.1,
                        },
                        "cases": [
                            {
                                "case_id": "positive",
                                "retrieved_sources": [
                                    {
                                        "doc_id": "handbook:other",
                                        "version_id": "v1",
                                        "score": 0.91,
                                    }
                                ],
                            },
                            {
                                "case_id": "no-hit",
                                "retrieved_sources": [
                                    {
                                        "doc_id": "handbook:other",
                                        "version_id": "v1",
                                        "score": 0.88,
                                    }
                                ],
                            },
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            tuned_path = root / "balanced.json"
            tuned_path.write_text(
                json.dumps(
                    {
                        "schema_version": "retrieval-tuning-candidate-run-v1",
                        "candidate_id": "balanced",
                        "profile": {
                            "dense_prefetch_limit": 30,
                            "sparse_prefetch_limit": 30,
                            "rrf_k": 60,
                            "rrf_dense_weight": 1.0,
                            "rrf_sparse_weight": 1.2,
                            "no_hit_min_top_score": 0.72,
                            "no_hit_min_score_gap": 0.12,
                        },
                        "cases": [
                            {
                                "case_id": "positive",
                                "retrieved_sources": [
                                    {
                                        "doc_id": "handbook:card",
                                        "version_id": "v1",
                                        "score": 0.93,
                                    }
                                ],
                            },
                            {"case_id": "no-hit", "retrieved_sources": []},
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            report = build_retrieval_tuning_report(
                qrels_path=qrels_path,
                candidate_paths=(baseline_path, tuned_path),
                manifest_path=manifest_path,
                runtime_profile_path=runtime_profile_path,
            )

        self.assertIsInstance(report, RetrievalTuningReport)
        self.assertEqual(
            report.scope, KnowledgeScope(corpus="regulations", collection="student_rules")
        )
        self.assertEqual(report.recommended_candidate_id, "balanced")
        self.assertEqual(
            report.recommended_profile_patch,
            {
                "dense_prefetch_limit": 30,
                "sparse_prefetch_limit": 30,
                "rrf_sparse_weight": 1.2,
                "no_hit_min_top_score": 0.72,
                "no_hit_min_score_gap": 0.12,
            },
        )
        self.assertEqual(report.candidates[0].gate_status, "fail")
        self.assertIn("hit_at_3_below_threshold", report.candidates[0].gate_reasons)
        self.assertEqual(report.candidates[1].gate_status, "pass")
        self.assertEqual(report.candidates[1].no_hit_success_rate, 1.0)
        self.assertEqual(report.candidates[1].version_locked_recall_at_5, 1.0)

    def test_tuning_cli_writes_json_report(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            qrels_path = root / "qrels.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "official_web",
                        "collection": "stable_reference",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "school-profile",
                                "split": "smoke",
                                "query": "学校简介",
                                "expected_sources": [
                                    {"doc_id": "official_web:school-profile", "grade": 2}
                                ],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            manifest_path = root / "manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "documents": [
                            {"document_id": "official_web:school-profile", "title": "学校简介"}
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            candidate_path = root / "candidate.json"
            candidate_path.write_text(
                json.dumps(
                    {
                        "schema_version": "retrieval-tuning-candidate-run-v1",
                        "candidate_id": "baseline",
                        "profile": {"dense_prefetch_limit": 20, "sparse_prefetch_limit": 20},
                        "cases": [
                            {
                                "case_id": "school-profile",
                                "retrieved_sources": [{"doc_id": "official_web:school-profile"}],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            output_path = root / "report.json"
            score_report_path = root / "langfuse-score-report.json"

            stdout_buffer = io.StringIO()
            with redirect_stdout(stdout_buffer):
                exit_code = tuning_main(
                    [
                        "--qrels",
                        str(qrels_path),
                        "--manifest",
                        str(manifest_path),
                        "--candidate",
                        str(candidate_path),
                        "--output",
                        str(output_path),
                        "--langfuse-score-report",
                        str(score_report_path),
                        "--langfuse-environment",
                        "staging",
                        "--langfuse-release",
                        "retrieval-tuning@2026-06-19",
                        "--source-git-head",
                        "git-head-001",
                        "--dataset-run-id",
                        "dataset-run-001",
                        "--format",
                        "json",
                    ]
                )
            report_payload = json.loads(output_path.read_text(encoding="utf-8"))
            score_report_payload = json.loads(score_report_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(
            json.loads(stdout_buffer.getvalue())["recommended_candidate_id"], "baseline"
        )
        self.assertEqual(report_payload["schema_version"], "retrieval-tuning-report-v1")
        self.assertEqual(report_payload["recommended_candidate_id"], "baseline")
        self.assertEqual(report_payload["candidates"][0]["gate_status"], "pass")
        self.assertEqual(score_report_payload["schema_version"], "langfuse_score_report.v1")
        self.assertEqual(score_report_payload["eval_kind"], "rag_first_stage_parameter_sweep")
        self.assertEqual(score_report_payload["profile_id"], "rag-first-stage-parameter-sweep")
        self.assertEqual(score_report_payload["surface_key"], "official_web/stable_reference")
        self.assertEqual(score_report_payload["expected_publish_denominator"], 4)
        validate_langfuse_score_report(score_report_payload)

    def test_builds_langfuse_score_report_from_retrieval_tuning_report(self) -> None:
        from campus_evals.langfuse_score_report import (
            build_score_report_from_retrieval_tuning_report,
        )

        score_report = build_score_report_from_retrieval_tuning_report(
            tuning_report_payload={
                "schema_version": "retrieval-tuning-report-v1",
                "scope": {"corpus": "regulations", "collection": "student_rules"},
                "case_count": 2,
                "recommended_candidate_id": "balanced",
                "candidates": [
                    {
                        "candidate_id": "balanced",
                        "profile": {"retrieval_top_k": 5},
                        "metrics": {
                            "doc_hit_at_1": 1.0,
                            "doc_hit_at_3": 1.0,
                            "doc_recall_at_5": 1.0,
                            "forbidden_hit_rate": 0.0,
                        },
                    }
                ],
            },
            tuning_report_path=Path("/tmp/retrieval-tuning-report.json"),
            environment="staging",
            release="retrieval-tuning@2026-06-19",
            source_git_head="git-head-001",
            dataset_run_id="dataset-run-001",
        )

        self.assertEqual(score_report["eval_kind"], "rag_first_stage_parameter_sweep")
        self.assertEqual(score_report["source_result_denominator"], 4)
        self.assertEqual(score_report["expected_publish_denominator"], 4)
        self.assertEqual(
            {item["name"] for item in score_report["score_items"]},
            {
                "retrieval.doc_hit_at_1",
                "retrieval.doc_hit_at_3",
                "retrieval.doc_recall_at_k",
                "retrieval.forbidden_hit_rate",
            },
        )
        self.assertEqual(
            {item["dataset_run_id"] for item in score_report["score_items"]},
            {"dataset-run-001"},
        )
        self.assertEqual(
            {item["trace_id"] for item in score_report["score_items"]},
            {None},
        )
        validate_langfuse_score_report(score_report)


if __name__ == "__main__":
    unittest.main()
