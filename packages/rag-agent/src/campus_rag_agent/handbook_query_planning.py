from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal

from campus_regulation_semantics.regulation_semantic_registry import (
    load_student_rules_discovery_config,
)

from .handbook_query_classifiers import (
    _FOCUSED_QUERY_CONTEXT_TERMS,
    _HEARING_APPLICATION_CUES,
    _PROCEDURE_FOCUS_TERMS,
    _REISSUE_PROCEDURE_QUERY_CUES,
    _augment_focus_terms,
    _build_policy_action_query,
    _compact_text,
    _has_any_compact_cue,
    _is_ambiguous_category_procedure_query,
    _is_category_discovery_query,
    _is_category_overview_condition_query,
    _is_category_scoped_policy_question,
    _looks_like_appeal_after_discipline_query,
    _looks_like_unresolved_policy_object_query,
    _normalize_text,
    _query_action_type,
    _query_condition_subject,
)
from .policy_query_focus import extract_policy_query_focus
from .retrieval_intent import RetrievalIntent, retrieval_intent_for_handbook_plan

_WHITESPACE_RE = re.compile(r"\s+")
_TITLE_PREFIX_PATTERNS = (
    re.compile(r"^中央民族大学"),
    re.compile(r"^本科学生"),
    re.compile(r"^学生"),
)


@dataclass(frozen=True, slots=True)
class HandbookPolicyObject:
    document_id: str
    title: str
    aliases: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class HandbookPolicyCategory:
    category_id: str
    display_name: str
    aliases: tuple[str, ...]
    audience: str
    member_policy_document_ids: tuple[str, ...]
    default_procedure_document_id: str = ""
    procedure_overrides: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True, slots=True)
class HandbookQueryPlan:
    status: Literal["pass_through", "resolved", "needs_clarification"]
    rewritten_query_text: str
    focused_query_text: str = ""
    target_document_ids: tuple[str, ...] = ()
    preferred_document_ids: tuple[str, ...] = ()
    resolved_policy_document_id: str = ""
    resolved_policy_title: str = ""
    task_kind: Literal[
        "specific_policy_lookup",
        "category_discovery",
        "ambiguous_procedure",
        "unsupported_or_no_hit",
    ] = "unsupported_or_no_hit"
    category_id: str = ""
    category_display_name: str = ""
    audience: str = ""
    category_member_document_ids: tuple[str, ...] = ()
    focus_detail_labels: tuple[str, ...] = ()
    focus_article_nos: tuple[str, ...] = ()
    focus_clause_nos: tuple[str, ...] = ()
    focus_terms: tuple[str, ...] = ()
    focus_mode: Literal[
        "none",
        "anchor_only",
        "semantic_only",
        "anchor_and_semantic",
    ] = "none"
    query_condition_subject: str = ""
    query_action_type: str = ""
    clarification_reason: str = ""

    @property
    def retrieval_intent(self) -> RetrievalIntent:
        return retrieval_intent_for_handbook_plan(self)


@dataclass(frozen=True, slots=True)
class HandbookQueryPlanningConfig:
    clarification_cues: tuple[str, ...]
    policy_objects: tuple[HandbookPolicyObject, ...]
    policy_categories: tuple[HandbookPolicyCategory, ...]


_ATTENDANCE_DISCIPLINE_DOC_ID = "handbook:9350d885657d7409e524e73666b828b826f07191"
_ATTENDANCE_MANAGEMENT_DOC_ID = "handbook:e53d05ae90e91f1c45843c50c3a777f774a88afc"


def plan_student_handbook_query(query_text: str) -> HandbookQueryPlan:
    normalized_query = _normalize_text(query_text)
    matched_objects = _match_policy_objects(normalized_query)
    if len(matched_objects) == 1:
        matched_object = matched_objects[0]
        rewritten_query_text = _build_rewritten_query(
            normalized_query=normalized_query,
            policy_object=matched_object,
        )
        focus_hints = extract_policy_query_focus(normalized_query)
        query_condition_subject = _query_condition_subject(
            normalized_query,
            category_display_name=matched_object.title,
        )
        query_action_type = _query_action_type(
            normalized_query,
            category_display_name=matched_object.title,
        )
        augmented_focus_terms = _augment_focus_terms(
            normalized_query=normalized_query,
            focus_terms=focus_hints.focus_terms,
            query_condition_subject=query_condition_subject,
        )
        return HandbookQueryPlan(
            status="resolved",
            rewritten_query_text=rewritten_query_text,
            focused_query_text=_build_focused_query(
                normalized_query=normalized_query,
                rewritten_query_text=rewritten_query_text,
                policy_object=matched_object,
                focus_hints=focus_hints,
                augmented_focus_terms=augmented_focus_terms,
            ),
            target_document_ids=(matched_object.document_id,),
            resolved_policy_document_id=matched_object.document_id,
            resolved_policy_title=matched_object.title,
            task_kind="specific_policy_lookup",
            focus_detail_labels=focus_hints.detail_labels,
            focus_article_nos=focus_hints.article_nos,
            focus_clause_nos=focus_hints.clause_nos,
            focus_terms=augmented_focus_terms,
            focus_mode=focus_hints.focus_mode,
            query_condition_subject=query_condition_subject,
            query_action_type=query_action_type,
        )
    if len(matched_objects) > 1:
        return HandbookQueryPlan(
            status="needs_clarification",
            rewritten_query_text=normalized_query,
            focused_query_text=normalized_query,
            task_kind="specific_policy_lookup",
            clarification_reason="policy_object_conflict",
        )
    matched_category = _match_policy_category(normalized_query)
    if matched_category is not None:
        if _is_category_discovery_query(normalized_query):
            return HandbookQueryPlan(
                status="resolved",
                rewritten_query_text=normalized_query,
                focused_query_text=normalized_query,
                preferred_document_ids=matched_category.member_policy_document_ids,
                task_kind="category_discovery",
                category_id=matched_category.category_id,
                category_display_name=matched_category.display_name,
                audience=matched_category.audience,
                category_member_document_ids=matched_category.member_policy_document_ids,
            )
        if _is_ambiguous_category_procedure_query(normalized_query):
            procedure_document_id = _resolve_category_procedure_document_id(
                matched_category=matched_category,
                normalized_query=normalized_query,
            )
            matched_object = (
                _policy_object_by_document_id(procedure_document_id)
                if procedure_document_id
                else None
            )
            if matched_object is not None:
                rewritten_query_text = _build_rewritten_query(
                    normalized_query=normalized_query,
                    policy_object=matched_object,
                )
                query_condition_subject = _query_condition_subject(
                    normalized_query,
                    category_display_name=matched_object.title,
                )
                query_action_type = _query_action_type(
                    normalized_query,
                    category_display_name=matched_object.title,
                )
                focus_hints = extract_policy_query_focus(normalized_query)
                augmented_focus_terms = _augment_focus_terms(
                    normalized_query=normalized_query,
                    focus_terms=focus_hints.focus_terms,
                    query_condition_subject=query_condition_subject,
                )
                return HandbookQueryPlan(
                    status="resolved",
                    rewritten_query_text=rewritten_query_text,
                    focused_query_text=_build_focused_query(
                        normalized_query=normalized_query,
                        rewritten_query_text=rewritten_query_text,
                        policy_object=matched_object,
                        focus_hints=focus_hints,
                        augmented_focus_terms=augmented_focus_terms,
                    ),
                    target_document_ids=(matched_object.document_id,),
                    resolved_policy_document_id=matched_object.document_id,
                    resolved_policy_title=matched_object.title,
                    task_kind="specific_policy_lookup",
                    category_id=matched_category.category_id,
                    category_display_name=matched_category.display_name,
                    audience=matched_category.audience,
                    category_member_document_ids=matched_category.member_policy_document_ids,
                    focus_detail_labels=focus_hints.detail_labels,
                    focus_article_nos=focus_hints.article_nos,
                    focus_clause_nos=focus_hints.clause_nos,
                    focus_terms=augmented_focus_terms,
                    focus_mode=focus_hints.focus_mode,
                    query_condition_subject=query_condition_subject,
                    query_action_type=query_action_type,
                )
            return HandbookQueryPlan(
                status="needs_clarification",
                rewritten_query_text=normalized_query,
                focused_query_text=normalized_query,
                task_kind="ambiguous_procedure",
                category_id=matched_category.category_id,
                category_display_name=matched_category.display_name,
                audience=matched_category.audience,
                category_member_document_ids=matched_category.member_policy_document_ids,
                clarification_reason="ambiguous_procedure",
            )
        category_specific_plan = _resolve_category_specific_lookup_plan(
            matched_category=matched_category,
            normalized_query=normalized_query,
        )
        if category_specific_plan is not None:
            return category_specific_plan
    if _looks_like_unresolved_policy_object_query(
        normalized_query,
        clarification_cues=_load_query_planning_config().clarification_cues,
    ):
        return HandbookQueryPlan(
            status="needs_clarification",
            rewritten_query_text=normalized_query,
            focused_query_text=normalized_query,
            task_kind="specific_policy_lookup",
            clarification_reason="policy_object_missing",
        )
    return HandbookQueryPlan(
        status="pass_through",
        rewritten_query_text=normalized_query,
        focused_query_text=normalized_query,
    )


@lru_cache(maxsize=1)
def _load_query_planning_config() -> HandbookQueryPlanningConfig:
    discovery = load_student_rules_discovery_config()
    policy_objects = tuple(
        HandbookPolicyObject(
            document_id=item.document_id,
            title=item.title,
            aliases=item.aliases,
        )
        for item in discovery.policy_objects
    )
    policy_categories = tuple(
        HandbookPolicyCategory(
            category_id=item.category_id,
            display_name=item.display_name,
            aliases=item.aliases,
            audience=item.audience,
            member_policy_document_ids=item.member_policy_document_ids,
            default_procedure_document_id=item.default_procedure_document_id,
            procedure_overrides=item.procedure_overrides,
        )
        for item in discovery.categories
    )
    return HandbookQueryPlanningConfig(
        clarification_cues=discovery.clarification_cues,
        policy_objects=policy_objects,
        policy_categories=policy_categories,
    )


def _match_policy_objects(normalized_query: str) -> tuple[HandbookPolicyObject, ...]:
    compact_query = _compact_text(normalized_query)
    exact_matches = tuple(
        policy_object
        for policy_object in _load_query_planning_config().policy_objects
        if compact_query == _compact_text(policy_object.title)
    )
    if exact_matches:
        return exact_matches
    title_containment_matches = tuple(
        policy_object
        for policy_object in _load_query_planning_config().policy_objects
        if _compact_text(policy_object.title) in compact_query
    )
    if title_containment_matches:
        return title_containment_matches
    matches: list[HandbookPolicyObject] = []
    for policy_object in _load_query_planning_config().policy_objects:
        if any(term in compact_query for term in _match_terms(policy_object)):
            matches.append(policy_object)
    return tuple(matches)


def _query_exactly_targets_policy_object(
    *,
    normalized_query: str,
    policy_object: HandbookPolicyObject,
) -> bool:
    compact_query = _compact_text(normalized_query)
    return any(compact_query == term for term in _match_terms(policy_object))


def _match_policy_category(normalized_query: str) -> HandbookPolicyCategory | None:
    compact_query = _compact_text(normalized_query)
    for category in _load_query_planning_config().policy_categories:
        if any(term in compact_query for term in _category_match_terms(category)):
            return category
    return None


def _policy_object_by_document_id(document_id: str) -> HandbookPolicyObject | None:
    for policy_object in _load_query_planning_config().policy_objects:
        if policy_object.document_id == document_id:
            return policy_object
    return None


def _match_terms(policy_object: HandbookPolicyObject) -> tuple[str, ...]:
    candidates = (
        policy_object.title,
        *_title_variants(policy_object.title),
        *policy_object.aliases,
    )
    return tuple(
        dict.fromkeys(
            compact_term
            for compact_term in (_compact_text(candidate) for candidate in candidates)
            if compact_term
        )
    )


def _category_match_terms(category: HandbookPolicyCategory) -> tuple[str, ...]:
    candidates = (category.display_name, *category.aliases)
    return tuple(
        dict.fromkeys(
            compact_term
            for compact_term in (_compact_text(candidate) for candidate in candidates)
            if compact_term
        )
    )


def _resolve_category_procedure_document_id(
    *,
    matched_category: HandbookPolicyCategory,
    normalized_query: str,
) -> str:
    compact_query = _compact_text(normalized_query)
    for match_term, document_id in matched_category.procedure_overrides:
        if _compact_text(match_term) in compact_query:
            return document_id
    return matched_category.default_procedure_document_id


def _resolve_category_specific_lookup_plan(
    *,
    matched_category: HandbookPolicyCategory,
    normalized_query: str,
) -> HandbookQueryPlan | None:
    query_condition_subject = _query_condition_subject(
        normalized_query,
        category_display_name=matched_category.display_name,
    )
    query_action_type = _query_action_type(
        normalized_query,
        category_display_name=matched_category.display_name,
    )
    if not _is_category_scoped_policy_question(
        normalized_query,
        query_condition_subject=query_condition_subject,
        query_action_type=query_action_type,
    ):
        return None
    if _is_category_overview_condition_query(normalized_query):
        return HandbookQueryPlan(
            status="resolved",
            rewritten_query_text=normalized_query,
            focused_query_text=normalized_query,
            task_kind="specific_policy_lookup",
            category_id=matched_category.category_id,
            category_display_name=matched_category.display_name,
            audience=matched_category.audience,
            category_member_document_ids=matched_category.member_policy_document_ids,
            query_condition_subject=query_condition_subject or "generic_condition",
            query_action_type=query_action_type,
        )
    override_document_ids = _resolve_category_specific_document_override(
        matched_category=matched_category,
        normalized_query=normalized_query,
    )
    if override_document_ids:
        matched_object = _policy_object_by_document_id(override_document_ids[0])
        if matched_object is not None:
            rewritten_query_text = _build_rewritten_query(
                normalized_query=normalized_query,
                policy_object=matched_object,
            )
            focus_hints = extract_policy_query_focus(normalized_query)
            augmented_focus_terms = _augment_focus_terms(
                normalized_query=normalized_query,
                focus_terms=focus_hints.focus_terms,
                query_condition_subject=query_condition_subject,
            )
            return HandbookQueryPlan(
                status="resolved",
                rewritten_query_text=rewritten_query_text,
                focused_query_text=_build_focused_query(
                    normalized_query=normalized_query,
                    rewritten_query_text=rewritten_query_text,
                    policy_object=matched_object,
                    focus_hints=focus_hints,
                    augmented_focus_terms=augmented_focus_terms,
                ),
                target_document_ids=override_document_ids,
                resolved_policy_document_id=matched_object.document_id,
                resolved_policy_title=matched_object.title,
                task_kind="specific_policy_lookup",
                category_id=matched_category.category_id,
                category_display_name=matched_category.display_name,
                audience=matched_category.audience,
                category_member_document_ids=tuple(
                    dict.fromkeys(
                        (
                            *matched_category.member_policy_document_ids,
                            *override_document_ids,
                        )
                    )
                ),
                focus_detail_labels=focus_hints.detail_labels,
                focus_article_nos=focus_hints.article_nos,
                focus_clause_nos=focus_hints.clause_nos,
                focus_terms=augmented_focus_terms,
                focus_mode=focus_hints.focus_mode,
                query_condition_subject=query_condition_subject or "generic_condition",
                query_action_type=query_action_type,
            )
    if len(matched_category.member_policy_document_ids) != 1:
        return HandbookQueryPlan(
            status="needs_clarification",
            rewritten_query_text=normalized_query,
            focused_query_text=normalized_query,
            task_kind="specific_policy_lookup",
            category_id=matched_category.category_id,
            category_display_name=matched_category.display_name,
            audience=matched_category.audience,
            category_member_document_ids=matched_category.member_policy_document_ids,
            query_condition_subject=query_condition_subject,
            query_action_type=query_action_type,
            clarification_reason="category_policy_ambiguous",
        )
    matched_object = _policy_object_by_document_id(matched_category.member_policy_document_ids[0])
    if matched_object is None:
        return None
    rewritten_query_text = _build_rewritten_query(
        normalized_query=normalized_query,
        policy_object=matched_object,
    )
    focus_hints = extract_policy_query_focus(normalized_query)
    augmented_focus_terms = _augment_focus_terms(
        normalized_query=normalized_query,
        focus_terms=focus_hints.focus_terms,
        query_condition_subject=query_condition_subject,
    )
    return HandbookQueryPlan(
        status="resolved",
        rewritten_query_text=rewritten_query_text,
        focused_query_text=_build_focused_query(
            normalized_query=normalized_query,
            rewritten_query_text=rewritten_query_text,
            policy_object=matched_object,
            focus_hints=focus_hints,
            augmented_focus_terms=augmented_focus_terms,
        ),
        target_document_ids=(matched_object.document_id,),
        resolved_policy_document_id=matched_object.document_id,
        resolved_policy_title=matched_object.title,
        task_kind="specific_policy_lookup",
        category_id=matched_category.category_id,
        category_display_name=matched_category.display_name,
        audience=matched_category.audience,
        category_member_document_ids=matched_category.member_policy_document_ids,
        focus_detail_labels=focus_hints.detail_labels,
        focus_article_nos=focus_hints.article_nos,
        focus_clause_nos=focus_hints.clause_nos,
        focus_terms=augmented_focus_terms,
        focus_mode=focus_hints.focus_mode,
        query_condition_subject=query_condition_subject,
        query_action_type=query_action_type,
    )


def _title_variants(title: str) -> tuple[str, ...]:
    variants = [title.strip()]
    for pattern in _TITLE_PREFIX_PATTERNS:
        stripped = pattern.sub("", variants[-1]).strip()
        if stripped and stripped not in variants:
            variants.append(stripped)
    return tuple(variants)


def _build_rewritten_query(
    *,
    normalized_query: str,
    policy_object: HandbookPolicyObject,
) -> str:
    action_query = _build_policy_action_query(normalized_query)
    if action_query:
        return action_query
    if policy_object.title in normalized_query:
        return normalized_query
    return f"{policy_object.title} {normalized_query}".strip()


def _build_focused_query(
    *,
    normalized_query: str,
    rewritten_query_text: str,
    policy_object: HandbookPolicyObject,
    focus_hints,
    augmented_focus_terms: tuple[str, ...] = (),
) -> str:
    focused_parts = [policy_object.title]
    focused_parts.extend(focus_hints.detail_labels)
    focus_terms = augmented_focus_terms or focus_hints.focus_terms
    focused_parts.extend(focus_terms)
    compact_query = _compact_text(normalized_query)
    if _has_any_compact_cue(compact_query, _REISSUE_PROCEDURE_QUERY_CUES):
        for term in ("挂失", "补办"):
            if term not in focused_parts:
                focused_parts.append(term)
        for term in _PROCEDURE_FOCUS_TERMS:
            if term not in focused_parts:
                focused_parts.append(term)
    elif _has_any_compact_cue(compact_query, _HEARING_APPLICATION_CUES):
        for term in ("听证申请", "10日内", "书面听证申请", "申请听证"):
            if term not in focused_parts:
                focused_parts.append(term)
    elif _looks_like_appeal_after_discipline_query(compact_query):
        for term in ("书面申诉", "10日内", "处分决定书", "申诉材料"):
            if term not in focused_parts:
                focused_parts.append(term)
    elif focus_hints.focus_mode == "none" and tuple(focus_terms) == tuple(focus_hints.focus_terms):
        return rewritten_query_text
    focused_parts.extend(
        term
        for term in _FOCUSED_QUERY_CONTEXT_TERMS
        if term in normalized_query and term not in focused_parts
    )
    return " ".join(
        dict.fromkeys(
            part.strip() for part in focused_parts if isinstance(part, str) and part.strip()
        )
    )


def _resolve_category_specific_document_override(
    *,
    matched_category: HandbookPolicyCategory,
    normalized_query: str,
) -> tuple[str, ...]:
    compact_query = _compact_text(normalized_query)
    if matched_category.category_id == "discipline_appeal_hearing" and (
        "旷课" in compact_query or ("缺勤" in compact_query and "学时" in compact_query)
    ):
        return (_ATTENDANCE_DISCIPLINE_DOC_ID, _ATTENDANCE_MANAGEMENT_DOC_ID)
    return ()


__all__ = [
    "HandbookPolicyCategory",
    "HandbookPolicyObject",
    "HandbookQueryPlan",
    "plan_student_handbook_query",
]
