from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import json
from pathlib import Path
import re
import unicodedata
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
class HandbookQueryPlan:
    status: Literal["pass_through", "resolved", "needs_clarification"]
    rewritten_query_text: str
    target_document_ids: tuple[str, ...] = ()
    resolved_policy_document_id: str = ""
    resolved_policy_title: str = ""
    clarification_reason: str = ""


@dataclass(frozen=True, slots=True)
class HandbookQueryPlanningConfig:
    clarification_cues: tuple[str, ...]
    policy_objects: tuple[HandbookPolicyObject, ...]


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
        )
    if len(matched_objects) > 1:
        return HandbookQueryPlan(
            status="needs_clarification",
            rewritten_query_text=normalized_query,
            clarification_reason="policy_object_conflict",
        )
    if _looks_like_unresolved_policy_object_query(normalized_query):
        return HandbookQueryPlan(
            status="needs_clarification",
            rewritten_query_text=normalized_query,
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
        / "student_handbook"
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
    clarification_cues = tuple(
        cue.strip()
        for cue in payload.get("clarification_cues", ())
        if isinstance(cue, str) and cue.strip()
    )
    return HandbookQueryPlanningConfig(
        clarification_cues=clarification_cues,
        policy_objects=policy_objects,
    )


def _match_policy_objects(normalized_query: str) -> tuple[HandbookPolicyObject, ...]:
    compact_query = _compact_text(normalized_query)
    matches: list[HandbookPolicyObject] = []
    for policy_object in _load_query_planning_config().policy_objects:
        if any(term in compact_query for term in _match_terms(policy_object)):
            matches.append(policy_object)
    return tuple(matches)


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
    if policy_object.title in normalized_query:
        return normalized_query
    return f"{policy_object.title} {normalized_query}".strip()


def _looks_like_unresolved_policy_object_query(normalized_query: str) -> bool:
    compact_query = _compact_text(normalized_query)
    return any(
        _compact_text(cue) in compact_query
        for cue in _load_query_planning_config().clarification_cues
    )


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
    "HandbookPolicyObject",
    "HandbookQueryPlan",
    "plan_student_handbook_query",
]
