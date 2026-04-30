from __future__ import annotations

from campus_evals.retrieval_monitoring import build_retrieval_monitoring_backlog

from tests.evals.retrieval_benchmark_test_support import unittest


class RetrievalMonitoringBacklogTest(unittest.TestCase):
    def test_builds_candidate_qrels_backlog_from_runtime_observations(self) -> None:
        report = build_retrieval_monitoring_backlog(
            observations=[
                {
                    "request_id": "req-no-hit",
                    "query": "校内宇宙签证办理处",
                    "scope": {"corpus": "official_web", "collection": "stable_reference"},
                    "terminal_state": "completed",
                    "candidate_count": 0,
                    "top_score": None,
                },
                {
                    "request_id": "req-low-score",
                    "query": "校园卡丢了怎么办",
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
        self.assertEqual(report.candidates[2].recommended_action, "release_metadata_repair")


if __name__ == "__main__":
    unittest.main()
