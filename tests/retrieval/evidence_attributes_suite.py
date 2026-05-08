from __future__ import annotations

import unittest

from campus_contracts import EvidenceSource
from campus_retrieval_core.backend_qdrant_evidence import build_evidence_sources
from campus_retrieval_core.evidence_attributes import (
    INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY,
    build_internal_evidence_attribute_payload,
    evidence_attributes_for_source,
    evidence_fallback_diagnostics_for_source,
)
from qdrant_client.http import models as qdrant_models

from tests.retrieval.backend_qdrant_test_support import (
    InMemoryDocumentRegistry,
    Mock,
    MockEmbeddingSettings,
    MockSparseEmbeddingSettings,
    QdrantRetrievalBackend,
    RetrievalSettings,
    build_mock_embedding_model,
    build_mock_sparse_embedding_model,
)


def _make_source(
    *,
    semantic_role: str = "",
    polarity: str = "",
    action_type: str = "",
    claim_type: str = "",
    anchor: dict[str, object] | None = None,
) -> EvidenceSource:
    return EvidenceSource(
        doc_id="handbook:demerit-relief",
        revision_track="source-faithful",
        version_id="v1",
        chunk_id="chunk-1",
        anchor=anchor or {},
        canonical_url="https://campus.example/rules",
        latest_url="https://campus.example/rules",
        source_channel="pdf_ocr",
        collection="student_rules",
        is_current=True,
        snippet="学生受处分满考察期后，可以申请解除纪律处分。",
        score=0.7,
        semantic_role=semantic_role,
        polarity=polarity,
        action_type=action_type,
        claim_type=claim_type,
        is_answer_bearing=True,
    )


class EvidenceAttributesTest(unittest.TestCase):
    def test_internal_attribute_payload_uses_shared_answer_ready_field_set(self) -> None:
        payload = build_internal_evidence_attribute_payload(
            {
                "answer_role": "eligibility_intro",
                "condition_group_subject": "rank_threshold",
                "parent_unit_id": "article-1",
                "clause_unit_id": "article-1:2",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "intro_scope": "eligibility_group",
                "introduced_condition_group_id": "article-1:rank_threshold",
                "intro_target_roles": ["eligibility_condition"],
                "procedure_action": "submit_materials",
                "unrelated_payload": "ignored",
            }
        )

        self.assertEqual(payload["intro_scope"], "eligibility_group")
        self.assertEqual(payload["condition_group_subject"], "rank_threshold")
        self.assertEqual(payload["clause_unit_id"], "article-1:2")
        self.assertEqual(payload["introduced_condition_group_id"], "article-1:rank_threshold")
        self.assertEqual(payload["intro_target_roles"], ["eligibility_condition"])
        self.assertEqual(payload["procedure_action"], "submit_materials")
        self.assertNotIn("unrelated_payload", payload)

    def test_old_public_evidence_source_remains_readable_with_legacy_fallbacks(self) -> None:
        source = _make_source(
            semantic_role="procedure_step",
            polarity="positive",
            action_type="lift_discipline",
            claim_type="procedure",
        )

        attributes = evidence_attributes_for_source(source)

        self.assertEqual(attributes.answer_role, "procedure_step")
        self.assertEqual(attributes.polarity, "positive")
        self.assertEqual(attributes.action_type, "lift_discipline")
        self.assertEqual(attributes.claim_type, "procedure")
        self.assertIn("evidence_contract_version", attributes.missing_contract_fields)

    def test_qdrant_payload_projects_answer_ready_metadata_to_internal_accessor(self) -> None:
        backend = QdrantRetrievalBackend(
            settings=RetrievalSettings(
                qdrant_url=":memory:",
                document_registry_database_url="postgresql://registry.example/postgres",
            ),
            registry=InMemoryDocumentRegistry(),
            qdrant_client=Mock(),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
            sparse_embedding_model=build_mock_sparse_embedding_model(MockSparseEmbeddingSettings()),
        )

        sources = build_evidence_sources(
            backend,
            (
                qdrant_models.ScoredPoint(
                    id="point-discipline-procedure",
                    version=0,
                    score=0.83,
                    payload={
                        "document_id": "handbook:demerit-relief",
                        "revision_track": "source-faithful",
                        "version_id": "v1:demerit-relief",
                        "chunk_id": "discipline-positive-procedure",
                        "collection": "student_rules",
                        "canonical_url": "https://campus.example/handbook/demerit-relief",
                        "latest_url": "https://campus.example/handbook/demerit-relief",
                        "source_channel": "pdf_ocr",
                        "is_current": True,
                        "title": "中央民族大学解除学生纪律处分实施办法",
                        "unit_type": "article_body",
                        "content_role": "procedure",
                        "is_answer_bearing": True,
                        "answer_role": "procedure_step",
                        "condition_subject": "discipline_relief_condition",
                        "condition_group_subject": "application_procedure",
                        "condition_group_id": "handbook:demerit-relief:article-3:application_procedure",
                        "parent_unit_id": "handbook:demerit-relief:article-3",
                        "clause_unit_id": "handbook:demerit-relief:article-3:1",
                        "evidence_contract_version": "answer_ready_evidence.v3",
                        "procedure_step_index": 1,
                        "procedure_actor": "student",
                        "procedure_action": "submit_materials",
                        "procedure_materials": ["解除处分申请表"],
                        "procedure_next_actor": "college",
                        "intro_scope": "eligibility_group",
                        "introduced_condition_group_id": "handbook:demerit-relief:article-3:application_procedure",
                        "intro_target_roles": ["procedure_step"],
                        "semantic_role": "procedure_step",
                        "polarity": "positive",
                        "action_type": "lift_discipline",
                        "claim_type": "procedure",
                        "anchor": {"section_path": ["解除处分"], "article_label": "第三条"},
                        "text": "学生受处分满考察期后，可以提交解除处分申请表。",
                    },
                ),
            ),
        )

        attributes = evidence_attributes_for_source(sources[0])

        self.assertEqual(attributes.answer_role, "procedure_step")
        self.assertEqual(attributes.condition_subject, "discipline_relief_condition")
        self.assertEqual(attributes.condition_group_subject, "application_procedure")
        self.assertEqual(
            attributes.condition_group_id,
            "handbook:demerit-relief:article-3:application_procedure",
        )
        self.assertEqual(attributes.parent_unit_id, "handbook:demerit-relief:article-3")
        self.assertEqual(attributes.clause_unit_id, "handbook:demerit-relief:article-3:1")
        self.assertEqual(attributes.evidence_contract_version, "answer_ready_evidence.v3")
        self.assertEqual(attributes.procedure.step_index, 1)
        self.assertEqual(attributes.procedure.actor, "student")
        self.assertEqual(attributes.procedure.action, "submit_materials")
        self.assertEqual(attributes.procedure.materials, ("解除处分申请表",))
        self.assertEqual(attributes.procedure.next_actor, "college")
        self.assertEqual(attributes.missing_contract_fields, ())

    def test_evidence_attributes_recover_condition_group_subject_from_group_id(self) -> None:
        source = _make_source(
            anchor={
                INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                    "answer_role": "procedure_step",
                    "condition_subject": "application_procedure",
                    "condition_group_id": "handbook:student-card:article-3:application_procedure",
                    "parent_unit_id": "handbook:student-card:article-3",
                    "evidence_contract_version": "answer_ready_evidence.v3",
                    "procedure_step_index": 1,
                    "procedure_actor": "student",
                    "procedure_action": "submit_materials",
                    "procedure_action_taxonomy_version": "procedure_action.v1",
                    "procedure_action_provenance": "keyword:提交+材料",
                }
            }
        )

        attributes = evidence_attributes_for_source(source)

        self.assertEqual(attributes.condition_group_subject, "application_procedure")

    def test_fallback_diagnostics_flag_incomplete_v3_procedure_contract(self) -> None:
        source = _make_source(
            anchor={
                INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                    "answer_role": "procedure_step",
                    "condition_subject": "application_procedure",
                    "condition_group_id": "handbook:student-card:article-3:application_procedure",
                    "parent_unit_id": "handbook:student-card:article-3",
                    "evidence_contract_version": "answer_ready_evidence.v3",
                }
            }
        )

        diagnostics = evidence_fallback_diagnostics_for_source(source)

        self.assertTrue(diagnostics.fallback_used)
        self.assertEqual(diagnostics.fallback_reason, "missing_contract")
        self.assertIn("condition_polarity", diagnostics.missing_contract_fields)
        self.assertIn("procedure_step_index", diagnostics.missing_contract_fields)
        self.assertIn("procedure_actor", diagnostics.missing_contract_fields)
        self.assertIn("procedure_action", diagnostics.missing_contract_fields)


if __name__ == "__main__":
    unittest.main()
