from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


class RagFirstStageSweepSuite(unittest.TestCase):
    def test_builds_sweep_report_candidate_artifacts(self) -> None:
        from campus_evals.rag_first_stage_sweep import build_rag_first_stage_parameter_sweep

        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            qrels_path = _write_qrels(root)
            candidate_path = root / "candidate.json"
            candidate_path.write_text(
                json.dumps(
                    {
                        "schema_version": "rag_first_stage_candidate_result.v1",
                        "surface_key": "regulations/student_rules",
                        "variant_id": "topk3-d20-s20",
                        "retrieval_top_k": 3,
                        "dense_prefetch_limit": 20,
                        "sparse_prefetch_limit": 20,
                        "rrf_k": 60,
                        "rrf_dense_weight": 1.0,
                        "rrf_sparse_weight": 1.0,
                        "reranker_enabled": False,
                        "cases": [
                            {
                                "case_id": "positive",
                                "status": "completed",
                                "latency_ms": 10,
                                "prefetch_sources": [
                                    {
                                        "rank": 1,
                                        "stage": "dense_prefetch",
                                        "doc_id": "doc-expected",
                                        "version_id": "v1",
                                        "chunk_id": "chunk-1",
                                        "score": 0.9,
                                    }
                                ],
                                "final_sources": [
                                    {
                                        "rank": 1,
                                        "stage": "rrf_final",
                                        "doc_id": "doc-expected",
                                        "version_id": "v1",
                                        "chunk_id": "chunk-1",
                                        "score": 0.9,
                                    }
                                ],
                            },
                            {
                                "case_id": "version-locked",
                                "status": "completed",
                                "latency_ms": 20,
                                "prefetch_sources": [],
                                "final_sources": [
                                    {
                                        "rank": 1,
                                        "stage": "rrf_final",
                                        "doc_id": "doc-versioned",
                                        "version_id": "wrong-version",
                                        "chunk_id": "chunk-2",
                                        "score": 0.7,
                                    }
                                ],
                            },
                            {
                                "case_id": "no-hit",
                                "status": "completed",
                                "latency_ms": 30,
                                "prefetch_sources": [],
                                "final_sources": [
                                    {
                                        "rank": 1,
                                        "stage": "rrf_final",
                                        "doc_id": "doc-noise",
                                        "version_id": None,
                                        "chunk_id": "chunk-3",
                                        "score": 0.6,
                                    }
                                ],
                            },
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            output_dir = root / "out"
            report = build_rag_first_stage_parameter_sweep(
                qrels_paths=(qrels_path,),
                candidate_paths=(candidate_path,),
                output_dir=output_dir,
                environment="staging",
                release="release-2026-06-19",
                source_git_head="abc123",
                dataset_run_id="dataset-run-001",
            )
            sweep_report = json.loads(
                (output_dir / "rag-first-stage-parameter-sweep.json").read_text(encoding="utf-8")
            )

        self.assertEqual(report["schema_version"], "rag_first_stage_parameter_sweep.v1")
        self.assertEqual(sweep_report["surfaces"][0]["surface_key"], "regulations/student_rules")
        candidate = sweep_report["surfaces"][0]["candidates"][0]
        self.assertEqual(candidate["case_count"], 3)
        self.assertEqual(candidate["metrics"]["retrieval.doc_hit_at_1"], 1.0)
        self.assertEqual(candidate["metrics"]["retrieval.no_hit_false_positive_rate"], 1.0)
        self.assertEqual(candidate["metrics"]["retrieval.wrong_version_hit_rate"], 0.5)
        self.assertEqual(candidate["metrics"]["retrieval.p95_latency_ms"], 30)
        self.assertEqual(candidate["recommended"], False)
        self.assertIn("no_hit_false_positive_rate_above_threshold", candidate["rejected_reasons"])
        self.assertFalse((output_dir / "langfuse-score-report.json").exists())

    def test_rejects_candidate_without_latency(self) -> None:
        from campus_evals.rag_first_stage_sweep import validate_rag_first_stage_candidate_result

        with self.assertRaisesRegex(ValueError, "latency_ms"):
            validate_rag_first_stage_candidate_result(
                {
                    "schema_version": "rag_first_stage_candidate_result.v1",
                    "surface_key": "regulations/student_rules",
                    "variant_id": "topk3-d20-s20",
                    "retrieval_top_k": 3,
                    "dense_prefetch_limit": 20,
                    "sparse_prefetch_limit": 20,
                    "rrf_k": 60,
                    "rrf_dense_weight": 1.0,
                    "rrf_sparse_weight": 1.0,
                    "reranker_enabled": False,
                    "cases": [
                        {
                            "case_id": "positive",
                            "status": "completed",
                            "prefetch_sources": [],
                            "final_sources": [],
                        }
                    ],
                }
            )


def _write_qrels(root: Path) -> Path:
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
                        "split": "release_gate",
                        "query": "命中正例",
                        "expected_sources": [
                            {"doc_id": "doc-expected", "version_id": "v1", "grade": 2}
                        ],
                    },
                    {
                        "case_id": "version-locked",
                        "split": "release_gate",
                        "query": "版本锁定",
                        "expected_sources": [
                            {
                                "doc_id": "doc-versioned",
                                "version_id": "expected-version",
                                "grade": 2,
                            }
                        ],
                    },
                    {
                        "case_id": "no-hit",
                        "split": "release_gate",
                        "query": "无答案",
                        "expected_sources": [],
                    },
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    return qrels_path


if __name__ == "__main__":
    unittest.main()
