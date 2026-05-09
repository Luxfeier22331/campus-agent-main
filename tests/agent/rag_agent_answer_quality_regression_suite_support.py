# ruff: noqa: F401
from __future__ import annotations

from dataclasses import replace

from campus_rag_agent.agent_answer_shape import AnswerShape
from tests.agent.rag_agent_test_support import (
    EvidenceBundle,
    RagAgent,
    _make_curriculum_plan_source,
    _make_handbook_source,
    _make_program_semester_source,
    _select_answer_support_rows,
)

from campus_retrieval_core.evidence_attributes import INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY


def _answer_ready_anchor(**metadata: object) -> dict[str, object]:
    payload = {
        "evidence_contract_version": "answer_ready_evidence.v3",
        "parent_unit_id": "handbook:unit:article-1",
        **metadata,
    }
    return {INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: payload}


def _make_policy_source(
    *,
    doc_id: str,
    title: str,
    snippet: str,
    score: float,
    chunk: str,
    detail_label: str = "",
    collection: str = "student_rules",
):
    source = _make_handbook_source(
        doc_id=doc_id,
        title=title,
        snippet=snippet,
        score=score,
        chunk_id_suffix=chunk,
        detail_label=detail_label,
        content_role="eligibility",
        is_answer_bearing=True,
    )
    if collection == "student_rules":
        return source
    return source.__class__(
        doc_id=source.doc_id,
        revision_track=source.revision_track,
        version_id=source.version_id,
        chunk_id=source.chunk_id,
        anchor=source.anchor,
        canonical_url=source.canonical_url,
        latest_url=source.latest_url,
        source_channel=source.source_channel,
        collection=collection,
        is_current=source.is_current,
        snippet=source.snippet,
        score=source.score,
        source_title=source.source_title,
        structural_path=source.structural_path,
        content_kind=source.content_kind,
        content_role=source.content_role,
        detail_label=source.detail_label,
        is_answer_bearing=source.is_answer_bearing,
        canonical_source_id=source.canonical_source_id,
        canonical_source_title=source.canonical_source_title,
        source_unit_kind=source.source_unit_kind,
        source_unit_key=source.source_unit_key,
        source_trust_tier=source.source_trust_tier,
        remote_content_suspicion_labels=source.remote_content_suspicion_labels,
    )


__all__ = [name for name in globals() if not name.startswith("__")]
