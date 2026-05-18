from __future__ import annotations

from dataclasses import replace

from campus_ingestion_core.index_release_acceptance import (
    evaluate_release_chunk_quality,
)

from tests.ingestion.index_release_acceptance_test_support import (
    _make_chunk,
    _make_record,
)


class IndexReleaseAcceptanceChunkQualityCategorySuite:
    def test_release_chunk_quality_reports_category_overview_registry_conflicts(self) -> None:
        record = replace(
            _make_record(),
            document_id="official_web_regulation:0a420e3fe367027c",
            collection="institutional_rules",
            source_uri="https://docs.example/institutional-rule",
            cleaning_policy_version="institutional_rules_cleaning_v1",
            document_units_object_key=("regulations/institutional_rules/rule/document-units.jsonl"),
            processed_object_keys=("regulations/institutional_rules/rule/document-units.jsonl",),
        )
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    chunk_id="institutional_rules:rule:chunk-category-overview",
                    metadata={
                        "unit_type": "category_overview",
                        "root_unit_id": "institutional_rules:rule:category-overview:public_service",
                        "parent_unit_id": "category:public_service",
                        "display_text": "当前已收录依据中，校园服务制度相关制度包括：……",
                        "final_token_count": 32,
                        "chunk_policy_version": "institutional_rules_semantic_v1",
                        "cleaning_policy_version": "institutional_rules_cleaning_v1",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "category_overview",
                        "content_role": "policy_list",
                        "claim_type": "policy_list",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_polarity": "neutral",
                        "category_id": "public_service",
                        "category_registry_version": "policy_category_registry.v1",
                        "audience": "错误受众",
                        "member_policy_document_ids": ["official_web_regulation:not-in-registry"],
                        "member_policy_titles": ["不在 registry 中的制度"],
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "category_overview_audience_registry_conflict",
            report.summary["answer_ready_semantic_failures"],
        )
        self.assertIn(
            "category_overview_member_documents_registry_conflict",
            report.summary["answer_ready_semantic_failures"],
        )

    def test_release_chunk_quality_reports_category_overview_missing_typed_subject_contract(
        self,
    ) -> None:
        record = replace(
            _make_record(),
            document_id="official_web_regulation:0a420e3fe367027c",
            collection="institutional_rules",
            source_uri="https://docs.example/institutional-rule",
            cleaning_policy_version="institutional_rules_cleaning_v1",
            document_units_object_key=("regulations/institutional_rules/rule/document-units.jsonl"),
            processed_object_keys=("regulations/institutional_rules/rule/document-units.jsonl",),
        )
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    chunk_id="institutional_rules:rule:chunk-category-overview-missing-subject",
                    metadata={
                        "unit_type": "category_overview",
                        "root_unit_id": "institutional_rules:rule:category-overview:public_service",
                        "parent_unit_id": "category:public_service",
                        "display_text": "当前已收录依据中，校园服务制度相关制度包括：……",
                        "final_token_count": 32,
                        "chunk_policy_version": "institutional_rules_semantic_v1",
                        "cleaning_policy_version": "institutional_rules_cleaning_v1",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "category_overview",
                        "content_role": "policy_list",
                        "claim_type": "policy_list",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_polarity": "neutral",
                        "category_id": "public_service",
                        "category_registry_version": "policy_category_registry.v1",
                        "audience": "校园成员",
                        "member_policy_document_ids": ["official_web_regulation:0a420e3fe367027c"],
                        "member_policy_titles": ["中央民族大学校园卡管理办法"],
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_condition_subject_missing",
            report.summary["answer_ready_required_field_failures"],
        )
        self.assertIn(
            "answer_ready_condition_subject_taxonomy_version_missing",
            report.summary["answer_ready_required_field_failures"],
        )
        self.assertIn(
            "answer_ready_condition_subject_provenance_missing",
            report.summary["answer_ready_required_field_failures"],
        )

    def test_release_chunk_quality_reports_category_overview_missing_group_contract(
        self,
    ) -> None:
        record = replace(
            _make_record(),
            document_id="official_web_regulation:0a420e3fe367027c",
            collection="institutional_rules",
            source_uri="https://docs.example/institutional-rule",
            cleaning_policy_version="institutional_rules_cleaning_v1",
            document_units_object_key=("regulations/institutional_rules/rule/document-units.jsonl"),
            processed_object_keys=("regulations/institutional_rules/rule/document-units.jsonl",),
        )
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    chunk_id="institutional_rules:rule:chunk-category-overview-missing-group",
                    metadata={
                        "unit_type": "category_overview",
                        "root_unit_id": "institutional_rules:rule:category-overview:public_service",
                        "parent_unit_id": "category:public_service",
                        "display_text": "当前已收录依据中，校园服务制度相关制度包括：……",
                        "final_token_count": 32,
                        "chunk_policy_version": "institutional_rules_semantic_v1",
                        "cleaning_policy_version": "institutional_rules_cleaning_v1",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "category_overview",
                        "content_role": "policy_list",
                        "claim_type": "policy_list",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_subject": "audience_scope",
                        "condition_subject_taxonomy_version": "condition_subject.v1",
                        "condition_subject_provenance": "category_registry:audience_scope",
                        "condition_polarity": "neutral",
                        "category_id": "public_service",
                        "category_registry_version": "policy_category_registry.v1",
                        "audience": "校园成员",
                        "member_policy_document_ids": ["official_web_regulation:0a420e3fe367027c"],
                        "member_policy_titles": ["中央民族大学校园卡管理办法"],
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "answer_ready_condition_group_id_missing",
            report.summary["answer_ready_required_field_failures"],
        )

    def test_release_chunk_quality_reports_category_overview_registry_title_conflicts(
        self,
    ) -> None:
        record = replace(
            _make_record(),
            document_id="official_web_regulation:0a420e3fe367027c",
            collection="institutional_rules",
            source_uri="https://docs.example/institutional-rule",
            cleaning_policy_version="institutional_rules_cleaning_v1",
            document_units_object_key=("regulations/institutional_rules/rule/document-units.jsonl"),
            processed_object_keys=("regulations/institutional_rules/rule/document-units.jsonl",),
        )
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    chunk_id="institutional_rules:rule:chunk-category-overview-title-conflict",
                    metadata={
                        "unit_type": "category_overview",
                        "root_unit_id": "institutional_rules:rule:category-overview:public_service",
                        "parent_unit_id": "category:public_service",
                        "display_text": "当前已收录依据中，校园服务制度相关制度包括：……",
                        "final_token_count": 32,
                        "chunk_policy_version": "institutional_rules_semantic_v1",
                        "cleaning_policy_version": "institutional_rules_cleaning_v1",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "category_overview",
                        "content_role": "policy_list",
                        "claim_type": "policy_list",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                        "condition_polarity": "neutral",
                        "category_id": "public_service",
                        "category_registry_version": "policy_category_registry.v1",
                        "audience": "校园成员",
                        "member_policy_document_ids": [
                            "official_web_regulation:0a420e3fe367027c",
                            "official_web_regulation:b23aa5f14642eb92",
                            "official_web_regulation:5defea25436a134e",
                            "official_web_regulation:b1c19829dcb2f9c9",
                            "official_web_regulation:e350a6f1f7c0fdb2",
                            "official_web_regulation:7c62688242b9f47b",
                            "official_web_regulation:91431d30da51d124",
                            "official_web_regulation:b082a6b801811a1e",
                            "official_web_regulation:ce565b348ca6ee31",
                            "official_web_regulation:bffa1b7b85e9842f",
                        ],
                        "member_policy_titles": ["错误标题"] * 10,
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "category_overview_member_titles_registry_conflict",
            report.summary["answer_ready_semantic_failures"],
        )

    def test_institutional_rules_release_chunk_quality_uses_regulation_contract_gate(
        self,
    ) -> None:
        record = replace(
            _make_record(),
            document_id="institutional_rules:rule",
            collection="institutional_rules",
            source_uri="https://docs.example/institutional-rule",
            cleaning_policy_version="institutional_rules_cleaning_v1",
            document_units_object_key=("regulations/institutional_rules/rule/document-units.jsonl"),
            processed_object_keys=("regulations/institutional_rules/rule/document-units.jsonl",),
        )
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    chunk_id="institutional_rules:rule:chunk-0001",
                    metadata={
                        "unit_type": "institutional_regulation_block",
                        "root_unit_id": "institutional_rules:rule:article-1",
                        "parent_unit_id": "institutional_rules:rule:article-1",
                        "display_text": "申请人提交申请材料。",
                        "final_token_count": 32,
                        "chunk_policy_version": "institutional_rules_semantic_v1",
                        "cleaning_policy_version": "institutional_rules_cleaning_v1",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "answer_role": "procedure_step",
                        "content_role": "procedure",
                        "claim_type": "procedure",
                        "role_confidence": "high",
                        "is_answer_bearing": True,
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertEqual(report.summary["answer_ready_contract_status"], "failed")
        self.assertIn("chunk_contract_missing", report.summary["failure_classes"])
        self.assertIn(
            "answer_ready_condition_group_id_missing",
            report.summary["answer_ready_required_field_failures"],
        )
        self.assertIn(
            "answer_ready_condition_group_id_missing",
            report.summary["issues_by_chunk_id"]["institutional_rules:rule:chunk-0001"],
        )
        self.assertIn(
            "answer_ready_procedure_step_fields_missing",
            report.summary["issues_by_chunk_id"]["institutional_rules:rule:chunk-0001"],
        )
