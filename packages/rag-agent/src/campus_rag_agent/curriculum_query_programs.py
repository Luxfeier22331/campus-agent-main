from __future__ import annotations

from dataclasses import replace

from campus_retrieval_core.curriculum_query_resolution import interpret_curriculum_query

from .curriculum_query_config import (
    _document_by_id,
    _load_curriculum_documents,
    _load_query_planning_config,
)
from .curriculum_query_models import (
    CurriculumDocument,
    CurriculumFamilyAliasConfig,
    CurriculumQueryPlan,
)
from .curriculum_query_program_families import (
    _clarification_options_for_program_family_alias,
    _query_contains_more_specific_family_alias,
)
from .curriculum_query_text import (
    _compact_title_key,
    _normalize_text,
    _prepend_title_if_missing,
)

_DEICTIC_MAJOR_CUES = ("我这个专业", "本专业")


def plan_curriculum_query(
    query_text: str,
    *,
    verified_major: str | None = None,
) -> CurriculumQueryPlan:
    interpretation = interpret_curriculum_query(query_text)
    normalized_query = interpretation.normalized_query_text
    matched_documents = _match_explicit_documents(
        normalized_query,
        title_fragment=interpretation.program_query_fragment,
    )
    unsupported_lookup_plan = _resolve_unsupported_curriculum_lookup(
        interpretation=interpretation,
        normalized_query=normalized_query,
        matched_documents=matched_documents,
    )
    if unsupported_lookup_plan is not None:
        return unsupported_lookup_plan
    specific_family_document_plan = _resolve_specific_family_document_alias(
        normalized_query=normalized_query,
    )
    if specific_family_document_plan is not None:
        return replace(specific_family_document_plan, intent_kind=interpretation.intent_kind)
    if len(matched_documents) == 1:
        target_document = matched_documents[0]
        return CurriculumQueryPlan(
            status="resolved",
            rewritten_query_text=_prepend_title_if_missing(
                normalized_query=normalized_query,
                title=target_document.title,
            ),
            intent_kind=interpretation.intent_kind,
            target_document_ids=(target_document.document_id,),
            resolved_document_title=target_document.title,
        )
    if len(matched_documents) > 1:
        clarification_candidates = tuple(document.title for document in matched_documents[:3])
        return CurriculumQueryPlan(
            status="needs_clarification",
            rewritten_query_text=normalized_query,
            intent_kind=interpretation.intent_kind,
            clarification_reason="curriculum_program_conflict",
            clarification_candidates=clarification_candidates,
            candidate_title_summary=clarification_candidates,
        )

    family_resolution = _resolve_family_alias(
        normalized_query=normalized_query,
        verified_major=verified_major,
    )
    if family_resolution is not None:
        return replace(family_resolution, intent_kind=interpretation.intent_kind)

    forbidden_family_resolution = _resolve_forbidden_generic_family_alias(normalized_query)
    if forbidden_family_resolution is not None:
        return replace(forbidden_family_resolution, intent_kind=interpretation.intent_kind)

    return CurriculumQueryPlan(
        status="pass_through",
        rewritten_query_text=normalized_query,
        intent_kind=interpretation.intent_kind,
    )


def _match_explicit_documents(
    normalized_query: str,
    *,
    title_fragment: str = "",
) -> tuple[CurriculumDocument, ...]:
    query_keys = tuple(
        dict.fromkeys(
            key
            for key in (
                _compact_title_key(title_fragment),
                _compact_title_key(normalized_query),
            )
            if key
        )
    )
    if not query_keys:
        return ()
    documents = _explicit_document_candidates_for_query(normalized_query)
    for query_key in query_keys:
        exact_matches = tuple(
            document for document in documents if document.title_key == query_key
        )
        if exact_matches:
            return exact_matches
    matches = tuple(
        dict.fromkeys(
            document
            for query_key in query_keys
            for document in documents
            if document.title_key
            and _title_key_matches_query(
                title_key=document.title_key,
                query_key=query_key,
            )
        )
    )
    if len(matches) < 2:
        return matches
    maximal_matches = tuple(
        document
        for document in matches
        if not any(
            document.title_key != other.title_key and document.title_key in other.title_key
            for other in matches
        )
    )
    if maximal_matches:
        return maximal_matches
    return matches


def _explicit_document_candidates_for_query(
    normalized_query: str,
) -> tuple[CurriculumDocument, ...]:
    documents = _load_curriculum_documents()
    if "课程教学计划" not in normalized_query:
        return documents
    course_teaching_plan_documents = tuple(
        document for document in documents if "课程教学计划" in document.title
    )
    if course_teaching_plan_documents:
        return course_teaching_plan_documents
    return documents


def _title_key_matches_query(*, title_key: str, query_key: str) -> bool:
    if title_key in query_key:
        return True
    return bool(
        query_key
        and query_key in title_key
        and _is_ordered_compact_subsequence(needle=query_key, haystack=title_key)
    )


def _is_ordered_compact_subsequence(*, needle: str, haystack: str) -> bool:
    if not needle:
        return False
    position = 0
    for char in haystack:
        if position < len(needle) and needle[position] == char:
            position += 1
    return position == len(needle)


def _resolve_family_alias(
    *,
    normalized_query: str,
    verified_major: str | None,
) -> CurriculumQueryPlan | None:
    for family_alias in _load_query_planning_config().family_aliases:
        alias = family_alias.alias
        if alias not in normalized_query:
            continue
        preferred_document_ids = _major_scoped_candidates(family_alias, verified_major)
        clarification_candidates = _prioritize_clarification_candidates(
            clarification_candidates=_family_candidate_titles(family_alias),
            preferred_document_ids=preferred_document_ids,
        )
        if (
            any(cue in normalized_query for cue in _DEICTIC_MAJOR_CUES)
            and len(preferred_document_ids) == 1
        ):
            target_document = _document_by_id(preferred_document_ids[0])
            if target_document is not None:
                return CurriculumQueryPlan(
                    status="resolved",
                    rewritten_query_text=_prepend_title_if_missing(
                        normalized_query=normalized_query,
                        title=target_document.title,
                    ),
                    target_document_ids=(target_document.document_id,),
                    clarification_candidates=clarification_candidates,
                    resolved_document_title=target_document.title,
                    used_verified_identity=True,
                )
        return CurriculumQueryPlan(
            status="needs_clarification",
            rewritten_query_text=normalized_query,
            preferred_document_ids=preferred_document_ids,
            clarification_reason="curriculum_program_family_alias",
            clarification_candidates=clarification_candidates,
            used_soft_preference=bool(preferred_document_ids),
            candidate_title_summary=clarification_candidates,
        )
    return None


def _resolve_specific_family_document_alias(
    *,
    normalized_query: str,
) -> CurriculumQueryPlan | None:
    for family_alias in _load_query_planning_config().family_aliases:
        family_markers = (family_alias.alias, *family_alias.candidate_terms)
        if not any(marker and marker in normalized_query for marker in family_markers):
            continue
        target_document_ids = _query_scoped_family_document_ids(
            family_alias=family_alias,
            normalized_query=normalized_query,
        )
        if len(target_document_ids) != 1:
            continue
        target_document = _document_by_id(target_document_ids[0])
        if target_document is None:
            continue
        return CurriculumQueryPlan(
            status="resolved",
            rewritten_query_text=_prepend_title_if_missing(
                normalized_query=normalized_query,
                title=target_document.title,
            ),
            target_document_ids=(target_document.document_id,),
            resolved_document_title=target_document.title,
            candidate_title_summary=(target_document.title,),
        )
    return None


def _resolve_unsupported_curriculum_lookup(
    *,
    interpretation: object,
    normalized_query: str,
    matched_documents: tuple[CurriculumDocument, ...],
) -> CurriculumQueryPlan | None:
    lookup_target = getattr(interpretation, "curriculum_lookup_target", "")
    if lookup_target != "course_map":
        return None
    if len(matched_documents) == 1:
        target_document = matched_documents[0]
        return CurriculumQueryPlan(
            status="unsupported",
            rewritten_query_text=_prepend_title_if_missing(
                normalized_query=normalized_query,
                title=target_document.title,
            ),
            intent_kind=interpretation.intent_kind,
            target_document_ids=(target_document.document_id,),
            resolved_document_title=target_document.title,
            unsupported_reason="curriculum_course_map_unsupported",
            candidate_title_summary=(target_document.title,),
        )
    candidate_titles = tuple(document.title for document in matched_documents[:3])
    return CurriculumQueryPlan(
        status="unsupported",
        rewritten_query_text=normalized_query,
        intent_kind=interpretation.intent_kind,
        unsupported_reason="curriculum_course_map_unsupported",
        clarification_candidates=candidate_titles,
        candidate_title_summary=candidate_titles,
    )


def _resolve_forbidden_generic_family_alias(normalized_query: str) -> CurriculumQueryPlan | None:
    for alias in _load_query_planning_config().forbidden_generic_aliases:
        if alias not in normalized_query:
            continue
        if _query_contains_more_specific_family_alias(normalized_query, alias):
            continue
        clarification_candidates = _clarification_options_for_program_family_alias(alias)
        return CurriculumQueryPlan(
            status="needs_clarification",
            rewritten_query_text=normalized_query,
            clarification_reason="curriculum_program_family_alias",
            clarification_candidates=clarification_candidates,
            candidate_title_summary=clarification_candidates,
        )
    return None


def _major_scoped_candidates(
    family_alias: CurriculumFamilyAliasConfig,
    verified_major: str | None,
) -> tuple[str, ...]:
    if not isinstance(verified_major, str) or not verified_major.strip():
        return ()
    normalized_major = _normalize_text(verified_major)
    for major_key, document_ids in family_alias.major_candidates.items():
        if _normalize_text(major_key) != normalized_major:
            continue
        return tuple(document_ids)
    return ()


def _query_scoped_family_document_ids(
    *,
    family_alias: CurriculumFamilyAliasConfig,
    normalized_query: str,
) -> tuple[str, ...]:
    matched_candidates: list[tuple[int, tuple[str, ...]]] = []
    normalized_query_text = _normalize_text(normalized_query)
    for major_key, document_ids in family_alias.major_candidates.items():
        normalized_major = _normalize_text(major_key)
        if not normalized_major or normalized_major not in normalized_query_text:
            continue
        matched_candidates.append((len(normalized_major), tuple(document_ids)))
    if not matched_candidates:
        return ()
    max_major_length = max(length for length, _ in matched_candidates)
    scoped_document_ids: list[str] = []
    for length, document_ids in matched_candidates:
        if length != max_major_length:
            continue
        for document_id in document_ids:
            if document_id not in scoped_document_ids:
                scoped_document_ids.append(document_id)
    return tuple(scoped_document_ids)


def _family_candidate_titles(family_alias: CurriculumFamilyAliasConfig) -> tuple[str, ...]:
    titles = [
        document.title
        for document in _load_curriculum_documents()
        if any(term in document.title for term in family_alias.candidate_terms)
    ]
    return tuple(dict.fromkeys(titles[:3]))


def _prioritize_clarification_candidates(
    *,
    clarification_candidates: tuple[str, ...],
    preferred_document_ids: tuple[str, ...],
) -> tuple[str, ...]:
    if not preferred_document_ids:
        return clarification_candidates
    prioritized: list[str] = []
    for document_id in preferred_document_ids:
        document = _document_by_id(document_id)
        if document is None or document.title in prioritized:
            continue
        prioritized.append(document.title)
    for title in clarification_candidates:
        if title not in prioritized:
            prioritized.append(title)
    return tuple(prioritized)


__all__ = [
    "plan_curriculum_query",
]
