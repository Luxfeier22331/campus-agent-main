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
_COURSE_SCHEDULE_CUES = ("第几学期开", "什么学期开", "哪学期开", "开设学期", "开课学期")
_COURSE_UNSUPPORTED_FIELD_CUES = {"offering_unit": ("哪个学院", "哪个系", "谁开", "开课学院")}
_PROGRAM_FAMILY_MEMBERSHIP_CUES = ("有哪些", "有哪几个", "都有哪些", "包括哪些")
_PROGRAM_FAMILY_NAME_PATTERN_PREFIXES = ("名称里带", "名字里带")
_PROGRAM_FAMILY_QUERY_BLOCKERS = (
    "培养方案",
    "学期",
    "大一",
    "大二",
    "大三",
    "大四",
    "大五",
    "课程",
    "课表",
    "总学分",
)


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
    fact_intent: Literal["generic", "audience", "family_membership", "schedule"] = "generic"
    canonical_course_id: str = ""
    canonical_course_title: str = ""
    canonical_course_family_id: str = ""
    canonical_course_family_title: str = ""
    internal_collection: str = "course_facts"
    unsupported_fields: tuple[str, ...] = ()
    partial_answer: bool = False


@dataclass(frozen=True, slots=True)
class CurriculumProgramFamilyQueryPlan:
    resolution_mode: Literal["resolved_family", "needs_clarification"]
    canonical_program_family_id: str = ""
    canonical_program_family_title: str = ""
    internal_collection: str = "program_family_facts"
    clarification_reason: str = ""
    clarification_candidates: tuple[str, ...] = ()


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
    used_verified_identity: bool = False
    used_soft_preference: bool = False
    candidate_title_summary: tuple[str, ...] = ()


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


@dataclass(frozen=True, slots=True)
class ProgramFamilyConfig:
    canonical_program_family_id: str
    canonical_program_family_title: str
    match_aliases: tuple[str, ...]
    mode: Literal["direct_answer_family", "clarify_first_family"]
    clarification_options: tuple[str, ...] = ()


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
        clarification_candidates = tuple(document.title for document in matched_documents[:3])
        return CurriculumQueryPlan(
            status="needs_clarification",
            rewritten_query_text=normalized_query,
            clarification_reason="curriculum_program_conflict",
            clarification_candidates=clarification_candidates,
            candidate_title_summary=clarification_candidates,
        )

    family_resolution = _resolve_family_alias(
        normalized_query=normalized_query,
        verified_major=verified_major,
    )
    if family_resolution is not None:
        return family_resolution

    forbidden_family_resolution = _resolve_forbidden_generic_family_alias(normalized_query)
    if forbidden_family_resolution is not None:
        return forbidden_family_resolution

    return CurriculumQueryPlan(
        status="pass_through",
        rewritten_query_text=normalized_query,
    )


def plan_curriculum_course_query(query_text: str) -> CurriculumCourseQueryPlan | None:
    normalized_query = interpret_curriculum_query(query_text).normalized_query_text
    fact_intent = _resolve_course_fact_intent(normalized_query)
    resolved_course = _resolve_course_entity(normalized_query)
    if resolved_course is not None:
        unsupported_fields = _resolve_unsupported_course_fields(normalized_query)
        return CurriculumCourseQueryPlan(
            resolution_mode="resolved_single",
            entity_type="course",
            fact_intent=fact_intent,
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
        fact_intent=fact_intent,
        canonical_course_family_id=resolved_family.canonical_id,
        canonical_course_family_title=resolved_family.title,
        unsupported_fields=unsupported_fields,
        partial_answer=bool(unsupported_fields),
    )


def plan_curriculum_program_family_query(query_text: str) -> CurriculumProgramFamilyQueryPlan | None:
    interpretation = interpret_curriculum_query(query_text)
    normalized_query = interpretation.normalized_query_text
    if not _is_program_family_membership_query(normalized_query):
        return None
    families = sorted(
        _load_program_family_configs(),
        key=lambda item: max((len(alias) for alias in item.match_aliases), default=0),
        reverse=True,
    )
    for family in families:
        if not any(alias in normalized_query for alias in family.match_aliases):
            continue
        if family.mode == "direct_answer_family":
            return CurriculumProgramFamilyQueryPlan(
                resolution_mode="resolved_family",
                canonical_program_family_id=family.canonical_program_family_id,
                canonical_program_family_title=family.canonical_program_family_title,
            )
        return CurriculumProgramFamilyQueryPlan(
            resolution_mode="needs_clarification",
            canonical_program_family_title=family.canonical_program_family_title,
            clarification_reason=f"program_family:{family.canonical_program_family_id}",
            clarification_candidates=family.clarification_options,
        )
    return None


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


@lru_cache(maxsize=1)
def _load_program_family_configs() -> tuple[ProgramFamilyConfig, ...]:
    config_path = (
        Path(__file__).resolve().parents[4]
        / "configs"
        / "ingestion"
        / "curriculum"
        / "program_family_facts"
        / "family-governance.json"
    )
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    results: list[ProgramFamilyConfig] = []
    for item in payload.get("families", ()):
        if not isinstance(item, dict):
            continue
        canonical_program_family_id = str(item.get("canonical_program_family_id", "")).strip()
        canonical_program_family_title = str(item.get("canonical_program_family_title", "")).strip()
        mode = str(item.get("mode", "")).strip()
        if not canonical_program_family_id or not canonical_program_family_title:
            continue
        if mode not in {"direct_answer_family", "clarify_first_family"}:
            continue
        results.append(
            ProgramFamilyConfig(
                canonical_program_family_id=canonical_program_family_id,
                canonical_program_family_title=canonical_program_family_title,
                match_aliases=tuple(
                    value.strip()
                    for value in item.get("match_aliases", ())
                    if isinstance(value, str) and value.strip()
                ),
                mode=mode,
                clarification_options=tuple(
                    value.strip()
                    for value in item.get("clarification_options", ())
                    if isinstance(value, str) and value.strip()
                ),
            )
        )
    return tuple(results)


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
        preferred_document_ids = _major_scoped_candidates(family_alias, verified_major)
        clarification_candidates = _prioritize_clarification_candidates(
            clarification_candidates=_family_candidate_titles(family_alias),
            preferred_document_ids=preferred_document_ids,
        )
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


def _resolve_course_fact_intent(
    normalized_query: str,
) -> Literal["generic", "audience", "family_membership", "schedule"]:
    if any(cue in normalized_query for cue in _COURSE_LIST_CUES):
        return "family_membership"
    if any(cue in normalized_query for cue in _COURSE_AUDIENCE_CUES):
        return "audience"
    if any(cue in normalized_query for cue in _COURSE_SCHEDULE_CUES):
        return "schedule"
    return "generic"


def _is_program_family_membership_query(normalized_query: str) -> bool:
    if not any(cue in normalized_query for cue in _PROGRAM_FAMILY_MEMBERSHIP_CUES):
        return False
    if any(prefix in normalized_query for prefix in _PROGRAM_FAMILY_NAME_PATTERN_PREFIXES):
        return True
    if any(blocker in normalized_query for blocker in _PROGRAM_FAMILY_QUERY_BLOCKERS):
        return False
    return True


@lru_cache(maxsize=1)
def _course_entities() -> tuple[CurriculumCourseEntity, ...]:
    return tuple(entity for entity in _load_course_alias_entities() if entity.entity_type == "course")


@lru_cache(maxsize=1)
def _course_family_entities() -> tuple[CurriculumCourseEntity, ...]:
    return tuple(entity for entity in _load_course_alias_entities() if entity.entity_type == "course_family")


@lru_cache(maxsize=1)
def _course_family_member_titles() -> dict[str, tuple[str, ...]]:
    if "course_family:muc.ideological_political_theory" not in {
        entity.canonical_id for entity in _course_family_entities()
    }:
        return {}
    return {
        "course_family:muc.ideological_political_theory": tuple(
            entity.title for entity in _course_entities()
        )
    }


@lru_cache(maxsize=1)
def _course_family_member_ids() -> dict[str, tuple[str, ...]]:
    if "course_family:muc.ideological_political_theory" not in {
        entity.canonical_id for entity in _course_family_entities()
    }:
        return {}
    return {
        "course_family:muc.ideological_political_theory": tuple(
            entity.canonical_id for entity in _course_entities()
        )
    }


@lru_cache(maxsize=1)
def _load_course_alias_entities() -> tuple[CurriculumCourseEntity, ...]:
    config_path = (
        Path(__file__).resolve().parents[4]
        / "configs"
        / "ingestion"
        / "curriculum"
        / "course_facts"
        / "alias-governance.json"
    )
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    results: list[CurriculumCourseEntity] = []
    for item in payload.get("entities", ()):
        if not isinstance(item, dict):
            continue
        entity_type = str(item.get("entity_type", "")).strip()
        canonical_id = str(item.get("canonical_id", "")).strip()
        title = str(item.get("title", "")).strip()
        if entity_type not in {"course", "course_family"}:
            continue
        if not canonical_id or not title:
            continue
        results.append(
            CurriculumCourseEntity(
                entity_type=entity_type,
                canonical_id=canonical_id,
                title=title,
                aliases=tuple(
                    value.strip()
                    for value in item.get("aliases", ())
                    if isinstance(value, str) and value.strip()
                ),
            )
    )
    return tuple(results)


def _clarification_options_for_program_family_alias(alias: str) -> tuple[str, ...]:
    normalized_alias = _normalize_text(alias)
    for family in _load_program_family_configs():
        if family.mode != "clarify_first_family":
            continue
        if any(_normalize_text(value) == normalized_alias for value in family.match_aliases):
            return family.clarification_options
    return ()


def _query_contains_more_specific_family_alias(normalized_query: str, alias: str) -> bool:
    normalized_alias = _normalize_text(alias)
    for family in _load_program_family_configs():
        for match_alias in family.match_aliases:
            normalized_match_alias = _normalize_text(match_alias)
            if normalized_match_alias == normalized_alias:
                continue
            if normalized_alias in normalized_match_alias and normalized_match_alias in normalized_query:
                return True
    return False


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


def course_family_member_titles(canonical_course_family_id: str) -> tuple[str, ...]:
    return _course_family_member_titles().get(canonical_course_family_id, ())


def course_family_member_ids(canonical_course_family_id: str) -> tuple[str, ...]:
    return _course_family_member_ids().get(canonical_course_family_id, ())


__all__ = [
    "CurriculumCourseQueryPlan",
    "CurriculumProgramFamilyQueryPlan",
    "CurriculumQueryPlan",
    "course_family_member_ids",
    "course_family_member_titles",
    "plan_curriculum_course_query",
    "plan_curriculum_program_family_query",
    "plan_curriculum_query",
]
