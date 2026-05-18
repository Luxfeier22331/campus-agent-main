from __future__ import annotations

import unittest
from unittest.mock import patch

from campus_ingestion_core.answer_ready_contract_quality import (
    evaluate_answer_ready_contract_metadata,
)
from campus_shared.regulation_semantic_patterns import build_category_overview_metadata
from campus_shared.regulation_semantic_registry import (
    resolve_regulation_condition_subject,
)


class RegulationSemanticRegressionsTest(unittest.TestCase):
    def test_positive_condition_subject_resolution_does_not_promote_safety_subject_from_domain_name(
        self,
    ) -> None:
        assignment = resolve_regulation_condition_subject(
            text=(
                "获得转段申请资格的强基生可以申请本专业所在一级学科各专业，"
                "也可申请符合国家重大战略需求的国家安全等人文社会学科领域相关专业。"
            ),
            answer_role="eligibility_condition",
            section_path=("第四章 转段范围",),
        )

        self.assertEqual(assignment.value, "generic_condition")
        self.assertEqual(assignment.provenance, "answer_role:generic_condition")

    def test_positive_condition_subject_resolution_keeps_security_subject_for_security_requirement(
        self,
    ) -> None:
        assignment = resolve_regulation_condition_subject(
            text="信息系统建设须达到学校安全等级要求后，经信息化建设管理处核准后接入校园网。",
            answer_role="eligibility_condition",
            section_path=("第四章 信息系统管理",),
        )

        self.assertEqual(assignment.value, "security_or_confidentiality_requirement")

    def test_positive_condition_subject_resolution_keeps_security_subject_for_confidentiality_requirement(
        self,
    ) -> None:
        assignment = resolve_regulation_condition_subject(
            text=(
                "学位论文主题、研究方向、主要内容或成果涉及国家秘密的，开题前导师和研究生"
                "须根据所执行科研项目的密级定密。"
            ),
            answer_role="eligibility_condition",
            section_path=("第二章 涉密学位论文的定密与申请",),
        )

        self.assertEqual(assignment.value, "security_or_confidentiality_requirement")

    def test_procedure_section_subject_resolution_does_not_promote_amount_clause_to_application_procedure(
        self,
    ) -> None:
        assignment = resolve_regulation_condition_subject(
            text=(
                "免试生名额分为普通班名额、校级创新实验班名额和奖惩名额。"
                "普通班名额以学生总数为基础按统一比例确定。"
            ),
            answer_role="eligibility_condition",
            section_path=("第四章 遴选办法及程序",),
        )

        self.assertEqual(assignment.value, "amount_or_quota")
        self.assertEqual(assignment.provenance, "keyword:额度上限")

    def test_answer_ready_validation_accepts_exception_rule_audience_scope_subject(self) -> None:
        result = evaluate_answer_ready_contract_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "exception_rule",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "institutional:article-003",
                "condition_subject": "audience_scope",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "section_path_leaf:audience_scope",
                "condition_group_id": "institutional:article-003:audience_scope",
                "condition_polarity": "positive",
                "is_answer_bearing": True,
                "content_role": "eligibility",
                "claim_type": "condition",
                "role_confidence": "high",
            },
        )

        self.assertEqual(result.status, "passed")

    def test_registry_facade_preserves_student_rules_query_planning_patch_point(self) -> None:
        payload = {
            "policy_objects": [
                {"document_id": "handbook:member-1", "title": "成员制度一"},
                {"document_id": "handbook:member-2", "title": "成员制度二"},
            ],
            "policy_categories": [
                {
                    "category_id": "custom-category",
                    "display_name": "事项",
                    "aliases": ["事项"],
                    "audience": "本科生",
                    "member_policy_document_ids": ["handbook:member-1", "handbook:member-2"],
                    "overview_document_id": "handbook:member-2",
                }
            ],
        }

        with patch(
            "campus_shared.regulation_semantic_registry._load_student_rules_query_planning_config",
            return_value=payload,
        ):
            self.assertEqual(
                build_category_overview_metadata(
                    collection="student_rules",
                    document_id="handbook:member-2",
                )[0]["metadata"]["member_policy_document_ids"],
                ["handbook:member-1", "handbook:member-2"],
            )


if __name__ == "__main__":
    unittest.main()
