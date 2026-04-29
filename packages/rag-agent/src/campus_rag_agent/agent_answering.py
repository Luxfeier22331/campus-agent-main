from __future__ import annotations

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_ingestion_core.corpus_profiles import is_official_web_stable_reference_like_collection

from .agent_answering_generic import _compose_generic_answer
from .agent_answering_procedure import _compose_procedure_answer
from .agent_answering_support import _render_supporting_contexts
from .agent_curriculum_answering import (
    _compose_curriculum_lookup_answer,
    _compose_curriculum_semester_course_list_answer,
)
from .agent_curriculum_terms import _is_curriculum_semester_course_list_query
from .agent_official_web import _compose_official_web_answer
from .agent_selection_query import _query_mode


def _compose_direct_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    if not selected_rows:
        return ""

    mode = _query_mode(evidence.query_text)
    if mode == "procedure":
        return _compose_procedure_answer(evidence=evidence, selected_rows=selected_rows)
    if evidence.corpus == "official_web" and is_official_web_stable_reference_like_collection(
        evidence.collection
    ):
        official_web_answer = _compose_official_web_answer(
            evidence=evidence,
            selected_rows=selected_rows,
        )
        if official_web_answer:
            return official_web_answer
    if _is_curriculum_semester_course_list_query(evidence.query_text):
        semester_course_list_answer = _compose_curriculum_semester_course_list_answer(
            evidence=evidence,
            selected_rows=selected_rows,
        )
        if semester_course_list_answer:
            return semester_course_list_answer
    if evidence.corpus == "curriculum" and evidence.collection == "curriculum_plan":
        curriculum_lookup_answer = _compose_curriculum_lookup_answer(
            evidence=evidence,
            selected_rows=selected_rows,
        )
        if curriculum_lookup_answer:
            return curriculum_lookup_answer
    return _compose_generic_answer(evidence=evidence, selected_rows=selected_rows)


__all__ = [
    "_compose_direct_answer",
    "_render_supporting_contexts",
]
