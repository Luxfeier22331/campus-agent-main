from __future__ import annotations

from campus_rag_agent.rag_sdk_models import RagSdkRunRequest, RagSdkRunResult
from campus_rag_agent.rag_sdk_output import (
    RagSdkAnswerOutput,
    RagSdkClaim,
    RagSdkClaimSupport,
    RagSdkListItem,
    RagSdkListItemSupport,
)


class MockRagAgentsSdkRunner:
    def __call__(self, request: RagSdkRunRequest) -> RagSdkRunResult:
        if not request.evidence.anchors:
            return RagSdkRunResult(
                output=RagSdkAnswerOutput(
                    answer_text="未找到可支持回答的证据。",
                    answer_kind="no_answer",
                    semantic_outcome="unsupported_by_evidence",
                    confidence="low",
                    cited_source_ids=(),
                    unsupported_reason="no_evidence",
                ),
                trace_projection={
                    "schema_version": "rag-sdk-trace-projection-v1",
                    "runtime": "mock",
                    "tool_names": ["retrieve_evidence"],
                },
            )
        anchor = request.evidence.anchors[0]
        answer_text = anchor.excerpt.strip()
        claim_id = "mock-claim-1"
        return RagSdkRunResult(
            output=RagSdkAnswerOutput(
                answer_text=answer_text,
                answer_kind="short_answer",
                semantic_outcome="grounded_answer",
                confidence="medium",
                cited_source_ids=(anchor.source_id,),
                answer_items=(RagSdkListItem(text=answer_text, source_ids=(anchor.source_id,)),)
                if request.query_intent.task_kind == "category_discovery"
                else (),
                claims=(RagSdkClaim(claim_id=claim_id, text=answer_text),),
                claim_supports=(RagSdkClaimSupport(claim_id=claim_id, anchors=(anchor,)),),
                item_supports=(RagSdkListItemSupport(item_text=answer_text, anchors=(anchor,)),)
                if request.query_intent.task_kind == "category_discovery"
                else (),
                evidence_anchors=(anchor,),
            ),
            trace_projection={
                "schema_version": "rag-sdk-trace-projection-v1",
                "runtime": "mock",
                "tool_names": ["retrieve_evidence"],
            },
        )


__all__ = ["MockRagAgentsSdkRunner"]
