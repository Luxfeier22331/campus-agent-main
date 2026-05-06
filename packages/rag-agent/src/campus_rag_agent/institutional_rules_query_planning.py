from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal


@dataclass(frozen=True, slots=True)
class InstitutionalRuleConsumptionEntry:
    document_id: str
    docs_nav_group: Literal["student", "public_service", "staff_governance"]
    rag_default_exposure: Literal["include", "gated"]
    title: str
    title_aliases: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class InstitutionalRulesQueryPlanningConfig:
    default_nav_group: Literal["public_service", "staff_governance"]
    public_service_terms: tuple[str, ...]
    staff_governance_terms: tuple[str, ...]
    documents: tuple[InstitutionalRuleConsumptionEntry, ...]


@dataclass(frozen=True, slots=True)
class InstitutionalRulesQueryPlan:
    mode: Literal["default_public_service", "governance_targeted"]
    target_document_ids: tuple[str, ...]


_WHITESPACE_RE = re.compile(r"\s+")


def plan_institutional_rules_query(query_text: str) -> InstitutionalRulesQueryPlan:
    config = _load_institutional_rules_query_planning_config()
    normalized_query = _normalize_text(query_text)
    matched_governance_docs = _match_governance_documents(normalized_query, config.documents)
    if matched_governance_docs:
        return InstitutionalRulesQueryPlan(
            mode="governance_targeted",
            target_document_ids=matched_governance_docs,
        )
    if _contains_any(normalized_query, config.staff_governance_terms):
        return InstitutionalRulesQueryPlan(
            mode="governance_targeted",
            target_document_ids=staff_governance_document_ids(),
        )
    return InstitutionalRulesQueryPlan(
        mode="default_public_service",
        target_document_ids=public_service_document_ids(),
    )


def public_service_document_ids() -> tuple[str, ...]:
    return tuple(
        entry.document_id
        for entry in _load_institutional_rules_query_planning_config().documents
        if entry.docs_nav_group == "public_service" and entry.rag_default_exposure == "include"
    )


def staff_governance_document_ids() -> tuple[str, ...]:
    return tuple(
        entry.document_id
        for entry in _load_institutional_rules_query_planning_config().documents
        if entry.docs_nav_group == "staff_governance"
    )


@lru_cache(maxsize=1)
def _load_institutional_rules_query_planning_config() -> InstitutionalRulesQueryPlanningConfig:
    config_path = (
        Path(__file__).resolve().parents[4]
        / "configs"
        / "ingestion"
        / "regulations"
        / "public-regulation-consumption.v1.json"
    )
    payload = json.loads(config_path.read_text(encoding="utf-8"))
    policy = payload.get("institutional_rules_policy", {})
    documents = tuple(
        InstitutionalRuleConsumptionEntry(
            document_id=str(item["document_id"]).strip(),
            docs_nav_group=str(item["docs_nav_group"]).strip(),
            rag_default_exposure=str(item["rag_default_exposure"]).strip(),
            title=str(item["title"]).strip(),
            title_aliases=tuple(
                alias.strip()
                for alias in item.get("title_aliases", ())
                if isinstance(alias, str) and alias.strip()
            ),
        )
        for item in payload.get("documents", ())
        if isinstance(item, dict)
        and str(item.get("canonical_scope", "")).strip() == "regulations/institutional_rules"
    )
    return InstitutionalRulesQueryPlanningConfig(
        default_nav_group=str(policy.get("default_nav_group", "public_service")).strip(),
        public_service_terms=tuple(
            term.strip()
            for term in policy.get("public_service_terms", ())
            if isinstance(term, str) and term.strip()
        ),
        staff_governance_terms=tuple(
            term.strip()
            for term in policy.get("staff_governance_terms", ())
            if isinstance(term, str) and term.strip()
        ),
        documents=documents,
    )


def _match_governance_documents(
    normalized_query: str,
    documents: tuple[InstitutionalRuleConsumptionEntry, ...],
) -> tuple[str, ...]:
    matched_document_ids: list[str] = []
    for entry in documents:
        if entry.docs_nav_group != "staff_governance":
            continue
        candidates = (entry.title, *entry.title_aliases)
        if any(_normalize_text(candidate) and _normalize_text(candidate) in normalized_query for candidate in candidates):
            matched_document_ids.append(entry.document_id)
    return tuple(dict.fromkeys(matched_document_ids))


def _contains_any(value: str, terms: tuple[str, ...]) -> bool:
    return any(_normalize_text(term) in value for term in terms if _normalize_text(term))


def _normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", str(value or ""))
    normalized = _WHITESPACE_RE.sub("", normalized)
    return normalized.lower()
