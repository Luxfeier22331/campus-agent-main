from __future__ import annotations

import unittest

from campus_retrieval_core.evidence_attributes import (
    INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY,
)
from campus_retrieval_core.evidence_ranking import prioritize_evidence_sources
from campus_retrieval_core.evidence_ranking_features import build_ranking_features
from campus_retrieval_core.evidence_ranking_text import match_key, normalize_text
from campus_retrieval_core.evidence_semantics import infer_query_condition_subject

from tests.retrieval.backend_qdrant_test_support import _make_source


def _answer_ready_anchor(**metadata: object) -> dict[str, object]:
    payload = {
        "evidence_contract_version": "answer_ready_evidence.v3",
        "parent_unit_id": "handbook:unit:article-1",
        **metadata,
    }
    return {INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: payload}


class EvidenceContractRankingTest(unittest.TestCase):
    def test_query_condition_subject_infers_amount_or_quota_from_amount_lookup(self) -> None:
        self.assertEqual(
            infer_query_condition_subject("专业奖学金一等奖金额是多少？"),
            "amount_or_quota",
        )

    def test_query_condition_subject_infers_amount_or_quota_from_quota_lookup(self) -> None:
        self.assertEqual(
            infer_query_condition_subject("专业奖学金一等奖名额有多少？"),
            "amount_or_quota",
        )

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

    def test_rank_exception_query_ranks_exception_rule_over_baseline_top_ten_clause(self) -> None:
        ranked = prioritize_evidence_sources(
            query_text="成绩没前十还能评国奖吗",
            sources=(
                _make_source(
                    doc_id="handbook:national-scholarship",
                    chunk_id="national-scholarship-top-ten-baseline",
                    snippet="学习成绩排名与综合考评成绩排名原则上均应位于前10%以内。",
                    score=0.95,
                    collection="student_rules",
                    source_title="中央民族大学本科学生国家奖学金评审办法",
                    content_role="eligibility",
                    is_answer_bearing=True,
                    semantic_role="condition",
                    anchor={},
                ),
                _make_source(
                    doc_id="handbook:national-scholarship",
                    chunk_id="national-scholarship-rank-exception",
                    snippet=(
                        "学习成绩排名或综合测评排名超出前10%,但均位于前30%,且单科成绩不低于80分,"
                        "平均成绩不低于85分,必须在某一方面表现特别优秀且可提供相应证明材料。"
                    ),
                    score=0.94,
                    collection="student_rules",
                    source_title="中央民族大学本科学生国家奖学金评审办法",
                    content_role="eligibility",
                    is_answer_bearing=True,
                    semantic_role="exception",
                    anchor={},
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "national-scholarship-rank-exception")

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

    def test_rank_threshold_query_keeps_group_aligned_example_evidence_over_generic_condition(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="成绩没前十还能评国奖吗",
            sources=(
                _make_source(
                    doc_id="handbook:national-scholarship",
                    chunk_id="national-scholarship-generic-condition",
                    snippet="申请人应当遵守宪法和法律，遵守学校规章制度。",
                    score=0.95,
                    collection="student_rules",
                    source_title="国家奖学金评审办法",
                    content_role="eligibility",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        polarity="positive",
                        claim_type="condition",
                    ),
                ),
                _make_source(
                    doc_id="handbook:national-scholarship",
                    chunk_id="national-scholarship-rank-group-example",
                    snippet="且在学术研究上取得显著成绩。",
                    score=0.41,
                    collection="student_rules",
                    source_title="国家奖学金评审办法",
                    content_role="eligibility",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="example_evidence",
                        condition_subject="paper_or_publication",
                        condition_group_subject="rank_threshold",
                        polarity="positive",
                        claim_type="condition",
                    ),
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "national-scholarship-rank-group-example")

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

    def test_institutional_category_discovery_ranks_category_overview_over_procedure(self) -> None:
        ranked = prioritize_evidence_sources(
            query_text="学校层面的学生管理制度有哪些",
            sources=(
                _make_source(
                    doc_id="official_web_regulation:7c62688242b9f47b",
                    chunk_id="portal-procedure",
                    snippet="信息门户相关事项按申请、审核、公示流程办理。",
                    score=0.96,
                    collection="institutional_rules",
                    source_title="中央民族大学信息门户运行管理办法（试行）",
                    content_role="procedure",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="procedure_step",
                        category_id="public_service",
                        condition_subject="application_procedure",
                        polarity="positive",
                    ),
                ),
                _make_source(
                    doc_id="official_web_regulation:0a420e3fe367027c",
                    chunk_id="public-service-category-overview",
                    snippet=(
                        "当前已收录依据中，校园成员校园服务制度相关制度包括：《中央民族大学信息公开实施细则》、"
                        "《中央民族大学信息门户运行管理办法（试行）》等。"
                    ),
                    score=0.44,
                    collection="institutional_rules",
                    source_title="校园服务制度目录",
                    content_role="policy_list",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="category_overview",
                        category_id="public_service",
                        category_audience="校园成员",
                        category_member_document_ids=(
                            "official_web_regulation:0a420e3fe367027c",
                            "official_web_regulation:7c62688242b9f47b",
                        ),
                        category_member_titles=(
                            "中央民族大学信息公开实施细则",
                            "中央民族大学信息门户运行管理办法（试行）",
                        ),
                        polarity="neutral",
                    ),
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "public-service-category-overview")

    def test_institutional_deadline_query_ranks_time_constraint_over_generic_condition(
        self,
    ) -> None:
        ranked = prioritize_evidence_sources(
            query_text="申诉有时间限制吗",
            sources=(
                _make_source(
                    doc_id="official-web-regulation-appeal-deadline-test",
                    chunk_id="appeal-generic-condition",
                    snippet="申诉应当符合规定条件，并按程序办理。",
                    score=0.95,
                    collection="institutional_rules",
                    source_title="中央民族大学学生申诉处理办法",
                    content_role="requirement",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        polarity="positive",
                        claim_type="condition",
                    ),
                ),
                _make_source(
                    doc_id="official-web-regulation-appeal-deadline-test",
                    chunk_id="appeal-deadline",
                    snippet="学生应当在收到处理决定后5个工作日内提出申诉。",
                    score=0.44,
                    collection="institutional_rules",
                    source_title="中央民族大学学生申诉处理办法",
                    content_role="deadline",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="time_constraint",
                        condition_subject="deadline",
                        polarity="positive",
                        claim_type="time_constraint",
                    ),
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "appeal-deadline")

    def test_institutional_material_query_ranks_material_requirement_over_procedure(self) -> None:
        ranked = prioritize_evidence_sources(
            query_text="申请复核要交什么材料",
            sources=(
                _make_source(
                    doc_id="official-web-regulation-appeal-material-test",
                    chunk_id="appeal-procedure",
                    snippet="校级复核按提交申请、审核、答复程序办理。",
                    score=0.95,
                    collection="institutional_rules",
                    source_title="中央民族大学学生申诉处理办法",
                    content_role="procedure",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="procedure_step",
                        condition_subject="application_procedure",
                        polarity="positive",
                        claim_type="procedure",
                    ),
                ),
                _make_source(
                    doc_id="official-web-regulation-appeal-material-test",
                    chunk_id="appeal-materials",
                    snippet="申诉申请应当提交书面申请、相关证明材料。",
                    score=0.43,
                    collection="institutional_rules",
                    source_title="中央民族大学学生申诉处理办法",
                    content_role="requirement",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="material_requirement",
                        condition_subject="material_requirement",
                        polarity="positive",
                        claim_type="material_requirement",
                    ),
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "appeal-materials")

    def test_amount_or_quota_query_ranks_table_fact_over_overview(self) -> None:
        ranked = prioritize_evidence_sources(
            query_text="专业奖学金一等奖金额是多少？",
            sources=(
                _make_source(
                    doc_id="handbook:professional-scholarship",
                    chunk_id="professional-scholarship-overview",
                    snippet="专业奖学金用于奖励学习刻苦、成绩优良、表现突出的本科学生。",
                    score=0.95,
                    collection="student_rules",
                    source_title="中央民族大学本科学生专业奖学金评定办法",
                    content_role="definition",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        condition_subject="generic_condition",
                        polarity="positive",
                        claim_type="condition",
                    ),
                ),
                _make_source(
                    doc_id="handbook:professional-scholarship",
                    chunk_id="professional-scholarship-amount-table",
                    snippet=(
                        "专业奖学金等级和金额\n"
                        "奖学金等级 | 奖励金额 | 名额\n"
                        "一等奖 | 3000元 | 10人\n"
                        "二等奖 | 1500元 | 20人"
                    ),
                    score=0.44,
                    collection="student_rules",
                    source_title="中央民族大学本科学生专业奖学金评定办法",
                    structural_path=(
                        "中央民族大学本科学生专业奖学金评定办法",
                        "专业奖学金等级和金额",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="table_fact",
                        condition_subject="amount_or_quota",
                        polarity="positive",
                        claim_type="amount_or_quota",
                        table_fact_type="amount_or_quota",
                    ),
                ),
            ),
        )

        self.assertEqual(ranked[0].chunk_id, "professional-scholarship-amount-table")

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
                    condition_subject="application_procedure",
                    condition_group_subject="application_procedure",
                    condition_group_id="handbook:demerit-relief:article-3:application_procedure",
                    condition_subject_taxonomy_version="condition_subject.v1",
                    condition_subject_provenance="test-helper:default",
                    procedure_step_index=1,
                    procedure_actor="student",
                    procedure_action="apply",
                    procedure_action_taxonomy_version="procedure_action.v1",
                    procedure_action_provenance="test-helper:default",
                    polarity="positive",
                    action_type="lift_discipline",
                    claim_type="procedure",
                    condition_polarity="positive",
                    parent_unit_id="handbook:demerit-relief:article-3",
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

    def test_incomplete_v3_sidecar_is_still_treated_as_missing_contract(self) -> None:
        query_text = "处分怎么消"
        normalized_query = normalize_text(query_text)
        query_key = match_key(normalized_query)

        incomplete_feature = build_ranking_features(
            query_text=query_text,
            normalized_query=normalized_query,
            query_key=query_key,
            source=_make_source(
                doc_id="handbook:demerit-relief",
                chunk_id="typed-but-incomplete-sidecar",
                snippet="学生受处分满考察期后，可以申请解除纪律处分。",
                score=0.72,
                collection="student_rules",
                content_role="procedure",
                is_answer_bearing=True,
                anchor=_answer_ready_anchor(
                    answer_role="procedure_step",
                    evidence_contract_version="answer_ready_evidence.v3",
                    parent_unit_id="handbook:demerit-relief:article-3",
                    condition_subject="application_procedure",
                    condition_group_id="handbook:demerit-relief:article-3:application_procedure",
                ),
            ),
        )

        self.assertTrue(incomplete_feature.fallback_diagnostics.fallback_used)
        self.assertEqual(
            incomplete_feature.fallback_diagnostics.fallback_reason, "missing_contract"
        )
        self.assertIn(
            "procedure_action",
            incomplete_feature.fallback_diagnostics.missing_contract_fields,
        )
        self.assertIn(
            "procedure_actor",
            incomplete_feature.fallback_diagnostics.missing_contract_fields,
        )


if __name__ == "__main__":
    unittest.main()
