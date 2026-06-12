from __future__ import annotations

import unittest

from campus_contracts import EvidenceBundle
from campus_knowledge_capability.rag_sdk_models import (
    RagQueryIntent,
    RagSdkEvidenceAnchor,
    RagSdkEvidenceProjection,
    RagTaskKind,
)
from campus_knowledge_capability.rag_sdk_output import (
    RagSdkAnswerOutput,
    RagSdkClaim,
    RagSdkClaimSupport,
    RagSdkListItem,
    RagSdkListItemSupport,
    validate_rag_sdk_answer_output,
)

from tests.agent.knowledge_capability_test_support import _make_handbook_source


class KnowledgeAgentsSdkEvalTest(unittest.TestCase):
    def test_scholarship_category_discovery_is_admitted_list_answer_case(self) -> None:
        evidence = _scholarship_evidence()
        projection = RagSdkEvidenceProjection.from_evidence_bundle(evidence)
        source = evidence.sources[0]
        anchor = RagSdkEvidenceAnchor(
            source_id=source.doc_id,
            chunk_id=source.chunk_id,
            excerpt=source.snippet,
            span_ref="chunk-0001:0-20",
        )
        intent = RagQueryIntent(
            task_kind=RagTaskKind.CATEGORY_DISCOVERY,
            normalized_query="有哪些本科生可以申请的奖学金",
            category_id="scholarship",
            admitted_query_slot_ids=("indexed-lookup",),
        )
        output = RagSdkAnswerOutput(
            answer_text="本科生可申请国家奖学金和国家励志奖学金。",
            answer_kind="list",
            semantic_outcome="grounded_answer",
            confidence="medium",
            cited_source_ids=(source.doc_id,),
            answer_items=(
                RagSdkListItem(text="国家奖学金", source_ids=(source.doc_id,)),
                RagSdkListItem(text="国家励志奖学金", source_ids=(source.doc_id,)),
            ),
            claims=(RagSdkClaim(claim_id="claim-1", text="本科生可申请国家奖学金。"),),
            claim_supports=(RagSdkClaimSupport(claim_id="claim-1", anchors=(anchor,)),),
            item_supports=(
                RagSdkListItemSupport(item_text="国家奖学金", anchors=(anchor,)),
                RagSdkListItemSupport(item_text="国家励志奖学金", anchors=(anchor,)),
            ),
        )

        self.assertEqual(intent.task_kind, RagTaskKind.CATEGORY_DISCOVERY)
        self.assertTrue(validate_rag_sdk_answer_output(output, evidence=projection).accepted)

    def test_portal_password_is_routing_negative_for_rag_sdk_eval(self) -> None:
        intent = RagQueryIntent(
            task_kind=RagTaskKind.UNSUPPORTED_SCOPE,
            normalized_query="门户密码忘了怎么办",
            unsupported_reason="service_identity_workflow",
        )

        self.assertEqual(intent.task_kind, RagTaskKind.UNSUPPORTED_SCOPE)
        self.assertEqual(intent.unsupported_reason, "service_identity_workflow")


def _scholarship_evidence() -> EvidenceBundle:
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
