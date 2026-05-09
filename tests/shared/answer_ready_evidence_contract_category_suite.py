from __future__ import annotations

from campus_shared.answer_ready_evidence_contract import validate_answer_ready_evidence_metadata
from campus_shared.regulation_semantic_registry import load_regulation_discovery_config


class AnswerReadyEvidenceContractCategorySuite:
    def test_category_overview_requires_generalized_member_registry_fields(self) -> None:
        discovery = load_regulation_discovery_config("institutional_rules")
        category = next(
            item for item in discovery.categories if item.category_id == "public_service"
        )
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "category_overview",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": f"category:{category.category_id}",
                "condition_subject": "audience_scope",
                "condition_group_subject": "audience_scope",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "category_registry:audience_scope",
                "condition_group_id": f"category:{category.category_id}:audience_scope",
                "category_id": category.category_id,
                "condition_polarity": "neutral",
                "category_registry_version": "policy_category_registry.v1",
                "audience": category.audience,
                "member_policy_document_ids": list(category.member_policy_document_ids),
                "member_policy_titles": [
                    discovery.policy_titles_by_document_id[document_id]
                    for document_id in category.member_policy_document_ids
                ],
            },
            content_role="policy_list",
            unit_type="category_overview",
        )

        self.assertEqual(result.status, "passed")

    def test_category_overview_fails_without_member_registry_fields(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "category_overview",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "category:appeal",
                "category_id": "appeal",
                "condition_polarity": "neutral",
            },
            content_role="policy_list",
            unit_type="category_overview",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("category_overview_registry_version_missing", result.issues)
        self.assertIn("category_overview_audience_missing", result.issues)
        self.assertIn("category_overview_missing_member_document_ids", result.issues)
        self.assertIn("category_overview_missing_member_titles", result.issues)

    def test_category_overview_fails_without_typed_condition_subject_contract(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "category_overview",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "category:appeal",
                "condition_polarity": "neutral",
                "category_id": "appeal",
                "category_registry_version": "policy_category_registry.v1",
                "audience": "校园成员",
                "member_policy_document_ids": ["official_web_regulation:0a420e3fe367027c"],
                "member_policy_titles": ["中央民族大学校园卡管理办法"],
            },
            content_role="policy_list",
            unit_type="category_overview",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_condition_subject_missing", result.issues)
        self.assertIn(
            "answer_ready_condition_subject_taxonomy_version_missing",
            result.issues,
        )
        self.assertIn("answer_ready_condition_subject_provenance_missing", result.issues)

    def test_category_overview_fails_when_registry_membership_is_inconsistent(self) -> None:
        discovery = load_regulation_discovery_config("institutional_rules")
        category = next(
            item for item in discovery.categories if item.category_id == "public_service"
        )
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "category_overview",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": f"category:{category.category_id}",
                "category_id": category.category_id,
                "condition_polarity": "neutral",
                "category_registry_version": "policy_category_registry.v1",
                "audience": "错误受众",
                "member_policy_document_ids": ["official_web_regulation:not-in-registry"],
                "member_policy_titles": ["不在 registry 中的制度"],
            },
            content_role="policy_list",
            unit_type="category_overview",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("category_overview_audience_registry_conflict", result.issues)
        self.assertIn("category_overview_member_documents_registry_conflict", result.issues)

    def test_category_overview_fails_when_registry_titles_are_inconsistent(self) -> None:
        discovery = load_regulation_discovery_config("institutional_rules")
        category = next(
            item for item in discovery.categories if item.category_id == "public_service"
        )
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "category_overview",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": f"category:{category.category_id}",
                "category_id": category.category_id,
                "condition_polarity": "neutral",
                "category_registry_version": "policy_category_registry.v1",
                "audience": category.audience,
                "member_policy_document_ids": list(category.member_policy_document_ids),
                "member_policy_titles": ["错误标题"] * len(category.member_policy_document_ids),
            },
            content_role="policy_list",
            unit_type="category_overview",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("category_overview_member_titles_registry_conflict", result.issues)

    def test_category_overview_fails_when_category_id_is_unknown(self) -> None:
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "category_overview",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "category:not_registered",
                "category_id": "not_registered",
                "condition_polarity": "neutral",
                "category_registry_version": "policy_category_registry.v1",
                "audience": "校园成员",
                "member_policy_document_ids": ["official_web_regulation:0a420e3fe367027c"],
                "member_policy_titles": ["中央民族大学校园卡管理办法"],
            },
            content_role="policy_list",
            unit_type="category_overview",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("category_overview_category_id_unknown", result.issues)

    def test_category_overview_fails_without_group_contract(self) -> None:
        discovery = load_regulation_discovery_config("institutional_rules")
        category = next(
            item for item in discovery.categories if item.category_id == "public_service"
        )
        result = validate_answer_ready_evidence_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "category_overview",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": f"category:{category.category_id}",
                "condition_subject": "audience_scope",
                "condition_subject_taxonomy_version": "condition_subject.v1",
                "condition_subject_provenance": "category_registry:audience_scope",
                "condition_polarity": "neutral",
                "category_id": category.category_id,
                "category_registry_version": "policy_category_registry.v1",
                "audience": category.audience,
                "member_policy_document_ids": list(category.member_policy_document_ids),
                "member_policy_titles": [
                    discovery.policy_titles_by_document_id[document_id]
                    for document_id in category.member_policy_document_ids
                ],
            },
            content_role="policy_list",
            unit_type="category_overview",
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("answer_ready_condition_group_id_missing", result.issues)
