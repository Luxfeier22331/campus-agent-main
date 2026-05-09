from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_retrieval_core.evidence_attributes import evidence_attributes_for_source
from campus_retrieval_core.evidence_ranking import select_supporting_evidence_sources

from .agent_answer_shape import (
    AnswerShape,
    answer_shape_from_retrieval_intent,
    answer_shape_support_budget,
    infer_answer_shape,
)
from .agent_answering import _compose_direct_answer, _render_supporting_contexts
from .agent_selection_query import _query_mode
from .agent_selection_rows import _select_answer_support_rows
from .retrieval_intent import RetrievalIntent
from .typed_answer_drafts import (
    CategoryDiscoveryDraftContext,
    TypedAnswerDraft,
    build_typed_answer_draft,
    validate_typed_answer_draft,
)

DEFAULT_MAX_ANSWER_SOURCES = 3
__all__ = (
    "DEFAULT_MAX_ANSWER_SOURCES",
    "AnswerDraft",
    "RagAgent",
    "_query_mode",
    "_select_answer_support_rows",
)


@dataclass(frozen=True, slots=True)
class AnswerDraft:
    answer_text: str
    supporting_sources: tuple[EvidenceSource, ...]
    supporting_contexts: tuple[str, ...] = ()
    typed_draft: TypedAnswerDraft = field(
        default_factory=lambda: TypedAnswerDraft(kind="unsupported", unsupported_reason="empty")
    )


@dataclass(frozen=True, slots=True)
class RagAgent:
    runtime_provider: str = ""
    max_answer_sources: int = DEFAULT_MAX_ANSWER_SOURCES

    def build_answer(
        self,
        evidence: EvidenceBundle,
        *,
        answer_shape: AnswerShape | None = None,
        category_id: str = "",
        category_display_name: str = "",
        audience: str = "",
        retrieval_intent: RetrievalIntent | None = None,
    ) -> AnswerDraft:
        if not evidence.sources:
            return AnswerDraft(
                answer_text="",
                supporting_sources=(),
                supporting_contexts=(),
                typed_draft=TypedAnswerDraft(
                    kind="unsupported",
                    unsupported_reason="no_supporting_evidence",
                ),
            )

        answer_shape = answer_shape or (
            answer_shape_from_retrieval_intent(retrieval_intent)
            if retrieval_intent is not None
            else infer_answer_shape(evidence=evidence)
        )
        resolved_category_display_name = category_display_name
        resolved_audience = audience
        if answer_shape == AnswerShape.CATEGORY_DISCOVERY_LIST and (
            not resolved_category_display_name or not resolved_audience
        ):
            inferred_category_display_name, inferred_audience = _infer_category_context(
                evidence.sources
            )
            if not resolved_category_display_name:
                resolved_category_display_name = inferred_category_display_name
            if not resolved_audience:
                resolved_audience = inferred_audience
        support_budget = answer_shape_support_budget(answer_shape, self.max_answer_sources)
        if support_budget > self.max_answer_sources:
            candidate_sources = _select_doc_diverse_answer_sources(
                sources=evidence.sources,
                max_sources=support_budget,
            )
        else:
            candidate_sources = select_supporting_evidence_sources(
                query_text=evidence.query_text,
                sources=evidence.sources,
                max_sources=support_budget,
            )
        selected_rows = _select_answer_support_rows(
            query_text=evidence.query_text,
            sources=candidate_sources,
            max_sources=support_budget,
            answer_shape=answer_shape,
            retrieval_intent=retrieval_intent,
        )
        supporting_sources = tuple(source for source, _ in selected_rows)
        supporting_contexts = _render_supporting_contexts(selected_rows)
        answer_text = _compose_direct_answer(
            evidence=evidence,
            selected_rows=selected_rows,
            answer_shape=answer_shape,
            category_display_name=resolved_category_display_name,
            audience=resolved_audience,
        )
        typed_draft = build_typed_answer_draft(
            answer_shape=answer_shape,
            selected_rows=selected_rows,
            category_discovery_context=(
                CategoryDiscoveryDraftContext(
                    collection=evidence.collection,
                    category_id=category_id,
                    category_display_name=resolved_category_display_name,
                    audience=resolved_audience,
                )
                if answer_shape == AnswerShape.CATEGORY_DISCOVERY_LIST
                else None
            ),
            retrieval_intent=retrieval_intent,
        )
        validation = validate_typed_answer_draft(
            typed_draft,
            expected_answer_kind=(
                retrieval_intent.expected.answer_kind if retrieval_intent is not None else ""
            ),
        )
        if validation.verdict != "valid":
            answer_text = ""
        return AnswerDraft(
            answer_text=answer_text,
            supporting_sources=supporting_sources,
            supporting_contexts=supporting_contexts,
            typed_draft=typed_draft,
        )

    def compose_answer(
        self,
        evidence: EvidenceBundle,
        *,
        retrieval_intent: RetrievalIntent | None = None,
    ) -> str:
        return self.build_answer(evidence, retrieval_intent=retrieval_intent).answer_text


def _infer_category_context(sources: tuple[EvidenceSource, ...]) -> tuple[str, str]:
    for source in sources:
        attributes = evidence_attributes_for_source(source)
        if attributes.answer_role != "category_overview":
            continue
        category_display_name = attributes.category_display_name.strip()
        audience = attributes.category_audience.strip()
        if category_display_name or audience:
            return category_display_name, audience
    return "", ""


def _select_doc_diverse_answer_sources(
    *,
    sources: tuple[EvidenceSource, ...],
    max_sources: int,
) -> tuple[EvidenceSource, ...]:
    selected: list[EvidenceSource] = []
    seen_chunk_ids: set[str] = set()
    seen_doc_ids: set[str] = set()
    for source in sources:
        if source.doc_id in seen_doc_ids:
            continue
        selected.append(source)
        seen_chunk_ids.add(source.chunk_id)
        seen_doc_ids.add(source.doc_id)
        if len(selected) >= max_sources:
            break
    for source in sources:
        if len(selected) >= max_sources:
            break
        if source.chunk_id in seen_chunk_ids:
            continue
        selected.append(source)
        seen_chunk_ids.add(source.chunk_id)
    if selected:
        return tuple(selected)
    return tuple(sources[:max_sources])
