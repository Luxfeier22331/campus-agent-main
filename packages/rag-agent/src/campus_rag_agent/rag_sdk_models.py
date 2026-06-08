from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

from campus_contracts import EvidenceBundle
from campus_contracts.schema_metadata import schema_metadata
from campus_prompt_runtime import NormalizedProviderGroundingSupport

from .typed_answer_drafts import TypedAnswerDraft


class RagTaskKind(StrEnum):
    SPECIFIC_POLICY_LOOKUP = "specific_policy_lookup"
    CATEGORY_DISCOVERY = "category_discovery"
    AMBIGUOUS_PROCEDURE = "ambiguous_procedure"
    FACT_LOOKUP = "fact_lookup"
    COMPARISON = "comparison"
    UNSUPPORTED_SCOPE = "unsupported_scope"


@dataclass(frozen=True, slots=True)
class RagQueryIntent:
    task_kind: RagTaskKind
    normalized_query: str
    category_id: str = ""
    admitted_query_slot_ids: tuple[str, ...] = field(default_factory=tuple)
    needs_clarification: bool = False
    unsupported_reason: str = ""

    def __post_init__(self) -> None:
        if not self.normalized_query.strip():
            raise ValueError("normalized_query must not be empty")
        if self.needs_clarification and self.task_kind == RagTaskKind.CATEGORY_DISCOVERY:
            raise ValueError("category_discovery must not be pre-marked as clarification")


@dataclass(frozen=True, slots=True)
class RagSdkEvidenceAnchor:
    source_id: str
    chunk_id: str = ""
    excerpt: str = ""
    span_ref: str = ""
    title: str = ""
    url: str = ""

    @property
    def has_span_support(self) -> bool:
        return bool(self.source_id.strip() and self.excerpt.strip() and self.span_ref.strip())


@dataclass(frozen=True, slots=True)
class RagSdkEvidenceProjection:
    corpus: str
    collection: str
    query_text: str
    anchors: tuple[RagSdkEvidenceAnchor, ...] = field(default_factory=tuple)

    @classmethod
    def from_evidence_bundle(cls, evidence: EvidenceBundle) -> RagSdkEvidenceProjection:
        return cls(
            corpus=evidence.corpus,
            collection=evidence.collection,
            query_text=evidence.query_text,
            anchors=tuple(
                RagSdkEvidenceAnchor(
                    source_id=source.doc_id,
                    chunk_id=source.chunk_id,
                    excerpt=source.snippet,
                    span_ref=_span_ref_for_source(source),
                    title=source.source_title,
                    url=source.canonical_url or source.latest_url,
                )
                for source in evidence.sources
            ),
        )

    @property
    def source_ids(self) -> frozenset[str]:
        return frozenset(anchor.source_id for anchor in self.anchors if anchor.source_id.strip())

    @property
    def chunk_ids(self) -> frozenset[str]:
        return frozenset(anchor.chunk_id for anchor in self.anchors if anchor.chunk_id.strip())


@dataclass(frozen=True, slots=True)
class RagSdkRunRequest:
    user_goal: str
    query_intent: RagQueryIntent
    evidence: RagSdkEvidenceProjection
    typed_answer: TypedAnswerDraft | None = None
    request_id: str = ""
    workflow_run_ref: str = ""
    workflow_step_id: str = ""
    selector_blocked_query_slot_ids: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class RagSdkRetrieveEvidenceArguments:
    query_slot_id: str = field(
        default="",
        metadata=schema_metadata(description="One of the admitted deterministic query slot ids."),
    )
    retrieval_intent: str = field(
        default="",
        metadata=schema_metadata(
            description="Short semantic label for the requested evidence.",
            semantic_required=True,
        ),
    )


@dataclass(frozen=True, slots=True)
class RagSdkRunResult:
    output: object
    trace_projection: object | None = None
    failure_class: str = ""
    failure_detail: str = ""
    latency_ms: int = 0
    provider_grounding_supports: tuple[NormalizedProviderGroundingSupport, ...] = field(
        default_factory=tuple
    )


def _span_ref_for_source(source) -> str:
    anchor = source.anchor
    for key in ("span_ref", "text_span", "page_start", "segment_ord", "retrieval_step_ids"):
        value = anchor.get(key)
        if value not in {None, "", ()}:
            return f"{key}:{value}"
    return source.chunk_id


__all__ = [
    "RagQueryIntent",
    "RagSdkEvidenceAnchor",
    "RagSdkEvidenceProjection",
    "RagSdkRetrieveEvidenceArguments",
    "RagSdkRunRequest",
    "RagSdkRunResult",
    "RagTaskKind",
]
