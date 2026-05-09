# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.evals.retrieval_chunk_quality_suite_support import *


class RetrievalChunkQualityTestPart02(unittest.TestCase):
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
        discovery = load_regulation_discovery_config("student_rules")
        category = next(item for item in discovery.categories if item.category_id == "scholarship")
        category_titles = [
            discovery.policy_titles_by_document_id[document_id]
            for document_id in category.member_policy_document_ids
        ]
        category_display_text = (
            f"当前已收录依据中，{category.audience}{category.display_name}相关制度包括："
            f"{'、'.join(f'《{title}》' for title in category_titles)}。"
        )
        report = build_chunk_quality_audit_report(
            chunks=[
                {
                    "document_id": category.overview_document_id,
                    "version_id": "v1",
                    "chunk_id": "chunk-overview",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": category_display_text,
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "category_overview",
                        "root_unit_id": f"category:{category.category_id}",
                        "display_text": category_display_text,
                        "chunk_policy_version": "student_rules_semantic_v3",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "parent_unit_id": f"category:{category.category_id}",
                        "answer_role": "category_overview",
                        "content_role": "policy_list",
                        "claim_type": "category_overview",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_subject": "audience_scope",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "category_registry:audience_scope",
                        "condition_group_subject": "audience_scope",
                        "condition_group_id": f"category:{category.category_id}:audience_scope",
                        "condition_polarity": "neutral",
                        "category_id": category.category_id,
                        "category_registry_version": "policy_category_registry.v1",
                        "audience": category.audience,
                        "member_policy_document_ids": list(category.member_policy_document_ids),
                        "member_policy_titles": category_titles,
                    },
                },
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
                        "condition_subject": "generic_condition",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "metadata:condition_subject",
                        "condition_group_id": "article-condition:generic_condition",
                        "condition_polarity": "positive",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
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
                        "condition_group_id": "table-scholarship:amount_or_quota",
                        "condition_polarity": "positive",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "table_headers": ["奖学金等级", "奖励金额", "名额"],
                    },
                },
            ],
            max_tokens=256,
        )

        self.assertEqual(report.status, "passed")
        self.assertEqual(report.counts_by_answer_role["category_overview"], 1)
        self.assertEqual(report.counts_by_answer_role["eligibility_condition"], 1)
        self.assertEqual(report.counts_by_answer_role["table_fact"], 1)
        self.assertEqual(report.counts_by_content_role["policy_list"], 1)
        self.assertEqual(report.counts_by_content_role["table_fact"], 1)
        self.assertEqual(report.counts_by_claim_type["amount_or_quota"], 1)
        self.assertEqual(report.answer_ready_chunk_count, 3)
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
