from __future__ import annotations

import unittest

from campus_contracts import EvidenceBundle
from campus_rag_agent.rag_sdk_models import (
    RagQueryIntent,
    RagSdkEvidenceAnchor,
    RagSdkEvidenceProjection,
    RagTaskKind,
)
from campus_rag_agent.rag_sdk_output import (
    RagSdkAnswerOutput,
    RagSdkClaim,
    RagSdkClaimSupport,
    RagSdkListItem,
    RagSdkListItemSupport,
    validate_rag_sdk_answer_output,
)

from tests.agent.rag_agent_test_support import _make_handbook_source


class RagAgentSdkContractTest(unittest.TestCase):
    def test_internal_models_do_not_import_official_sdk_types(self) -> None:
        import campus_rag_agent.rag_sdk_models as sdk_models
        import campus_rag_agent.rag_sdk_output as sdk_output

        for module in (sdk_models, sdk_output):
            source_names = tuple(module.__dict__)
            self.assertNotIn("Agent", source_names)
            self.assertNotIn("Runner", source_names)
            self.assertNotIn("FunctionTool", source_names)

    def test_query_intent_represents_category_discovery_without_supervisor_rewrite(self) -> None:
        intent = RagQueryIntent(
            task_kind=RagTaskKind.CATEGORY_DISCOVERY,
            normalized_query="有哪些本科生可以申请的奖学金",
            category_id="scholarship",
            admitted_query_slot_ids=("indexed-lookup",),
        )

        self.assertEqual(intent.task_kind, RagTaskKind.CATEGORY_DISCOVERY)
        self.assertEqual(intent.category_id, "scholarship")
        self.assertFalse(intent.needs_clarification)

    def test_answer_output_accepts_claims_and_list_items_with_span_anchors(self) -> None:
        evidence = _evidence()
        projection = RagSdkEvidenceProjection.from_evidence_bundle(evidence)
        source = evidence.sources[0]
        anchor = RagSdkEvidenceAnchor(
            source_id=source.doc_id,
            chunk_id=source.chunk_id,
            excerpt="本科生可申请国家奖学金。",
            span_ref="chunk-0001:0-12",
        )
        output = RagSdkAnswerOutput(
            answer_text="本科生可申请国家奖学金。",
            answer_kind="list",
            semantic_outcome="grounded_answer",
            confidence="medium",
            cited_source_ids=(source.doc_id,),
            answer_items=(RagSdkListItem(text="国家奖学金", source_ids=(source.doc_id,)),),
            claims=(RagSdkClaim(claim_id="claim-1", text="本科生可申请国家奖学金。"),),
            claim_supports=(RagSdkClaimSupport(claim_id="claim-1", anchors=(anchor,)),),
            item_supports=(RagSdkListItemSupport(item_text="国家奖学金", anchors=(anchor,)),),
            evidence_anchors=(anchor,),
        )

        result = validate_rag_sdk_answer_output(output, evidence=projection)

        self.assertTrue(result.accepted)
        self.assertEqual(result.failure_reason, "")

    def test_answer_output_rejects_source_id_only_claim_support(self) -> None:
        evidence = _evidence()
        projection = RagSdkEvidenceProjection.from_evidence_bundle(evidence)
        source = evidence.sources[0]
        output = RagSdkAnswerOutput(
            answer_text="本科生可申请国家奖学金。",
            answer_kind="list",
            semantic_outcome="grounded_answer",
            confidence="medium",
            cited_source_ids=(source.doc_id,),
            answer_items=(RagSdkListItem(text="国家奖学金", source_ids=(source.doc_id,)),),
            claims=(RagSdkClaim(claim_id="claim-1", text="本科生可申请国家奖学金。"),),
            claim_supports=(
                RagSdkClaimSupport(
                    claim_id="claim-1",
                    anchors=(
                        RagSdkEvidenceAnchor(
                            source_id=source.doc_id,
                            chunk_id=source.chunk_id,
                            excerpt="",
                            span_ref="",
                        ),
                    ),
                ),
            ),
        )

        result = validate_rag_sdk_answer_output(output, evidence=projection)

        self.assertFalse(result.accepted)
        self.assertEqual(result.failure_reason, "claim_anchor_missing_span")

    def test_answer_output_rejects_uncited_list_items(self) -> None:
        evidence = _evidence()
        projection = RagSdkEvidenceProjection.from_evidence_bundle(evidence)
        source = evidence.sources[0]
        output = RagSdkAnswerOutput(
            answer_text="本科生可申请国家奖学金。",
            answer_kind="list",
            semantic_outcome="grounded_answer",
            confidence="medium",
            cited_source_ids=(source.doc_id,),
            answer_items=(RagSdkListItem(text="国家奖学金", source_ids=(source.doc_id,)),),
            claims=(),
            claim_supports=(),
            item_supports=(),
        )

        result = validate_rag_sdk_answer_output(output, evidence=projection)

        self.assertFalse(result.accepted)
        self.assertEqual(result.failure_reason, "list_item_support_missing")

    def test_answer_output_rejects_forged_source_id(self) -> None:
        evidence = _evidence()
        projection = RagSdkEvidenceProjection.from_evidence_bundle(evidence)
        output = RagSdkAnswerOutput(
            answer_text="伪造来源。",
            answer_kind="short_answer",
            semantic_outcome="grounded_answer",
            confidence="medium",
            cited_source_ids=("forged:source",),
        )

        result = validate_rag_sdk_answer_output(output, evidence=projection)

        self.assertFalse(result.accepted)
        self.assertEqual(result.failure_reason, "citation_not_in_evidence")


def _evidence() -> EvidenceBundle:
    return EvidenceBundle(
        query_text="有哪些本科生可以申请的奖学金",
        corpus="regulations",
        collection="student_rules",
        sources=(
            _make_handbook_source(
                doc_id="handbook:scholarship",
                title="中央民族大学本科生奖学金评定办法",
                snippet="本科生可申请国家奖学金、国家励志奖学金和校级奖学金。",
                score=0.91,
                chunk_id_suffix="scholarship-1",
                content_role="policy_list",
                is_answer_bearing=True,
            ),
        ),
    )


if __name__ == "__main__":
    unittest.main()
