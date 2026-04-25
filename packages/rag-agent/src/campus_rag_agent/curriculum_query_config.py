from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from .curriculum_query_models import (
    CurriculumCourseEntity,
    CurriculumDocument,
    CurriculumFamilyAliasConfig,
    CurriculumQueryPlanningConfig,
    ProgramFamilyConfig,
)
from .curriculum_query_text import _compact_title_key


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


def _document_by_id(document_id: str) -> CurriculumDocument | None:
    for document in _load_curriculum_documents():
        if document.document_id == document_id:
            return document
    return None


@lru_cache(maxsize=1)
def _course_entities() -> tuple[CurriculumCourseEntity, ...]:
    return tuple(
        entity for entity in _load_course_alias_entities() if entity.entity_type == "course"
    )


@lru_cache(maxsize=1)
def _course_family_entities() -> tuple[CurriculumCourseEntity, ...]:
    return tuple(
        entity for entity in _load_course_alias_entities() if entity.entity_type == "course_family"
    )


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


def course_family_member_titles(canonical_course_family_id: str) -> tuple[str, ...]:
    return _course_family_member_titles().get(canonical_course_family_id, ())


def course_family_member_ids(canonical_course_family_id: str) -> tuple[str, ...]:
    return _course_family_member_ids().get(canonical_course_family_id, ())
