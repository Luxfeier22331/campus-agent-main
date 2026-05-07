from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.retrieval_chunk_quality import (
    build_chunk_quality_audit_report,
    evaluate_chunk_quality,
    retrieval_chunk_quality_report_to_dict,
)
from campus_evals.retrieval_chunk_quality_cli import main as chunk_quality_main

from tests.evals.retrieval_benchmark_test_support import unittest


class RetrievalChunkQualityTest(unittest.TestCase):
    def test_chunk_quality_accepts_traceable_chunks_under_budget(self) -> None:
        report = evaluate_chunk_quality(
            chunks=[
                {
                    "document_id": "doc:policy",
                    "version_id": "v1",
                    "chunk_id": "chunk-001",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "第一条 校园卡遗失后应及时挂失并补办。",
                    "source_uri": "s3://derived/doc",
                    "canonical_url": "https://example.edu/policy",
                    "metadata": {
                        "root_unit_id": "article-1",
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                }
            ],
            max_tokens=64,
        )

        self.assertEqual(report.status, "passed")
        self.assertEqual(report.issue_count, 0)

    def test_chunk_quality_flags_missing_traceability_and_over_budget_text(self) -> None:
        report = evaluate_chunk_quality(
            chunks=[
                {
                    "document_id": "doc:policy",
                    "version_id": "v1",
                    "chunk_id": "chunk-001",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": " ".join(f"token{i}" for i in range(80)),
                    "metadata": {},
                }
            ],
            max_tokens=32,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn("chunk-001", report.issues_by_chunk_id)
        self.assertIn("missing_source_uri", report.issues_by_chunk_id["chunk-001"])
        self.assertIn("missing_root_unit_id", report.issues_by_chunk_id["chunk-001"])
        self.assertIn("token_count_exceeds_budget", report.issues_by_chunk_id["chunk-001"])

    def test_chunk_quality_flags_semantic_release_gate_issues(self) -> None:
        report = evaluate_chunk_quality(
            chunks=[
                {
                    "document_id": "doc:policy",
                    "version_id": "v1",
                    "chunk_id": "chunk-context-only",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "第一章 总则",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "section_text",
                        "root_unit_id": "article-context-only",
                        "display_text": "学生应当按学校规定办理注册手续。",
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                },
                {
                    "document_id": "doc:policy",
                    "version_id": "v1",
                    "chunk_id": "chunk-segment-1",
                    "chunk_order": 2,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "第一段",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "section_text",
                        "root_unit_id": "article-segmented",
                        "segment_index": 1,
                        "segment_total": 3,
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                },
                {
                    "document_id": "doc:policy",
                    "version_id": "v1",
                    "chunk_id": "chunk-segment-3",
                    "chunk_order": 3,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "第三段",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "section_text",
                        "root_unit_id": "article-segmented",
                        "segment_index": 3,
                        "segment_total": 3,
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                },
                {
                    "document_id": "doc:policy",
                    "version_id": "v1",
                    "chunk_id": "chunk-table",
                    "chunk_order": 4,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "本科生 | 按学期注册",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "table_unit",
                        "root_unit_id": "table-1",
                        "table_row_count": 1,
                        "table_row_lines": ["本科生 | 按学期注册"],
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                },
            ],
            max_tokens=64,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "display_text_not_in_chunk_text",
            report.issues_by_chunk_id["chunk-context-only"],
        )
        self.assertIn("segment_coverage_gap", report.issues_by_chunk_id["chunk-segment-1"])
        self.assertIn("segment_coverage_gap", report.issues_by_chunk_id["chunk-segment-3"])
        self.assertIn("missing_table_context_or_header", report.issues_by_chunk_id["chunk-table"])

    def test_chunk_quality_flags_answer_clause_mixed_with_example_list(self) -> None:
        report = evaluate_chunk_quality(
            chunks=[
                {
                    "document_id": "doc:scholarship",
                    "version_id": "v1",
                    "chunk_id": "chunk-mixed-examples",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": (
                        "参评学生还须具备以下条件之一:\n"
                        "（二）学习成绩排名超出前10%,但位于前30%。具体表现如下:\n"
                        "1. 在学术研究上取得显著成绩。\n"
                        "2. 在体育竞赛中取得显著成绩。"
                    ),
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "article_body",
                        "root_unit_id": "article-9",
                        "display_text": (
                            "（二）学习成绩排名超出前10%,但位于前30%。具体表现如下:\n"
                            "1. 在学术研究上取得显著成绩。\n"
                            "2. 在体育竞赛中取得显著成绩。"
                        ),
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "answer_role": "exception_rule",
                        "content_role": "eligibility",
                    },
                }
            ],
            max_tokens=256,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_clause_mixed_with_example_list",
            report.issues_by_chunk_id["chunk-mixed-examples"],
        )

    def test_chunk_quality_does_not_treat_bare_ruxia_as_example_list_marker(self) -> None:
        report = evaluate_chunk_quality(
            chunks=[
                {
                    "document_id": "doc:procedure",
                    "version_id": "v1",
                    "chunk_id": "chunk-ruxia",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": ("奖学金申请流程如下:\n1. 学生本人提交申请材料。\n2. 学院审核并公示。"),
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "article_body",
                        "root_unit_id": "article-procedure",
                        "display_text": (
                            "奖学金申请流程如下:\n1. 学生本人提交申请材料。\n2. 学院审核并公示。"
                        ),
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "parent_unit_id": "article-procedure",
                        "answer_role": "procedure_step",
                        "content_role": "procedure",
                        "claim_type": "procedure",
                        "is_answer_bearing": True,
                        "role_confidence": "high",
                        "condition_subject": "application_procedure",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "metadata:condition_subject",
                        "condition_group_id": "article-procedure:application_procedure",
                        "procedure_step_index": 1,
                        "procedure_actor": "student",
                        "procedure_action": "submit_materials",
                        "procedure_action_taxonomy_version": "procedure_action.v1",
                        "procedure_action_provenance": "keyword:提交+材料",
                    },
                }
            ],
            max_tokens=256,
        )

        self.assertEqual(report.status, "passed")
        self.assertNotIn("chunk-ruxia", report.issues_by_chunk_id)

    def test_chunk_quality_flags_inline_example_tail_mixed_into_main_clause(self) -> None:
        report = evaluate_chunk_quality(
            chunks=[
                {
                    "document_id": "doc:inline-example",
                    "version_id": "v1",
                    "chunk_id": "chunk-inline-example-tail",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": (
                        "（二）学习成绩排名超出前10%,但位于前30%,且在学术研究上取得显著成绩。"
                    ),
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "article_body",
                        "root_unit_id": "article-inline-example",
                        "display_text": (
                            "（二）学习成绩排名超出前10%,但位于前30%,且在学术研究上取得显著成绩。"
                        ),
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "parent_unit_id": "article-inline-example",
                        "clause_unit_id": "article-inline-example:2",
                        "answer_role": "exception_rule",
                        "content_role": "eligibility",
                        "claim_type": "condition",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_subject": "rank_threshold",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "keyword:排名综测",
                        "condition_group_id": "article-inline-example:rank_threshold",
                        "condition_polarity": "positive",
                    },
                }
            ],
            max_tokens=256,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_clause_mixed_with_example_list",
            report.issues_by_chunk_id["chunk-inline-example-tail"],
        )

    def test_chunk_quality_flags_category_discovery_missing_answer_role(self) -> None:
        report = evaluate_chunk_quality(
            chunks=[
                {
                    "document_id": "doc:scholarship",
                    "version_id": "v1",
                    "chunk_id": "chunk-policy-list",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "当前已收录依据中，本科生奖学金相关制度包括：《中央民族大学本科学生国家奖学金评审办法》。",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "category_overview",
                        "root_unit_id": "category-scholarship",
                        "display_text": "当前已收录依据中，本科生奖学金相关制度包括：《中央民族大学本科学生国家奖学金评审办法》。",
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "content_role": "policy_list",
                    },
                }
            ],
            max_tokens=256,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "category_overview_missing_answer_role",
            report.issues_by_chunk_id["chunk-policy-list"],
        )

    def test_chunk_quality_flags_category_overview_missing_member_titles(self) -> None:
        report = evaluate_chunk_quality(
            chunks=[
                {
                    "document_id": "doc:scholarship",
                    "version_id": "v1",
                    "chunk_id": "chunk-policy-list",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "当前已收录依据中，本科生奖学金相关制度包括：《中央民族大学本科学生国家奖学金评审办法》。",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "category_overview",
                        "root_unit_id": "category-scholarship",
                        "display_text": "当前已收录依据中，本科生奖学金相关制度包括：《中央民族大学本科学生国家奖学金评审办法》。",
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "answer_role": "category_overview",
                        "content_role": "policy_list",
                        "category_member_titles": [
                            "中央民族大学本科学生国家奖学金评审办法",
                            "中央民族大学本科学生国家励志奖学金评审办法",
                        ],
                    },
                }
            ],
            max_tokens=256,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "category_overview_missing_member_titles",
            report.issues_by_chunk_id["chunk-policy-list"],
        )

    def test_chunk_quality_flags_procedure_role_mismatch(self) -> None:
        report = evaluate_chunk_quality(
            chunks=[
                {
                    "document_id": "doc:scholarship",
                    "version_id": "v1",
                    "chunk_id": "chunk-procedure",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "1. 学生本人提交申请材料。",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "article_body",
                        "root_unit_id": "article-procedure",
                        "display_text": "1. 学生本人提交申请材料。",
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "answer_role": "eligibility_condition",
                        "content_role": "eligibility",
                    },
                }
            ],
            max_tokens=256,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "procedure_step_role_mismatch",
            report.issues_by_chunk_id["chunk-procedure"],
        )

    def test_chunk_quality_does_not_flag_responsibility_text_as_procedure_step(
        self,
    ) -> None:
        report = evaluate_chunk_quality(
            chunks=[
                {
                    "document_id": "doc:innovation",
                    "version_id": "v1",
                    "chunk_id": "chunk-responsibility",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "教务处负责与本科生研究训练计划项目有关的立项、审批、中期检查、结题、成绩管理等方面的组织工作。",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "article_body",
                        "root_unit_id": "article-responsibility",
                        "display_text": "教务处负责与本科生研究训练计划项目有关的立项、审批、中期检查、结题、成绩管理等方面的组织工作。",
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "parent_unit_id": "article-responsibility",
                        "answer_role": "eligibility_condition",
                        "content_role": "requirement",
                        "claim_type": "condition",
                        "role_confidence": "medium",
                        "is_answer_bearing": True,
                        "condition_subject": "audience_scope",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "metadata:condition_subject",
                        "condition_group_id": "article-responsibility:audience_scope",
                    },
                }
            ],
            max_tokens=256,
        )

        self.assertEqual(report.status, "passed")
        self.assertEqual(report.issue_count, 0)

    def test_chunk_quality_does_not_flag_recordkeeping_or_deadline_text_as_procedure_step(
        self,
    ) -> None:
        report = evaluate_chunk_quality(
            chunks=[
                {
                    "document_id": "doc:innovation",
                    "version_id": "v1",
                    "chunk_id": "chunk-recordkeeping",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "每年12月初和6月初由院系组织项目中期检查，由学生填写报告书，并报教务处备案。",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "article_body",
                        "root_unit_id": "article-recordkeeping",
                        "display_text": "每年12月初和6月初由院系组织项目中期检查，由学生填写报告书，并报教务处备案。",
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "answer_role": "supporting_detail",
                        "content_role": "",
                        "claim_type": "",
                        "role_confidence": "low",
                        "is_answer_bearing": False,
                    },
                },
                {
                    "document_id": "doc:appeal",
                    "version_id": "v1",
                    "chunk_id": "chunk-deadline-exclusion",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "学生在申诉期内未提出申诉的视为放弃申诉，学校不再受理其提出的申诉。",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "article_body",
                        "root_unit_id": "article-deadline",
                        "display_text": "学生在申诉期内未提出申诉的视为放弃申诉，学校不再受理其提出的申诉。",
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "parent_unit_id": "article-deadline",
                        "answer_role": "exclusion_rule",
                        "content_role": "deadline",
                        "claim_type": "cannot_do",
                        "role_confidence": "medium",
                        "is_answer_bearing": True,
                        "condition_subject": "deadline",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "metadata:condition_subject",
                        "condition_group_id": "article-deadline:deadline",
                    },
                },
            ],
            max_tokens=256,
        )

        self.assertEqual(report.status, "passed")
        self.assertEqual(report.issue_count, 0)

    def test_chunk_quality_does_not_flag_submission_requirement_as_procedure_step(
        self,
    ) -> None:
        report = evaluate_chunk_quality(
            chunks=[
                {
                    "document_id": "doc:hardship-support",
                    "version_id": "v1",
                    "chunk_id": "chunk-submission-requirement",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": (
                        "如实填写和提交申请材料,如发现弄虚作假,须全额退还所得补助款项,"
                        "并视情节轻重给予相应处分。"
                    ),
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "article_body",
                        "root_unit_id": "article-submission-requirement",
                        "display_text": (
                            "如实填写和提交申请材料,如发现弄虚作假,须全额退还所得补助款项,"
                            "并视情节轻重给予相应处分。"
                        ),
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "parent_unit_id": "article-submission-requirement",
                        "answer_role": "eligibility_condition",
                        "content_role": "eligibility",
                        "claim_type": "condition",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_subject": "material_requirement",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "metadata:condition_subject",
                        "condition_group_id": (
                            "article-submission-requirement:material_requirement"
                        ),
                    },
                }
            ],
            max_tokens=256,
        )

        self.assertEqual(report.status, "passed")
        self.assertEqual(report.issue_count, 0)

    def test_chunk_quality_does_not_flag_negative_exception_with_followup_steps_as_procedure(
        self,
    ) -> None:
        report = evaluate_chunk_quality(
            chunks=[
                {
                    "document_id": "doc:discipline-relief",
                    "version_id": "v1",
                    "chunk_id": "chunk-negative-procedure-exception",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": (
                        "(三)学院(系)收到申请后不予答复或无故拒绝受理的,学生可在学院(系)"
                        "受理时限期满后,直接向学生处提交书面申请。学生处应在收到申请后的"
                        "5个工作日内决定是否受理,并将结果告知学生。"
                    ),
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "article_body",
                        "root_unit_id": "article-negative-procedure-exception",
                        "display_text": (
                            "(三)学院(系)收到申请后不予答复或无故拒绝受理的,学生可在学院(系)"
                            "受理时限期满后,直接向学生处提交书面申请。学生处应在收到申请后的"
                            "5个工作日内决定是否受理,并将结果告知学生。"
                        ),
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "parent_unit_id": "article-negative-procedure-exception",
                        "answer_role": "exclusion_rule",
                        "content_role": "eligibility",
                        "claim_type": "cannot_do",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_subject": "discipline_relief_exclusion",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "metadata:condition_subject",
                        "condition_group_id": (
                            "article-negative-procedure-exception:discipline_relief_exclusion"
                        ),
                    },
                }
            ],
            max_tokens=256,
        )

        self.assertEqual(report.status, "passed")
        self.assertEqual(report.issue_count, 0)

    def test_chunk_quality_uses_final_token_count_metadata_for_budget(self) -> None:
        report = evaluate_chunk_quality(
            chunks=[
                {
                    "document_id": "doc:policy",
                    "version_id": "v1",
                    "chunk_id": "chunk-tokenizer-counted",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": " ".join(f"token-{index:04d}" for index in range(180)),
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "article_body",
                        "root_unit_id": "article-tokenizer-counted",
                        "display_text": " ".join(f"token-{index:04d}" for index in range(180)),
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "final_token_count": 48,
                    },
                }
            ],
            max_tokens=64,
        )

        self.assertEqual(report.status, "passed")
        self.assertEqual(report.issue_count, 0)

    def test_chunk_quality_flags_answer_bearing_chunk_missing_role_confidence(self) -> None:
        report = evaluate_chunk_quality(
            chunks=[
                {
                    "document_id": "doc:scholarship",
                    "version_id": "v1",
                    "chunk_id": "chunk-condition",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "1. 申请人应当品行端正。",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "article_body",
                        "root_unit_id": "article-condition",
                        "display_text": "1. 申请人应当品行端正。",
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "answer_role": "eligibility_condition",
                        "content_role": "eligibility",
                        "is_answer_bearing": True,
                    },
                }
            ],
            max_tokens=256,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_bearing_missing_role_confidence",
            report.issues_by_chunk_id["chunk-condition"],
        )

    def test_chunk_quality_flags_table_unit_missing_answer_ready_metadata(self) -> None:
        report = evaluate_chunk_quality(
            chunks=[
                {
                    "document_id": "doc:scholarship",
                    "version_id": "v1",
                    "chunk_id": "chunk-table",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "奖学金等级 | 奖励金额 | 名额\n一等奖 | 3000元 | 10人",
                    "source_uri": "s3://derived/doc",
                    "anchor": {"table_context": "专业奖学金等级和金额"},
                    "metadata": {
                        "unit_type": "table_unit",
                        "root_unit_id": "table-scholarship",
                        "display_text": "奖学金等级 | 奖励金额 | 名额\n一等奖 | 3000元 | 10人",
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "table_headers": ["奖学金等级", "奖励金额", "名额"],
                    },
                }
            ],
            max_tokens=256,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "table_unit_missing_answer_ready_metadata",
            report.issues_by_chunk_id["chunk-table"],
        )

    def test_chunk_quality_flags_missing_answer_ready_contract_fields(self) -> None:
        report = evaluate_chunk_quality(
            chunks=[
                {
                    "document_id": "doc:scholarship",
                    "version_id": "v1",
                    "chunk_id": "chunk-condition-missing-subject",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "学习成绩排名与综合考评成绩排名原则上均应位于前10%。",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "article_body",
                        "root_unit_id": "article-rank",
                        "parent_unit_id": "article-rank",
                        "provision_label": "（一）",
                        "display_text": "学习成绩排名与综合考评成绩排名原则上均应位于前10%。",
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "eligibility_condition",
                        "content_role": "eligibility",
                        "claim_type": "condition",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                    },
                },
                {
                    "document_id": "doc:procedure",
                    "version_id": "v1",
                    "chunk_id": "chunk-procedure-missing-fields",
                    "chunk_order": 2,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "学生受处分满考察期后，可以提交解除处分申请表。",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "article_body",
                        "root_unit_id": "article-procedure",
                        "parent_unit_id": "article-procedure",
                        "display_text": "学生受处分满考察期后，可以提交解除处分申请表。",
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "procedure_step",
                        "content_role": "procedure",
                        "claim_type": "procedure",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                    },
                },
                {
                    "document_id": "doc:category",
                    "version_id": "v1",
                    "chunk_id": "chunk-category-missing-members",
                    "chunk_order": 3,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "当前已收录依据中，本科生奖学金相关制度包括国家奖学金。",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "category_overview",
                        "root_unit_id": "category-scholarship",
                        "parent_unit_id": "category-scholarship",
                        "display_text": "当前已收录依据中，本科生奖学金相关制度包括国家奖学金。",
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "category_overview",
                        "content_role": "policy_list",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "category_id": "scholarship",
                    },
                },
            ],
            max_tokens=256,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_condition_subject_missing",
            report.issues_by_chunk_id["chunk-condition-missing-subject"],
        )
        self.assertIn(
            "answer_ready_clause_unit_id_missing",
            report.issues_by_chunk_id["chunk-condition-missing-subject"],
        )
        self.assertIn(
            "answer_ready_procedure_step_fields_missing",
            report.issues_by_chunk_id["chunk-procedure-missing-fields"],
        )
        self.assertIn(
            "category_overview_missing_member_document_ids",
            report.issues_by_chunk_id["chunk-category-missing-members"],
        )

    def test_chunk_quality_audit_report_includes_answer_ready_distribution(self) -> None:
        report = build_chunk_quality_audit_report(
            chunks=[
                {
                    "document_id": "doc:scholarship",
                    "version_id": "v1",
                    "chunk_id": "chunk-condition",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "1. 申请人应当品行端正。",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "article_body",
                        "root_unit_id": "article-condition",
                        "display_text": "1. 申请人应当品行端正。",
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "parent_unit_id": "article-condition",
                        "answer_role": "eligibility_condition",
                        "content_role": "eligibility",
                        "claim_type": "condition",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_subject": "generic_condition",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "metadata:condition_subject",
                        "condition_group_id": "article-condition:generic_condition",
                    },
                },
                {
                    "document_id": "doc:scholarship",
                    "version_id": "v1",
                    "chunk_id": "chunk-table",
                    "chunk_order": 2,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "奖学金等级 | 奖励金额 | 名额\n一等奖 | 3000元 | 10人",
                    "source_uri": "s3://derived/doc",
                    "anchor": {"table_context": "专业奖学金等级和金额"},
                    "metadata": {
                        "unit_type": "table_unit",
                        "root_unit_id": "table-scholarship",
                        "display_text": "奖学金等级 | 奖励金额 | 名额\n一等奖 | 3000元 | 10人",
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "parent_unit_id": "table-scholarship",
                        "answer_role": "table_fact",
                        "content_role": "table_fact",
                        "claim_type": "amount_or_quota",
                        "condition_subject": "amount_or_quota",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "metadata:condition_subject",
                        "table_fact_type": "amount_or_quota",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "table_headers": ["奖学金等级", "奖励金额", "名额"],
                    },
                },
            ],
            max_tokens=256,
        )

        self.assertEqual(report.status, "passed")
        self.assertEqual(report.counts_by_answer_role["eligibility_condition"], 1)
        self.assertEqual(report.counts_by_answer_role["table_fact"], 1)
        self.assertEqual(report.counts_by_content_role["table_fact"], 1)
        self.assertEqual(report.counts_by_claim_type["amount_or_quota"], 1)
        self.assertEqual(report.answer_ready_chunk_count, 2)
        self.assertEqual(report.low_confidence_role_count, 0)
        self.assertEqual(report.table_answer_ready_count, 1)

    def test_chunk_quality_counts_aggregated_member_segment_lineage_as_covered(
        self,
    ) -> None:
        report = evaluate_chunk_quality(
            chunks=[
                {
                    "document_id": "doc:policy",
                    "version_id": "v1",
                    "chunk_id": "chunk-segment-1-aggregated",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "第一段",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "section_text",
                        "root_unit_id": "article-previous",
                        "member_segment_lineage": [
                            {
                                "root_unit_id": "article-segmented",
                                "segment_index": 1,
                                "segment_total": 2,
                            }
                        ],
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                },
                {
                    "document_id": "doc:policy",
                    "version_id": "v1",
                    "chunk_id": "chunk-segment-2",
                    "chunk_order": 2,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "第二段",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "section_text",
                        "root_unit_id": "article-segmented",
                        "segment_index": 2,
                        "segment_total": 2,
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                },
            ],
            max_tokens=64,
        )

        self.assertEqual(report.status, "passed")
        self.assertEqual(report.issue_count, 0)

    def test_chunk_quality_audit_report_summarizes_issue_and_unit_type_counts(self) -> None:
        report = build_chunk_quality_audit_report(
            chunks=[
                {
                    "document_id": "doc:policy",
                    "version_id": "v1",
                    "chunk_id": "chunk-missing-root",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "第一章 总则",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "section_text",
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                },
                {
                    "document_id": "doc:policy",
                    "version_id": "v1",
                    "chunk_id": "chunk-table",
                    "chunk_order": 2,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "办理地点 | 中慧楼",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "table_unit",
                        "root_unit_id": "table-1",
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                },
            ],
            max_tokens=64,
        )
        payload = retrieval_chunk_quality_report_to_dict(report)

        self.assertEqual(payload["status"], "failed")
        self.assertEqual(payload["chunk_count"], 2)
        self.assertEqual(payload["failed_chunk_count"], 2)
        self.assertEqual(payload["counts_by_unit_type"]["section_text"], 1)
        self.assertEqual(payload["counts_by_unit_type"]["table_unit"], 1)
        self.assertEqual(payload["counts_by_issue"]["missing_root_unit_id"], 1)
        self.assertEqual(payload["counts_by_issue"]["missing_table_context_or_header"], 1)

    def test_chunk_quality_cli_writes_json_report(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            chunks_path = root / "chunks.jsonl"
            report_path = root / "chunk-quality.json"
            chunks_path.write_text(
                json.dumps(
                    {
                        "document_id": "doc:policy",
                        "version_id": "v1",
                        "chunk_id": "chunk-001",
                        "chunk_order": 1,
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "text": "第一章 总则",
                        "source_uri": "s3://derived/doc",
                        "metadata": {
                            "unit_type": "section_text",
                            "root_unit_id": "article-1",
                            "chunk_policy_version": "student_rules_semantic_v3",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            exit_code = chunk_quality_main(
                [
                    "--chunks",
                    str(chunks_path),
                    "--output",
                    str(report_path),
                    "--max-tokens",
                    "64",
                ]
            )
            payload = json.loads(report_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["status"], "passed")
        self.assertEqual(payload["chunk_count"], 1)

    def test_chunk_quality_cli_returns_nonzero_when_report_failed(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            chunks_path = root / "chunks.jsonl"
            report_path = root / "chunk-quality.json"
            chunks_path.write_text(
                json.dumps(
                    {
                        "document_id": "doc:policy",
                        "version_id": "v1",
                        "chunk_id": "chunk-001",
                        "chunk_order": 1,
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "text": "第一章 总则",
                        "metadata": {},
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            exit_code = chunk_quality_main(
                [
                    "--chunks",
                    str(chunks_path),
                    "--output",
                    str(report_path),
                    "--max-tokens",
                    "64",
                ]
            )
            payload = json.loads(report_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 2)
        self.assertEqual(payload["status"], "failed")


if __name__ == "__main__":
    unittest.main()
