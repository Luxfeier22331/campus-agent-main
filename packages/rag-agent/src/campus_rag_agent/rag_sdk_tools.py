from __future__ import annotations

from typing import Any

from campus_rag_agent.rag_sdk_models import RagSdkRunRequest


class RagSdkToolError(ValueError):
    def __init__(self, failure_class: str, message: str) -> None:
        super().__init__(f"{failure_class}: {message}")
        self.failure_class = failure_class
        self.message = message


def execute_retrieve_evidence_tool(
    request: RagSdkRunRequest,
    arguments: dict[str, Any],
) -> dict[str, object]:
    reject_model_supplied_scope_or_selector(arguments)
    query_slot_id = resolve_admitted_query_slot_id(
        arguments.get("query_slot_id"),
        admitted_query_slot_ids=request.query_intent.admitted_query_slot_ids,
    )
    if query_slot_id in request.selector_blocked_query_slot_ids:
        raise RagSdkToolError(
            "rag_sdk_selector_not_admitted",
            "RAG SDK selected query slot contains selector state not admitted for model choice",
        )
    return {
        "status": "completed",
        "query_slot_id": query_slot_id,
        "retrieval_intent": str(arguments.get("retrieval_intent") or "").strip(),
        "corpus": request.evidence.corpus,
        "collection": request.evidence.collection,
        "source_count": len(request.evidence.anchors),
        "anchors": [
            {
                "source_id": anchor.source_id,
                "chunk_id": anchor.chunk_id,
                "excerpt": anchor.excerpt,
                "span_ref": anchor.span_ref,
                "title": anchor.title,
                "url": anchor.url,
            }
            for anchor in request.evidence.anchors
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
__all__ = [
    "RagSdkToolError",
    "execute_retrieve_evidence_tool",
    "reject_model_supplied_scope_or_selector",
    "resolve_admitted_query_slot_id",
]
