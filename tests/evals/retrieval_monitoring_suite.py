from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.retrieval_monitoring import (
    build_retrieval_monitoring_backlog,
    load_retrieval_runtime_observations_jsonl,
    retrieval_monitoring_backlog_to_dict,
)
from campus_evals.retrieval_monitoring_cli import main as monitoring_main

from tests.evals.retrieval_benchmark_test_support import unittest


class RetrievalMonitoringBacklogTest(unittest.TestCase):
    def test_builds_candidate_qrels_backlog_from_runtime_observations(self) -> None:
        report = build_retrieval_monitoring_backlog(
            observations=[
                {
                    "request_id": "req-no-hit",
                    "query": "校内宇宙签证办理处",
                    "query_sha256": "query-hash-no-hit",
                    "scope": {"corpus": "official_web", "collection": "stable_reference"},
                    "terminal_state": "completed",
                    "candidate_count": 0,
                    "top_score": None,
                },
                {
                    "request_id": "req-low-score",
                    "query_sha256": "query-hash-low-score",
                    "scope": {"corpus": "regulations", "collection": "student_rules"},
                    "terminal_state": "completed",
                    "candidate_count": 3,
                    "top_score": 0.41,
                    "score_gap": 0.02,
                },
                {
                    "request_id": "req-drift",
                    "query": "学士学位授予规定",
                    "scope": {"corpus": "regulations", "collection": "student_rules"},
                    "terminal_state": "failed_closed",
                    "failure_kind": "release_metadata_drift",
                    "candidate_count": 0,
                },
            ],
            low_score_threshold=0.6,
            low_score_gap_threshold=0.1,
        )

        self.assertEqual(report.observation_count, 3)
        self.assertEqual(report.candidate_count, 3)
        self.assertEqual(
            [candidate.failure_class for candidate in report.candidates],
            ["no_hit", "low_confidence", "drift_guard_failure"],
        )
        self.assertEqual(report.candidates[0].recommended_action, "qrels_no_hit_candidate")
        self.assertEqual(report.candidates[1].query, "")
        self.assertEqual(report.candidates[1].query_sha256, "query-hash-low-score")
        self.assertEqual(report.candidates[2].recommended_action, "release_metadata_repair")

    def test_build_retrieval_monitoring_backlog_classifies_reranker_degraded(
        self,
    ) -> None:
        report = build_retrieval_monitoring_backlog(
            observations=[
                {
                    "request_id": "req-reranker",
                    "query_sha256": "abc123",
                    "scope": {"corpus": "regulations", "collection": "student_rules"},
                    "candidate_count": 3,
                    "failure_kind": "reranker_degraded",
                    "reranker_degraded": True,
                }
            ],
            low_score_threshold=0.6,
            low_score_gap_threshold=0.1,
        )

        self.assertEqual(report.candidate_count, 1)
        self.assertEqual(report.candidates[0].failure_class, "reranker_degraded")
        self.assertEqual(report.candidates[0].recommended_action, "reranker_gate_review")

    def test_loads_sanitized_runtime_observation_jsonl_for_backlog_export(self) -> None:
        with TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "observations.jsonl"
            path.write_text(
                "\n".join(
                    [
                        json.dumps(
                            {
                                "request_id": "req-low-score",
                                "timestamp": "2026-05-01T00:00:00+00:00",
                                "query_sha256": "query-hash-low-score",
                                "scope": {
                                    "corpus": "regulations",
                                    "collection": "student_rules",
                                },
                                "terminal_state": "completed",
                                "candidate_count": 3,
                                "top_score": 0.41,
                                "score_gap": 0.02,
                                "release_id": "r20260501",
                                "profile_hash": "profile-hash",
                            }
                        )
                    ]
                )
                + "\n",
                encoding="utf-8",
            )

            observations = load_retrieval_runtime_observations_jsonl(path)
            report = build_retrieval_monitoring_backlog(
                observations=observations,
                low_score_threshold=0.6,
                low_score_gap_threshold=0.1,
            )
            payload = retrieval_monitoring_backlog_to_dict(report)

        self.assertEqual(payload["observation_count"], 1)
        self.assertEqual(payload["candidates"][0]["request_id"], "req-low-score")
        self.assertEqual(payload["candidates"][0]["query_sha256"], "query-hash-low-score")
        self.assertEqual(payload["candidates"][0]["failure_class"], "low_confidence")

    def test_monitoring_cli_writes_backlog_json_from_runtime_observations(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            observation_path = root / "observations.jsonl"
            output_path = root / "backlog.json"
            observation_path.write_text(
                json.dumps(
                    {
                        "request_id": "req-no-hit",
                        "query": "校内宇宙签证办理处",
                        "scope": {
                            "corpus": "official_web",
                            "collection": "stable_reference",
                        },
                        "terminal_state": "completed",
                        "candidate_count": 0,
                    }
                )
                + "\n",
                encoding="utf-8",
            )

            exit_code = monitoring_main(
                [
                    "--observations",
                    str(observation_path),
                    "--output",
                    str(output_path),
                ]
            )
            payload = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["candidate_count"], 1)
        self.assertEqual(payload["candidates"][0]["failure_class"], "no_hit")


if __name__ == "__main__":
    unittest.main()
