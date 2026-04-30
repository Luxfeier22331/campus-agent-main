from __future__ import annotations

from campus_contracts import KnowledgeScope
from campus_evals.benchmark_models import (
    RetrievalQrelsCase,
    RetrievalQrelsDataset,
    RetrievalQrelsSourceRef,
)
from campus_evals.retrieval_rerank_eval import (
    RerankCandidateSource,
    RerankRunCase,
    evaluate_deterministic_rerank_branch,
)

from tests.evals.retrieval_benchmark_test_support import unittest


class RetrievalRerankEvalTest(unittest.TestCase):
    def test_deterministic_rerank_eval_reports_before_after_metric_delta(self) -> None:
        dataset = RetrievalQrelsDataset(
            schema_version=1,
            scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            baseline={},
            cases=(
                RetrievalQrelsCase(
                    case_id="campus-card-reissue",
                    split="release_gate",
                    query="校园卡丢了怎么补办",
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                    expected_sources=(
                        RetrievalQrelsSourceRef(
                            doc_id="student-service:campus-card",
                            grade=3,
                        ),
                    ),
                ),
            ),
        )
        run = (
            RerankRunCase(
                case_id="campus-card-reissue",
                retrieved_sources=(
                    RerankCandidateSource(
                        doc_id="student-service:scholarship",
                        score=0.95,
                        title="国家奖学金评审办法",
                        snippet="奖学金评审条件和流程。",
                    ),
                    RerankCandidateSource(
                        doc_id="student-service:campus-card",
                        score=0.55,
                        title="校园卡补办指引",
                        snippet="校园卡丢失后可自助补卡，也可到卡务中心办理。",
                    ),
                ),
            ),
        )

        report = evaluate_deterministic_rerank_branch(dataset=dataset, run=run)

        self.assertEqual(report.case_count, 1)
        self.assertEqual(report.changed_case_count, 1)
        self.assertEqual(report.improved_case_ids, ("campus-card-reissue",))
        self.assertEqual(report.baseline_metrics.doc_hit_at_1, 0.0)
        self.assertEqual(report.reranked_metrics.doc_hit_at_1, 1.0)


if __name__ == "__main__":
    unittest.main()
