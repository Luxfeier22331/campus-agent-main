from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from campus_contracts import AgentRequest, EvidenceBundle
from campus_retrieval_core import RetrievalPlan, RetrievalStep

from campus_rag_agent.rag_sdk_models import RagSdkEvidenceProjection


class RagSdkToolError(ValueError):
    def __init__(self, failure_class: str, message: str) -> None:
        super().__init__(f"{failure_class}: {message}")
        self.failure_class = failure_class
        self.message = message


@dataclass(frozen=True, slots=True)
class RagSdkToolExecutionContext:
    request: AgentRequest
    retrieval_plan: RetrievalPlan
    evidence: EvidenceBundle
    admitted_query_slot_ids: tuple[str, ...]


def execute_retrieve_evidence_tool(
    context: RagSdkToolExecutionContext,
    arguments: dict[str, Any],
) -> dict[str, object]:
    reject_model_supplied_scope_or_selector(arguments)
    query_slot_id = resolve_admitted_query_slot_id(
        arguments.get("query_slot_id"),
        admitted_query_slot_ids=context.admitted_query_slot_ids,
    )
    step = _step_by_id(context.retrieval_plan, query_slot_id)
    if step is None:
        raise RagSdkToolError(
            "rag_sdk_query_slot_not_admitted",
            "RAG SDK retrieval tool query slot is not present in the retrieval plan",
        )
    _validate_step_selector_is_bounded(step)
    projection = RagSdkEvidenceProjection.from_evidence_bundle(context.evidence)
    return {
        "status": "completed",
        "query_slot_id": query_slot_id,
        "retrieval_intent": str(arguments.get("retrieval_intent") or "").strip(),
        "corpus": projection.corpus,
        "collection": projection.collection,
        "source_count": len(projection.anchors),
        "anchors": [
            {
                "source_id": anchor.source_id,
                "chunk_id": anchor.chunk_id,
                "excerpt": anchor.excerpt,
                "span_ref": anchor.span_ref,
                "title": anchor.title,
                "url": anchor.url,
            }
            for anchor in projection.anchors
        ],
    }


def reject_model_supplied_scope_or_selector(arguments: dict[str, Any]) -> None:
    forbidden_keys = {
        "corpus",
        "collection",
        "scope",
        "target_document_ids",
        "target_version_ids",
        "target_revision_track",
        "authorization",
        "authorized_filter",
        "top_k",
        "serving_surface",
    }
    if forbidden_keys.intersection(arguments):
        raise RagSdkToolError(
            "rag_sdk_scope_widening_rejected",
            "RAG SDK tool arguments must not provide scope, selector, authz or budget fields",
        )


def resolve_admitted_query_slot_id(
    value: object,
    *,
    admitted_query_slot_ids: tuple[str, ...],
) -> str:
    if len(admitted_query_slot_ids) == 1:
        return admitted_query_slot_ids[0]
    query_slot_id = str(value or "").strip()
    if not query_slot_id or query_slot_id not in admitted_query_slot_ids:
        raise RagSdkToolError(
            "rag_sdk_query_slot_not_admitted",
            "RAG SDK retrieval tool may only select admitted query slots",
        )
    return query_slot_id


def _step_by_id(plan: RetrievalPlan, step_id: str) -> RetrievalStep | None:
    for step in plan.steps:
        if step.step_id == step_id:
            return step
    return None


def _validate_step_selector_is_bounded(step: RetrievalStep) -> None:
    selector = step.selector
    if selector.target_document_ids and step.step_id not in {
        "indexed-lookup",
        "entity-resolution",
        "historical-version-lookup",
        "compare-current-lookup",
        "compare-other-lookup",
    }:
        raise RagSdkToolError(
            "rag_sdk_selector_not_admitted",
            "RAG SDK selected query slot contains selector state not admitted for model choice",
        )


__all__ = [
    "RagSdkToolError",
    "RagSdkToolExecutionContext",
    "execute_retrieve_evidence_tool",
    "reject_model_supplied_scope_or_selector",
    "resolve_admitted_query_slot_id",
]
