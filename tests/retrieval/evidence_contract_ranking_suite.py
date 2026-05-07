from __future__ import annotations

import unittest

from campus_retrieval_core.evidence_attributes import (
    INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY,
)
from campus_retrieval_core.evidence_ranking import prioritize_evidence_sources
from campus_retrieval_core.evidence_ranking_features import build_ranking_features
from campus_retrieval_core.evidence_ranking_text import match_key, normalize_text

from tests.retrieval.backend_qdrant_test_support import _make_source


def _answer_ready_anchor(**metadata: object) -> dict[str, object]:
    payload = {
        "evidence_contract_version": "answer_ready_evidence.v3",
        "parent_unit_id": "handbook:unit:article-1",
        **metadata,
    }
    return {INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: payload}


class EvidenceContractRankingTest(unittest.TestCase):
    def test_typed_metadata_ranks_positive_procedure_over_negative_exclusion_without_public_semantics(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="处分怎么消",
            sources=(
                _make_source(
                    doc_id="handbook:demerit-relief",
                    chunk_id="discipline-negative-exclusion",
                    snippet="第六条 有下列情形之一的，不予解除处分。",
                    score=0.99,
                    collection="student_rules",
                    source_title="处分怎么消：不予解除处分的情形",
                    content_role="procedure",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="exclusion_rule",
                        polarity="negative",
                        action_type="lift_discipline",
                        claim_type="cannot_do",
                        condition_polarity="negative",
                    ),
                ),
                _make_source(
                    doc_id="handbook:demerit-relief",
                    chunk_id="discipline-positive-procedure",
                    snippet="第三条 学生受处分满考察期后，可以申请解除纪律处分。",
                    score=0.42,
                    collection="student_rules",
                    source_title="中央民族大学解除学生纪律处分实施办法",
                    content_role="procedure",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="procedure_step",
                        polarity="positive",
                        action_type="lift_discipline",
                        claim_type="procedure",
                        condition_polarity="positive",
                    ),
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "discipline-positive-procedure")

    def test_typed_metadata_preserves_negative_exclusion_for_negative_query(self) -> None:
        ranked = prioritize_evidence_sources(
            query_text="哪些情况不能解除处分",
            sources=(
                _make_source(
                    doc_id="handbook:demerit-relief",
                    chunk_id="discipline-positive-procedure",
                    snippet="第三条 学生受处分满考察期后，可以申请解除纪律处分。",
                    score=0.92,
                    collection="student_rules",
                    source_title="中央民族大学解除学生纪律处分实施办法",
                    content_role="procedure",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="procedure_step",
                        polarity="positive",
                        action_type="lift_discipline",
                        claim_type="procedure",
                        condition_polarity="positive",
                    ),
                ),
                _make_source(
                    doc_id="handbook:demerit-relief",
                    chunk_id="discipline-negative-exclusion",
                    snippet="第六条 有下列情形之一的，不予解除处分。",
                    score=0.41,
                    collection="student_rules",
                    source_title="中央民族大学解除学生纪律处分实施办法",
                    content_role="requirement",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="exclusion_rule",
                        polarity="negative",
                        action_type="lift_discipline",
                        claim_type="cannot_do",
                        condition_polarity="negative",
                    ),
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "discipline-negative-exclusion")

    def test_condition_subject_ranks_rank_threshold_clause_over_generic_eligibility(self) -> None:
        ranked = prioritize_evidence_sources(
            query_text="成绩没前十还能评国奖吗",
            sources=(
                _make_source(
                    doc_id="handbook:national-scholarship",
                    chunk_id="national-scholarship-generic-eligibility",
                    snippet="申请人应当热爱社会主义祖国，拥护中国共产党的领导。",
                    score=0.95,
                    collection="student_rules",
                    source_title="国家奖学金评审办法",
                    content_role="eligibility",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="general_eligibility",
                        polarity="positive",
                        claim_type="condition",
                    ),
                ),
                _make_source(
                    doc_id="handbook:national-scholarship",
                    chunk_id="national-scholarship-rank-threshold",
                    snippet="学习成绩排名与综合考评成绩排名原则上均应位于前10%。",
                    score=0.38,
                    collection="student_rules",
                    source_title="国家奖学金评审办法",
                    content_role="eligibility",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="rank_threshold",
                        polarity="positive",
                        claim_type="condition",
                    ),
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "national-scholarship-rank-threshold")

    def test_condition_subject_ranks_paper_publication_clause_over_generic_eligibility(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="论文能不能算国奖条件",
            sources=(
                _make_source(
                    doc_id="handbook:national-scholarship",
                    chunk_id="national-scholarship-generic-eligibility",
                    snippet="申请人应当遵守宪法和法律，遵守学校规章制度。",
                    score=0.95,
                    collection="student_rules",
                    source_title="国家奖学金评审办法",
                    content_role="eligibility",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="general_eligibility",
                        polarity="positive",
                        claim_type="condition",
                    ),
                ),
                _make_source(
                    doc_id="handbook:national-scholarship",
                    chunk_id="national-scholarship-paper-publication",
                    snippet="在公开发行刊物上发表较高水平学术论文，或正式出版学术著作。",
                    score=0.37,
                    collection="student_rules",
                    source_title="国家奖学金评审办法",
                    content_role="eligibility",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="paper_or_publication",
                        polarity="positive",
                        claim_type="condition",
                    ),
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "national-scholarship-paper-publication")

    def test_category_discovery_ranks_category_overview_over_procedure_and_exclusion(self) -> None:
        ranked = prioritize_evidence_sources(
            query_text="本科生有哪些奖学金能申请",
            sources=(
                _make_source(
                    doc_id="handbook:scholarship-procedure",
                    chunk_id="scholarship-procedure",
                    snippet="奖学金评审由学院推荐、学校审核、公示后确定名单。",
                    score=0.96,
                    collection="student_rules",
                    source_title="奖学金评审程序",
                    content_role="procedure",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="procedure_step",
                        category_id="scholarship",
                        polarity="positive",
                    ),
                ),
                _make_source(
                    doc_id="handbook:scholarship-exclusion",
                    chunk_id="scholarship-exclusion",
                    snippet="有违纪处分记录者，不得参评部分奖学金。",
                    score=0.94,
                    collection="student_rules",
                    source_title="奖学金限制条件",
                    content_role="requirement",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="exclusion_rule",
                        category_id="scholarship",
                        polarity="negative",
                    ),
                ),
                _make_source(
                    doc_id="handbook:scholarship-category",
                    chunk_id="scholarship-category-overview",
                    snippet="当前已收录的本科生奖学金相关制度包括国家奖学金、国家励志奖学金、专业奖学金等。",
                    score=0.43,
                    collection="student_rules",
                    source_title="本科生奖学金制度目录",
                    content_role="overview",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="category_overview",
                        category_id="scholarship",
                        category_audience="undergraduate",
                        category_member_document_ids=(
                            "handbook:national-scholarship",
                            "handbook:national-encouragement-scholarship",
                        ),
                        category_member_titles=("国家奖学金", "国家励志奖学金"),
                        polarity="neutral",
                    ),
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "scholarship-category-overview")

    def test_ranking_features_report_fallback_diagnostics_when_contract_metadata_is_absent(
        self,
    ) -> None:
        query_text = "处分怎么消"
        normalized_query = normalize_text(query_text)
        query_key = match_key(normalized_query)

        legacy_feature = build_ranking_features(
            query_text=query_text,
            normalized_query=normalized_query,
            query_key=query_key,
            source=_make_source(
                doc_id="handbook:demerit-relief",
                chunk_id="legacy-public-semantic",
                snippet="学生受处分满考察期后，可以申请解除纪律处分。",
                score=0.72,
                collection="student_rules",
                content_role="procedure",
                is_answer_bearing=True,
                semantic_role="procedure_step",
                polarity="positive",
                action_type="lift_discipline",
                claim_type="procedure",
            ),
        )
        typed_feature = build_ranking_features(
            query_text=query_text,
            normalized_query=normalized_query,
            query_key=query_key,
            source=_make_source(
                doc_id="handbook:demerit-relief",
                chunk_id="typed-sidecar",
                snippet="学生受处分满考察期后，可以申请解除纪律处分。",
                score=0.72,
                collection="student_rules",
                content_role="procedure",
                is_answer_bearing=True,
                anchor=_answer_ready_anchor(
                    answer_role="procedure_step",
                    polarity="positive",
                    action_type="lift_discipline",
                    claim_type="procedure",
                ),
            ),
        )

        self.assertTrue(legacy_feature.fallback_diagnostics.fallback_used)
        self.assertEqual(legacy_feature.fallback_diagnostics.fallback_reason, "missing_contract")
        self.assertIn("answer_role", legacy_feature.fallback_diagnostics.missing_contract_fields)
        self.assertIn(
            "evidence_contract_version",
            legacy_feature.fallback_diagnostics.missing_contract_fields,
        )
        self.assertEqual(legacy_feature.fallback_diagnostics.source_index_contract_version, "")
        self.assertEqual(
            legacy_feature.fallback_diagnostics.fallback_primary_signal, "public_semantic"
        )
        self.assertFalse(typed_feature.fallback_diagnostics.fallback_used)
        self.assertEqual(typed_feature.fallback_diagnostics.missing_contract_fields, ())


if __name__ == "__main__":
    unittest.main()
