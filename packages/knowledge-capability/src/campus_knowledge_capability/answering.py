from __future__ import annotations

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_ingestion_core.corpus_profiles import is_official_web_stable_reference_like_collection

from .answer_presentation_contract import AnswerPresentationDraft, PresentationKind
from .answer_selection_query import _query_mode
from .answer_shape import AnswerShape
from .answer_shared import _lead_source_title
from .answer_text_cleanup import finalize_answer_text
from .answering_category_discovery import _compose_category_discovery_list_answer
from .answering_conditions import _compose_condition_table_answer
from .answering_detail_clause import _compose_focused_detail_clause_answer
from .answering_generic import _compose_generic_answer
from .answering_identity import _compose_document_identity_answer
from .answering_judgment import compose_judgment_clause_answer
from .answering_procedure import _compose_procedure_answer
from .answering_result import DirectAnswerResult
from .answering_support import _render_supporting_contexts
from .curriculum_answering import (
    _compose_curriculum_identity_answer,
    _compose_curriculum_lookup_answer,
    _compose_curriculum_semester_course_list_answer,
    _query_requires_curriculum_typed_lookup,
)
from .curriculum_terms import _is_curriculum_semester_course_list_query
from .official_web import _compose_official_web_answer


def _compose_direct_answer(
    *,
    evidence: EvidenceBundle,
    query_text: str = "",
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
    answer_shape: AnswerShape | None = None,
    category_display_name: str = "",
    audience: str = "",
    expected_answer_kind: str = "",
) -> DirectAnswerResult:
    if not selected_rows:
        return DirectAnswerResult(answer_text="")

    answer_query_text = query_text.strip() or evidence.query_text
    mode = _query_mode(answer_query_text)
    if answer_shape == AnswerShape.CATEGORY_DISCOVERY_LIST:
        return DirectAnswerResult(
            answer_text=_compose_category_discovery_list_answer(
                selected_rows=selected_rows,
                category_display_name=category_display_name,
                audience=audience,
            ),
        )
    if answer_shape == AnswerShape.TITLE_LOOKUP and evidence.corpus == "curriculum":
        curriculum_identity_answer = _compose_curriculum_identity_answer(
            evidence=evidence,
            query_text=answer_query_text,
            selected_rows=selected_rows,
            document_reference_only=expected_answer_kind == "curriculum_document",
        )
        if curriculum_identity_answer:
            normalized_answer = finalize_answer_text(curriculum_identity_answer)
            return DirectAnswerResult(
                answer_text=normalized_answer,
                presentation=AnswerPresentationDraft(
                    kind=PresentationKind.DOCUMENT_IDENTITY,
                    answer_shape=AnswerShape.TITLE_LOOKUP,
                    fragments=(normalized_answer,),
                    identity_tokens=(
                        _lead_source_title(tuple(source for source, _ in selected_rows)),
                    ),
                ),
            )
    if answer_shape == AnswerShape.TITLE_LOOKUP and not (
        evidence.corpus == "official_web"
        and is_official_web_stable_reference_like_collection(evidence.collection)
    ):
        return _compose_document_identity_answer(evidence=evidence, selected_rows=selected_rows)
    if expected_answer_kind == "procedure_steps" or (
        mode == "procedure"
        and answer_shape
        not in {
            AnswerShape.CONDITION_OVERVIEW,
            AnswerShape.FACT_LOOKUP,
            AnswerShape.JUDGMENT_CLAUSE,
        }
    ):
        return DirectAnswerResult(
            answer_text=finalize_answer_text(
                _compose_procedure_answer(
                    evidence=evidence,
                    query_text=answer_query_text,
                    selected_rows=selected_rows,
                )
            )
        )
    if evidence.corpus == "official_web" and is_official_web_stable_reference_like_collection(
        evidence.collection
    ):
        official_web_answer = _compose_official_web_answer(
            evidence=evidence,
            selected_rows=selected_rows,
        )
        if official_web_answer:
            normalized_answer = finalize_answer_text(official_web_answer)
            fragments = tuple(
                fragment
                for fragment in (item.strip() for item in normalized_answer.split("；"))
                if fragment
            )[:2]
            return DirectAnswerResult(
                answer_text=normalized_answer,
                presentation=AnswerPresentationDraft(
                    kind=PresentationKind.BRIEF_REFERENCE,
                    answer_shape=AnswerShape.TITLE_LOOKUP,
                    fragments=fragments or (normalized_answer,),
                ),
            )
    if _is_curriculum_semester_course_list_query(evidence.query_text):
        semester_course_list_answer = _compose_curriculum_semester_course_list_answer(
            evidence=evidence,
            query_text=answer_query_text,
            selected_rows=selected_rows,
        )
        if semester_course_list_answer:
            return DirectAnswerResult(answer_text=finalize_answer_text(semester_course_list_answer))
    if evidence.corpus == "curriculum" and evidence.collection == "curriculum_plan":
        curriculum_lookup_answer = _compose_curriculum_lookup_answer(
            evidence=evidence,
            selected_rows=selected_rows,
        )
        if curriculum_lookup_answer:
            return DirectAnswerResult(answer_text=finalize_answer_text(curriculum_lookup_answer))
        if _query_requires_curriculum_typed_lookup(evidence.query_text):
            return DirectAnswerResult(answer_text="")
    if answer_shape == AnswerShape.DETAIL_CLAUSE:
        detail_clause_answer = _compose_focused_detail_clause_answer(
            evidence=evidence,
            selected_rows=selected_rows,
        )
        if detail_clause_answer:
            return DirectAnswerResult(answer_text=finalize_answer_text(detail_clause_answer))
    if answer_shape == AnswerShape.JUDGMENT_CLAUSE:
        judgment_clause_answer = compose_judgment_clause_answer(
            evidence=evidence,
            query_text=answer_query_text,
            selected_rows=selected_rows,
        )
        return DirectAnswerResult(answer_text=finalize_answer_text(judgment_clause_answer))
    if answer_shape == AnswerShape.CONDITION_OVERVIEW:
        condition_table_answer = _compose_condition_table_answer(
            evidence=evidence,
            query_text=answer_query_text,
            selected_rows=selected_rows,
        )
        if condition_table_answer:
            return DirectAnswerResult(answer_text=finalize_answer_text(condition_table_answer))
    collapse_to_short = answer_shape == AnswerShape.GENERAL_SUMMARY
    generic_answer = finalize_answer_text(
        _compose_generic_answer(
            evidence=evidence,
            selected_rows=selected_rows,
            collapse_to_short=collapse_to_short,
        )
    )
    if not generic_answer:
        return DirectAnswerResult(answer_text="")
    if not collapse_to_short:
        return DirectAnswerResult(answer_text=generic_answer)
    return DirectAnswerResult(
        answer_text=generic_answer,
        presentation=AnswerPresentationDraft(
            kind=PresentationKind.GENERAL_SUMMARY,
            answer_shape=AnswerShape.GENERAL_SUMMARY,
            fragments=(generic_answer,),
        ),
    )
__all__ = [
    "_compose_direct_answer",
    "_render_supporting_contexts",
]
