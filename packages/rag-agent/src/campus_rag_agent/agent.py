from __future__ import annotations

from dataclasses import dataclass, field, replace

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
from .agent_official_web_reference_selection import official_web_reference_support_budget
from .agent_selection_query import _query_mode
from .agent_selection_rows import _select_answer_support_rows
from .agent_shared import _normalize_snippet
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
    presentation_kind: str = ""
    presentation_path: str = ""
    diagnostic_reason: str = ""
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
        query_text: str = "",
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
                presentation_kind="",
                presentation_path="",
                diagnostic_reason="",
                typed_draft=TypedAnswerDraft(
                    kind="unsupported",
                    unsupported_reason="no_supporting_evidence",
                ),
            )

        answer_query_text = query_text.strip() or evidence.query_text
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
        support_budget = official_web_reference_support_budget(
            evidence=evidence,
            query_text=answer_query_text,
            default_budget=support_budget,
        )
        if _needs_procedure_step_completeness_support_budget(retrieval_intent):
            support_budget = max(support_budget, 5)
        if _needs_curriculum_course_settings_support_budget(
            evidence=evidence,
            query_text=answer_query_text,
        ):
            support_budget = max(support_budget, 6)
        candidate_budget = max(support_budget, self.max_answer_sources)
        if _needs_procedure_step_completeness_support_budget(retrieval_intent):
            candidate_budget = max(candidate_budget, len(evidence.sources))
        if _needs_curriculum_course_settings_support_budget(
            evidence=evidence,
            query_text=answer_query_text,
        ):
            candidate_budget = max(candidate_budget, len(evidence.sources))
        if _needs_document_identity_candidate_scan(retrieval_intent):
            candidate_budget = max(candidate_budget, len(evidence.sources))
        if _needs_curriculum_course_settings_support_budget(
            evidence=evidence,
            query_text=answer_query_text,
        ):
            candidate_sources = select_supporting_evidence_sources(
                query_text=evidence.query_text,
                sources=evidence.sources,
                max_sources=candidate_budget,
            )
        elif (
            _needs_procedure_step_completeness_support_budget(retrieval_intent)
            or _needs_document_identity_candidate_scan(retrieval_intent)
            or answer_shape in {AnswerShape.CONDITION_OVERVIEW, AnswerShape.GENERAL_SUMMARY}
        ):
            candidate_sources = evidence.sources
        elif candidate_budget > self.max_answer_sources:
            candidate_sources = _select_doc_diverse_answer_sources(
                sources=evidence.sources,
                max_sources=candidate_budget,
            )
        else:
            candidate_sources = select_supporting_evidence_sources(
                query_text=evidence.query_text,
                sources=evidence.sources,
                max_sources=candidate_budget,
            )
        selected_rows = _select_answer_support_rows(
            query_text=answer_query_text,
            sources=candidate_sources,
            max_sources=support_budget,
            answer_shape=answer_shape,
            retrieval_intent=retrieval_intent,
        )
        supporting_sources = _dedupe_supporting_sources(selected_rows)
        supporting_contexts = _render_supporting_contexts(selected_rows)
        answer_result = _compose_direct_answer(
            evidence=evidence,
            query_text=answer_query_text,
            selected_rows=selected_rows,
            answer_shape=answer_shape,
            category_display_name=resolved_category_display_name,
            audience=resolved_audience,
            expected_answer_kind=(
                retrieval_intent.expected.answer_kind if retrieval_intent is not None else ""
            ),
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
        if answer_result.presentation is not None:
            typed_draft = replace(typed_draft, presentation=answer_result.presentation)
        if typed_draft.kind == "short_reference" and typed_draft.presentation is None:
            typed_draft = replace(
                typed_draft,
                presentation=answer_result.presentation,
            )
        validation = validate_typed_answer_draft(
            typed_draft,
            expected_answer_kind=(
                retrieval_intent.expected.answer_kind if retrieval_intent is not None else ""
            ),
        )
        answer_text = answer_result.answer_text
        if validation.verdict != "valid":
            answer_text = ""
        return AnswerDraft(
            answer_text=answer_text,
            supporting_sources=supporting_sources,
            supporting_contexts=supporting_contexts,
            presentation_kind=(
                answer_result.presentation.kind.value
                if answer_result.presentation is not None
                else ""
            ),
            presentation_path=answer_result.presentation_path,
            diagnostic_reason=answer_result.diagnostic_reason,
            typed_draft=typed_draft,
        )

    def compose_answer(
        self,
        evidence: EvidenceBundle,
        *,
        query_text: str = "",
        retrieval_intent: RetrievalIntent | None = None,
    ) -> str:
        return self.build_answer(
            evidence,
            query_text=query_text,
            retrieval_intent=retrieval_intent,
        ).answer_text


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


def _dedupe_supporting_sources(
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> tuple[EvidenceSource, ...]:
    supporting_sources: list[EvidenceSource] = []
    seen_keys: set[tuple[str, str, str]] = set()
    for source, _ in selected_rows:
        key = (source.doc_id, source.chunk_id, source.snippet)
        if key in seen_keys:
            continue
        supporting_sources.append(source)
        seen_keys.add(key)
    return tuple(supporting_sources)


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


def _needs_curriculum_course_settings_support_budget(
    *,
    evidence: EvidenceBundle,
    query_text: str,
) -> bool:
    if evidence.corpus != "curriculum" or evidence.collection != "curriculum_plan":
        return False
    normalized_query = _normalize_snippet(query_text or evidence.query_text)
    return "课程设置" in normalized_query or "修读建议" in normalized_query


def _needs_document_identity_candidate_scan(retrieval_intent: RetrievalIntent | None) -> bool:
    return (
        retrieval_intent is not None
        and retrieval_intent.expected.selection_policy == "document_identity_first"
    )


def _needs_procedure_step_completeness_support_budget(
    retrieval_intent: RetrievalIntent | None,
) -> bool:
    return (
        retrieval_intent is not None
        and retrieval_intent.kind == "procedure_steps"
        and retrieval_intent.expected.coverage_policy == "procedure_step_completeness"
    )
