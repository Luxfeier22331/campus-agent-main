from __future__ import annotations

from campus_retrieval_core.query_focus import source_covers_query_focus

from tests.retrieval.backend_qdrant_test_support import (
    _make_source,
    prioritize_evidence_sources,
    select_supporting_evidence_sources,
    unittest,
)


class BackendQdrantPolicyFocusRankingTest(unittest.TestCase):
    def test_prioritize_evidence_sources_prefers_matching_policy_anchor_and_focus_terms(self) -> None:
        ranked = prioritize_evidence_sources(
            query_text="国奖第九条怎么要求论文和著作？",
            sources=(
                _make_source(
                    doc_id="handbook:national-scholarship",
                    chunk_id="national-scholarship-article-8",
                    snippet="第八条 国家奖学金候选人应当坚持德智体美劳全面发展。",
                    score=0.95,
                    source_title="国家奖学金评审办法",
                    detail_label="第八条",
                    content_role="requirement",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="handbook:national-scholarship",
                    chunk_id="national-scholarship-article-9",
                    snippet="第九条 在前10%的基础上，必须在论文、著作等方面特别优秀。",
                    score=0.74,
                    source_title="国家奖学金评审办法",
                    detail_label="第九条",
                    content_role="requirement",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "national-scholarship-article-9")

    def test_select_supporting_evidence_sources_fail_closes_when_focus_terms_are_missing(self) -> None:
        selected = select_supporting_evidence_sources(
            query_text="国奖第九条怎么要求论文和著作？",
            max_sources=2,
            sources=(
                _make_source(
                    doc_id="handbook:national-scholarship",
                    chunk_id="national-scholarship-article-9-rank-only",
                    snippet="第九条 学习成绩排名与综合考评成绩排名均位于前10%。",
                    score=0.93,
                    source_title="国家奖学金评审办法",
                    detail_label="第九条",
                    content_role="requirement",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="handbook:national-scholarship",
                    chunk_id="national-scholarship-article-8",
                    snippet="第八条 国家奖学金候选人应当坚持德智体美劳全面发展。",
                    score=0.82,
                    source_title="国家奖学金评审办法",
                    detail_label="第八条",
                    content_role="requirement",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(selected, ())

    def test_rank_threshold_focus_does_not_require_implicit_front_thirty_clause(self) -> None:
        source = _make_source(
            doc_id="handbook:national-scholarship",
            chunk_id="national-scholarship-rank-top-ten",
            snippet="国家奖学金申请人的学习成绩排名与综合考评成绩排名原则上均应位于前10%。",
            score=0.82,
            source_title="国家奖学金评审办法",
            detail_label="评审条件",
            content_role="requirement",
            is_answer_bearing=True,
        )

        self.assertTrue(
            source_covers_query_focus(
                query_text="成绩没前十还能评国奖吗？",
                source=source,
            )
        )


if __name__ == "__main__":
    unittest.main()
