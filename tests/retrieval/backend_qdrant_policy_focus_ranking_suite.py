from __future__ import annotations

from campus_retrieval_core.evidence_semantics import infer_query_condition_subject
from campus_retrieval_core.query_focus import (
    build_focus_groups,
    extract_query_focus,
    source_covers_query_focus,
)

from tests.retrieval.backend_qdrant_test_support import (
    _make_source,
    prioritize_evidence_sources,
    select_supporting_evidence_sources,
    unittest,
)


class BackendQdrantPolicyFocusRankingTest(unittest.TestCase):
    def test_prioritize_evidence_sources_prefers_matching_policy_anchor_and_focus_terms(
        self,
    ) -> None:
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

    def test_select_supporting_evidence_sources_fail_closes_when_focus_terms_are_missing(
        self,
    ) -> None:
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

    def test_select_supporting_evidence_sources_allows_same_clause_split_focus_coverage(
        self,
    ) -> None:
        selected = select_supporting_evidence_sources(
            query_text="国奖第九条怎么要求论文和著作？",
            max_sources=3,
            sources=(
                _make_source(
                    doc_id="handbook:national-scholarship",
                    chunk_id="national-scholarship-article-9-paper",
                    snippet="第九条 在学术研究上取得显著成绩，以第一作者发表论文。",
                    score=0.93,
                    source_title="国家奖学金评审办法",
                    detail_label="第九条",
                    content_role="requirement",
                    is_answer_bearing=True,
                ),
                _make_source(
                    doc_id="handbook:national-scholarship",
                    chunk_id="national-scholarship-article-9-book",
                    snippet="第九条 以第一、二作者出版学术专著，可以优先考虑。",
                    score=0.91,
                    source_title="国家奖学金评审办法",
                    detail_label="第九条",
                    content_role="requirement",
                    is_answer_bearing=True,
                ),
            ),
        )

        self.assertEqual(
            tuple(source.chunk_id for source in selected),
            (
                "national-scholarship-article-9-paper",
                "national-scholarship-article-9-book",
            ),
        )

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

    def test_attendance_absence_threshold_focus_tracks_absence_and_class_hour_units(
        self,
    ) -> None:
        query = "中央民族大学学生违纪处分实施办法 旷课 学时 课时 节"

        focus = extract_query_focus(query)

        self.assertIn("旷课", focus.focus_terms)
        self.assertIn("学时", focus.focus_terms)
        self.assertIn("节", focus.focus_terms)
        self.assertIn(("学时", "课时", "节"), build_focus_groups(query))
        self.assertEqual(infer_query_condition_subject(query), "attendance_absence_threshold")

    def test_applicability_lookup_maps_to_audience_scope_subject(self) -> None:
        self.assertEqual(
            infer_query_condition_subject("中央民族大学毕业生就业奖励办法适用于2019届及以后毕业生吗"),
            "audience_scope",
        )

    def test_select_supporting_evidence_sources_prefers_absence_threshold_over_procedure_rows(
        self,
    ) -> None:
        selected = select_supporting_evidence_sources(
            query_text="中央民族大学学生违纪处分实施办法 旷课 学时 课时 节",
            max_sources=2,
            sources=(
                _make_source(
                    doc_id="handbook:discipline",
                    chunk_id="discipline-procedure",
                    snippet="第十二条 对违纪学生作出处分决定,应当依据告知、听证、处理、送达处分决定的程序进行。",
                    score=0.96,
                    source_title="中央民族大学学生违纪处分实施办法",
                    detail_label="第十二条",
                    content_role="procedure",
                    is_answer_bearing=True,
                    semantic_role="procedure_step",
                    claim_type="procedure",
                ),
                _make_source(
                    doc_id="handbook:discipline",
                    chunk_id="discipline-absence-threshold",
                    snippet=(
                        "第三十三条 违反学校考勤管理规定,无故旷课者,视情节给予如下处分:"
                        "一学期累计旷课16节以下者,给予学院通报批评处分。"
                    ),
                    score=0.72,
                    source_title="中央民族大学学生违纪处分实施办法",
                    detail_label="第三十三条",
                    content_role="eligibility",
                    is_answer_bearing=True,
                    semantic_role="eligibility_condition",
                    claim_type="condition",
                ),
            ),
        )

        self.assertEqual(
            tuple(source.chunk_id for source in selected),
            ("discipline-absence-threshold",),
        )


if __name__ == "__main__":
    unittest.main()
