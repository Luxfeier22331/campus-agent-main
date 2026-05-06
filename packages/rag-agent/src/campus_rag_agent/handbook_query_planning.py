from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal

from campus_ingestion_core.regulation_semantics import load_student_rules_discovery_config

from .policy_query_focus import extract_policy_query_focus

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
    clarification_reason: str = ""


@dataclass(frozen=True, slots=True)
class HandbookQueryPlanningConfig:
    clarification_cues: tuple[str, ...]
    policy_objects: tuple[HandbookPolicyObject, ...]
    policy_categories: tuple[HandbookPolicyCategory, ...]


_CATEGORY_DISCOVERY_CUES = (
    "有哪些",
    "都有什么",
    "有什么",
    "哪些",
    "能申请哪些",
    "可以申请哪些",
    "能申请什么",
    "可以申请什么",
)
_PROCEDURE_CUES = (
    "怎么申请",
    "如何申请",
    "怎么办理",
    "如何办理",
    "怎么评",
    "如何评",
    "流程",
    "手续",
)
_UNRESOLVED_CONTEXT_CUES = ("这个", "该", "这项", "这个奖学金", "该奖学金")
_POLICY_ACTION_REWRITE_RULES: tuple[tuple[tuple[str, ...], str], ...] = (
    (
        ("处分怎么消", "处分怎么解除", "怎么消处分", "怎么解除处分", "消处分"),
        "解除处分 申请 条件 程序",
    ),
)
_FOCUSED_QUERY_CONTEXT_TERMS = ("条件", "要求", "资格", "程序", "流程", "材料", "申请")


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
        return HandbookQueryPlan(
            status="resolved",
            rewritten_query_text=rewritten_query_text,
            focused_query_text=_build_focused_query(
                normalized_query=normalized_query,
                rewritten_query_text=rewritten_query_text,
                policy_object=matched_object,
                focus_hints=focus_hints,
            ),
            target_document_ids=(matched_object.document_id,),
            resolved_policy_document_id=matched_object.document_id,
            resolved_policy_title=matched_object.title,
            task_kind="specific_policy_lookup",
            focus_detail_labels=focus_hints.detail_labels,
            focus_article_nos=focus_hints.article_nos,
            focus_clause_nos=focus_hints.clause_nos,
            focus_terms=focus_hints.focus_terms,
            focus_mode=focus_hints.focus_mode,
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
            if procedure_document_id:
                matched_object = _policy_object_by_document_id(procedure_document_id)
                if matched_object is not None:
                    rewritten_query_text = _build_rewritten_query(
                        normalized_query=normalized_query,
                        policy_object=matched_object,
                    )
                    return HandbookQueryPlan(
                        status="resolved",
                        rewritten_query_text=rewritten_query_text,
                        focused_query_text=rewritten_query_text,
                        target_document_ids=(matched_object.document_id,),
                        resolved_policy_document_id=matched_object.document_id,
                        resolved_policy_title=matched_object.title,
                        task_kind="specific_policy_lookup",
                        category_id=matched_category.category_id,
                        category_display_name=matched_category.display_name,
                        audience=matched_category.audience,
                        category_member_document_ids=matched_category.member_policy_document_ids,
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
    if _looks_like_unresolved_policy_object_query(normalized_query):
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
    matches: list[HandbookPolicyObject] = []
    for policy_object in _load_query_planning_config().policy_objects:
        if any(term in compact_query for term in _match_terms(policy_object)):
            matches.append(policy_object)
    return tuple(matches)


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


def _build_policy_action_query(normalized_query: str) -> str:
    compact_query = _compact_text(normalized_query)
    for cues, rewritten_query in _POLICY_ACTION_REWRITE_RULES:
        if any(_compact_text(cue) in compact_query for cue in cues):
            return rewritten_query
    return ""


def _build_focused_query(
    *,
    normalized_query: str,
    rewritten_query_text: str,
    policy_object: HandbookPolicyObject,
    focus_hints,
) -> str:
    if focus_hints.focus_mode == "none":
        return rewritten_query_text
    focused_parts = [policy_object.title]
    focused_parts.extend(focus_hints.detail_labels)
    focused_parts.extend(focus_hints.focus_terms)
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


def _looks_like_unresolved_policy_object_query(normalized_query: str) -> bool:
    compact_query = _compact_text(normalized_query)
    if _has_any_compact_cue(compact_query, _UNRESOLVED_CONTEXT_CUES):
        return True
    return any(
        _compact_text(cue) in compact_query
        for cue in _load_query_planning_config().clarification_cues
    )


def _is_category_discovery_query(normalized_query: str) -> bool:
    compact_query = _compact_text(normalized_query)
    return _has_any_compact_cue(compact_query, _CATEGORY_DISCOVERY_CUES)


def _is_ambiguous_category_procedure_query(normalized_query: str) -> bool:
    compact_query = _compact_text(normalized_query)
    return _has_any_compact_cue(compact_query, _PROCEDURE_CUES)


def _has_any_compact_cue(compact_query: str, cues: tuple[str, ...]) -> bool:
    return any(_compact_text(cue) in compact_query for cue in cues)


def _normalize_text(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", unicodedata.normalize("NFKC", text)).strip()


def _compact_text(text: str) -> str:
    normalized = _normalize_text(text).lower()
    return "".join(char for char in normalized if char.isalnum() or _is_cjk_char(char))


def _is_cjk_char(char: str) -> bool:
    code_point = ord(char)
    return (
        0x3400 <= code_point <= 0x4DBF
        or 0x4E00 <= code_point <= 0x9FFF
        or 0xF900 <= code_point <= 0xFAFF
    )


__all__ = [
    "HandbookPolicyCategory",
    "HandbookPolicyObject",
    "HandbookQueryPlan",
    "plan_student_handbook_query",
]
