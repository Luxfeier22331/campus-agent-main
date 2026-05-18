from __future__ import annotations

from campus_rag_agent.retrieval_intent import (
    RetrievalIntent,
    RetrievalIntentExpectation,
    RetrievalIntentTarget,
)
from campus_retrieval_core.evidence_attributes import INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY


def _answer_ready_anchor(**metadata: object) -> dict[str, object]:
    payload = {
        "evidence_contract_version": "answer_ready_evidence.v3",
        "parent_unit_id": "handbook:unit:article-1",
        **metadata,
    }
    return {INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: payload}


def _retrieval_intent(
    *,
    kind: str,
    answer_kind: str,
    corpus: str = "regulations",
    collection: str = "student_rules",
    document_ids: tuple[str, ...] = (),
    document_titles: tuple[str, ...] = (),
    condition_subject: str = "",
    evidence_roles: tuple[str, ...] = (),
    selection_policy: str = "default",
) -> RetrievalIntent:
    return RetrievalIntent(
        kind=kind,
        normalized_query="测试 query",
        expected=RetrievalIntentExpectation(
            answer_kind=answer_kind,
            evidence_roles=evidence_roles,
            selection_policy=selection_policy,
        ),
        target=RetrievalIntentTarget(
            corpus=corpus,
            collection=collection,
            document_ids=document_ids,
            document_titles=document_titles,
            condition_subject=condition_subject,
        ),
    )
