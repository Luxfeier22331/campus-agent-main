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
from campus_rag_agent.retrieval_intent import (
    RetrievalIntent,
    RetrievalIntentExpectation,
    RetrievalIntentTarget,
)
from campus_rag_agent.service_answer_synthesis import build_rag_query_intent

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

    def test_sdk_query_intent_projects_from_retrieval_intent_not_raw_query_cues(self) -> None:
        query_intent = build_rag_query_intent(
            user_goal="中央民族大学学生申诉处理办法",
            retrieval_plan=_plan_stub(),
            intent_frame=None,
            retrieval_intent=RetrievalIntent(
                kind="condition_table",
                normalized_query="中央民族大学学生申诉处理办法",
                expected=RetrievalIntentExpectation(answer_kind="condition_table"),
                target=RetrievalIntentTarget(
                    corpus="regulations",
                    collection="institutional_rules",
                    document_ids=("handbook:appeal",),
                    condition_subject="deadline",
                ),
            ),
        )

        self.assertEqual(query_intent.task_kind, RagTaskKind.SPECIFIC_POLICY_LOOKUP)
        self.assertEqual(query_intent.normalized_query, "中央民族大学学生申诉处理办法")

    def test_sdk_run_request_carries_typed_answer_projection_for_supported_regulation_path(
        self,
    ) -> None:
        from campus_rag_agent.agent_answer_shape import AnswerShape
        from campus_rag_agent.rag_sdk_models import RagSdkRunRequest
        from campus_rag_agent.typed_answer_drafts import build_typed_answer_draft

        source = _evidence().sources[0]
        draft = build_typed_answer_draft(
            answer_shape=AnswerShape.CATEGORY_DISCOVERY_LIST,
            selected_rows=((source, (source.snippet,)),),
            retrieval_intent=RetrievalIntent(
                kind="policy_list",
                normalized_query="有哪些本科生可以申请的奖学金",
                expected=RetrievalIntentExpectation(answer_kind="policy_list"),
                target=RetrievalIntentTarget(
                    corpus="regulations",
                    collection="student_rules",
                    category_id="scholarship",
                    category_member_document_ids=("handbook:scholarship",),
                ),
            ),
        )

        request = RagSdkRunRequest(
            user_goal="有哪些本科生可以申请的奖学金",
            query_intent=RagQueryIntent(
                task_kind=RagTaskKind.CATEGORY_DISCOVERY,
                normalized_query="有哪些本科生可以申请的奖学金",
                category_id="scholarship",
            ),
            evidence=RagSdkEvidenceProjection.from_evidence_bundle(_evidence()),
            typed_answer=draft,
        )

        self.assertEqual(request.typed_answer.kind, "policy_list")

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


def _plan_stub():
    from campus_retrieval_core import (
        RetrievalPlan,
        RetrievalPlanBudget,
        RetrievalScope,
        RetrievalStep,
    )

    return RetrievalPlan(
        plan_id="regulations:student_rules:current:test",
        query_mode="current",
        admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
        budget=RetrievalPlanBudget(max_steps=1, max_replans=0),
        steps=(
            RetrievalStep(
                step_id="indexed-lookup",
                step_type="indexed_lookup",
                scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                query_text="中央民族大学学生申诉处理办法",
            ),
        ),
    )
