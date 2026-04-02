from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import json
from pathlib import Path
import re
import unicodedata
from typing import Literal

from campus_retrieval_core.curriculum_query_resolution import interpret_curriculum_query


_WHITESPACE_RE = re.compile(r"\s+")
_DOC_NOISE = (
    "中央民族大学",
    "本科专业",
    "本科",
    "专业",
    "人才",
    "培养",
    "方案",
    "课程教学计划",
)
_DEICTIC_MAJOR_CUES = ("我这个专业", "本专业")
_COURSE_LIST_CUES = ("包括哪些课", "包括什么课")
_COURSE_AUDIENCE_CUES = ("哪些专业要上", "谁要上", "哪些人要上")
_COURSE_UNSUPPORTED_FIELD_CUES = {"offering_unit": ("哪个学院", "哪个系", "谁开", "开课学院")}


@dataclass(frozen=True, slots=True)
class CurriculumCourseEntity:
    entity_type: Literal["course", "course_family"]
    canonical_id: str
    title: str
    aliases: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class CurriculumCourseQueryPlan:
    resolution_mode: Literal["resolved_single", "resolved_family"]
    entity_type: Literal["course", "course_family"]
    canonical_course_id: str = ""
    canonical_course_title: str = ""
    canonical_course_family_id: str = ""
    canonical_course_family_title: str = ""
    internal_collection: str = "course_facts"
    unsupported_fields: tuple[str, ...] = ()
    partial_answer: bool = False


@dataclass(frozen=True, slots=True)
class CurriculumDocument:
    document_id: str
    title: str
    title_key: str


@dataclass(frozen=True, slots=True)
class CurriculumQueryPlan:
    status: Literal["pass_through", "resolved", "soft_preference", "needs_clarification"]
    rewritten_query_text: str
    target_document_ids: tuple[str, ...] = ()
    preferred_document_ids: tuple[str, ...] = ()
    clarification_reason: str = ""
    clarification_candidates: tuple[str, ...] = ()
    resolved_document_title: str = ""


@dataclass(frozen=True, slots=True)
class CurriculumFamilyAliasConfig:
    alias: str
    candidate_terms: tuple[str, ...]
    major_candidates: dict[str, tuple[str, ...]]


@dataclass(frozen=True, slots=True)
class CurriculumQueryPlanningConfig:
    safe_aliases: tuple[tuple[str, str], ...]
    family_aliases: tuple[CurriculumFamilyAliasConfig, ...]
    scoped_aliases: tuple[tuple[str, str], ...]
    forbidden_generic_aliases: tuple[str, ...]


def plan_curriculum_query(
    query_text: str,
    *,
    verified_major: str | None = None,
) -> CurriculumQueryPlan:
    interpretation = interpret_curriculum_query(query_text)
    normalized_query = interpretation.normalized_query_text
    matched_documents = _match_explicit_documents(normalized_query)
    if len(matched_documents) == 1:
        target_document = matched_documents[0]
        return CurriculumQueryPlan(
            status="resolved",
            rewritten_query_text=_prepend_title_if_missing(
                normalized_query=normalized_query,
                title=target_document.title,
            ),
            target_document_ids=(target_document.document_id,),
            resolved_document_title=target_document.title,
        )
    if len(matched_documents) > 1:
        return CurriculumQueryPlan(
            status="needs_clarification",
            rewritten_query_text=normalized_query,
            clarification_reason="curriculum_program_conflict",
            clarification_candidates=tuple(document.title for document in matched_documents[:3]),
        )

    family_resolution = _resolve_family_alias(
        normalized_query=normalized_query,
        verified_major=verified_major,
    )
    if family_resolution is not None:
        return family_resolution

    return CurriculumQueryPlan(
        status="pass_through",
        rewritten_query_text=normalized_query,
    )


def plan_curriculum_course_query(query_text: str) -> CurriculumCourseQueryPlan | None:
    normalized_query = interpret_curriculum_query(query_text).normalized_query_text
    resolved_course = _resolve_course_entity(normalized_query)
    if resolved_course is not None:
        unsupported_fields = _resolve_unsupported_course_fields(normalized_query)
        return CurriculumCourseQueryPlan(
            resolution_mode="resolved_single",
            entity_type="course",
            canonical_course_id=resolved_course.canonical_id,
            canonical_course_title=resolved_course.title,
            unsupported_fields=unsupported_fields,
            partial_answer=bool(unsupported_fields),
        )
    resolved_family = _resolve_course_family_entity(normalized_query)
    if resolved_family is None:
        return None
    unsupported_fields = _resolve_unsupported_course_fields(normalized_query)
    return CurriculumCourseQueryPlan(
        resolution_mode="resolved_family",
        entity_type="course_family",
        canonical_course_family_id=resolved_family.canonical_id,
        canonical_course_family_title=resolved_family.title,
        unsupported_fields=unsupported_fields,
        partial_answer=bool(unsupported_fields),
    )


@lru_cache(maxsize=1)
def _load_curriculum_documents() -> tuple[CurriculumDocument, ...]:
    manifest_path = (
        Path(__file__).resolve().parents[4]
        / "configs"
        / "ingestion"
        / "curriculum"
        / "curriculum_plan"
        / "split-manifest.v1.json"
    )
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    return tuple(
        CurriculumDocument(
            document_id=str(item["document_id"]).strip(),
            title=str(item["title"]).strip(),
            title_key=_compact_title_key(str(item["title"]).strip()),
        )
        for item in payload.get("documents", ())
        if isinstance(item, dict)
        and str(item.get("document_id", "")).strip()
        and str(item.get("title", "")).strip()
        and item.get("status") == "active"
    )


@lru_cache(maxsize=1)
def _load_query_planning_config() -> CurriculumQueryPlanningConfig:
    config_path = (
        Path(__file__).resolve().parents[4]
        / "configs"
        / "ingestion"
        / "curriculum"
        / "curriculum_plan"
        / "query-planning.json"
    )
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    family_aliases = tuple(
        CurriculumFamilyAliasConfig(
            alias=str(item.get("alias", "")).strip(),
            candidate_terms=tuple(
                term.strip()
                for term in item.get("candidate_terms", ())
                if isinstance(term, str) and term.strip()
            ),
            major_candidates={
                str(major).strip(): tuple(
                    str(document_id).strip()
                    for document_id in document_ids
                    if isinstance(document_id, str) and document_id.strip()
                )
                for major, document_ids in item.get("major_candidates", {}).items()
                if isinstance(major, str)
                and major.strip()
                and isinstance(document_ids, (list, tuple))
            },
        )
        for item in payload.get("family_aliases", ())
        if isinstance(item, dict) and str(item.get("alias", "")).strip()
    )
    safe_aliases = tuple(
        (
            str(item.get("alias", "")).strip(),
            str(item.get("canonical", "")).strip(),
        )
        for item in payload.get("safe_aliases", ())
        if isinstance(item, dict)
        and str(item.get("alias", "")).strip()
        and str(item.get("canonical", "")).strip()
    )
    scoped_aliases = tuple(
        (
            str(item.get("alias", "")).strip(),
            str(item.get("canonical", "")).strip(),
        )
        for item in payload.get("scoped_aliases", ())
        if isinstance(item, dict)
        and str(item.get("alias", "")).strip()
        and str(item.get("canonical", "")).strip()
    )
    forbidden_generic_aliases = tuple(
        alias.strip()
        for alias in payload.get("forbidden_generic_aliases", ())
        if isinstance(alias, str) and alias.strip()
    )
    return CurriculumQueryPlanningConfig(
        safe_aliases=safe_aliases,
        family_aliases=family_aliases,
        scoped_aliases=scoped_aliases,
        forbidden_generic_aliases=forbidden_generic_aliases,
    )


def _match_explicit_documents(normalized_query: str) -> tuple[CurriculumDocument, ...]:
    query_key = _compact_title_key(normalized_query)
    if not query_key:
        return ()
    matches = tuple(
        document
        for document in _load_curriculum_documents()
        if document.title_key and document.title_key in query_key
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


def _resolve_family_alias(
    *,
    normalized_query: str,
    verified_major: str | None,
) -> CurriculumQueryPlan | None:
    for family_alias in _load_query_planning_config().family_aliases:
        alias = family_alias.alias
        if alias not in normalized_query:
            continue
        clarification_candidates = _family_candidate_titles(family_alias)
        preferred_document_ids = _major_scoped_candidates(family_alias, verified_major)
        if any(cue in normalized_query for cue in _DEICTIC_MAJOR_CUES) and len(preferred_document_ids) == 1:
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
                )
        return CurriculumQueryPlan(
            status="needs_clarification",
            rewritten_query_text=normalized_query,
            preferred_document_ids=preferred_document_ids,
            clarification_reason="curriculum_program_family_alias",
            clarification_candidates=clarification_candidates,
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


def _family_candidate_titles(family_alias: CurriculumFamilyAliasConfig) -> tuple[str, ...]:
    titles = [
        document.title
        for document in _load_curriculum_documents()
        if any(term in document.title for term in family_alias.candidate_terms)
    ]
    return tuple(dict.fromkeys(titles[:3]))


def _document_by_id(document_id: str) -> CurriculumDocument | None:
    for document in _load_curriculum_documents():
        if document.document_id == document_id:
            return document
    return None


def _resolve_course_entity(normalized_query: str) -> CurriculumCourseEntity | None:
    if _resolve_course_family_entity(normalized_query) is not None:
        if any(cue in normalized_query for cue in _COURSE_LIST_CUES):
            return None
        if "思政课" in normalized_query or "思修课" in normalized_query:
            return None
    for entity in _course_entities():
        for alias in entity.aliases:
            if alias in normalized_query:
                return entity
        if entity.title in normalized_query:
            return entity
    return None


def _resolve_course_family_entity(normalized_query: str) -> CurriculumCourseEntity | None:
    for entity in _course_family_entities():
        if entity.title in normalized_query:
            return entity
        if any(alias in normalized_query for alias in entity.aliases):
            return entity
    return None


def _resolve_unsupported_course_fields(normalized_query: str) -> tuple[str, ...]:
    fields = []
    for field_name, cues in _COURSE_UNSUPPORTED_FIELD_CUES.items():
        if any(cue in normalized_query for cue in cues):
            fields.append(field_name)
    return tuple(fields)


@lru_cache(maxsize=1)
def _course_entities() -> tuple[CurriculumCourseEntity, ...]:
    return (
        CurriculumCourseEntity(
            entity_type="course",
            canonical_id="course:muc.marxist_basic_principles",
            title="马克思主义基本原理",
            aliases=("马原",),
        ),
        CurriculumCourseEntity(
            entity_type="course",
            canonical_id="course:muc.modern_chinese_history_outline",
            title="中国近现代史纲要",
            aliases=("史纲",),
        ),
        CurriculumCourseEntity(
            entity_type="course",
            canonical_id="course:muc.mao_zedong_thought_and_theoretical_system",
            title="毛泽东思想和中国特色社会主义理论体系概论",
            aliases=("毛概",),
        ),
        CurriculumCourseEntity(
            entity_type="course",
            canonical_id="course:muc.xigai",
            title="习近平新时代中国特色社会主义思想概论",
            aliases=("习概",),
        ),
        CurriculumCourseEntity(
            entity_type="course",
            canonical_id="course:muc.ideological_morality_and_rule_of_law",
            title="思想道德与法治",
            aliases=("思修",),
        ),
        CurriculumCourseEntity(
            entity_type="course",
            canonical_id="course:muc.situation_and_policy",
            title="形势与政策",
            aliases=("形策",),
        ),
        CurriculumCourseEntity(
            entity_type="course",
            canonical_id="course:muc.community_for_chinese_nation",
            title="中华民族共同体概论",
            aliases=("民概",),
        ),
    )


@lru_cache(maxsize=1)
def _course_family_entities() -> tuple[CurriculumCourseEntity, ...]:
    return (
        CurriculumCourseEntity(
            entity_type="course_family",
            canonical_id="course_family:muc.ideological_political_theory",
            title="思想政治理论课",
            aliases=("思政课", "思修课", "思政", "思修课", "思政课程"),
        ),
    )


def _prepend_title_if_missing(*, normalized_query: str, title: str) -> str:
    if title in normalized_query:
        return normalized_query
    title_key = _compact_title_key(title)
    query_key = _compact_title_key(normalized_query)
    if title_key and title_key in query_key:
        return normalized_query
    return f"{title} {normalized_query}".strip()


def _compact_title_key(text: str) -> str:
    normalized = _normalize_text(text)
    compact = "".join(char for char in normalized if char.isalnum() or _is_cjk_char(char))
    for noise in _DOC_NOISE:
        compact = compact.replace(_compact_text(noise), "")
    return compact


def _compact_text(text: str) -> str:
    normalized = _normalize_text(text)
    return "".join(char for char in normalized if char.isalnum() or _is_cjk_char(char))


def _normalize_text(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", unicodedata.normalize("NFKC", text)).strip().lower()


def _is_cjk_char(char: str) -> bool:
    code_point = ord(char)
    return (
        0x3400 <= code_point <= 0x4DBF
        or 0x4E00 <= code_point <= 0x9FFF
        or 0xF900 <= code_point <= 0xFAFF
    )


__all__ = [
    "CurriculumCourseQueryPlan",
    "CurriculumQueryPlan",
    "plan_curriculum_course_query",
    "plan_curriculum_query",
]
