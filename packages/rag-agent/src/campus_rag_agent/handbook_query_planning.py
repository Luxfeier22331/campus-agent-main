from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal

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


@dataclass(frozen=True, slots=True)
class HandbookQueryPlan:
    status: Literal["pass_through", "resolved", "needs_clarification"]
    rewritten_query_text: str
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


def plan_student_handbook_query(query_text: str) -> HandbookQueryPlan:
    normalized_query = _normalize_text(query_text)
    matched_objects = _match_policy_objects(normalized_query)
    if len(matched_objects) == 1:
        matched_object = matched_objects[0]
        return HandbookQueryPlan(
            status="resolved",
            rewritten_query_text=_build_rewritten_query(
                normalized_query=normalized_query,
                policy_object=matched_object,
            ),
            target_document_ids=(matched_object.document_id,),
            resolved_policy_document_id=matched_object.document_id,
            resolved_policy_title=matched_object.title,
            task_kind="specific_policy_lookup",
        )
    if len(matched_objects) > 1:
        return HandbookQueryPlan(
            status="needs_clarification",
            rewritten_query_text=normalized_query,
            task_kind="specific_policy_lookup",
            clarification_reason="policy_object_conflict",
        )
    matched_category = _match_policy_category(normalized_query)
    if matched_category is not None:
        if _is_category_discovery_query(normalized_query):
            return HandbookQueryPlan(
                status="resolved",
                rewritten_query_text=normalized_query,
                preferred_document_ids=matched_category.member_policy_document_ids,
                task_kind="category_discovery",
                category_id=matched_category.category_id,
                category_display_name=matched_category.display_name,
                audience=matched_category.audience,
                category_member_document_ids=matched_category.member_policy_document_ids,
            )
        if _is_ambiguous_category_procedure_query(normalized_query):
            return HandbookQueryPlan(
                status="needs_clarification",
                rewritten_query_text=normalized_query,
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
            task_kind="specific_policy_lookup",
            clarification_reason="policy_object_missing",
        )
    return HandbookQueryPlan(
        status="pass_through",
        rewritten_query_text=normalized_query,
    )


@lru_cache(maxsize=1)
def _load_query_planning_config() -> HandbookQueryPlanningConfig:
    config_path = (
        Path(__file__).resolve().parents[4]
        / "configs"
        / "ingestion"
        / "regulations"
        / "student_rules"
        / "query-planning.json"
    )
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    policy_objects = tuple(
        HandbookPolicyObject(
            document_id=str(item["document_id"]).strip(),
            title=str(item["title"]).strip(),
            aliases=tuple(
                alias.strip()
                for alias in item.get("aliases", ())
                if isinstance(alias, str) and alias.strip()
            ),
        )
        for item in payload.get("policy_objects", ())
        if isinstance(item, dict)
    )
    policy_categories = tuple(
        HandbookPolicyCategory(
            category_id=str(item["category_id"]).strip(),
            display_name=str(item.get("display_name", "")).strip(),
            aliases=tuple(
                alias.strip()
                for alias in item.get("aliases", ())
                if isinstance(alias, str) and alias.strip()
            ),
            audience=str(item.get("audience", "")).strip(),
            member_policy_document_ids=tuple(
                document_id.strip()
                for document_id in item.get("member_policy_document_ids", ())
                if isinstance(document_id, str) and document_id.strip()
            ),
        )
        for item in payload.get("policy_categories", ())
        if isinstance(item, dict) and str(item.get("category_id", "")).strip()
    )
    clarification_cues = tuple(
        cue.strip()
        for cue in payload.get("clarification_cues", ())
        if isinstance(cue, str) and cue.strip()
    )
    return HandbookQueryPlanningConfig(
        clarification_cues=clarification_cues,
        policy_objects=policy_objects,
        policy_categories=policy_categories,
    )


def _match_policy_objects(normalized_query: str) -> tuple[HandbookPolicyObject, ...]:
    compact_query = _compact_text(normalized_query)
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
