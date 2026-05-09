from __future__ import annotations

import json
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path

from .regulation_semantic_registry_types import (
    RegulationCategoryDefinition,
    RegulationDiscoveryConfig,
    RegulationPolicyObjectDefinition,
)


def regulation_repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def student_rules_query_planning_path() -> Path:
    return (
        regulation_repo_root()
        / "configs"
        / "ingestion"
        / "regulations"
        / "student_rules"
        / "query-planning.json"
    )


def public_regulation_consumption_manifest_path() -> Path:
    return (
        regulation_repo_root()
        / "configs"
        / "ingestion"
        / "regulations"
        / "public-regulation-consumption.v1.json"
    )


def load_student_rules_discovery_config() -> RegulationDiscoveryConfig:
    payload = _load_student_rules_query_planning_config()
    return _build_student_rules_discovery_config(payload)


def load_regulation_discovery_config(collection: str) -> RegulationDiscoveryConfig:
    normalized = collection.strip()
    if normalized == "student_rules":
        return load_student_rules_discovery_config()
    if normalized == "institutional_rules":
        return load_institutional_rules_discovery_config()
    return RegulationDiscoveryConfig(
        clarification_cues=(),
        policy_objects=(),
        policy_titles_by_document_id={},
        categories=(),
    )


def load_institutional_rules_discovery_config() -> RegulationDiscoveryConfig:
    payload = _load_public_regulation_consumption_manifest()
    policy = payload.get("institutional_rules_policy", {})
    documents = tuple(
        item
        for item in payload.get("documents", ())
        if isinstance(item, Mapping)
        and str(item.get("canonical_scope") or "").strip() == "regulations/institutional_rules"
    )
    policy_objects: list[RegulationPolicyObjectDefinition] = []
    policy_titles: dict[str, str] = {}
    docs_by_group: dict[str, list[Mapping[str, object]]] = {}
    for document in documents:
        document_id = str(document.get("document_id") or "").strip()
        title = str(document.get("title") or "").strip()
        if not document_id or not title:
            continue
        aliases = tuple(
            str(alias).strip() for alias in document.get("title_aliases", ()) if str(alias).strip()
        )
        policy_objects.append(
            RegulationPolicyObjectDefinition(
                document_id=document_id,
                title=title,
                aliases=aliases,
            )
        )
        policy_titles[document_id] = title
        docs_nav_group = str(document.get("docs_nav_group") or "").strip()
        if docs_nav_group:
            docs_by_group.setdefault(docs_nav_group, []).append(document)

    nav_groups = {
        str(group.get("group_id") or "").strip(): group
        for group in payload.get("nav_groups", ())
        if isinstance(group, Mapping) and str(group.get("group_id") or "").strip()
    }
    clarification_cues = tuple(
        str(cue).strip() for cue in policy.get("scope_signal_terms", ()) if str(cue).strip()
    )
    categories: list[RegulationCategoryDefinition] = []
    for group_id, documents_in_group in docs_by_group.items():
        nav_group = nav_groups.get(group_id)
        display_name = str((nav_group or {}).get("display_name") or "").strip()
        if not display_name:
            continue
        member_policy_document_ids = tuple(
            str(document.get("document_id") or "").strip()
            for document in documents_in_group
            if str(document.get("document_id") or "").strip()
        )
        if not member_policy_document_ids:
            continue
        first_member = documents_in_group[0]
        aliases = (display_name,)
        if group_id == "public_service":
            aliases = (
                display_name,
                "校园服务",
                "校园服务制度",
                "学校服务制度",
                "学校层面的学生管理制度",
            )
        elif group_id == "staff_governance":
            aliases = (
                display_name,
                "教职工与校级治理",
                "校级治理制度",
                "教职工治理制度",
            )
        categories.append(
            RegulationCategoryDefinition(
                category_id=group_id,
                display_name=display_name,
                aliases=aliases,
                audience=("校园成员" if group_id == "public_service" else "教职工与治理参与主体"),
                member_policy_document_ids=member_policy_document_ids,
                overview_document_id=str(first_member.get("document_id") or "").strip(),
            )
        )
    return RegulationDiscoveryConfig(
        clarification_cues=clarification_cues,
        policy_objects=tuple(policy_objects),
        policy_titles_by_document_id=policy_titles,
        categories=tuple(categories),
    )


def _build_student_rules_discovery_config(
    payload: Mapping[str, object],
) -> RegulationDiscoveryConfig:
    clarification_cues = tuple(
        str(cue).strip() for cue in payload.get("clarification_cues", ()) if str(cue).strip()
    )
    policy_objects: list[RegulationPolicyObjectDefinition] = []
    policy_titles: dict[str, str] = {}
    for policy_object in payload.get("policy_objects", ()):
        if not isinstance(policy_object, Mapping):
            continue
        document_id = str(policy_object.get("document_id") or "").strip()
        title = str(policy_object.get("title") or "").strip()
        if not document_id or not title:
            continue
        aliases = tuple(
            str(alias).strip() for alias in policy_object.get("aliases", ()) if str(alias).strip()
        )
        policy_objects.append(
            RegulationPolicyObjectDefinition(
                document_id=document_id,
                title=title,
                aliases=aliases,
            )
        )
        policy_titles[document_id] = title
    categories: list[RegulationCategoryDefinition] = []
    for item in payload.get("policy_categories", ()):
        if not isinstance(item, Mapping):
            continue
        category_id = str(item.get("category_id") or "").strip()
        if not category_id:
            continue
        member_policy_document_ids = tuple(
            str(document_id).strip()
            for document_id in item.get("member_policy_document_ids", ())
            if str(document_id).strip()
        )
        if not member_policy_document_ids:
            continue
        categories.append(
            RegulationCategoryDefinition(
                category_id=category_id,
                display_name=str(item.get("display_name") or "").strip(),
                aliases=tuple(
                    str(alias).strip() for alias in item.get("aliases", ()) if str(alias).strip()
                ),
                audience=str(item.get("audience") or "").strip(),
                member_policy_document_ids=member_policy_document_ids,
                overview_document_id=str(
                    item.get("overview_document_id") or member_policy_document_ids[0]
                ).strip(),
                default_procedure_document_id=str(
                    item.get("default_procedure_document_id") or ""
                ).strip(),
                procedure_overrides=tuple(
                    (
                        str(override.get("match_term") or "").strip(),
                        str(override.get("document_id") or "").strip(),
                    )
                    for override in item.get("procedure_overrides", ())
                    if isinstance(override, Mapping)
                    and str(override.get("match_term") or "").strip()
                    and str(override.get("document_id") or "").strip()
                ),
            )
        )
    return RegulationDiscoveryConfig(
        clarification_cues=clarification_cues,
        policy_objects=tuple(policy_objects),
        policy_titles_by_document_id=policy_titles,
        categories=tuple(categories),
    )


def regulation_categories_for_document(
    *,
    collection: str,
    document_id: str,
) -> tuple[RegulationCategoryDefinition, ...]:
    discovery = load_regulation_discovery_config(collection)
    return tuple(
        category
        for category in discovery.categories
        if document_id in category.member_policy_document_ids
    )


@lru_cache(maxsize=1)
def _load_student_rules_query_planning_config_impl() -> dict[str, object]:
    return json.loads(student_rules_query_planning_path().read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _load_public_regulation_consumption_manifest() -> dict[str, object]:
    return json.loads(public_regulation_consumption_manifest_path().read_text(encoding="utf-8"))


def _load_student_rules_query_planning_config() -> dict[str, object]:
    # Preserve the historical facade patch point used by tests and callers that
    # still target campus_shared.regulation_semantic_registry after the split.
    from campus_shared import regulation_semantic_registry as registry

    facade_loader = getattr(registry, "_load_student_rules_query_planning_config", None)
    if callable(facade_loader) and facade_loader is not _load_student_rules_query_planning_config:
        return dict(facade_loader())
    return _load_student_rules_query_planning_config_impl()
